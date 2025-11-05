/* server.js
 Desafio de Damas - Demo backend (sandbox)
 - Express + Socket.IO + SQLite (better-sqlite3)
 - PixUp integration placeholders (sandbox). Adapt webhook logic to PixUp payload.
*/
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PIXUP_BASE = process.env.PIXUP_API_URL || 'https://api.pixup.com.br/sandbox';
const PIXUP_CLIENT_ID = process.env.PIXUP_CLIENT_ID || '';
const PIXUP_CLIENT_SECRET = process.env.PIXUP_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

if (!PIXUP_CLIENT_ID || !PIXUP_CLIENT_SECRET) {
  console.warn('PixUp sandbox credentials not configured. Add PIXUP_CLIENT_ID and PIXUP_CLIENT_SECRET in .env or env vars.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- DB init ---
const db = new Database('db.sqlite');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  balance REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id INTEGER,
  guest_id INTEGER,
  stake REAL,
  status TEXT DEFAULT 'waiting',
  winner_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  amount REAL,
  meta TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// --- prepared statements
const createUserStmt = db.prepare('INSERT INTO users (username) VALUES (?)');
const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const updateBalance = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
const insertTransaction = db.prepare('INSERT INTO transactions (user_id, type, amount, meta) VALUES (?, ?, ?, ?)');
const createRoomStmt = db.prepare('INSERT INTO rooms (host_id, stake) VALUES (?, ?)');
const getRoomStmt = db.prepare('SELECT * FROM rooms WHERE id = ?');
const joinRoomStmt = db.prepare('UPDATE rooms SET guest_id = ?, status = ? WHERE id = ?');
const setRoomWinnerStmt = db.prepare('UPDATE rooms SET winner_id = ?, status = ? WHERE id = ?');

// --- JWT helpers
function signUser(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'missing token' });
  const token = auth.split(' ')[1];
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch (e) {
    res.status(401).json({ error: 'invalid token' });
  }
}

// --- Auth routes
app.post('/api/register', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const info = createUserStmt.run(username);
    const user = getUserById.get(info.lastInsertRowid);
    const token = signUser(user);
    res.json({ user, token });
  } catch (e) {
    res.status(400).json({ error: 'username already exists' });
  }
});

app.post('/api/login', (req, res) => {
  const { username } = req.body;
  const user = getUserByUsername.get(username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const token = signUser(user);
  res.json({ user, token });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = getUserById.get(req.user.id);
  res.json({ user });
});

// --- Rooms (min stake enforced)
app.post('/api/rooms', authMiddleware, (req, res) => {
  const { stake } = req.body;
  const hostId = req.user.id;
  const MIN_STAKE = 10.0; // minimum stake in BRL
  if (!stake || stake <= 0) return res.status(400).json({ error: 'stake invalid' });
  if (stake < MIN_STAKE) return res.status(400).json({ error: `minimum stake is R$ ${MIN_STAKE.toFixed(2)}` });

  const user = getUserById.get(hostId);
  if (user.balance < stake) return res.status(400).json({ error: 'insufficient balance, deposit first' });

  // reserve stake: subtract stake from host balance and record transaction
  updateBalance.run(-stake, hostId);
  insertTransaction.run(hostId, 'stake', -stake, `room_reserve_host stake ${stake}`);

  const info = createRoomStmt.run(hostId, stake);
  const room = getRoomStmt.get(info.lastInsertRowid);
  res.json({ room });
});

app.post('/api/rooms/:id/join', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const guestId = req.user.id;
  const room = getRoomStmt.get(roomId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (room.status !== 'waiting') return res.status(400).json({ error: 'room not available' });
  if (room.host_id === guestId) return res.status(400).json({ error: 'cannot join your own room' });

  const guest = getUserById.get(guestId);
  if (guest.balance < room.stake) return res.status(400).json({ error: 'insufficient balance, deposit first' });

  updateBalance.run(-room.stake, guestId);
  insertTransaction.run(guestId, 'stake', -room.stake, `room_reserve_guest room:${roomId} stake ${room.stake}`);

  joinRoomStmt.run(guestId, 'playing', roomId);
  const updated = getRoomStmt.get(roomId);
  io.to(`room_${roomId}`).emit('room_started', updated);
  res.json({ room: updated });
});

app.post('/api/rooms/:id/result', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const { winnerId } = req.body;
  const room = getRoomStmt.get(roomId);
  if (!room) return res.status(404).json({ error: 'room not found' });
  if (room.status !== 'playing') return res.status(400).json({ error: 'room not playing' });
  if (![room.host_id, room.guest_id].includes(req.user.id)) return res.status(403).json({ error: 'not a participant' });

  // apply platform fee per match
  const PLATFORM_FEE = 1.00; // R$1.00 per match
  const totalStakes = (room.stake || 0) * 2;
  const payoutAmount = Math.max(0, totalStakes - PLATFORM_FEE);

  // credit the winner with payoutAmount
  updateBalance.run(payoutAmount, winnerId);
  insertTransaction.run(winnerId, 'payout', payoutAmount, `room_payout room:${roomId} winner:${winnerId}`);

  // record platform fee (store as platform transaction with user_id = 0)
  insertTransaction.run(0, 'platform_fee', PLATFORM_FEE, `room_fee room:${roomId}`);

  setRoomWinnerStmt.run(winnerId, 'finished', roomId);
  const updated = getRoomStmt.get(roomId);
  io.to(`room_${roomId}`).emit('room_finished', updated);
  res.json({ room: updated });
});

