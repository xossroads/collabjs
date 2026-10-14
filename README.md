# CollabJS

A real-time collaborative JavaScript code editor built for technical interviews, pair programming, and live coding sessions.

![CollabJS](client/public/collabJS.png)

## Features

- **Real-time Collaboration** - Multiple users can edit the same document simultaneously with zero conflicts, powered by CRDT technology
- **Live Cursors** - See exactly where other users are typing and selecting in real-time
- **Shared Console** - Execute JavaScript code and view output together - everyone sees the results instantly
- **Sandboxed Execution** - Code runs in an isolated iframe that can't touch the page, your storage, or the API
- **Syntax Validation** - Catch syntax errors before running with accurate line numbers (powered by Acorn)
- **Multiple Themes** - Choose from ~35 editor color schemes
- **Persistent Sessions** - Code is saved automatically; rejoin anytime with the same URL
- **Room-based Sessions** - Share a unique URL to invite collaborators instantly
- **Room Hosts** - The first person to set a password becomes the room's host, with a dashboard of per-user activity, the ability to remove users, and a "nuke" that wipes the room and moves everyone to a fresh one

## Use Cases

- **Technical Interviews** - Watch candidates code in real-time
- **Pair Programming** - Collaborate with teammates remotely
- **Teaching** - Demonstrate code to students who can follow along
- **Code Reviews** - Walk through code changes together live

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vite, TypeScript, CodeMirror 6 |
| **Real-time** | Y.js (CRDT), Hocuspocus 3 WebSocket |
| **Backend** | Express, Node.js 18+ |
| **Database** | PostgreSQL |
| **Infrastructure** | Docker, Nginx, Cloudflare |
| **Syntax Parsing** | Acorn |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (optional — without it the app runs, but nothing is persisted and host features are disabled)

### Installation

```bash
# Clone the repository
git clone https://github.com/xossroads/collabjs.git
cd collabjs

# Install dependencies
npm install

# Point the server at your database. The schema is applied automatically on
# startup, so there is no separate migration step.
export DATABASE_URL="postgresql://user:password@localhost:5432/collabjs"

# Start development servers
npm run dev
```

The app will be available at:
- **Client:** http://localhost:5173 (landing page at `/`, rooms at `/room/<id>`)
- **WebSocket Server:** ws://localhost:3000
- **REST API:** http://localhost:3001 (proxied by Vite under `/api`)

### Using Docker

