// ---------------------------------------------------------------------------
// twitter-listener — polls Twitter API v2 for @mentions of the bot and
// forwards each new mention to the Next.js ingest endpoint.
//
// Port: 3004
//   GET /internal/health   -> service health + counters
//   GET /internal/status   -> alias for /internal/health
//
// No database, no LLM, no Prisma, no z-ai-web-dev-sdk — pure poll + HTTP
// forward. State (last seen tweet id) is persisted to a sibling file so the
// service can resume after a restart without re-processing old mentions.
//
// Sandbox note: this process must be daemonized with a Python double-fork
// (plain `nohup ... &` is killed when the spawning shell exits). See the
// startup command in the worklog / orchestrator instructions.
// ---------------------------------------------------------------------------

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { TwitterApi, type TweetV2, type UserV2 } from 'twitter-api-v2'

const PORT = 3004
// Try multiple .env locations (sandbox path + Docker path). First existing wins.
const ENV_FILE = ['/home/z/my-project/.env', '/app/.env', './.env', '../../.env'].find((p) => {
  try { return existsSync(p) } catch { return false }
}) || '/home/z/my-project/.env'
// State file: next to the listener (so it survives restarts + is volume-friendly).
const STATE_FILE = process.env.STATE_FILE || '/app/.last-mention-id'
const MIN_INTERVAL_MS = 15_000          // Twitter rate-limit floor
const MAX_BACKOFF_MS = 5 * 60 * 1000    // 5 minutes
const IDLE_LOG_INTERVAL_MS = 5 * 60 * 1000  // throttle "idling" logs

// ---------------------------------------------------------------------------
// loadEnv — manually parse the project-root .env (Bun only auto-loads .env
// from CWD, and this service runs from its own dir). Real process.env values
// win over file values (standard dotenv semantics).
// ---------------------------------------------------------------------------
function loadEnv(path: string) {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    console.warn(`[env] could not read ${path}: ${(err as Error).message}`)
    return
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // Strip surrounding quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!key) continue
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}

loadEnv(ENV_FILE)

