#!/bin/sh
# start-web.sh — init SQLite DB (if missing) then start the Next.js server.
set -e
if [ ! -f /app/db/custom.db ]; then
  echo "[startup] DB file not found — running prisma db push..."
  DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss --skip-generate
  echo "[startup] DB initialized."
fi
exec node server.js
