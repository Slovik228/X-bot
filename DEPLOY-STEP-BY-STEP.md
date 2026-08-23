# 🚀 Деплой Slopius на Fly.io (с реальными ключами в репо)

Все ключи уже в `.env` в репозитории. Fly подтянет репо и прочитает `.env` автоматически.
Нужно только создать 3 приложения, volume для БД, и задеплоить.

---

## Подготовка (3 минуты)

### 1. Установите flyctl

**macOS / Linux:**
```bash
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"
fly version
```

**Windows (PowerShell):**
```powershell
irm https://fly.io/install.ps1 | iex
```

### 2. Войдите в Fly.io

```bash
fly auth login
```

Откроется браузер → выберите аккаунт → "Sign in".
Должно появиться: `successfully logged in as <ваш-email>`.

### 3. Склонируйте репозиторий (если ещё не сделали)

```bash
git clone https://github.com/Slovik228/X-bot.git
cd X-bot
```

---

## Шаг 1. Создаём 3 приложения на Fly.io

### 1.1. Web (UI + бот-движок)

```bash
fly launch --no-deploy --name slopius-web
```

На вопросы:
- `Would you like to deploy now?` → **N**
- Остальное — соглашайтесь с дефолтами

### 1.2. Relay (socket.io real-time)

```bash
fly launch --no-deploy --name slopius-relay
```
Тоже **N** на деплой.

### 1.3. Listener (слушает упоминания @Slopius)

```bash
fly launch --no-deploy --name slopius-listener
```
Тоже **N** на деплой.

---

## Шаг 2. Volume для базы данных (SQLite)

```bash
fly volumes create slopius_db --app slopius-web --size 1
```

Должно вывести: `ID: vol_... Size: 1 GB`.

---

## Шаг 3. Деплоим все 3 приложения

Все секреты уже в `.env` в репо — Fly их прочитает автоматически. Никаких `fly secrets set` не нужно.

### 3.1. Деплой web (5-7 минут)

```bash
fly deploy --app slopius-web
```

Если спросит про volume mount → выберите `slopius_db` → mount в `/app/db`.
Дождитесь: `Deployment successful! → https://slopius-web.fly.dev`.

### 3.2. Деплой relay

```bash
fly deploy --app slopius-relay
```

Дождитесь: `Deployment successful! → https://slopius-relay.fly.dev`.

### 3.3. Деплой listener

```bash
fly deploy --app slopius-listener
```

Дождитесь: `Deployment successful!`.

---

## Шаг 4. Масштабирование (чтобы не засыпали)

```bash
fly scale count 1 --app slopius-web
fly scale count 1 --app slopius-relay
fly scale count 1 --app slopius-listener
```

---

## Шаг 5. Проверка

### 5.1. Откройте UI в браузере

**https://slopius-web.fly.dev**

Должна загрузиться тёмная X-подобная лента.

### 5.2. Напишите твит в реальном X

С любого аккаунта:
```
@Slopius /claude what is 2+2?
```

Через 30-60 сек бот должен ответить reply в X.

### 5.3. Если что-то не работает — смотрите логи

```bash
fly logs --app slopius-web
fly logs --app slopius-relay
fly logs --app slopius-listener
```

---

## URL'ы после деплоя

| Сервис | URL |
|---|---|
| Web (UI + API) | https://slopius-web.fly.dev |
| Relay (socket.io) | https://slopius-relay.fly.dev |
| Listener | (нет публичного URL — фоновый воркер) |

---

## Частые проблемы

### "Deployment failed"

- Проверьте, что вы в корне проекта (`pwd` → `/path/to/X-bot`)
- Для listener/relay Fly использует `fly.toml` с правильным `dockerfile` path

### Бот не отвечает в X

```bash
fly logs --app slopius-listener
```
Должно быть `[poll] found 1 mention(s)` и `[ingest] ok`.
Если `402 credits depleted` — закончились credits на X (нужно пополнить).

### Сайт белый / 500

```bash
fly logs --app slopius-web
```

### Перепроверить, что `.env` примонтирован

```bash
fly ssh console --app slopius-web
cat /app/.env | grep TWITTER_BOT_HANDLE
```
Должно вывести `TWITTER_BOT_HANDLE=Slopius`.

---

## Полезные команды

```bash
fly status --app slopius-web
fly status --app slopius-relay
fly status --app slopius-listener

fly apps restart --app slopius-web
fly ssh console --app slopius-web
```

## Удалить всё (если хотите начать заново)

```bash
fly apps destroy slopius-web
fly apps destroy slopius-relay
fly apps destroy slopius-listener
```

---

## ⚠️ После успешного деплоя

1. Проверьте, что бот отвечает в X (Шаг 5.2)
2. Сделайте репозиторий приватным:
   GitHub → Slovik228/X-bot → Settings → General → Bottom → **Change visibility** → Private
3. (опционально) Переместите ключи из `.env` в Fly secrets:
   ```bash
   fly secrets set TWITTER_API_KEY=... --app slopius-web
   ```
   И удалите `.env` из репо (через новый commit).

---

Готово! Бот работает 24/7 на Fly.io, ловит упоминания `@Slopius` в реальном X и отвечает в голосе выбранной модели (Claude / GPT / Gemini / Grok / DeepSeek).
