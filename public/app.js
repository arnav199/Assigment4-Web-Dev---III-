const state = { token: localStorage.getItem('secure-connect-token'), user: null, notes: [], editingNote: null, socket: null, room: 'general', authMode: 'login' };
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let toastTimer;

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 2800);
}
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) signOut(false);
    throw new Error(body.message || 'Something went wrong. Please try again.');
  }
  return body;
}

function setSignedIn(user) {
  state.user = user;
  $('account-name').textContent = user.username;
  $('avatar').textContent = user.username.slice(0, 1).toUpperCase();
  $('account-button').classList.add('signed-in');
  $('account-menu').classList.add('hidden');
  loadNotes();
  connectChat();
}
function signOut(showMessage = true) {
  state.token = null;
  state.user = null;
  state.notes = [];
  localStorage.removeItem('secure-connect-token');
  if (state.socket) state.socket.disconnect();
  state.socket = null;
  $('account-name').textContent = 'Guest';
  $('avatar').textContent = '?';
  $('account-button').classList.remove('signed-in');
  $('notes-grid').replaceChildren();
  updateNoteCount();
  showEmptyState();
  $('room-status').textContent = 'Sign in to connect';
  if (showMessage) toast('You are signed out.');
  showAuth('login');
}
function showAuth(mode = 'login') {
  state.authMode = mode;
  const signup = mode === 'signup';
  $('auth-title').innerHTML = signup ? 'A space of<br><em>your own.</em>' : 'Make yourself<br><em>at home.</em>';
  $('auth-description').textContent = signup ? 'Create an account to get your own private notebook.' : 'Sign in to keep your notes and conversations close.';
  $('auth-kicker').textContent = signup ? 'A QUIETER KIND OF SPACE' : 'YOUR PRIVATE SPACE';
  $('username-label').classList.toggle('hidden', !signup);
  $('username-field').required = signup;
  $('password-field').autocomplete = signup ? 'new-password' : 'current-password';
  $('auth-submit').innerHTML = signup ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  document.querySelectorAll('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.authMode === mode));
  $('form-error').classList.add('hidden');
  $('auth-modal').classList.remove('hidden');
  setTimeout(() => $(signup ? 'username-field' : 'email-field').focus(), 40);
}
function closeAuth() { if (state.token) $('auth-modal').classList.add('hidden'); }

async function loadNotes() {
  if (!state.token) return showEmptyState();
  try {
    state.notes = await api('/api/notes');
    renderNotes();
  } catch (error) { if (state.token) toast(error.message); }
}
function updateNoteCount() {
  $('note-count').textContent = state.notes.length;
  $('note-total').textContent = `${state.notes.length} ${state.notes.length === 1 ? 'note' : 'notes'}`;
}
function showEmptyState() {
  $('empty-state').classList.toggle('hidden', state.notes.length > 0);
  $('notes-grid').classList.toggle('hidden', state.notes.length === 0);
}
function renderNotes() {
  updateNoteCount();
  showEmptyState();
  $('notes-grid').innerHTML = state.notes.map((note, index) => {
    const date = new Date(note.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const colors = ['mint', 'peach', 'lavender', 'butter'];
    return `<article class="note-card ${colors[index % colors.length]}" data-note-id="${escapeHTML(note.id)}"><div class="note-card-top"><span class="note-spark">✳</span><button class="note-menu" data-delete-note="${escapeHTML(note.id)}" aria-label="Delete note">···</button></div><button class="note-open" data-open-note="${escapeHTML(note.id)}"><h3>${escapeHTML(note.title)}</h3><p>${escapeHTML(note.content || 'An empty page, full of possibility.')}</p></button><div class="note-card-foot"><span>${escapeHTML(date)}</span><span class="note-arrow">↗</span></div></article>`;
  }).join('');
}
function openNote(note = null) {
  if (!state.token) return showAuth();
  state.editingNote = note;
  $('note-modal-title').textContent = note ? 'Pick up the thread.' : 'Save a thought.';
  $('note-title').value = note?.title || '';
  $('note-content').value = note?.content || '';
  $('note-save-status').textContent = 'Only you can see this.';
  $('note-modal').classList.remove('hidden');
  setTimeout(() => $('note-title').focus(), 40);
}

function connectChat() {
  if (!window.io || !state.token) return;
  if (state.socket) state.socket.disconnect();
  state.socket = window.io({ auth: { token: state.token } });
  $('room-status').textContent = 'Connecting';
  state.socket.on('connect', () => {
    $('room-status').textContent = 'Connected';
    $('room-status').parentElement.classList.add('connected');
    state.socket.emit('chat:join', state.room);
  });
  state.socket.on('disconnect', () => {
    $('room-status').textContent = 'Reconnecting';
    $('room-status').parentElement.classList.remove('connected');
  });
  state.socket.on('connect_error', () => $('room-status').textContent = 'Sign in to connect');
  state.socket.on('chat:joined', ({ room }) => {
    state.room = room;
    $('room-input').value = room;
    $('messages').innerHTML = `<div class="chat-notice"><span>✳</span><span>You joined #${escapeHTML(room)}. Say something kind.</span></div>`;
  });
  state.socket.on('chat:message', addMessage);
}
function addMessage(message) {
  if (message.room !== state.room) return;
  const notice = $('messages').querySelector('.chat-notice');
  if (notice) notice.remove();
  const own = message.username === state.user?.username;
  const row = document.createElement('article');
  row.className = `message ${own ? 'own-message' : ''}`;
  const time = new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.innerHTML = `<div class="message-avatar">${escapeHTML(message.username.slice(0, 1).toUpperCase())}</div><div class="message-body"><div class="message-meta"><strong>${escapeHTML(own ? 'You' : message.username)}</strong><time>${escapeHTML(time)}</time></div><p>${escapeHTML(message.text)}</p></div>`;
  $('messages').append(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function selectView(view) {
  if (view === 'chat' && !state.token) return showAuth();
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $('notes-view').classList.toggle('hidden', view !== 'notes');
  $('notes-view').classList.toggle('active', view === 'notes');
  $('chat-view').classList.toggle('hidden', view !== 'chat');
  $('chat-view').classList.toggle('active', view === 'chat');
  $('breadcrumb-current').textContent = view === 'chat' ? 'Live chat' : 'My notes';
}

document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => selectView(item.dataset.view)));
document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => showAuth(tab.dataset.authMode)));
$('account-button').addEventListener('click', () => {
  if (!state.token) return showAuth();
  $('account-menu').classList.toggle('hidden');
});
$('logout-button').addEventListener('click', () => signOut());
$('auth-close').addEventListener('click', closeAuth);
$('auth-modal').addEventListener('click', (event) => { if (event.target === $('auth-modal')) closeAuth(); });
$('new-note-button').addEventListener('click', () => openNote());
$('empty-create-button').addEventListener('click', () => openNote());
$('note-close').addEventListener('click', () => $('note-modal').classList.add('hidden'));
$('note-modal').addEventListener('click', (event) => { if (event.target === $('note-modal')) $('note-modal').classList.add('hidden'); });
$('notes-grid').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-note]');
  const remove = event.target.closest('[data-delete-note]');
  if (open) openNote(state.notes.find((note) => note.id === open.dataset.openNote));
  if (remove && window.confirm('Delete this note? This cannot be undone.')) {
    try { await api(`/api/notes/${encodeURIComponent(remove.dataset.deleteNote)}`, { method: 'DELETE' }); await loadNotes(); toast('Note deleted.'); }
    catch (error) { toast(error.message); }
  }
});
$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const signup = state.authMode === 'signup';
  const payload = { email: $('email-field').value, password: $('password-field').value };
  if (signup) payload.username = $('username-field').value;
  $('auth-submit').disabled = true;
  try {
    if (signup) await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) });
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: payload.email, password: payload.password }) });
    state.token = result.token;
    localStorage.setItem('secure-connect-token', result.token);
    $('auth-modal').classList.add('hidden');
    setSignedIn(result.user);
    toast(signup ? 'Your private space is ready.' : 'Welcome back.');
    $('auth-form').reset();
  } catch (error) {
    $('form-error').textContent = error.message;
    $('form-error').classList.remove('hidden');
  } finally { $('auth-submit').disabled = false; }
});
$('note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = { title: $('note-title').value, content: $('note-content').value };
  try {
    if (state.editingNote) await api(`/api/notes/${encodeURIComponent(state.editingNote.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
    $('note-modal').classList.add('hidden');
    $('note-form').reset();
    await loadNotes();
    toast(state.editingNote ? 'Note updated.' : 'Thought saved.');
  } catch (error) { $('note-save-status').textContent = error.message; }
});
$('join-room-button').addEventListener('click', () => {
  const room = $('room-input').value.trim();
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(room)) return toast('Use 1–32 letters, numbers, dashes, or underscores.');
  if (state.socket?.connected) state.socket.emit('chat:join', room);
  else showAuth();
});
$('message-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('message-input').value.trim();
  if (!text) return;
  if (!state.socket?.connected) return showAuth();
  state.socket.emit('chat:message', { room: state.room, text });
  $('message-input').value = '';
  $('message-input').focus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeAuth(); $('note-modal').classList.add('hidden'); $('account-menu').classList.add('hidden'); }
});

if (state.token) {
  api('/api/auth/me').then(({ user }) => { $('auth-modal').classList.add('hidden'); setSignedIn(user); }).catch(() => {});
} else {
  state.notes = [];
  renderNotes();
}