const BEARER = process.env.TWITTER_BEARER_TOKEN || ''
const BOT_HANDLE = (process.env.TWITTER_BOT_HANDLE || '').trim().replace(/^@/, '')
const INTERNAL_SECRET = process.env.TWITTER_INTERNAL_SECRET || ''
const NEXT_APP_URL = (process.env.NEXT_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

const POSTING_ENABLED =
  !!BOT_HANDLE &&
  !!(process.env.TWITTER_ACCESS_TOKEN || '') &&
  !!(process.env.TWITTER_ACCESS_TOKEN_SECRET || '')

// Configured (base) poll interval — clamped to >= 15s.
const CONFIGURED_INTERVAL_MS = Math.max(
  MIN_INTERVAL_MS,
  parseInt(process.env.POLL_INTERVAL_MS || '', 10) || 30_000,
)

// --- Runtime state ---------------------------------------------------------
let currentIntervalMs = CONFIGURED_INTERVAL_MS
let lastMentionId: string | null = readLastMentionId()
let lastPollAt: number | null = null
let ingested = 0
let skipped = 0
let errors = 0
let lastIdleLogAt = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let shuttingDown = false

// --- Twitter client (bearer / app-only) ------------------------------------
const twitterClient = new TwitterApi(BEARER)

// Search params MUST match src/lib/twitter/client.ts `searchMentions` so the
// listener and the Next.js app agree on tweet shape.
const SEARCH_PARAMS = {
  max_results: 25,
  'tweet.fields': [
    'id',
    'text',
    'author_id',
    'created_at',
    'in_reply_to_user_id',
    'referenced_tweets',
    'entities',
    'attachments',
  ],
  expansions: ['author_id', 'referenced_tweets.id', 'attachments.media_keys'],
  'user.fields': ['id', 'name', 'username', 'verified', 'profile_image_url'],
  'media.fields': ['url', 'preview_image_url', 'type', 'media_key'],
} as const

// ---------------------------------------------------------------------------
// State file helpers (last seen tweet id, persisted across restarts).
// ---------------------------------------------------------------------------
function readLastMentionId(): string | null {
  try {
    if (!existsSync(STATE_FILE)) return null
    const v = readFileSync(STATE_FILE, 'utf8').trim()
    return v || null
  } catch {
    return null
  }
}

function writeLastMentionId(id: string) {
  try {
    writeFileSync(STATE_FILE, id, 'utf8')
  } catch (err) {
    console.warn(`[state] could not persist lastMentionId: ${(err as Error).message}`)
  }
}

// BigInt-safe "is a newer than b?" comparator. Twitter ids are 64-bit numeric
// strings, so BigInt comparison is required (Number would lose precision).
function isNewer(a: string, b: string | null): boolean {
  if (!b) return true
  try {
    return BigInt(a) > BigInt(b)
  } catch {
    // Fall back to string comparison if either side isn't a clean integer.
    return a > b
  }
}

// ---------------------------------------------------------------------------
// HTTP server (internal API only — no public routes).
// ---------------------------------------------------------------------------
function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function healthBody() {
  return {
    ok: true,
    uptime: process.uptime(),
    botHandle: BOT_HANDLE || null,
    postingEnabled: POSTING_ENABLED,
    configuredIntervalMs: CONFIGURED_INTERVAL_MS,
    currentIntervalMs,
    lastPollAt,
    lastMentionId,
    ingested,
    skipped,
    errors,
    bearerConfigured: !!BEARER,
    internalSecretConfigured: !!INTERNAL_SECRET,
  }
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? ''
  const method = req.method ?? ''
  if (
    (url === '/internal/health' || url === '/internal/status') &&
    method === 'GET'
  ) {
    sendJson(res, 200, healthBody())
    return
  }
  sendJson(res, 404, { ok: false, error: 'not found' })
}

const httpServer = createServer((req, res) => handleHttpRequest(req, res))

// ---------------------------------------------------------------------------
// Forward a single tweet to the Next.js ingest endpoint.
// ---------------------------------------------------------------------------
async function forwardTweet(
  tweet: TweetV2,
  users: UserV2[],
  referenced: TweetV2[],
  includes: Record<string, unknown>,
) {
  const author = users.find((u) => u.id === tweet.author_id) || null
  const body = {
    tweet,
    author,
    referenced,
    users,
    includes,
  }
  const snippet = (tweet.text || '').slice(0, 60).replace(/\s+/g, ' ')
  const authorHandle = author?.username ?? '?'

  let resp: Response
  try {
    resp = await fetch(`${NEXT_APP_URL}/api/twitter/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    errors++
    console.error(
      `[ingest] network error tweet=${tweet.id} author=@${authorHandle}: ${(err as Error).message}`,
    )
    return
  }

  if (resp.status === 200) {
    ingested++
    console.log(
      `[ingest] ok      tweet=${tweet.id} author=@${authorHandle} text="${snippet}"`,
    )
  } else if (resp.status === 409) {
    skipped++
    console.log(
      `[ingest] skipped tweet=${tweet.id} author=@${authorHandle} (already ingested)`,
    )
  } else {
    errors++
    const detail = await resp.text().catch(() => '')
    console.error(
      `[ingest] error   tweet=${tweet.id} author=@${authorHandle} status=${resp.status} body=${detail.slice(0, 200)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// One poll iteration.
// ---------------------------------------------------------------------------
async function pollOnce() {
  lastPollAt = Date.now()

  // Empty-handle case: idle, don't crash. Log once per ~5 min to avoid spam.
  if (!BOT_HANDLE) {
    if (Date.now() - lastIdleLogAt > IDLE_LOG_INTERVAL_MS) {
      console.log('[poll] TWITTER_BOT_HANDLE not set; listener idling')
      lastIdleLogAt = Date.now()
    }
    return
  }

  if (!BEARER) {
    if (Date.now() - lastIdleLogAt > IDLE_LOG_INTERVAL_MS) {
      console.log('[poll] TWITTER_BEARER_TOKEN not set; listener idling')
      lastIdleLogAt = Date.now()
    }
    return
  }

  const query = `@${BOT_HANDLE} -is:retweet`
  const params: Record<string, unknown> = { ...SEARCH_PARAMS }
  if (lastMentionId) params.since_id = lastMentionId

  let res: Awaited<ReturnType<typeof twitterClient.v2.search>>
  try {
    res = await twitterClient.v2.search(query, params as any)
  } catch (err: any) {
    // Rate limit — back off (double the interval up to MAX_BACKOFF_MS).
    const status = err?.code ?? err?.statusCode ?? err?.response?.status
    if (status === 429 || /rate limit/i.test(String(err?.message || ''))) {
      currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_BACKOFF_MS)
      console.warn(
        `[poll] rate limited; backing off to ${currentIntervalMs}ms`,
      )
      return
    }
    errors++
    console.error(`[poll] search error: ${(err as Error).message}`)
    return
  }

  // Successful poll — reset any prior backoff.
  currentIntervalMs = CONFIGURED_INTERVAL_MS

  const tweets = (res.tweets as TweetV2[]) || []
  const includes = (res.includes as any) || {}
  const users = (includes.users as UserV2[]) || []
  const referenced = (includes.tweets as TweetV2[]) || []

  if (tweets.length === 0) {
    // Quiet — no log spam on every empty poll.
    return
  }

  console.log(
    `[poll] found ${tweets.length} mention(s) for @${BOT_HANDLE} (since_id=${lastMentionId ?? 'none'})`,
  )

  // The Twitter API returns tweets newest-first by default; we forward them
  // in that order so the ingest endpoint sees the freshest tweet last.
  let newestId = lastMentionId
  for (const tweet of tweets) {
    await forwardTweet(tweet, users, referenced, includes)
    if (isNewer(tweet.id, newestId)) newestId = tweet.id
  }

  if (newestId && newestId !== lastMentionId) {
    lastMentionId = newestId
    writeLastMentionId(newestId)
    console.log(`[poll] advanced lastMentionId -> ${newestId}`)
  }
}

// ---------------------------------------------------------------------------
// Poll loop — recursive setTimeout so each iteration respects the CURRENT
// interval (which may have been inflated by a 429 backoff).
// ---------------------------------------------------------------------------
function scheduleNextPoll() {
  if (shuttingDown) return
  pollTimer = setTimeout(async () => {
    try {
      await pollOnce()
    } catch (err) {
      errors++
      console.error('[poll] uncaught error:', err)
    }
    scheduleNextPoll()
  }, currentIntervalMs)
}

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  const pollSec = Math.round(CONFIGURED_INTERVAL_MS / 1000)
  console.log(
    `twitter-listener running on port ${PORT}, bot=@${BOT_HANDLE || '<unset>'}, poll=${pollSec}s, posting=${POSTING_ENABLED ? 'enabled' : 'disabled'}`,
  )
  console.log(`  ingest endpoint: ${NEXT_APP_URL}/api/twitter/ingest`)
  console.log(`  health:          GET  http://localhost:${PORT}/internal/health`)
  if (lastMentionId) {
    console.log(`  resumed lastMentionId=${lastMentionId}`)
  }
  if (!BOT_HANDLE) {
    console.log('  WARNING: TWITTER_BOT_HANDLE is empty — listener will idle (not crash).')
  }
  if (!BEARER) {
    console.log('  WARNING: TWITTER_BEARER_TOKEN is empty — listener will idle (not crash).')
  }
  if (!INTERNAL_SECRET) {
    console.log('  WARNING: TWITTER_INTERNAL_SECRET is empty — ingest endpoint will reject posts.')
  }

  // Kick off the loop immediately (don't wait a full interval for the first poll).
  setTimeout(() => {
    pollOnce().catch((err) => {
      errors++
      console.error('[poll] uncaught error on first run:', err)
    })
    scheduleNextPoll()
  }, 500)
})

// ---------------------------------------------------------------------------
// Graceful shutdown.
// ---------------------------------------------------------------------------
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`twitter-listener received ${signal}, shutting down...`)
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  httpServer.close(() => {
    console.log('twitter-listener closed')
    process.exit(0)
  })
  // Hard exit if graceful close hangs.
  setTimeout(() => {
    console.error('twitter-listener graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 8000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
