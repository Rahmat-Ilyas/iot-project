const Datastore = require('@seald-io/nedb');
const path = require('path');

// Menggunakan path absolute relatif terhadap root direktori server agar aman dijalankan dari subfolder mana pun
const sensorDb = new Datastore({ filename: path.join(__dirname, '../sensor_data.db'), autoload: true });
const securityDb = new Datastore({ filename: path.join(__dirname, '../security_data.db'), autoload: true });
const settingsDb = new Datastore({ filename: path.join(__dirname, '../settings_data.db'), autoload: true });

console.log('✅ Terhubung ke NeDB lokal (sensor, security, settings)');

module.exports = {
  sensorDb,
  securityDb,
  settingsDb
};
