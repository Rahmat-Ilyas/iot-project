const express = require('express');
const { sensorDb, securityDb, settingsDb } = require('../config/db');

/**
 * Pemetaan Route Express API
 * @param {object} mqttService - Layanan MQTT Client
 * @param {object} socketService - Layanan Socket.io Server
 * @returns {object} Router Express
 */
module.exports = function (mqttService, socketService) {
  const router = express.Router();

  // Ambil histori data sensor DHT11 dengan filter waktu
  router.get('/sensor-history', (req, res) => {
    const filter = req.query.filter || 'last20';

    if (filter === 'last20') {
      sensorDb.find({}).sort({ timestamp: -1 }).limit(20).exec((err, docs) => {
        if (err) return res.status(500).json({ error: "Gagal mengambil data" });
        return res.json(docs.reverse());
      });
      return;
    }

    let hoursToSubtract = 0;
    let intervalMs = 1;

    if (filter === '1h') { 
      hoursToSubtract = 1; 
      intervalMs = 60 * 1000; // Bulatkan rata-rata per 1 menit
    } 
    else if (filter === '4h') { 
      hoursToSubtract = 4; 
      intervalMs = 5 * 60 * 1000; // Bulatkan rata-rata per 5 menit
    } 
    else if (filter === '24h') { 
      hoursToSubtract = 24; 
      intervalMs = 30 * 60 * 1000; // Bulatkan rata-rata per 30 menit
    }

    const timeAgo = Date.now() - (hoursToSubtract * 60 * 60 * 1000);
    const query = { timestamp: { $gte: timeAgo } };

    sensorDb.find(query).sort({ timestamp: 1 }).exec((err, docs) => {
      if (err) return res.status(500).json({ error: "Gagal mengambil data" });
      if (docs.length === 0) return res.json([]);

      const grouped = {};
      docs.forEach(doc => {
        const timeBucket = Math.floor(doc.timestamp / intervalMs) * intervalMs;
        if (!grouped[timeBucket]) {
          grouped[timeBucket] = { count: 0, sumSuhu: 0, sumHum: 0 };
        }
        grouped[timeBucket].count += 1;
        grouped[timeBucket].sumSuhu += doc.suhu;
        grouped[timeBucket].sumHum += doc.kelembapan;
      });

      const result = Object.keys(grouped).map(bucket => {
        const g = grouped[bucket];
        return {
          timestamp: parseInt(bucket),
          suhu: parseFloat((g.sumSuhu / g.count).toFixed(2)),
          kelembapan: parseFloat((g.sumHum / g.count).toFixed(2))
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      res.json(result);
    });
  });

  // Ambil log histori alarm PIR (gerak)
  router.get('/security-history', (req, res) => {
    securityDb.find({}).sort({ timestamp: -1 }).limit(50).exec((err, docs) => {
      if (err) {
        res.status(500).json({ error: "Gagal mengambil data riwayat keamanan" });
      } else {
        res.json(docs);
      }
    });
  });

  // Kontrol lampu lalu lintas
  router.post('/traffic', (req, res) => {
    const { action } = req.body; // 'merah', 'kuning', 'hijau', atau 'off'
    if (['merah', 'kuning', 'hijau', 'off'].includes(action)) {
      if (mqttService.isConnected()) {
        mqttService.publishTrafficCommand(action);
        res.json({ message: `Perintah '${action}' berhasil dikirim.` });
      } else {
        res.status(503).json({ error: "Server belum terhubung ke MQTT Broker" });
      }
    } else {
      res.status(400).json({ error: "Perintah tidak valid" });
    }
  });

  // Dapatkan pengaturan IP/Port MQTT saat ini
  router.get('/settings/mqtt', (req, res) => {
    settingsDb.findOne({ key: 'mqtt_config' }, (err, doc) => {
      if (doc && doc.value) {
        res.json({ ip: doc.value.ip, port: doc.value.port });
      } else {
        settingsDb.findOne({ key: 'mqtt_ip' }, (err, oldDoc) => {
          res.json({ ip: oldDoc ? oldDoc.value : "52.220.167.235", port: 1883 });
        });
      }
    });
  });

  // Simpan pengaturan IP/Port MQTT baru
  router.post('/settings/mqtt', (req, res) => {
    const { ip, port } = req.body;
    if (!ip) return res.status(400).json({ error: "IP MQTT harus diisi" });
    const mqttPort = port || 1883;

    settingsDb.update({ key: 'mqtt_config' }, { $set: { value: { ip, port: mqttPort } } }, { upsert: true }, (err) => {
      if (err) return res.status(500).json({ error: "Gagal menyimpan pengaturan" });
      
      mqttService.setupMQTT(ip, mqttPort);
      res.json({ message: `Pengaturan MQTT berhasil diubah menjadi ${ip}:${mqttPort} dan sedang menghubungkan ulang...` });
    });
  });

  // Kontrol relay ON/OFF dari API luar / 3rd party integration
  router.post('/relay', (req, res) => {
    const { command } = req.body; // 'on' atau 'off'
    if (command === 'on' || command === 'off') {
      if (mqttService.isConnected()) {
        mqttService.publishRelayCommand(command);
        res.json({ success: true, message: `Command ${command} dikirim ke relay` });
      } else {
        res.status(503).json({ success: false, message: 'Server belum terhubung ke MQTT Broker' });
      }
    } else {
      res.status(400).json({ success: false, message: 'Command tidak valid. Gunakan "on" atau "off"' });
    }
  });

  // Endpoint warisan / legacy
  router.post('/sensor', (req, res) => {
    socketService.emit('sensor_update', req.body);
    res.status(200).json({ message: "Data berhasil diterima server!" });
  });

  return router;
};
