#!/bin/sh
# start-web.sh — load .env, init SQLite DB (if missing), then start Next.js.
set -e

# Load .env into the process environment (Node standalone doesn't auto-load .env).
if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
  echo "[startup] .env loaded"
else
  echo "[startup] WARNING: no .env file found"
fi

# Init SQLite DB on first boot (persistent volume mount).
if [ ! -f /app/db/custom.db ]; then
  echo "[startup] DB file not found — running prisma db push..."
  DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss --skip-generate || {
    echo "[startup] WARNING: prisma db push failed — app will start without DB init."
    echo "[startup] The app may error on DB queries. Check fly logs for details."
  }
  echo "[startup] DB init step done."
else
  echo "[startup] DB file exists — skipping init."
fi

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
exec node server.js
