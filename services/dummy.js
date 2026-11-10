const { sensorDb, securityDb, settingsDb } = require('../config/db');

let socketService = null;
let dhtTimer = null;
let pirTimer = null;

// State nilai berjalan agar perubahan suhu & kelembapan terlihat halus (natural random walk)
let currentTemp = 26.8;
let currentHum = 72.5;

const defaultConfig = {
  enabled: false,
  dhtEnabled: true,
  intervalSec: 5,
  pirEnabled: false,
  trafficMock: true
};

let currentConfig = { ...defaultConfig };

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function generateNextDHT() {
  // Random walk halus: suhu berubah -0.3 s/d +0.3 C
  const tempDelta = (Math.random() - 0.48) * 0.5;
  currentTemp = clamp(parseFloat((currentTemp + tempDelta).toFixed(1)), 23.5, 32.5);

  // Kelembapan bergerak sedikit berlawanan dengan suhu + variasi acak kecil
  const humDelta = (-tempDelta * 1.4) + ((Math.random() - 0.5) * 0.8);
  currentHum = clamp(parseFloat((currentHum + humDelta).toFixed(1)), 55.0, 88.0);

  return {
    suhu: currentTemp,
    kelembapan: currentHum
  };
}

function emitAndSaveDummyDHT() {
  if (!currentConfig.enabled || !currentConfig.dhtEnabled) return;

  const data = generateNextDHT();
  const newSensorData = {
    suhu: data.suhu,
    kelembapan: data.kelembapan,
    isDummy: true,
    timestamp: Date.now()
  };

  sensorDb.insert(newSensorData, (err) => {
    if (!err && socketService) {
      socketService.emit('sensor_data', { ...data, isDummy: true });
      console.log(`[DUMMY] Data Sensor Disimpan: Suhu ${data.suhu}°C, Kelembapan ${data.kelembapan}%`);
    }
  });
}

function triggerDummyPir(customEventText) {
  const securityLog = {
    event: customEventText || 'Motion Detected',
    isDummy: true,
    timestamp: Date.now()
  };

  securityDb.insert(securityLog, (err) => {
    if (!err && socketService) {
      socketService.emit('security_alert', securityLog);
      console.log(`🚨 [DUMMY] Peringatan Keamanan: ${securityLog.event}`);
    }
  });

  return securityLog;
}

function applyTimers() {
  if (dhtTimer) {
    clearInterval(dhtTimer);
    dhtTimer = null;
  }
  if (pirTimer) {
    clearInterval(pirTimer);
    pirTimer = null;
  }

  if (!currentConfig.enabled) {
    console.log('⏹️ [DUMMY] Mode Simulasi Data Dummy dinonaktifkan.');
    if (socketService) {
      socketService.emit('dummy_config_update', currentConfig);
    }
    return;
  }

  const intervalMs = Math.max(2, Number(currentConfig.intervalSec) || 5) * 1000;

  if (currentConfig.dhtEnabled) {
    console.log(`▶️ [DUMMY] Simulasi DHT aktif setiap ${intervalMs / 1000} detik.`);
    // Kirim data pertama segera saat diaktifkan
    emitAndSaveDummyDHT();
    dhtTimer = setInterval(emitAndSaveDummyDHT, intervalMs);
  }

  if (currentConfig.pirEnabled) {
    console.log('▶️ [DUMMY] Simulasi Sensor Gerak PIR otomatis aktif.');
    pirTimer = setInterval(() => {
      if (currentConfig.enabled && currentConfig.pirEnabled) {
        triggerDummyPir('Motion Detected');
      }
    }, 35000);
  }

  if (socketService) {
    socketService.emit('dummy_config_update', currentConfig);
  }
}

function init(socketServiceInstance) {
  socketService = socketServiceInstance;

  settingsDb.findOne({ key: 'dummy_config' }, (err, doc) => {
    if (!err && doc && doc.value) {
      currentConfig = { ...defaultConfig, ...doc.value };
    }
    applyTimers();
  });
}

function getConfig() {
  return { ...currentConfig };
}

