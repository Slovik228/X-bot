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
ENV NEXT_PUBLIC_BOT_HANDLE=Slopius
RUN bunx prisma generate && bun run build
RUN mkdir -p .next/standalone/node_modules/@prisma && \
    cp -r node_modules/@prisma/client .next/standalone/node_modules/@prisma/ 2>/dev/null || true

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Prisma needs openssl + ca-certificates for the engine binary + HTTPS calls.
# bash is needed because start-web.sh uses bash-specific syntax (set -e works in dash,
# but other constructs may not).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates bash && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/db
# Prisma CLI for DB init on first boot
RUN bun add -g prisma
# Copy standalone Next.js output FIRST (this is the app).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# Copy .env (committed to repo — contains live Twitter keys).
COPY --from=builder /app/.env ./.env
# Copy start script AFTER standalone (so it's not overwritten).
COPY start-web.sh ./start-web.sh
RUN chmod +x start-web.sh
EXPOSE 3000
# Use bash (not /bin/sh) — start-web.sh uses bash syntax that dash rejects.
CMD ["/bin/bash", "/app/start-web.sh"]
