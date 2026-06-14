const socket = io(); // Menghubungkan otomatis ke server induk yang menyajikan halaman ini
let currentRelayState = 'OFF';

const connBadge = document.getElementById('connection-badge');
const relayStateEl = document.getElementById('relay-state');
const relayToggleBtn = document.getElementById('btn-relay-toggle');

socket.on('connect', () => {
  console.log('[Socket.io] Terhubung ke server!');
  connBadge.textContent = 'Terhubung';
  connBadge.className = 'badge connected';
});

socket.on('disconnect', () => {
  console.log('[Socket.io] Koneksi terputus!');
  connBadge.textContent = 'Terputus...';
  connBadge.className = 'badge disconnected';
});

socket.on('relay_update', (status) => {
  console.log('[Socket.io] Terima status relay terbaru:', status);
  updateUI(status);
});

function updateUI(status) {
  currentRelayState = status.toUpperCase();
  relayStateEl.textContent = currentRelayState;
  
  if (currentRelayState === 'ON') {
    relayStateEl.className = 'status-indicator on';
    relayToggleBtn.textContent = 'Matikan Relay';
    relayToggleBtn.className = 'btn btn-primary btn-relay active';
  } else {
    relayStateEl.className = 'status-indicator off';
    relayToggleBtn.textContent = 'Nyalakan Relay';
    relayToggleBtn.className = 'btn btn-primary btn-relay';
  }
}

// Event Listeners
relayToggleBtn.addEventListener('click', () => {
  const targetState = currentRelayState === 'ON' ? 'OFF' : 'ON';
  console.log(`[UI] Mengirim perintah Relay: ${targetState}`);
  socket.emit('control_relay', targetState);
});
