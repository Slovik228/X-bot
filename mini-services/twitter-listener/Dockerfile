# ---- twitter-listener (polls X for @Slopius mentions) ----
# Build context must be the project root (so we can COPY the root .env).
#   docker build -t slopius-listener -f mini-services/twitter-listener/Dockerfile .
#   (or fly deploy with dockerfile = mini-services/twitter-listener/Dockerfile
#    and the build context = project root)
FROM oven/bun:1-slim
WORKDIR /app
COPY mini-services/twitter-listener/package.json mini-services/twitter-listener/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY mini-services/twitter-listener/index.ts ./
# Copy root .env (contains real Twitter keys). The listener's loadEnv() finds
# /app/.env among its search paths and reads the keys.
COPY .env ./.env
# No EXPOSE needed — listener only makes outbound calls (polls Twitter → POSTs to Next.js)
CMD ["bun", "index.ts"]
