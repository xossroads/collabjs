# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
COPY shared/package*.json ./shared/

# Install dependencies exactly as locked
RUN npm ci

# Copy source code
COPY . .

# Build client and server
RUN npm run build

# Production stage
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Every workspace manifest is needed for npm to read the lockfile, but only
# the server's runtime dependencies are installed: the client ships as the
# prebuilt bundle below, and build tools (tsc, tsx, vite, @types) stay in the
# builder stage.
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
COPY shared/package*.json ./shared/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force

# Copy built assets from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# Applied by the server on startup (see applySchema in database.ts)
COPY server/src/schema.sql ./server/src/schema.sql

# Expose ports (3000 for Hocuspocus WebSocket, 3001 for REST API)
EXPOSE 3000 3001

# Run unprivileged. Everything above is root-owned and read-only to this user;
# the app writes nothing to disk.
USER node

# Run node directly (not via npm) so node is PID 1 and receives SIGTERM from
# `docker stop` itself. Hocuspocus installs a SIGTERM handler that flushes
# open documents to the database before exiting.
CMD ["node", "server/dist/index.js"]
