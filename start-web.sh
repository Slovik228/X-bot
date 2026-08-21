#!/bin/bash
# start-web.sh - load .env, init SQLite DB from template, then start Next.js.
set -e

echo "=== Slopius startup ==="

if [ -f /app/.env ]; then
  set -a
  . /app/.env
  set +a
  echo "[startup] .env loaded (TWITTER_BOT_HANDLE=${TWITTER_BOT_HANDLE:-unset})"
else
  echo "[startup] WARNING: no .env file found"
fi

echo "[startup] working dir: $(pwd)"
echo "[startup] node: $(node -v 2>&1)"
echo "[startup] server.js exists: $([ -f /app/server.js ] && echo yes || echo no)"

# Init SQLite DB: if the volume doesn't have custom.db, copy the pre-built
# template (created at Docker build time, with schema already pushed).
# This is 100x more reliable than running prisma db push at runtime.
if [ ! -f /app/db/custom.db ]; then
  echo "[startup] DB file not found on volume - copying template..."
  if [ -f /app/db/custom.db.template ]; then
    cp /app/db/custom.db.template /app/db/custom.db
    echo "[startup] DB copied from template."
  else
    echo "[startup] WARNING: no DB template found - app may crash on DB queries."
  fi
else
  echo "[startup] DB file exists - skipping init."
fi

echo "[startup] DB file: $(ls -la /app/db/custom.db 2>&1 || echo 'missing')"

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
exec node server.js
