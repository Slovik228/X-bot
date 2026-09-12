#!/bin/bash
set -e
echo "=== Slopius startup ==="
if [ -f /app/.env ]; then
  set -a; . /app/.env; set +a
fi
echo "[startup] TWITTER_BOT_HANDLE: ${TWITTER_BOT_HANDLE:-unset}"
echo "[startup] DATABASE_URL: ${DATABASE_URL:-unset}"
echo "[startup] DEEPSEEK_API_KEY set: $([ -n "$DEEPSEEK_API_KEY" ] && echo yes || echo no)"
echo "[startup] AI_API_KEY set: $([ -n "$AI_API_KEY" ] && echo yes || echo no)"
echo "[startup] FAL_KEY set: $([ -n "$FAL_KEY" ] && echo yes || echo no)"

# ALWAYS copy fresh DB from template
echo "[startup] copying fresh DB from template..."
rm -f /app/db/custom.db /app/db/custom.db-journal
if [ -f /app/custom.db.template ]; then
  cp /app/custom.db.template /app/db/custom.db
  chmod 666 /app/db/custom.db
  echo "[startup] fresh DB copied."
else
  echo "[startup] no template, running prisma db push..."
  bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma failed"
fi

echo "[startup] starting Next.js..."
exec node server.js