function updateConfig(newPartialConfig, callback) {
  currentConfig = {
    ...currentConfig,
    enabled: Boolean(newPartialConfig.enabled),
    dhtEnabled: newPartialConfig.dhtEnabled !== undefined ? Boolean(newPartialConfig.dhtEnabled) : currentConfig.dhtEnabled,
    intervalSec: Math.min(60, Math.max(2, parseInt(newPartialConfig.intervalSec, 10) || 5)),
    pirEnabled: newPartialConfig.pirEnabled !== undefined ? Boolean(newPartialConfig.pirEnabled) : currentConfig.pirEnabled,
    trafficMock: newPartialConfig.trafficMock !== undefined ? Boolean(newPartialConfig.trafficMock) : currentConfig.trafficMock
  };

  settingsDb.update(
    { key: 'dummy_config' },
    { $set: { value: currentConfig } },
    { upsert: true },
    (err) => {
      applyTimers();
      if (callback) callback(err, currentConfig);
    }
  );
}

/**
 * Buat data riwayat dummy selama 24 jam ke belakang agar grafik 1h, 4h, dan 24h terisi realistis
 */
function seedHistory24h(callback) {
  const now = Date.now();
  const points = [];
  const stepMs = 15 * 60 * 1000; // Setiap 15 menit selama 24 jam (96 titik) + 20 titik terakhir tiap 10 detik
  let baseTemp = 26.5;
  let baseHum = 73.0;

  // 24 jam ke belakang per 15 menit
  for (let t = now - (24 * 60 * 60 * 1000); t < now - (4 * 60 * 1000); t += stepMs) {
    const hour = new Date(t).getHours();
    // Kurva siang-malam: lebih hangat jam 12-15 siang, lebih sejuk jam 2-5 pagi
    const diurnalOffset = Math.sin(((hour - 6) / 24) * 2 * Math.PI) * 2.2;
    const noise = (Math.random() - 0.5) * 0.6;
    const suhu = clamp(parseFloat((baseTemp + diurnalOffset + noise).toFixed(1)), 23.0, 33.0);
    const kelembapan = clamp(parseFloat((baseHum - diurnalOffset * 3.2 + (Math.random() - 0.5) * 2).toFixed(1)), 52.0, 89.0);

    points.push({
      suhu,
      kelembapan,
      isDummy: true,
      timestamp: t
    });
  }

  // 20 data terakhir (tiap 10 detik) agar tampilan "20 Data Terakhir" juga langsung rapi
  let recentTemp = 26.8;
  let recentHum = 72.0;
  for (let i = 20; i >= 1; i--) {
    recentTemp = clamp(parseFloat((recentTemp + (Math.random() - 0.48) * 0.3).toFixed(1)), 24.5, 30.5);
    recentHum = clamp(parseFloat((recentHum + (Math.random() - 0.5) * 0.6).toFixed(1)), 60.0, 84.0);
    points.push({
      suhu: recentTemp,
      kelembapan: recentHum,
      isDummy: true,
      timestamp: now - (i * 10000)
    });
  }

  currentTemp = recentTemp;
  currentHum = recentHum;

  sensorDb.insert(points, (err) => {
    if (err) {
      if (callback) callback(err);
      return;
    }
    if (socketService && points.length > 0) {
      const latest = points[points.length - 1];
      socketService.emit('sensor_data', { suhu: latest.suhu, kelembapan: latest.kelembapan, isDummy: true });
    }
    if (callback) callback(null, points.length);
  });
}

function clearDummyData(callback) {
  sensorDb.remove({ isDummy: true }, { multi: true }, (err, numRemovedSensor) => {
    if (err) return callback && callback(err);
    securityDb.remove({ isDummy: true }, { multi: true }, (err2, numRemovedSec) => {
      if (callback) callback(err2, { sensorRemoved: numRemovedSensor, securityRemoved: numRemovedSec });
    });
  });
}

module.exports = {
  init,
  getConfig,
  updateConfig,
  triggerDummyPir,
  seedHistory24h,
  clearDummyData
};

