// public/app.js
const socket = io();
const contactsTable = document.querySelector('#contactsTable tbody');
const statusEl = document.getElementById('status');
const connectionBox = document.getElementById('connectionBox');
const qrContainer = document.getElementById('qrContainer');
const qrCodeDiv = document.getElementById('qrCode');
const progressBar = document.querySelector('.progress-bar');
let countdownInterval = null;

// --- Subida de Excel ---
document.getElementById('excelFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (data?.contacts) loadContacts(data.contacts);
});

// --- Subida de media ---
document.getElementById('fileMedia').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('media', file);
  const res = await fetch('/upload-media', { method: 'POST', body: formData });
  const data = await res.json();
  if (data?.filename) document.getElementById('mediaName').innerText = `📎 Archivo cargado: ${data.filename}`;
});

// --- Bot control buttons ---
document.getElementById('startBtn').addEventListener('click', () => {
  socket.emit('config', {
    message: document.getElementById('message').value,
    intervalMin: document.getElementById('intervalMin').value,
    intervalMax: document.getElementById('intervalMax').value
  });
  socket.emit('start');
  document.getElementById('excelFileForm').style.display = 'none';
  document.getElementById('fileSendForm').style.display = 'none';
  document.getElementById('configSendForm').style.display = 'none';
});
document.getElementById('pauseBtn').addEventListener('click', () => socket.emit('pause'));
document.getElementById('resumeBtn').addEventListener('click', () => socket.emit('resume'));
document.getElementById('cancelBtn').addEventListener('click', () => {
	socket.emit('cancel')
	document.getElementById('excelFileForm').style.display = 'block';
	document.getElementById('fileSendForm').style.display = 'block';
	document.getElementById('configSendForm').style.display = 'block';
});

// --- Socket.io listeners ---
socket.on('contacts', contacts => loadContacts(contacts));
socket.on('update', contact => updateContact(contact));
socket.on('status', msg => statusEl.textContent = msg);

socket.on('progress', data => {
  const percent = Math.floor((data.current / data.total) * 100);
  progressBar.style.width = percent + '%';
  statusEl.textContent = `📤 Enviando a ${data.contact} (${data.current}/${data.total})`;
});

// countdown for delay
socket.on('delay', msg => {
  const match = msg.match(/(\d+)\s*segundos/);
  if (!match) return;
  let secondsLeft = parseInt(match[1]);
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      statusEl.textContent = "🚀 Enviando siguiente mensaje...";
      return;
    }
    statusEl.textContent = `⏱ Próximo envío en ${secondsLeft} segundos...`;
    secondsLeft--;
  }, 1000);
});

socket.on('qr', qr => {
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=200x200`;
  qrCodeDiv.innerHTML = '';
  qrCodeDiv.appendChild(img);
});

socket.on('whatsapp-status', data => {
  if (data.status === 'connected') {
    connectionBox.textContent = 'Conectado a WhatsApp';
    connectionBox.style.background = '#25d366';
    qrContainer.style.display = 'none';
	
	document.getElementById('excelFileForm').style.display = 'block';
	document.getElementById('fileSendForm').style.display = 'block';
	document.getElementById('configSendForm').style.display = 'block';
	document.getElementById('btnControl').style.display = 'block';
	document.getElementById('contactSend').style.display = 'block';
  } else if (data.status === 'qr') {
    connectionBox.textContent = 'Escaneá el código QR';
    connectionBox.style.background = '#f39c12';
    qrContainer.style.display = 'block';
	
	document.getElementById('excelFileForm').style.display = 'none';
	document.getElementById('fileSendForm').style.display = 'none';
	document.getElementById('configSendForm').style.display = 'none';
	document.getElementById('btnControl').style.display = 'none';
	document.getElementById('contactSend').style.display = 'none';
  } else if (data.status === 'disconnected') {
    connectionBox.textContent = 'Desconectado';
    connectionBox.style.background = '#e74c3c';
    qrContainer.style.display = 'none';
	
	document.getElementById('excelFileForm').style.display = 'none';
	document.getElementById('fileSendForm').style.display = 'none';
	document.getElementById('configSendForm').style.display = 'none';
	document.getElementById('btnControl').style.display = 'none';
	document.getElementById('contactSend').style.display = 'none';
  } else {
    connectionBox.textContent = data.status;
  }
});

socket.on('buttons', data => {
  if (!data.showStart) {
	  document.getElementById('startBtn').style.display = data.showStart = 'none';
	  document.getElementById('excelFileForm').style.display = 'none';
	  document.getElementById('fileSendForm').style.display = 'none';
	  document.getElementById('configSendForm').style.display = 'none';
  }
  document.getElementById('pauseBtn').style.display = data.showPause ? 'inline-block' : 'none';
  document.getElementById('resumeBtn').style.display = data.showResume ? 'inline-block' : 'none';
  document.getElementById('cancelBtn').style.display = data.showCancel ? 'inline-block' : 'none';
});

// --- Tabla contactos helpers ---
function loadContacts(contacts) {
  contactsTable.innerHTML = '';
  contacts.forEach(c => addContact(c));
}
function addContact(c) {
  const row = contactsTable.insertRow();
  row.insertCell().textContent = c.Nombre || '';
  row.insertCell().textContent = c.Numero || '';
  row.insertCell().textContent = c.Interes || '';
  row.insertCell().textContent = c.Estado || '';
  row.insertCell().textContent = c.Archivo || '';
  row.insertCell().textContent = c.Tiempo || '';
}
function updateContact(c) {
  const rows = contactsTable.rows;
  for (let r of rows) {
    if (r.cells[1].textContent == c.Numero) {
      r.cells[3].textContent = c.Estado;
      r.cells[4].textContent = c.Archivo;
      r.cells[5].textContent = c.Tiempo;
      break;
    }
  }
}