# ---- bot-relay (socket.io real-time relay) ----
# Build context must be the project root.
#   docker build -t slopius-relay -f mini-services/bot-relay/Dockerfile .
FROM oven/bun:1-slim
WORKDIR /app
COPY mini-services/bot-relay/package.json mini-services/bot-relay/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY mini-services/bot-relay/index.ts ./
EXPOSE 3003
# SOCKET_PATH is set via fly.toml [env] for production.
CMD ["bun", "index.ts"]
