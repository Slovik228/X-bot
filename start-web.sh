#!/bin/sh
# start-web.sh — load .env, init SQLite DB (if missing), then start Next.js.
set -e

echo "=== Slopius startup ==="

# Load .env into the process environment (Node standalone doesn't auto-load .env).
if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
  echo "[startup] .env loaded (TWITTER_BOT_HANDLE=${TWITTER_BOT_HANDLE:-unset})"
else
  echo "[startup] WARNING: no .env file found"
fi

echo "[startup] working dir: $(pwd)"
echo "[startup] node: $(node --version 2>&1)"
echo "[startup] server.js exists: $([ -f /app/server.js ] && echo yes || echo no)"
echo "[startup] .next/static exists: $([ -d /app/.next/static ] && echo yes || echo no)"
echo "[startup] prisma schema exists: $([ -f /app/prisma/schema.prisma ] && echo yes || echo no)"
echo "[startup] db dir: $(ls -la /app/db 2>&1 | head -3)"

# Init SQLite DB on first boot (persistent volume mount).
if [ ! -f /app/db/custom.db ]; then
  echo "[startup] DB file not found — running prisma db push..."
  DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss --skip-generate 2>&1 || {
    echo "[startup] WARNING: prisma db push failed — continuing anyway"
  }
  echo "[startup] DB init step done."
else
  echo "[startup] DB file exists — skipping init."
fi

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
# Use 'exec' so the process becomes PID 1 and receives SIGTERM for graceful shutdown.
exec node server.js
