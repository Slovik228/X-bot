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

# Init SQLite DB: copy the pre-built template if the volume's DB is missing OR EMPTY.
# The template lives at /app/custom.db.template (outside the volume mount point).
# A previous deploy may have left an empty 0-byte custom.db on the volume, so we
# check the file size, not just existence.
DB_SIZE=$(stat -c %s /app/db/custom.db 2>/dev/null || echo 0)
echo "[startup] current DB size: ${DB_SIZE} bytes"

if [ "$DB_SIZE" -lt 1024 ]; then
  echo "[startup] DB missing or empty - copying template..."
  if [ -f /app/custom.db.template ]; then
    TEMPLATE_SIZE=$(stat -c %s /app/custom.db.template)
    echo "[startup] template size: ${TEMPLATE_SIZE} bytes"
    if [ "$TEMPLATE_SIZE" -gt 1024 ]; then
      rm -f /app/db/custom.db /app/db/custom.db-journal
      cp /app/custom.db.template /app/db/custom.db
      chmod 644 /app/db/custom.db
      echo "[startup] DB copied from template."
    else
      echo "[startup] ERROR: template is also empty - running prisma db push..."
      DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma db push failed"
    fi
  else
    echo "[startup] ERROR: no template at /app/custom.db.template - running prisma db push..."
    DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma db push failed"
  fi
else
  echo "[startup] DB file exists with content - skipping init."
fi

echo "[startup] final DB size: $(stat -c %s /app/db/custom.db 2>/dev/null || echo 0) bytes"

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
exec node server.js
