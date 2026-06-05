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
// KONEKSI MQTT KE AWS
// ==========================================
const AWS_MQTT_IP = "52.220.167.235";
const mqttClient = mqtt.connect(`mqtt://${AWS_MQTT_IP}:1883`, {
  clientId: 'NodeJS-BackendServer'
});

const Datastore = require('@seald-io/nedb');

// ==========================================
// INISIALISASI NEDB (Database Lokal Tanpa Install)
// ==========================================
const db = new Datastore({ filename: 'sensor_data.db', autoload: true });
console.log('✅ Terhubung ke NeDB lokal (sensor_data.db)');

mqttClient.on('connect', () => {
  console.log(`✅ Terhubung ke MQTT Broker AWS di ${AWS_MQTT_IP}`);
  // Berlangganan (subscribe) ke status terbaru dari ESP32
  mqttClient.subscribe('traffic_light/status');
  // Berlangganan ke data sensor
  mqttClient.subscribe('traffic_light/sensor');
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
      
      // Simpan ke NeDB
      const newSensorData = {
        suhu: data.suhu,
        kelembapan: data.kelembapan,
        timestamp: Date.now()
      };
      
      db.insert(newSensorData, (err, newDoc) => {
        if (err) {
          console.error("Gagal menyimpan ke NeDB:", err);
        } else {
          // Broadcast ke UI SPA secara realtime
          io.emit('sensor_data', data);
          console.log(`Data Sensor Disimpan ke NeDB: Suhu ${data.suhu}C, Kelembapan ${data.kelembapan}%`);
        }
      });
    } catch (e) {
      console.error("Gagal memparsing JSON dari MQTT sensor. Isi pesan: ", message.toString());
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public'))); 

// ==========================================
// ENDPOINT UNTUK FRONTEND SPA KITA
// ==========================================

// Mengambil data historis dengan filter waktu
app.get('/api/sensor-history', (req, res) => {
  const filter = req.query.filter || 'last20';
  let query = {};
  let dataLimit = 20; // Default limit untuk 'last20'

  if (filter !== 'last20') {
    let hoursToSubtract = 0;
    if (filter === '1h') { hoursToSubtract = 1; dataLimit = 150; } // Asumsi 150 titik cukup untuk 1 jam
    else if (filter === '4h') { hoursToSubtract = 4; dataLimit = 200; }
    else if (filter === '24h') { hoursToSubtract = 24; dataLimit = 300; }

    const timeAgo = Date.now() - (hoursToSubtract * 60 * 60 * 1000);
    query = { timestamp: { $gte: timeAgo } };
  }

  db.find(query).sort({ timestamp: -1 }).limit(dataLimit).exec((err, docs) => {
    if (err) {
      res.status(500).json({ error: "Gagal mengambil data riwayat sensor" });
    } else {
      // Kita balik arraynya agar data terlama di kiri dan terbaru di kanan grafik
      res.json(docs.reverse());
    }
  });
});

app.post('/api/traffic', (req, res) => {
  const { action } = req.body; 
  // action berisi: 'merah', 'kuning', 'hijau', atau 'off'
  if (['merah', 'kuning', 'hijau', 'off'].includes(action)) {
    // Tembak perintah ke AWS MQTT, yang akan diteruskan ke ESP32
    mqttClient.publish('traffic_light/command', action);
    res.json({ message: `Perintah '${action}' berhasil dikirim ke AWS MQTT.` });
  } else {
    res.status(400).json({ error: "Perintah tidak valid" });
  }
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
