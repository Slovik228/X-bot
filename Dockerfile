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
RUN bunx prisma generate
RUN bun run build
RUN mkdir -p .next/standalone/node_modules/@prisma && \
    cp -r node_modules/@prisma/client .next/standalone/node_modules/@prisma/ 2>/dev/null || true

FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN mkdir -p /app/db
# Prisma CLI for DB init on first boot
RUN bun add -g prisma
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# Real .env (committed to repo per user request — contains live Twitter keys).
# Loaded into env by start-web.sh at runtime.
COPY --from=builder /app/.env ./.env
COPY start-web.sh ./
RUN chmod +x start-web.sh
EXPOSE 3000
CMD ["./start-web.sh"]