// --- Transactions
app.get('/api/transactions', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ transactions: rows });
});

// --- Withdraw endpoint (charges platform +3% fee and records transaction)
// Note: actual payout via PixUp not implemented here. This records the withdrawal
// request, deducts balance and charges platform fee (3%).
app.post('/api/withdraw', authMiddleware, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'invalid amount' });
  const user = getUserById.get(req.user.id);
  if (!user) return res.status(400).json({ error: 'user not found' });
  // platform fee of 3%
  const PLATFORM_WITHDRAW_PERCENT = 0.03;
  const fee = Math.max(0, Math.round((amount * PLATFORM_WITHDRAW_PERCENT) * 100) / 100);
  const totalDebit = Math.round((amount + fee) * 100) / 100;
  if (user.balance < totalDebit) return res.status(400).json({ error: 'insufficient balance including fees' });

  // debit user
  updateBalance.run(-totalDebit, user.id);
  insertTransaction.run(user.id, 'withdraw_request', -amount, `withdraw_request amount:${amount}`);
  insertTransaction.run(user.id, 'withdraw_fee', -fee, `withdraw_fee:${fee}`);

  // record platform fee income (platform transaction)
  insertTransaction.run(0, 'platform_withdraw_fee', fee, `withdraw_fee user:${user.id}`);

  // In production here you would call PixUp payout API to actually send the money.
  res.json({ ok: true, amount: amount, fee: fee, debited: totalDebit });
});

// --- PixUp example: token + create charge
async function getPixupToken() {
  if (!PIXUP_CLIENT_ID || !PIXUP_CLIENT_SECRET) throw new Error('PixUp creds not configured');
  const tokenUrl = `${PIXUP_BASE}/oauth/token`;
  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');
  body.append('client_id', PIXUP_CLIENT_ID);
  body.append('client_secret', PIXUP_CLIENT_SECRET);

  const r = await fetch(tokenUrl, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('PixUp token error: ' + txt);
  }
  const data = await r.json();
  return data.access_token;
}

app.post('/api/pix/create_charge', authMiddleware, async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'invalid amount' });
  try {
    const token = await getPixupToken();
    const url = `${PIXUP_BASE}/charges`;
    const payload = {
      amount,
      description: description || 'Depósito Desafio de Damas',
      callback_url: `${PUBLIC_URL}/api/pixup/webhook`
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: 'pixup create charge failed', detail: data });
    }
    insertTransaction.run(req.user.id, 'deposit_pending', amount, JSON.stringify(data));
    res.json({ charge: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'error creating charge', msg: e.message });
  }
});

// --- PixUp webhook (example) ---
app.post('/api/pixup/webhook', async (req, res) => {
  const event = req.body;
  console.log('pixup webhook event', JSON.stringify(event).slice(0,1000));
  // TODO: adapt to PixUp webhook payload format.
  try {
    const chargeId = event?.resource?.charge_id || event?.id || null;
    const status = event?.resource?.status || event?.status || null;
    if (chargeId && (status === 'paid' || status === 'confirmed')) {
      // find pending transaction
      const pending = db.prepare("SELECT * FROM transactions WHERE meta LIKE ? AND type = 'deposit_pending'").get(`%${chargeId}%`);
      if (pending) {
        updateBalance.run(pending.amount, pending.user_id);
        insertTransaction.run(pending.user_id, 'deposit', pending.amount, `pix_confirmed:${chargeId}`);
      }
    }
    res.status(200).send('ok');
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).send('error');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO realtime
io.on('connection', (socket) => {
  console.log('socket connected', socket.id);
  socket.on('join_room', (roomId) => {
    socket.join(`room_${roomId}`);
    console.log(`socket ${socket.id} joined room_${roomId}`);
  });
  socket.on('move', (payload) => {
    io.to(`room_${payload.roomId}`).emit('move', payload.move);
  });
  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  console.log(`PUBLIC_URL=${PUBLIC_URL}`);
});