```bash
# Production: nginx (TLS + Cloudflare-only origin) + app + postgres
docker compose up -d --build

# Local preview of the same stack over plain HTTP on http://localhost:8080
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The production nginx config expects a Cloudflare origin certificate in `/etc/ssl/cloudflare/` and only accepts traffic from Cloudflare's IP ranges. Those ranges live in `nginx/cloudflare-ips.conf`, which `scripts/update-cloudflare-ips.sh` regenerates; `scripts/systemd/` has a weekly timer for it.

## Project Structure

```
collabjs/
├── client/                    # Frontend application
│   ├── index.html             # Landing page ("/")
│   ├── app.html               # Editor shell ("/room/:id")
│   ├── src/
│   │   ├── landing.ts         # Landing page: "Start coding" → new room
│   │   ├── main.ts            # Editor entry point, room routing, UI, host flow
│   │   ├── editor.ts          # CodeMirror setup, Y.js/Hocuspocus binding
│   │   ├── console.ts         # Shared console, syntax validation
│   │   ├── sandbox.ts         # Sandboxed iframe runner (parent side)
│   │   ├── host.ts            # Host claim/login/kick/nuke API client
│   │   ├── awareness.ts       # Connected users display
│   │   ├── mouse-cursors.ts   # Real-time mouse cursor tracking
│   │   ├── sanitize.ts        # Validation of untrusted peer state
│   │   ├── activity.ts        # Keystroke activity reporting
│   │   ├── username.ts        # Identity management
│   │   ├── themes.ts          # Editor themes
│   │   └── *.css              # Styles
│   └── public/
│       ├── sandbox/runner.html  # Executes user code (iframe side)
│       └── robots.txt, icons, images
├── server/
│   └── src/
│       ├── index.ts           # Hocuspocus + Express servers, host API
│       ├── database.ts        # PostgreSQL operations
│       ├── schema.sql         # Database schema (applied on startup)
│       ├── cleanup.ts         # Periodic TTL cleanup
│       ├── password.ts        # Password hashing, session tokens
│       └── logging.ts         # Request logging, client IP resolution
├── nginx/                     # Production nginx config
├── scripts/                   # Cloudflare IP refresh script + systemd units
├── Dockerfile, Dockerfile.db
└── docker-compose.yml, docker-compose.dev.yml
```

## How It Works

### Real-time Collaboration

CollabJS uses [Y.js](https://yjs.dev/), a CRDT (Conflict-free Replicated Data Type) implementation, to enable real-time collaboration:

1. **Document Sync** - Text is synced via `ydoc.getText('codemirror')` with automatic conflict resolution
2. **User Presence** - The awareness protocol syncs usernames, colors, and cursor positions
3. **Shared Console** - Execution output is synced via `ydoc.getArray('console-logs')` (capped at the most recent 1000 lines)
4. **Persistence** - Hocuspocus automatically saves document state to PostgreSQL

### Code Execution

1. **Syntax Validation** - Code is parsed with Acorn before execution to catch syntax errors with accurate line numbers
2. **Sandboxed Runner** - Code runs in a hidden `sandbox="allow-scripts"` iframe. Without `allow-same-origin` it gets an opaque origin, so user code can't read the page's DOM, cookies, or localStorage, or call the API as the user
3. **Shared Output** - `console.log`/`error`/`warn`/`info` and the return value are posted back to the page and synced to collaborators

### Room Hosts

The first visitor to a room is offered the host role; setting a password claims it. The host can see each participant's activity, remove (kick) a user for 10 minutes, log out every host session, or nuke the room — which deletes its content and history and sends everyone, including anyone who reconnects later, to a fresh room together.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Enter` | Run code |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + F` | Find in editor |

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | — | Health check |
| `POST` | `/api/activity` | — | Log keystroke activity |
| `POST` | `/api/user` | — | Register/update user |
| `GET` | `/api/rooms/:id/host` | optional | Whether the room has a host (and whether the caller is it) |
| `POST` | `/api/rooms/:id/claim` | — | Claim host with a password |
| `POST` | `/api/rooms/:id/host-login` | — | Log in as the room's host |
| `POST` | `/api/rooms/:id/host/logout-all` | host | Revoke every host session |
| `GET` | `/api/rooms/:id/host/stats` | host | Per-user activity stats |
| `POST` | `/api/rooms/:id/host/kick` | host | Remove a user from the room |
| `DELETE` | `/api/rooms/:id` | host | Nuke the room |

Host endpoints take `Authorization: Bearer <token>`, using the token returned by claim or login.

## Scripts

```bash
npm run dev          # Start both client and server in development
npm run dev:client   # Start Vite dev server only
npm run dev:server   # Start backend server only
npm run build        # Build for production
npm start            # Run production server
npm run db:migrate   # Apply the schema manually with psql (optional)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://localhost:5432/collabjs` |
| `PORT` | WebSocket server port | `3000` |
| `API_PORT` | REST API port | `3001` |
| `NODE_ENV` | `production` serves the built client and trusts nginx's `X-Real-IP` | `development` |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API cross-origin | dev: `localhost:5173`; prod: none (same-origin only) |
| `MAX_WS_CONNECTIONS_PER_IP` | Concurrent WebSocket connections allowed per IP | `20` |
| `DOCUMENT_TTL_DAYS` | Delete rooms untouched for this many days (`0` disables) | `30` |
| `ACTIVITY_LOG_TTL_DAYS` | Delete activity logs older than this (`0` disables) | `90` |
| `USER_TTL_DAYS` | Delete users not seen for this long (`0` disables) | `90` |
| `CLEANUP_INTERVAL_HOURS` | How often the cleanup job runs (`0` disables) | `24` |

## Contributing

CollabJS is open source and contributions are welcome! Whether it's bug fixes, new features, documentation improvements, or feedback - we appreciate all contributions.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

This means you are free to:
- Use the software for any purpose
- Modify the source code
- Distribute copies
- Use it commercially

---

**CollabJS** is free and open source software built with Y.js, Hocuspocus, CodeMirror 6, TypeScript, Vite, and Acorn.
