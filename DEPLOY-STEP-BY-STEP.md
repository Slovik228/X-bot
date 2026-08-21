# 🚀 Пошаговый деплой Slopius на Fly.io

Все команды ниже готовы к копированию. Реальные ключи уже подставлены.
Выполняйте по порядку, по одной команде за раз.

---

## Подготовка (5 минут)

### 1. Установите flyctl (если не установлен)

**macOS / Linux (в терминале):**
```bash
curl -L https://fly.io/install.sh | sh
```

Добавьте в PATH (если попросит):
```bash
export PATH="$HOME/.fly/bin:$PATH"
```

Проверьте установку:
```bash
fly version
```
Должен вывести версию (например `v0.x.x`).

**Windows (PowerShell):**
```powershell
irm https://fly.io/install.ps1 | iex
```

### 2. Войдите в Fly.io

```bash
fly auth login
```

Откроется браузер → выберите ваш аккаунт Fly.io → "Continue" → "Sign in with Fly.io" (или GitHub, как регались).

Должно появиться: `successfully logged in as <ваш-email>`.

---

## Шаг 1. Клонируем репозиторий и переходим в него (если ещё не сделали)

```bash
git clone https://github.com/Slovik228/X-bot.git
cd X-bot
```

> Если вы работаете в том же sandbox, где бот уже настроен — просто:
> ```bash
> cd /home/z/my-project
> ```

---

## Шаг 2. Создаём 3 приложения на Fly.io

Выполняйте по одной команде. Когда спросит `Would you like to deploy now?` — отвечайте **N** (сначала настроим секреты).

### 2.1. Web-приложение (UI + бот-движок)

```bash
cd /home/z/my-project
fly launch --no-deploy --name slopius-web
```

Когда спросит:
- `Would you like to deploy now?` → **N**
- Если спросит про Dockerfile → подтверждайте (используем существующий)

### 2.2. Relay (socket.io real-time)

```bash
cd mini-services/bot-relay
fly launch --no-deploy --name slopius-relay
cd ../..
```

### 2.3. Listener (слушает упоминания @Slopius)

```bash
cd mini-services/twitter-listener
fly launch --no-deploy --name slopius-listener
cd ../..
```

---

## Шаг 3. Создаём volume для базы данных (SQLite)

```bash
fly volumes create slopius_db --app slopius-web --size 1
```

Должно вывести: `ID: vol_...  Size: 1 GB`.

---

## Шаг 4. Устанавливаем секреты (ВАШИ РЕАЛЬНЫЕ КЛЮЧИ)

### 4.1. Для web-приложения (СЛОПИЙ блок, копируйте целиком):

```bash
fly secrets set \
  TWITTER_BOT_HANDLE="Slopius" \
  TWITTER_API_KEY="khV8WscnKAcIWqbIwB6OqWorN" \
  TWITTER_API_KEY_SECRET="9JFph7PnJgA0eEWSmG27FAoEp0HCzKMQraR9yhGwvNQa0aLwlc" \
  TWITTER_BEARER_TOKEN="AAAAAAAAAAAAAAAAAAAAAF6n%2FAEAAAAALR89cYcMB%2BEVng%2BtLXlkpleohYo%3D2cdXD2pgFyYOgvqrTVKoANoFSYsLJs5xsiaiBHbwKp9JuZmTaY" \
  TWITTER_ACCESS_TOKEN="2088347479381082112-JVHq27KRT1EGwr5kWDqAaycAJktC8O" \
  TWITTER_ACCESS_TOKEN_SECRET="ksERxbvcziMu0xKgL7UTZG8hz9BxWhj0wpzcUEzvrxuHS" \
  BOT_RELAY_URL="https://slopius-relay.fly.dev/internal/broadcast" \
  NEXT_PUBLIC_SOCKET_URL="https://slopius-relay.fly.dev" \
  TWITTER_INTERNAL_SECRET="local-dev-secret-change-me" \
  DATABASE_URL="file:/app/db/custom.db" \
  --app slopius-web
```

Должно вывести: `Secrets are staged for the first deployment...`.

### 4.2. Для relay:

```bash
fly secrets set SOCKET_PATH="/socket.io/" --app slopius-relay
```

### 4.3. Для listener:

