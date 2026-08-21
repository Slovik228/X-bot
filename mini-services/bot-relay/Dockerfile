# ---- bot-relay (socket.io real-time relay) ----
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY index.ts ./
EXPOSE 3003
CMD ["bun", "index.ts"]
