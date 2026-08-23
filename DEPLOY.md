# 🚀 Развертывание Slopius Bot

Бот состоит из 3 сервисов:
| Сервис | Что делает | Порт |
|---|---|---|
| **web** (Next.js) | UI + API + бот-движок | 3000 |
| **relay** (socket.io) | Real-time обновления в браузере | 3003 |
| **listener** | Опрашивает X на упоминания `@Slopius` | — |

Все файлы для деплоя готовы: `Dockerfile` (3 шт), `docker-compose.yml`, `fly.toml` (3 шт).

---

## Вариант 1: Fly.io (РЕКОМЕНДУЕТСЯ — бесплатно, 24/7, без засыпания)

Fly.io даёт **3 бесплатные VM** (256-512MB) — ровно под наши 3 сервиса. Не засыпают.

### Шаг 1. Установите flyctl
```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh
# или: brew install flyctl
```

### Шаг 2. Войдите и создайте 3 приложения
```bash
fly auth login

# 1) Web-приложение (UI + бот)
fly launch --no-deploy --name slopius-web
# На вопрос "Would you like to deploy now?" → N

# 2) Relay (socket.io)
cd mini-services/bot-relay
fly launch --no-deploy --name slopius-relay
cd ../..

# 3) Listener
cd mini-services/twitter-listener
fly launch --no-deploy --name slopius-listener
cd ../..
```

### Шаг 3. Создайте volume для базы данных
```bash
fly volumes create slopius_db --app slopius-web --size 1
```

### Шаг 4. Загрузите секреты (ключи Twitter)
```bash
# Web
fly secrets set \
  TWITTER_BOT_HANDLE=Slopius \
  TWITTER_API_KEY="YOUR_CONSUMER_KEY" \
  TWITTER_API_KEY_SECRET="YOUR_CONSUMER_KEY_SECRET" \
  TWITTER_BEARER_TOKEN="YOUR_BEARER_TOKEN" \
  TWITTER_ACCESS_TOKEN="YOUR_ACCESS_TOKEN" \
  TWITTER_ACCESS_TOKEN_SECRET="YOUR_ACCESS_TOKEN_SECRET" \
  BOT_RELAY_URL="https://slopius-relay.fly.dev/internal/broadcast" \
  NEXT_PUBLIC_SOCKET_URL="https://slopius-relay.fly.dev" \
  TWITTER_INTERNAL_SECRET="local-dev-secret-change-me" \
  DATABASE_URL="file:/app/db/custom.db" \
  --app slopius-web

# Relay
fly secrets set SOCKET_PATH="/socket.io/" --app slopius-relay

# Listener
fly secrets set \
  TWITTER_BOT_HANDLE=Slopius \
  TWITTER_API_KEY="YOUR_CONSUMER_KEY" \
  TWITTER_API_KEY_SECRET="YOUR_CONSUMER_KEY_SECRET" \
  TWITTER_BEARER_TOKEN="YOUR_BEARER_TOKEN" \
  TWITTER_INTERNAL_SECRET="local-dev-secret-change-me" \
  NEXT_APP_URL="https://slopius-web.fly.dev" \
  --app slopius-listener
```

### Шаг 5. Деплой всех 3 сервисов
```bash
# Web
fly deploy --app slopius-web

# Relay
cd mini-services/bot-relay && fly deploy --app slopius-relay && cd ../..

# Listener
cd mini-services/twitter-listener && fly deploy --app slopius-listener && cd ../..
```

### Шаг 6. Готово!
- UI: `https://slopius-web.fly.dev`
- Бот слушает X 24/7, отвечает на `@Slopius` автоматически
- База данных на persistent volume (не теряется при перезапуске)

**Масштабирование (чтобы всегда работало):**
```bash
fly scale count 1 --app slopius-web
fly scale count 1 --app slopius-relay
fly scale count 1 --app slopius-listener
```

---

## Вариант 2: Render (проще, но засыпает)

Render: free web services засыпают через 15 мин без трафика. Listener тоже засыпает.

1. Запушьте код на GitHub
2. На render.com создайте 3 сервиса:
   - **Web Service**: корень репозитория, Dockerfile, порт 3000
   - **Background Worker** (relay): `mini-services/bot-relay`, Dockerfile
   - **Background Worker** (listener): `mini-services/twitter-listener`, Dockerfile
3. Добавьте те же env-переменные в настройки каждого сервиса
4. Деплой автоматический при пуше

Минус: listener засыпает → пропускает упоминания.

---

## Вариант 3: VPS с Docker Compose (любой VPS за $4-5/мес)

Если у вас есть VPS (Hetzner, DigitalOcean, Oracle Cloud free tier):

```bash
# На VPS:
git clone <your-repo> && cd your-repo
cp .env.example .env  # отредактируйте ключи
docker compose up -d --build
```

Один URL, всё через Caddy reverse proxy. Persistent volume для SQLite.

---

## Переменные окружения

| Переменная | Где | Значение |
|---|---|---|
| `TWITTER_BOT_HANDLE` | web, listener | `Slopius` |
| `TWITTER_API_KEY` | web, listener | ваш Consumer Key |
| `TWITTER_API_KEY_SECRET` | web, listener | ваш Consumer Key Secret |
| `TWITTER_BEARER_TOKEN` | web, listener | ваш Bearer Token |
| `TWITTER_ACCESS_TOKEN` | web | ваш OAuth1 Access Token |
| `TWITTER_ACCESS_TOKEN_SECRET` | web | ваш OAuth1 Access Token Secret |
| `BOT_RELAY_URL` | web | URL relay сервиса + `/internal/broadcast` |
| `NEXT_PUBLIC_SOCKET_URL` | web | URL relay сервиса (для браузера) |
| `NEXT_APP_URL` | listener | URL web сервиса |
| `SOCKET_PATH` | relay | `/socket.io/` |
| `DATABASE_URL` | web | `file:/app/db/custom.db` |
| `TWITTER_INTERNAL_SECRET` | web, listener | одинаковая строка |

---

## Проверка после деплоя

1. Откройте `https://slopius-web.fly.dev` — должна загрузиться лента
2. Напишите твит `@Slopius /claude what is 2+2?` в реальном X
3. Через ~30 сек бот ответит reply в X
4. Проверьте логи: `fly logs --app slopius-listener`
