#!/bin/bash
# start-web.sh - load .env, run Prisma migrations, then start Next.js.
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
echo "[startup] DATABASE_URL set: $([ -n "$DATABASE_URL" ] && echo yes || echo no)"
echo "[startup] DEEPSEEK_API_KEY set: $([ -n "$DEEPSEEK_API_KEY" ] && echo yes || echo no)"
echo "[startup] AI_API_KEY set: $([ -n "$AI_API_KEY" ] && echo yes || echo no)"
echo "[startup] FAL_KEY set: $([ -n "$FAL_KEY" ] && echo yes || echo no)"

# Run Prisma migrations (creates tables if they don't exist, safe to re-run).
# DATABASE_URL must point to PostgreSQL (set via Fly secrets).
echo "[startup] running prisma migrate deploy..."
if [ -n "$DATABASE_URL" ]; then
  bunx prisma migrate deploy 2>&1 || {
    echo "[startup] WARNING: prisma migrate failed — trying db push..."
    bunx prisma db push --accept-data-loss 2>&1 || echo "[startup] prisma db push also failed"
  }
  echo "[startup] migrations done."
else
  echo "[startup] ERROR: DATABASE_URL not set — app will crash on DB queries."
fi

echo "[startup] starting Next.js server on port ${PORT:-3000}..."
exec node server.js
