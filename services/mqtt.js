const mqtt = require('mqtt');
const { settingsDb, sensorDb, securityDb } = require('../config/db');

let mqttClient = null;
let socketService = null;

/**
 * Inisialisasi Layanan MQTT
 * @param {object} socketServiceInstance - Layanan Socket.io untuk siaran data
 */
function init(socketServiceInstance) {
  socketService = socketServiceInstance;

  // Ambil konfigurasi MQTT dari NeDB
  settingsDb.findOne({ key: 'mqtt_config' }, (err, doc) => {
    if (doc && doc.value) {
      setupMQTT(doc.value.ip, doc.value.port);
    } else {
      settingsDb.findOne({ key: 'mqtt_ip' }, (err, oldDoc) => {
        const ip = oldDoc ? oldDoc.value : "52.220.167.235";
        setupMQTT(ip, 1883);
      });
    }
  });
}

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
    mqttClient.subscribe('relay/status');
    mqttClient.subscribe('relay/command');
  });

  mqttClient.on('message', (topic, message) => {
    const msgStr = message.toString();
    
    if (topic === 'traffic_light/status') {
      try {
        const data = JSON.parse(msgStr);
        socketService.updateTrafficStatus(data.status);
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT status");
      }
    } else if (topic === 'traffic_light/sensor') {
      try {
        const data = JSON.parse(msgStr);
        const newSensorData = {
          suhu: data.suhu,
          kelembapan: data.kelembapan,
          timestamp: Date.now()
        };
        sensorDb.insert(newSensorData, (err, newDoc) => {
          if (!err) {
            socketService.emit('sensor_data', data);
            console.log(`Data Sensor Disimpan: Suhu ${data.suhu}C, Kelembapan ${data.kelembapan}%`);
          }
        });
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT sensor");
      }
    } else if (topic === 'traffic_light/security') {
      try {
        const data = JSON.parse(msgStr);
        if (data.motion) {
          const securityLog = { event: 'Motion Detected', timestamp: Date.now() };
          securityDb.insert(securityLog, (err, newDoc) => {
            if (!err) {
              socketService.emit('security_alert', securityLog);
              console.log(`🚨 Peringatan Keamanan: Gerakan terdeteksi!`);
            }
          });
        }
      } catch (e) {
        console.error("Gagal memparsing JSON dari MQTT security.");
      }
    } else if (topic === 'relay/status') {
      let status = msgStr;
      try {
        const data = JSON.parse(msgStr);
        status = data.status;
      } catch (e) {
        // Menggunakan string mentah jika bukan format JSON
      }
      socketService.updateRelayStatus(status);
      console.log(`[MQTT] Status Relay diperbarui: ${status}`);
    }
  });
}

function publishRelayCommand(state) {
  const cmd = state.toLowerCase();
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish('relay/command', cmd);
    console.log(`[MQTT] Publish command to relay: ${cmd}`);
    return true;
  }
  return false;
}

function publishTrafficCommand(action) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish('traffic_light/command', action);
    console.log(`[MQTT] Publish command to traffic: ${action}`);
    return true;
  }
  return false;
}

function isConnected() {
  return mqttClient && mqttClient.connected;
}

module.exports = {
  init,
  setupMQTT,
  publishRelayCommand,
  publishTrafficCommand,
  isConnected
};
