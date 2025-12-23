// bot.js
const express = require('express');
const fileUpload = require('express-fileupload');
const http = require('http');
const socketIo = require('socket.io');
const XLSX = require('xlsx');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

const MAX_PER_HOUR = 50;

app.use(express.static('public'));
app.use(fileUpload({ useTempFiles: false }));
app.use(express.json());

// session middleware (para Express y Socket.IO)
const sessionMiddleware = session({
  secret: 'damaro-secret-session',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// asegurarse de que exista la carpeta sessions
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// --- Usuarios (users.json) ---
let users = [];
const USERS_FILE = path.resolve(__dirname, 'users.json');
if (fs.existsSync(USERS_FILE)) {
  try {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (e) {
    users = [];
  }
}

// helper: guardar users
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// --- Global bots map ---
// global.bots[username] = { client, botData, ready }
global.bots = global.bots || {};

// botData shape per user:
// {
//   contacts: [], currentIndex:0, sending:false, paused:false,
//   messageText:'', intervalMin:120, intervalMax:180,
//   mediaBuffer: null, mediaMimetype: null, mediaName: null,
//   messagesSentThisHour:0, hourStart: Date.now()
// }

function createBotEntryIfMissing(username) {
  if (global.bots[username]) return global.bots[username];

  const dataPath = path.join(SESSIONS_DIR, username);
  // ensure folder
  if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: username, dataPath }),
    puppeteer: { headless: true }
  });

  const botData = {
    contacts: [],
    currentIndex: 0,
    sending: false,
    paused: false,
    messageText: '',
    intervalMin: 120,
    intervalMax: 180,
    mediaBuffer: null,
    mediaMimetype: null,
    mediaName: null,
    messagesSentThisHour: 0,
    hourStart: Date.now()
  };

  const entry = { client, botData, ready: false };
  global.bots[username] = entry;

  // event handlers
  client.on('qr', qr => {
    // emit to sockets of that user later (we'll broadcast using rooms)
    io.to(`user:${username}`).emit('qr', qr);
    io.to(`user:${username}`).emit('whatsapp-status', { status: 'qr' });
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    entry.ready = true;
    io.to(`user:${username}`).emit('whatsapp-status', { status: 'connected' });
    console.log(`Bot ready for user ${username}`);
  });

  client.on('auth_failure', msg => {
    entry.ready = false;
    io.to(`user:${username}`).emit('whatsapp-status', { status: 'disconnected', reason: 'auth_failure' });
    console.log('Auth failure for', username, msg);
  });

  client.on('disconnected', reason => {
    entry.ready = false;
    io.to(`user:${username}`).emit('whatsapp-status', { status: 'disconnected', reason });
    console.log(`Client disconnected for ${username}:`, reason);
    // try reinit after delay
    setTimeout(() => {
      try { client.initialize(); } catch (e) { console.error(e); }
    }, 5000);
  });

  // initialize client (will use existing session if saved under dataPath)
  client.initialize().catch(e => console.error('client.initialize error', e));

  return entry;
}

// --- Auth routes ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ success: false, message: 'Faltan datos' });
  if (users.find(u => u.username === username)) return res.json({ success: false, message: 'Usuario existe' });
  const hash = await bcrypt.hash(password, 10);
  users.push({ username, password: hash });
  saveUsers();
  // create bot entry folder and Client (so session folder exists)
  createBotEntryIfMissing(username);
  res.json({ success: true });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.json({ success: false, message: 'Faltan datos' });
  const user = users.find(u => u.username == username);
  if (!user) return res.json({ success: false, message: 'Usuario no encontrado' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, message: 'Credenciales inválidas' });

  // ensure bot exists and client is initialized
  createBotEntryIfMissing(username);

  req.session.user = username;
  res.json({ success: true });
});

