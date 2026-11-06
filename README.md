# Secure Connect and Communication Platform

Lab 4 for Web Dev III. This project includes a Node.js / Express API, JWT authentication, bcrypt password hashing, private note CRUD, authenticated Socket.IO chat, role-based access control, and EventEmitter activity logs.

## Run it

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env` and set `JWT_SECRET` to a random secret at least 32 characters long.
4. Run `npm start` and open <http://localhost:5000>.

The server creates `data/store.json` on first run. Accounts and notes persist there; passwords are stored as bcrypt hashes. Keep `.env` and the `data` folder private. This file-backed store is suitable for the lab and a single server process; use MongoDB for multi-process or production deployment.

To create an administrator, set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before starting the server. The server bootstraps that account with an admin role; public signups always receive the regular user role. The administrator can sign in normally and call `GET /api/admin/users`. Never commit real credentials.

## API

All JSON errors use `{ "message": "..." }`. Pass the login token as `Authorization: Bearer <token>` for protected endpoints.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health check |
| `POST` | `/api/auth/signup` | Public | Create account: `{ "username", "email", "password" }` |
| `POST` | `/api/auth/login` | Public | Sign in: `{ "email", "password" }`; returns JWT and user |
| `GET` | `/api/auth/me` | JWT | Current account |
| `GET` | `/api/notes` | JWT | List your notes |
| `POST` | `/api/notes` | JWT | Create note: `{ "title", "content" }` |
| `GET` | `/api/notes/:id` | JWT | Read your note |
| `PUT` | `/api/notes/:id` | JWT | Update your note |
| `DELETE` | `/api/notes/:id` | JWT | Delete your note |
| `GET` | `/api/admin/users` | Admin JWT | List public user records |

Signup returns `201 { "message": "User registered", "id": "...", "username": "...", "email": "..." }`. Login returns `200 { "message": "Login successful", "token": "...", "user": { ... } }`. A notes request without a bearer token returns `403 { "message": "No token provided" }`.

## Real-time chat

The browser connects to Socket.IO with `{ auth: { token } }`. The server verifies the JWT before accepting a connection. Clients emit `chat:join` with a room name (letters, digits, `_`, and `-`, up to 32 characters) and `chat:message` with `{ "room", "text" }`. Messages are broadcast to members of that room and logged through Node's `EventEmitter`; chat history is intentionally ephemeral.

## Try the API with PowerShell

After starting the server, create and log in to an account:

```powershell
$signup = @{ username = 'victor'; email = 'victor@example.com'; password = 'a-strong-password' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/signup -ContentType 'application/json' -Body $signup

$login = @{ email = 'victor@example.com'; password = 'a-strong-password' } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/auth/login -ContentType 'application/json' -Body $login
$headers = @{ Authorization = "Bearer $($session.token)" }
Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/notes -ContentType 'application/json' -Headers $headers -Body (@{ title = 'My First Note'; content = 'This is my first note.' } | ConvertTo-Json)
Invoke-RestMethod -Uri http://localhost:5000/api/notes -Headers $headers
```
