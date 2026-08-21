#!/bin/sh
# start-web.sh — load .env, init SQLite DB (if missing), then start Next.js.
set -e

# Load .env into the process environment (Node standalone doesn't auto-load .env).
if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
  echo "[startup] .env loaded"
fi

# Init SQLite DB on first boot (persistent volume mount).
if [ ! -f /app/db/custom.db ]; then
  echo "[startup] DB file not found — running prisma db push..."
  DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss --skip-generate
  echo "[startup] DB initialized."
fi

exec node server.js
