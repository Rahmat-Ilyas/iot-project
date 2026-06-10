const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const mqtt = require('mqtt');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ==========================================
// INISIALISASI NEDB (Database Lokal)
// ==========================================
const Datastore = require('@seald-io/nedb');
const db = new Datastore({ filename: 'sensor_data.db', autoload: true });
const securityDb = new Datastore({ filename: 'security_data.db', autoload: true });
const settingsDb = new Datastore({ filename: 'settings_data.db', autoload: true });
console.log('✅ Terhubung ke NeDB lokal (sensor, security, settings)');

// ==========================================
// KONEKSI MQTT KE AWS DINAMIS
// ==========================================
let mqttClient = null;

function setupMQTT(ip, port = 1883) {
  if (mqttClient) {
    console.log(`🔌 Memutuskan koneksi MQTT lama...`);
    mqttClient.end(true); // Putus paksa
  }

  console.log(`⏳ Menghubungkan ke MQTT Broker di ${ip}:${port}...`);
  mqttClient = mqtt.connect(`mqtt://${ip}:${port}`, {
    clientId: 'NodeJS-BackendServer-' + Math.random().toString(16).substring(2, 8)
  });

  mqttClient.on('connect', () => {
    console.log(`✅ Terhubung ke MQTT Broker di ${ip}`);
    mqttClient.subscribe('traffic_light/status');
    mqttClient.subscribe('traffic_light/sensor');
    mqttClient.subscribe('traffic_light/security');
  });

  mqttClient.on('message', (topic, message) => {
    if (topic === 'traffic_light/status') {
      try {
        const data = JSON.parse(message.toString());
        io.emit('traffic_update', data.status);
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT status");
      }
    } else if (topic === 'traffic_light/sensor') {
      try {
        const data = JSON.parse(message.toString());
        
        const newSensorData = {
          suhu: data.suhu,
          kelembapan: data.kelembapan,
          timestamp: Date.now()
        };
        
        db.insert(newSensorData, (err, newDoc) => {
          if (!err) {
            io.emit('sensor_data', data);
            console.log(`Data Sensor Disimpan: Suhu ${data.suhu}C, Kelembapan ${data.kelembapan}%`);
          }
        });
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT sensor");
      }
    } else if (topic === 'traffic_light/security') {
      try {
        const data = JSON.parse(message.toString());
        if (data.motion) {
          const securityLog = { event: 'Motion Detected', timestamp: Date.now() };
          securityDb.insert(securityLog, (err, newDoc) => {
            if (!err) {
              io.emit('security_alert', securityLog);
              console.log(`🚨 Peringatan Keamanan: Gerakan terdeteksi!`);
            }
          });
        }
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT security.");
      }
    }
  });
}

// Mulai sistem MQTT saat server nyala
settingsDb.findOne({ key: 'mqtt_config' }, (err, doc) => {
  if (doc && doc.value) {
    setupMQTT(doc.value.ip, doc.value.port);
  } else {
    // Fallback if old key exists
    settingsDb.findOne({ key: 'mqtt_ip' }, (err, oldDoc) => {
      const ip = oldDoc ? oldDoc.value : "52.220.167.235";
      setupMQTT(ip, 1883);
    });
  }
});

// Middleware
app.use(cors());
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public'))); 

// ==========================================
// ENDPOINT UNTUK FRONTEND SPA KITA
// ==========================================

// Mengambil data historis dengan filter waktu dan merata-ratakan data sesuai rentang waktu
app.get('/api/sensor-history', (req, res) => {
  const filter = req.query.filter || 'last20';

  if (filter === 'last20') {
    db.find({}).sort({ timestamp: -1 }).limit(20).exec((err, docs) => {
      if (err) return res.status(500).json({ error: "Gagal mengambil data" });
      return res.json(docs.reverse());
    });
    return;
  }

  let hoursToSubtract = 0;
  let intervalMs = 1;

  if (filter === '1h') { 
    hoursToSubtract = 1; 
    intervalMs = 60 * 1000; // rata-rata per 1 menit
  } 
  else if (filter === '4h') { 
    hoursToSubtract = 4; 
    intervalMs = 5 * 60 * 1000; // rata-rata per 5 menit
  } 
  else if (filter === '24h') { 
    hoursToSubtract = 24; 
    intervalMs = 30 * 60 * 1000; // rata-rata per 30 menit
  }

  const timeAgo = Date.now() - (hoursToSubtract * 60 * 60 * 1000);
  const query = { timestamp: { $gte: timeAgo } };

  // Ambil semua data dalam rentang waktu tersebut lalu kelompokkan di server
  db.find(query).sort({ timestamp: 1 }).exec((err, docs) => {
    if (err) return res.status(500).json({ error: "Gagal mengambil data" });

    if (docs.length === 0) return res.json([]);

    const grouped = {};
    docs.forEach(doc => {
      // Bulatkan ke interval waktu terdekat
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

// Mengambil 50 data historis keamanan terakhir
app.get('/api/security-history', (req, res) => {
  securityDb.find({}).sort({ timestamp: -1 }).limit(50).exec((err, docs) => {
    if (err) {
      res.status(500).json({ error: "Gagal mengambil data riwayat keamanan" });
    } else {
      res.json(docs);
    }
  });
});

app.post('/api/traffic', (req, res) => {
  const { action } = req.body; 
  // action berisi: 'merah', 'kuning', 'hijau', atau 'off'
  if (['merah', 'kuning', 'hijau', 'off'].includes(action)) {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish('traffic_light/command', action);
      res.json({ message: `Perintah '${action}' berhasil dikirim.` });
    } else {
      res.status(503).json({ error: "Server belum terhubung ke MQTT Broker" });
    }
  } else {
    res.status(400).json({ error: "Perintah tidak valid" });
  }
});

// ==========================================
// ENDPOINT PENGATURAN MQTT DINAMIS
// ==========================================
app.get('/api/settings/mqtt', (req, res) => {
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

app.post('/api/settings/mqtt', (req, res) => {
  const { ip, port } = req.body;
  if (!ip) return res.status(400).json({ error: "IP MQTT harus diisi" });
  const mqttPort = port || 1883;

  settingsDb.update({ key: 'mqtt_config' }, { $set: { value: { ip, port: mqttPort } } }, { upsert: true }, (err) => {
    if (err) return res.status(500).json({ error: "Gagal menyimpan pengaturan" });
    
    setupMQTT(ip, mqttPort);
    res.json({ message: `Pengaturan MQTT berhasil diubah menjadi ${ip}:${mqttPort} dan sedang menghubungkan ulang...` });
  });
});

// Endpoint lama (Sensor Cahaya/Banjir) dibiarkan agar tidak rusak
app.post('/api/sensor', (req, res) => {
    const { cahaya, statusLampu, air, statusBanjir } = req.body;
    io.emit('sensor_update', req.body);
    res.status(200).json({ message: "Data berhasil diterima server!" });
});

// Jalankan Server di port 3000
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 IoT Backend API berjalan di http://localhost:${PORT}`);
});