app.post('/logout', (req, res) => {
  const username = req.session?.user;
  // leave room handled by socket disconnect; do not destroy client automatically
  req.session.destroy(() => { /* nothing */ });
  res.json({ success: true });
});

// --- Upload Excel for current user ---
app.post('/upload', (req, res) => {
  const username = req.session?.user;
  if (!username) return res.status(401).send('No autorizado');
  if (!req.files?.file) return res.status(400).send('No se subió archivo');
  try {
    const workbook = XLSX.read(req.files.file.data, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    const entry = createBotEntryIfMissing(username);
    entry.botData.contacts = rows.map(c => ({
      ...c,
      Estado: '⏳ Pendiente',
      Tiempo: '-',
      Archivo: entry.botData.mediaBuffer ? '📎 Pendiente' : '❌ Sin archivo'
    }));
    entry.botData.currentIndex = entry.botData.contacts.findIndex(c => c.Estado !== '✅ Enviado');
    if (entry.botData.currentIndex === -1) entry.botData.currentIndex = entry.botData.contacts.length;
    res.json({ total: entry.botData.contacts.length, contacts: entry.botData.contacts });
    // notify user's sockets
    io.to(`user:${username}`).emit('contacts', entry.botData.contacts);
  } catch (err) {
    //console.error(err);
    res.status(500).send('Error leyendo Excel');
  }
});

// --- Upload media (buffer only) ---
app.post('/upload-media', (req, res) => {
  const username = req.session?.user;
  if (!username) return res.status(401).send('No autorizado');
  if (!req.files?.media) return res.status(400).send('No se subió archivo');
  const entry = createBotEntryIfMissing(username);
  const media = req.files.media;
  entry.botData.mediaBuffer = media.data;
  entry.botData.mediaMimetype = media.mimetype;
  entry.botData.mediaName = media.name;
  entry.botData.contacts = entry.botData.contacts.map(c => (c.Estado !== '✅ Enviado') ? { ...c, Archivo: '📎 Pendiente' } : c);
  io.to(`user:${username}`).emit('contacts', entry.botData.contacts);
  res.json({ success: true, filename: media.name });
});

// --- Socket.io connection per user room ---
io.on('connection', socket => {
  const req = socket.request;
  const username = req.session?.user;
  if (!username) {
    // no session -> ignore
    return;
  }

  // join a room for the user to receive events
  socket.join(`user:${username}`);

  const entry = createBotEntryIfMissing(username);
  const client = entry.client;
  const botData = entry.botData;

  // send initial state
  socket.emit('contacts', botData.contacts || []);
  socket.emit('whatsapp-status', { status: entry.ready ? 'connected' : 'disconnected' });
  socket.emit('buttons', {
    showStart: !botData.sending,
    showPause: botData.sending && !botData.paused,
    showResume: botData.paused,
    showCancel: botData.sending || botData.paused
  });

  // events from client
  socket.on('config', data => {
    botData.messageText = data.message || '';
    botData.intervalMin = Math.max(10, parseInt(data.intervalMin) || 60);
    botData.intervalMax = Math.max(botData.intervalMin, parseInt(data.intervalMax) || 180);
  });

  socket.on('start', () => {
    if (botData.sending) return;
    botData.sending = true;
    botData.paused = false;
    io.to(`user:${username}`).emit('status', '🚀 Iniciando envíos...');
    io.to(`user:${username}`).emit('buttons', { showStart: false, showPause: true, showResume: false, showCancel: true });
    // start sending
    sendNextForUser(username);
  });

  socket.on('pause', () => {
    botData.paused = true;
    io.to(`user:${username}`).emit('status', '⏸ Envío pausado');
    io.to(`user:${username}`).emit('buttons', { showStart: false, showPause: false, showResume: true, showCancel: true });
  });

  socket.on('resume', () => {
    if (!botData.sending) botData.sending = true;
    botData.paused = false;
    io.to(`user:${username}`).emit('status', '▶️ Reanudando envíos...');
    io.to(`user:${username}`).emit('buttons', { showStart: false, showPause: true, showResume: false, showCancel: true });
    sendNextForUser(username);
  });

  socket.on('cancel', () => {
    botData.sending = false;
    botData.paused = false;
    io.to(`user:${username}`).emit('status', '❌ Envío cancelado');
    io.to(`user:${username}`).emit('buttons', { showStart: true, showPause: false, showResume: false, showCancel: false });
  });

  socket.on('disconnect', () => {
    socket.leave(`user:${username}`);
  });
});

// --- sendNextForUser: per-user sending loop ---
function sendNextForUser(username) {
  const entry = global.bots[username];
  if (!entry) return;
  const client = entry.client;
  const botData = entry.botData;

  if (!botData.sending || botData.paused) return;
  if (Date.now() - botData.hourStart > 3600000) { botData.messagesSentThisHour = 0; botData.hourStart = Date.now(); }
  if (botData.messagesSentThisHour >= MAX_PER_HOUR) {
    io.to(`user:${username}`).emit('status', '⚠️ Límite por hora alcanzado. Esperando...');
    setTimeout(() => sendNextForUser(username), 60000);
    return;
  }

  if (botData.currentIndex >= botData.contacts.length) {
    botData.sending = false;
    io.to(`user:${username}`).emit('status', '✅ Envíos completados');
    io.to(`user:${username}`).emit('buttons', { showStart: true, showPause: false, showResume: false, showCancel: false });
    return;
  }

  const contact = botData.contacts[botData.currentIndex];
  if (!contact?.Numero) {
    botData.currentIndex++;
    return sendNextForUser(username);
  }

  const number = `549${String(contact.Numero).replace(/\D/g, '')}@c.us`;
  const startTime = new Date().toLocaleTimeString();
  let text = botData.messageText || '';
  for (const key in contact) {
    text = text.replace(new RegExp(`{${key.toLowerCase()}}`, 'g'), contact[key]);
  }

  contact.Estado = '⏳ Enviando';
  io.to(`user:${username}`).emit('update', contact);

  (async () => {
    try {
      if (botData.mediaBuffer) {
        const media = new MessageMedia(botData.mediaMimetype, botData.mediaBuffer.toString('base64'), botData.mediaName);
        await client.sendMessage(number, media, { caption: text });
        contact.Archivo = '✅ Enviado';
      } else {
        await client.sendMessage(number, text);
        contact.Archivo = '❌ Sin archivo';
      }
      contact.Estado = '✅ Enviado';
      contact.Tiempo = startTime;
      botData.messagesSentThisHour = (botData.messagesSentThisHour || 0) + 1;
    } catch (err) {
      console.error('Error sending to', number, err && err.message);
      contact.Estado = '⚠️ Error';
      contact.Tiempo = startTime;
      contact.Archivo = '⚠️ Error';
      io.to(`user:${username}`).emit('error', { contact: contact.Nombre || contact.Numero, error: err?.message || String(err) });
    }

    io.to(`user:${username}`).emit('update', contact);
    botData.currentIndex++;
    io.to(`user:${username}`).emit('progress', { current: botData.currentIndex, total: botData.contacts.length, contact: contact.Nombre || 'Desconocido' });

    const randomDelay = Math.floor(Math.random() * (botData.intervalMax - botData.intervalMin + 1) + botData.intervalMin);
    // countdown emit
    let secondsLeft = randomDelay;
    const countdown = setInterval(() => {
      if (secondsLeft <= 0) {
        clearInterval(countdown);
      }
      io.to(`user:${username}`).emit('delay', `⏱ Próximo envío en ${secondsLeft} segundos...`);
      secondsLeft--;
    }, 1000);

    setTimeout(() => sendNextForUser(username), randomDelay * 1000);
  })();
}

server.listen(PORT, () => console.log('Servidor corriendo en http://localhost:' + PORT));