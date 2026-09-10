# Dockerfile para M-NEXUS backend (v0.62.2)
#
# Multi-stage build: build deps + runtime slim
# v0.62.2: Node 22 alpine para mejor-sqlite3 y compatibilidad con crypto moderno

# ── Stage 1: deps ──
FROM node:22-alpine AS deps
WORKDIR /app

# better-sqlite3 requiere build tools
RUN apk add --no-cache python3 make g++

# Copiar solo package files para cache de capas
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# ── Stage 2: build ──
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY tsconfig*.json ./
COPY backend/ ./backend/
RUN cd backend && npx tsc

# ── Stage 3: runtime ──
FROM node:22-alpine AS runtime
WORKDIR /app

# v0.62.2: usuario no-root para seguridad
RUN addgroup -S mnexus && adduser -S mnexus -G mnexus

# Install only production deps
COPY --from=deps /app/backend/node_modules ./backend/node_modules

# Copy built app
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/
COPY backend/src/utils/migrations ./backend/dist/utils/migrations 2>/dev/null || true

# Data directory
RUN mkdir -p /data && chown mnexus:mnexus /data
WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 3000

USER mnexus

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
