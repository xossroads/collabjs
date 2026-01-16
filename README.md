# CollabJS

A real-time collaborative JavaScript code editor built for technical interviews, pair programming, and live coding sessions.

![CollabJS](client/public/collabJS.png)

## Features

- **Real-time Collaboration** - Multiple users can edit the same document simultaneously with zero conflicts, powered by CRDT technology
- **Live Cursors** - See exactly where other users are typing and selecting in real-time
- **Shared Console** - Execute JavaScript code and view output together - everyone sees the results instantly
- **Syntax Validation** - Catch syntax errors before running with accurate line numbers (powered by Acorn)
- **Multiple Themes** - Choose from various editor color schemes
- **Persistent Sessions** - Code is saved automatically; rejoin anytime with the same URL
- **Room-based Sessions** - Share a unique URL to invite collaborators instantly

## Use Cases

- **Technical Interviews** - Watch candidates code in real-time
- **Pair Programming** - Collaborate with teammates remotely
- **Teaching** - Demonstrate code to students who can follow along
- **Code Reviews** - Walk through code changes together live

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vite, TypeScript, CodeMirror 6 |
| **Real-time** | Y.js (CRDT), Hocuspocus WebSocket |
| **Backend** | Express, Node.js 18+ |
| **Database** | PostgreSQL |
| **Infrastructure** | Docker, Nginx |
| **Syntax Parsing** | Acorn |

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL (for persistence)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/collabjs.git
cd collabjs

# Install dependencies
npm install

# Set up the database
export DATABASE_URL="postgresql://user:password@localhost:5432/collabjs"
npm run db:migrate

# Start development servers
npm run dev
```

The app will be available at:
- **Client:** http://localhost:5173
- **WebSocket Server:** ws://localhost:3000
- **REST API:** http://localhost:3001

### Using Docker

```bash
# Start the full stack (nginx + app + postgres)
docker-compose up -d
```

## Project Structure

```
collabjs/
├── client/                 # Frontend application
│   ├── src/
│   │   ├── main.ts         # Entry point, room routing, UI
│   │   ├── editor.ts       # CodeMirror setup, Y.js binding, themes
│   │   ├── console.ts      # Code execution, syntax validation
│   │   ├── awareness.ts    # Connected users display
│   │   ├── mouse-cursors.ts # Real-time cursor tracking
│   │   ├── username.ts     # Identity management
│   │   └── styles.css      # UI styling
│   ├── public/             # Static assets (favicon, images)
│   └── index.html
├── server/
│   ├── src/
│   │   ├── index.ts        # Hocuspocus + Express servers
│   │   ├── database.ts     # PostgreSQL operations
│   │   └── schema.sql      # Database schema
│   └── package.json
├── shared/
│   └── types.ts            # Shared TypeScript types
└── docker-compose.yml
```

## How It Works

### Real-time Collaboration

CollabJS uses [Y.js](https://yjs.dev/), a CRDT (Conflict-free Replicated Data Type) implementation, to enable real-time collaboration:

1. **Document Sync** - Text is synced via `ydoc.getText('codemirror')` with automatic conflict resolution
2. **User Presence** - The awareness protocol syncs usernames, colors, and cursor positions
3. **Shared Console** - Execution output is synced via `ydoc.getArray('console-logs')`
4. **Persistence** - Hocuspocus automatically saves document state to PostgreSQL

### Code Execution

JavaScript code is executed in a sandboxed environment:

1. **Syntax Validation** - Code is parsed with Acorn before execution to catch syntax errors with accurate line numbers
2. **Sandboxed Console** - A custom console object captures `log`, `error`, `warn`, and `info` calls
3. **Shared Output** - All output is synced to collaborators in real-time

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Enter` | Run code |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + F` | Find in editor |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/activity` | Log user activity |
| `POST` | `/api/user` | Register/update user |

## Scripts

```bash
npm run dev          # Start both client and server in development
npm run dev:client   # Start Vite dev server only
npm run dev:server   # Start backend server only
npm run build        # Build for production
npm start            # Run production server
npm run db:migrate   # Run database migrations
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | WebSocket server port | `3000` |
| `API_PORT` | REST API port | `3001` |
| `NODE_ENV` | Environment mode | `development` |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

---

Built with Y.js, Hocuspocus, CodeMirror 6, TypeScript, Vite, and Acorn.
