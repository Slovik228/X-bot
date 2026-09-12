# ---- Main Next.js app (Slopius bot) ----
# Multi-stage: deps → build → slim runtime

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Set NEXT_PUBLIC_* env vars at BUILD time so Next.js inlines them into the
# client bundle. (Next.js bakes NEXT_PUBLIC_* during `next build`.)
ENV NEXT_PUBLIC_SOCKET_URL=https://slopius-relay.fly.dev
ENV NEXT_PUBLIC_BOT_HANDLE=kemocalls
RUN bunx prisma generate && bun run build
RUN mkdir -p .next/standalone/node_modules/@prisma && \
    cp -r node_modules/@prisma/client .next/standalone/node_modules/@prisma/ 2>/dev/null || true
# Pre-create the SQLite database at BUILD time (template for runtime).
RUN DATABASE_URL="file:/app/db/custom.db" bunx prisma db push --accept-data-loss
RUN ls -la /app/db/custom.db && echo "DB template created OK" || (echo "ERROR: DB template NOT created" && exit 1)

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# ---- Critical env vars (baked into image, not dependent on .env loading) ----
# Database (SQLite — until Fly Postgres is set up)
ENV DATABASE_URL=file:/app/db/custom.db
# AI API (DeepSeek primary, Groq fallback)
ENV AI_BASE_URL=https://api.groq.com/openai/v1
ENV AI_MODEL=openai/gpt-oss-120b
ENV AI_VISION_MODEL=openai/gpt-oss-120b
ENV DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
ENV DEEPSEEK_MODEL=deepseek-chat
# Twitter config (keys are set via fly secrets — AI_API_KEY, TWITTER_*)
ENV TWITTER_BOT_HANDLE=kemocalls
ENV NEXT_PUBLIC_BOT_HANDLE=kemocalls
ENV BOT_RELAY_URL=https://slopius-relay.fly.dev/internal/broadcast
ENV LISTENER_URL=https://slopius-listener.fly.dev
ENV NEXT_APP_URL=https://slopius-web.fly.dev
ENV TWITTER_INTERNAL_SECRET=local-dev-secret-change-me
# Prisma needs openssl + ca-certificates for the engine binary + HTTPS calls.
# bash is needed because start-web.sh uses bash-specific syntax.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates bash && rm -rf /var/lib/apt/lists/*
# Prisma CLI for migrations at runtime
RUN bun add -g prisma
# Copy standalone Next.js output FIRST (this is the app).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# Copy the pre-built SQLite DB template OUTSIDE the volume mount point.
COPY --from=builder /app/db/custom.db /app/custom.db.template
# Copy .env (committed to repo — contains live Twitter keys + config).
COPY --from=builder /app/.env ./.env
# Copy start script AFTER standalone (so it's not overwritten).
COPY start-web.sh ./start-web.sh
RUN chmod +x start-web.sh
EXPOSE 3000
# Use bash (not /bin/sh) — start-web.sh uses bash syntax that dash rejects.
CMD ["/bin/bash", "/app/start-web.sh"]
