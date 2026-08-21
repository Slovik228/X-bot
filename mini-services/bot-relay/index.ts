import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'

// ---------------------------------------------------------------------------
// bot-relay — a thin real-time relay service for the Multi-Model AI X Bot.
//
// Responsibilities:
//   1. Accept socket.io connections from the browser (via Caddy, path: '/').
//   2. Relay `bot:typing` events when a `mention:trigger` is received.
//   3. Expose an internal HTTP broadcast endpoint that the Next.js API uses
//      to push `bot:reply` / `bot:done` / `bot:error` / `bot:typing` events
//      to every connected browser.
//
// NO database, NO LLM — pure relay. All bot processing happens in Next.js.
// ---------------------------------------------------------------------------

const PORT = 3003

// --- HTTP server (shared with socket.io) ----------------------------------
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  handleHttpRequest(req, res)
})

// --- socket.io server ------------------------------------------------------
// Path is configurable: sandbox uses '/' (Caddy query-param routing);
// production uses default '/socket.io/' (Caddy/nginx path-based routing).
const SOCKET_PATH = process.env.SOCKET_PATH || '/';
const io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// With path: '/', engine.io's request-wrapper intercepts EVERY URL (because
// every URL starts with '/'), which means our /internal/* HTTP endpoints would
// never be reached. Re-take control of the 'request' listener so /internal/*
// routes to our handler, and everything else still goes to socket.io.
const socketIoListeners = httpServer.listeners('request').slice(0)
httpServer.removeAllListeners('request')
httpServer.on('request', (req, res) => {
  const url = req.url ?? ''
  if (url.startsWith('/internal/')) {
    handleHttpRequest(req, res)
    return
  }
  // Delegate to socket.io's wrapped listener (handles handshakes/polling).
  for (const fn of socketIoListeners) {
    fn.call(httpServer, req, res)
  }
})

// --- Internal HTTP handlers ------------------------------------------------
function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? ''
  const method = req.method ?? ''

  // Health check (used by orchestrator + Caddy liveness probes)
  if (url === '/internal/health' && method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      uptime: process.uptime(),
      clients: io.engine.clientsCount,
    })
    return
  }

  // Internal broadcast — Next.js API routes POST events here to fan them out
  // to every connected browser via socket.io.
  if (url === '/internal/broadcast' && method === 'POST') {
    let raw: string
    try {
      raw = await readBody(req)
    } catch (err) {
      sendJson(res, 400, { ok: false, error: 'failed to read body' })
      return
    }

    let parsed: { event?: string; payload?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid JSON' })
      return
    }

    if (typeof parsed.event !== 'string' || parsed.event.length === 0) {
      sendJson(res, 400, { ok: false, error: 'missing or invalid "event" field' })
      return
    }

    // Fan out to all connected browser clients. The relay is generic —
    // we don't care about the event name or payload shape.
    io.emit(parsed.event, parsed.payload)
    console.log(
      `[broadcast] event=${parsed.event} clients=${io.engine.clientsCount}`,
    )
    sendJson(res, 200, { ok: true })
    return
  }

  // Anything else is not part of the relay API.
  sendJson(res, 404, { ok: false, error: 'not found' })
}

// --- socket.io connection lifecycle ---------------------------------------
io.on('connection', (socket: Socket) => {
  console.log(`[socket] connected id=${socket.id}`)

  // Acknowledge the connection back to this specific client.
  socket.emit('connected', { id: socket.id })

  // A browser (or test client) signals that a mention was triggered.
  // We broadcast `bot:typing` to ALL clients so every open UI shows the
  // bot "thinking" about this tweet.
  socket.on(
    'mention:trigger',
    (payload: { tweetId: string; authorHandle: string; snippet: string }) => {
      if (!payload || typeof payload.tweetId !== 'string') {
        // Malformed — ignore silently but log.
        console.log('[mention:trigger] malformed payload, ignoring')
        return
      }
      const broadcast = {
        tweetId: payload.tweetId,
        authorHandle: payload.authorHandle,
        snippet: payload.snippet,
        at: new Date().toISOString(),
      }
      io.emit('bot:typing', broadcast)
      console.log(
        `[mention:trigger] tweetId=${payload.tweetId} author=${payload.authorHandle}`,
      )
    },
  )

  socket.on('disconnect', (reason: string) => {
    console.log(`[socket] disconnected id=${socket.id} reason=${reason}`)
  })

  socket.on('error', (err: Error) => {
    console.error(`[socket] error id=${socket.id}:`, err)
  })
})

// --- Boot ------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`bot-relay running on port ${PORT}`)
  console.log(`  socket.io path: /`)
  console.log(`  health:        GET  http://localhost:${PORT}/internal/health`)
  console.log(`  broadcast:     POST http://localhost:${PORT}/internal/broadcast`)
})

// --- Graceful shutdown -----------------------------------------------------
function shutdown(signal: string) {
  console.log(`bot-relay received ${signal}, shutting down...`)
  // Close socket.io first (tells clients to disconnect), then the http server.
  io.close(() => {
    httpServer.close(() => {
      console.log('bot-relay closed')
      process.exit(0)
    })
  })
  // Hard exit if graceful close hangs.
  setTimeout(() => {
    console.error('bot-relay graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 8000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
