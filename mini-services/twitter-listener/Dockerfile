# ---- twitter-listener (polls X for @Slopius mentions) ----
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY index.ts ./
# No EXPOSE needed — listener only makes outbound calls (polls Twitter → POSTs to Next.js)
CMD ["bun", "index.ts"]