```bash
fly secrets set \
  TWITTER_BOT_HANDLE="Slopius" \
  TWITTER_API_KEY="khV8WscnKAcIWqbIwB6OqWorN" \
  TWITTER_API_KEY_SECRET="9JFph7PnJgA0eEWSmG27FAoEp0HCzKMQraR9yhGwvNQa0aLwlc" \
  TWITTER_BEARER_TOKEN="AAAAAAAAAAAAAAAAAAAAAF6n%2FAEAAAAALR89cYcMB%2BEVng%2BtLXlkpleohYo%3D2cdXD2pgFyYOgvqrTVKoANoFSYsLJs5xsiaiBHbwKp9JuZmTaY" \
  TWITTER_INTERNAL_SECRET="local-dev-secret-change-me" \
  NEXT_APP_URL="https://slopius-web.fly.dev" \
  --app slopius-listener
```

---

## Шаг 5. Деплоим все 3 приложения

### 5.1. Деплой web (5-7 минут)

```bash
cd /home/z/my-project
fly deploy --app slopius-web
```

Дождитесь: `Deployment successful! → https://slopius-web.fly.dev`.

> Если спросит про volume mount → выберите `slopius_db` → mount в `/app/db`.

### 5.2. Деплой relay

```bash
cd mini-services/bot-relay
fly deploy --app slopius-relay
cd ../..
```

Дождитесь: `Deployment successful! → https://slopius-relay.fly.dev`.

### 5.3. Деплой listener

```bash
cd mini-services/twitter-listener
fly deploy --app slopius-listener
cd ../..
```

Дождитесь: `Deployment successful!`.

---

## Шаг 6. Масштабирование (чтобы не засыпали)

```bash
fly scale count 1 --app slopius-web
fly scale count 1 --app slopius-relay
fly scale count 1 --app slopius-listener
```

Это гарантирует, что всегда работает по 1 инстансу каждого сервиса.

---

## Шаг 7. Проверка (5 минут)

### 7.1. Откройте UI в браузере

**https://slopius-web.fly.dev**

Должна загрузиться тёмная X-подобная лента с compose-боксом и кнопками `/claude /gpt /grok` и т.д.

### 7.2. Напишите твит в реальном X

С любого аккаунта напишите:
```
@Slopius /claude what is 2+2?
```

Через 30-60 секунд бот должен ответить reply в X.

### 7.3. Проверьте логи (если что-то не работает)

```bash
fly logs --app slopius-web
fly logs --app slopius-relay
fly logs --app slopius-listener
```

---

## Частые проблемы

### "Deployment failed" / "Build error"

Проверьте, что вы в правильной директории:
- web → `/home/z/my-project` (корень проекта)
- relay → `/home/z/my-project/mini-services/bot-relay`
- listener → `/home/z/my-project/mini-services/twitter-listener`

### Бот не отвечает в X

1. Проверьте логи listener: `fly logs --app slopius-listener`
2. Должно быть: `[poll] found 1 mention(s) for @Slopius` и `[ingest] ok`
3. Если `402 credits depleted` — закончились credits на Fly или X (надо пополнить)

### Socket не подключается (UI без "Live")

1. Проверьте, что relay запущен: `fly status --app slopius-relay`
2. Откройте `https://slopius-relay.fly.dev` — должно быть `{"code":0,...}` или 404 (это нормально, значит работает)

### Сайт белый / ошибка 500

```bash
fly logs --app slopius-web
```

Ищите в логах ошибку. Часто дело в DATABASE_URL или в неинициализированной БД.

### Volume не примонтировался

```bash
fly ssh console --app slopius-web
ls /app/db
```

Должен быть `custom.db`. Если нет — пересоздайте volume:
```bash
fly volumes list --app slopius-web
```

---

## URL'ы после деплоя

| Сервис | URL |
|---|---|
| Web (UI + API) | https://slopius-web.fly.dev |
| Relay (socket.io) | https://slopius-relay.fly.dev |
| Listener | (нет публичного URL — это фоновый воркер) |

---

## Полезные команды

```bash
# Статус всех 3
fly status --app slopius-web
fly status --app slopius-relay
fly status --app slopius-listener

# Перезапуск
fly apps restart --app slopius-web
fly apps restart --app slopius-relay
fly apps restart --app slopius-listener

# SSH в web (для дебага)
fly ssh console --app slopius-web

# Удалить всё (если хотите начать заново)
fly apps destroy slopius-web
fly apps destroy slopius-relay
fly apps destroy slopius-listener
```

---

## Готово!

После деплоя бот работает 24/7:
- Каждые 30 сек listener ищет упоминания `@Slopius` в реальном X
- При нахождении → бот генерирует ответ в голосе выбранной модели → постит reply обратно в X
- База данных на persistent volume (история твитов сохраняется)
- OAuth 1.0a токены не истекают → бот работает бессрочно

Любой человек в X может написать `@Slopius /claude ...`, `@Slopius /grok ...`, `@Slopius /price BTC` — и бот ответит автоматически.
