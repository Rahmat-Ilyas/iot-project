let io = null;
const state = {
  currentTrafficStatus: 'Menunggu...',
  currentRelayStatus: 'OFF'
};

/**
 * Inisialisasi Layanan Socket.io
 * @param {object} socketIoInstance - Instansi Server Socket.io
 * @param {object} mqttService - Layanan MQTT Client
 */
function init(socketIoInstance, mqttService) {
  io = socketIoInstance;

  io.on('connection', (socket) => {
    // Sinkronisasi status terakhir ke klien baru
    socket.emit('traffic_update', state.currentTrafficStatus);
    socket.emit('relay_update', state.currentRelayStatus);

    // Dengar perintah kendali relay dari client web
    socket.on('control_relay', (targetState) => {
      mqttService.publishRelayCommand(targetState);
    });
  });
}

function updateRelayStatus(status) {
  state.currentRelayStatus = status.toUpperCase();
  if (io) {
    io.emit('relay_update', state.currentRelayStatus);
  }
}

function updateTrafficStatus(status) {
  state.currentTrafficStatus = status;
  if (io) {
    io.emit('traffic_update', status);
  }
}

function emit(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

module.exports = {
  init,
  updateRelayStatus,
  updateTrafficStatus,
  emit,
  state
};
