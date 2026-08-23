#!/bin/bash
# start-web.sh - load .env, ALWAYS init fresh SQLite DB from template, then start Next.js.
set -e

echo "=== Slopius startup ==="

# Load .env if present (supplements Dockerfile ENV vars)
if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
  echo "[startup] .env loaded"
fi

echo "[startup] working dir: $(pwd)"
echo "[startup] TWITTER_BOT_HANDLE: ${TWITTER_BOT_HANDLE:-unset}"
echo "[startup] DATABASE_URL: ${DATABASE_URL:-unset}"
echo "[startup] AI_API_KEY set: $([ -n "$AI_API_KEY" ] && echo yes || echo no)"

# ALWAYS copy fresh DB from template (avoids corruption/permission/schema issues).
# The template was pre-built at Docker build time with the correct schema.
# Tweet history is lost on each restart, but the bot re-seeds users automatically.
echo "[startup] copying fresh DB from template..."
if [ -f /app/custom.db.template ]; then
  TEMPLATE_SIZE=$(stat -c %s /app/custom.db.template)
  echo "[startup] template size: ${TEMPLATE_SIZE} bytes"
  if [ "$TEMPLATE_SIZE" -gt 1024 ]; then
    rm -f /app/db/custom.db /app/db/custom.db-journal /app/db/custom.db-wal /app/db/custom.db-shm
    cp /app/custom.db.template /app/db/custom.db
    chmod 666 /app/db/custom.db
    chmod 777 /app/db
    echo "[startup] fresh DB copied from template + permissions set."
  else
    echo "[startup] ERROR: template is empty! Running prisma db push..."
    DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma failed"
  fi
else
  echo "[startup] ERROR: no template found! Running prisma db push..."
  DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma failed"
fi

echo "[startup] final DB: $(ls -la /app/db/custom.db 2>&1)"

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
exec node server.js
