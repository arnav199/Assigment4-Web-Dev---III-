require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { EventEmitter } = require('node:events');

const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';
const DATA_FILE = path.resolve(process.env.DATA_FILE || './data/store.json');
const SALT_ROUNDS = 12;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET in .env to a random value at least 32 characters long.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const events = new EventEmitter();

function loadStore() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], notes: [] }, null, 2));
  try {
    const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { users: Array.isArray(store.users) ? store.users : [], notes: Array.isArray(store.notes) ? store.notes : [] };
  } catch (error) {
    console.error(`Could not read ${DATA_FILE}: ${error.message}`);
    process.exit(1);
  }
}

const store = loadStore();
function saveStore() {
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}
function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}
function sendError(res, status, message) {
  return res.status(status).json({ message });
}
function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return sendError(res, 403, 'No token provided');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = store.users.find((entry) => entry.id === payload.sub);
    if (!user) return sendError(res, 401, 'User account not found');
    req.user = user;
    next();
  } catch {
    return sendError(res, 401, 'Invalid or expired token');
  }
}
function requireRole(role) {
  return (req, res, next) => req.user.role === role
    ? next()
    : sendError(res, 403, 'You do not have permission to access this resource');
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Secure Connect' }));

app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (username.length < 2 || username.length > 32) return sendError(res, 400, 'Username must be 2–32 characters');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, 'Enter a valid email address');
    if (password.length < 8 || password.length > 72) return sendError(res, 400, 'Password must be 8–72 characters');
    if (store.users.some((user) => user.email === email)) return sendError(res, 409, 'An account with this email already exists');
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = {
      id: crypto.randomUUID(), username, email, passwordHash,
      role: 'user',
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    saveStore();
    events.emit('user:registered', { id: user.id, email: user.email });
    return res.status(201).json({ message: 'User registered', id: user.id, username: user.username, email: user.email });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = store.users.find((entry) => entry.email === email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return sendError(res, 401, 'Invalid email or password');
    const token = signToken(user);
    events.emit('user:login', { id: user.id, email: user.email });
    return res.json({ message: 'Login successful', token, user: publicUser(user) });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', authenticate, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/notes', authenticate, (req, res) => {
  const notes = store.notes.filter((note) => note.owner === req.user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(notes.map(({ owner, ...note }) => note));
});

app.post('/api/notes', authenticate, (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!title || title.length > 100) return sendError(res, 400, 'Title is required and must be at most 100 characters');
  if (content.length > 10000) return sendError(res, 400, 'Note content must be at most 10,000 characters');
  const now = new Date().toISOString();
  const note = { id: crypto.randomUUID(), title, content, owner: req.user.id, createdAt: now, updatedAt: now };
  store.notes.push(note);
  saveStore();
  events.emit('note:created', { noteId: note.id, userId: req.user.id });
  const { owner, ...result } = note;
  res.status(201).json(result);
});

app.get('/api/notes/:id', authenticate, (req, res) => {
  const note = store.notes.find((entry) => entry.id === req.params.id && entry.owner === req.user.id);
  if (!note) return sendError(res, 404, 'Note not found');
  const { owner, ...result } = note;
  res.json(result);
});

app.put('/api/notes/:id', authenticate, (req, res) => {
  const note = store.notes.find((entry) => entry.id === req.params.id && entry.owner === req.user.id);
  if (!note) return sendError(res, 404, 'Note not found');
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : note.title;
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : note.content;
  if (!title || title.length > 100) return sendError(res, 400, 'Title is required and must be at most 100 characters');
  if (content.length > 10000) return sendError(res, 400, 'Note content must be at most 10,000 characters');
  note.title = title;
  note.content = content;
  note.updatedAt = new Date().toISOString();
  saveStore();
  events.emit('note:updated', { noteId: note.id, userId: req.user.id });
  const { owner, ...result } = note;
  res.json(result);
});

app.delete('/api/notes/:id', authenticate, (req, res) => {
  const index = store.notes.findIndex((entry) => entry.id === req.params.id && entry.owner === req.user.id);
  if (index === -1) return sendError(res, 404, 'Note not found');
  const [note] = store.notes.splice(index, 1);
  saveStore();
  events.emit('note:deleted', { noteId: note.id, userId: req.user.id });
  res.json({ message: 'Note deleted' });
});

app.get('/api/admin/users', authenticate, requireRole('admin'), (_req, res) => {
  res.json(store.users.map(publicUser));
});

app.use('/api', (_req, res) => sendError(res, 404, 'API endpoint not found'));

events.on('user:registered', ({ email }) => console.log(`[event] account registered: ${email}`));
events.on('user:login', ({ email }) => console.log(`[event] login: ${email}`));
events.on('note:created', ({ noteId, userId }) => console.log(`[event] note created: ${noteId} by ${userId}`));
events.on('note:updated', ({ noteId, userId }) => console.log(`[event] note updated: ${noteId} by ${userId}`));
events.on('note:deleted', ({ noteId, userId }) => console.log(`[event] note deleted: ${noteId} by ${userId}`));
events.on('chat:message', ({ room, username, text }) => console.log(`[${room}] ${username}: ${text}`));

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token || '', JWT_SECRET);
    const user = store.users.find((entry) => entry.id === payload.sub);
    if (!user) return next(new Error('Authentication required'));
    socket.user = publicUser(user);
    next();
  } catch { next(new Error('Authentication required')); }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username} (${socket.id})`);
  socket.on('chat:join', (requestedRoom) => {
    const room = typeof requestedRoom === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(requestedRoom) ? requestedRoom : 'general';
    for (const current of socket.rooms) if (current !== socket.id) socket.leave(current);
    socket.join(room);
    socket.emit('chat:joined', { room, username: socket.user.username });
    console.log(`${socket.user.username} joined room ${room}`);
  });
  socket.on('chat:message', (payload) => {
    const room = typeof payload?.room === 'string' && socket.rooms.has(payload.room) ? payload.room : 'general';
    const text = typeof payload?.text === 'string' ? payload.text.trim().slice(0, 1000) : '';
    if (!text) return;
    const message = { id: crypto.randomUUID(), room, username: socket.user.username, text, sentAt: new Date().toISOString() };
    events.emit('chat:message', message);
    io.to(room).emit('chat:message', message);
  });
  socket.on('disconnect', (reason) => console.log(`User disconnected: ${socket.user.username} (${reason})`));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof SyntaxError && 'body' in err) return sendError(res, 400, 'Request body must be valid JSON');
  return sendError(res, 500, 'Internal server error');
});

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password || password.length < 8) {
    console.warn('Admin bootstrap skipped: set both ADMIN_EMAIL and an ADMIN_PASSWORD of at least 8 characters.');
    return;
  }
  if (store.users.some((user) => user.email === email)) return;
  const user = { id: crypto.randomUUID(), username: 'Administrator', email, passwordHash: await bcrypt.hash(password, SALT_ROUNDS), role: 'admin', createdAt: new Date().toISOString() };
  store.users.push(user);
  saveStore();
  console.log(`Administrator account ready: ${email}`);
}

bootstrapAdmin().then(() => {
  server.listen(PORT, () => console.log(`Secure Connect listening at http://localhost:${PORT}`));
}).catch((error) => {
  console.error('Could not initialize the application:', error);
  process.exit(1);
});
