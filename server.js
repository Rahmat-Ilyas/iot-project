const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

// Impor modul konfigurasi database & layanan modular
const socketService = require('./services/socket');
const mqttService = require('./services/mqtt');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Inisialisasi Layanan via Dependency Injection runtime
socketService.init(io, mqttService);
mqttService.init(socketService);

// Middleware Express
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hubungkan Router API terpusat
app.use('/api', apiRoutes(mqttService, socketService));

// Menjalankan Server di Port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 IoT Backend API berjalan di http://localhost:${PORT}`);
});
