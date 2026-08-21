// Frontend client: types, API helpers, and socket.io singleton for the X bot UI.
// Client-safe (no prisma imports).

import { io, type Socket } from 'socket.io-client';

export interface TweetAuthor {
  handle: string;
  name: string;
  avatarColor: string;
  isBot: boolean;
  isVerified: boolean;
  bio: string;
}

export interface BotSource {
  title: string;
  url: string;
  host: string;
  snippet?: string;
}

export interface Tweet {
  id: string;
  xid: string;
  author: TweetAuthor;
  content: string;
  imageUrl: string | null;
  parentId: string | null;
  quotedId: string | null;
  quoted?: Tweet | null;
  isBot: boolean;
  botModel: string | null;
  botCommand: string | null;
  botRunId: string | null;
  threadIndex: number;
  threadTotal: number;
  sources: BotSource[] | null;
  mentionTarget: string | null;
  createdAt: string;
  replyCount: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  color: string;
  badge: string;
  emoji: string;
  capabilities: { vision: boolean; code: boolean; reasoning: boolean; search: boolean; speed: string };
  description: string;
  systemPrompt: string;
}

export interface CommandInfo {
  id: string;
  type: 'model' | 'action';
  label: string;
  description: string;
  usage: string;
}

export interface RateLimits {
  globalUsedThisMinute: number;
  globalPerMin: number;
  perUserPerMin: number;
  dailyUsed: number;
  dailyCap: number;
  dailyResetsInMs: number;
}

// ---- API helpers ----
const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      const t = await res.text();
      // Avoid dumping HTML error pages into the UI.
      detail = t.startsWith('<') ? '' : t.slice(0, 160);
    } catch {}
    throw new Error(`${res.status} ${detail || res.statusText}`.trim());
  }
  return res.json();
};

export const api = {
  timeline: () => json('/api/timeline').then((d) => d.tweets as Tweet[]),
  postTweet: (body: {
    handle: string;
    content: string;
    imageUrl?: string | null;
    parentId?: string | null;
    quotedId?: string | null;
  }) =>
    json('/api/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  tweet: (id: string) => json(`/api/tweets/${id}`) as Promise<{ tweet: Tweet; replies: Tweet[] }>,
  processBot: (tweetId: string) =>
    json('/api/bot/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetId }),
    }),
  models: () => json('/api/models').then((d) => d.models as ModelInfo[]),
  commands: () =>
    json('/api/commands').then((d) => ({ commands: d.commands as CommandInfo[], rateLimits: d.rateLimits as RateLimits })),
  preferences: (handle: string) => json(`/api/preferences?handle=${handle}`),
  setPreference: (handle: string, defaultModel: string) =>
    json('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, defaultModel }),
    }),
  upload: (dataUrl: string) =>
    json('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    }).then((d) => d.url as string),
  seed: () => json('/api/seed', { method: 'POST' }),
  twitterStatus: () => json('/api/twitter/status') as Promise<{
    configured: boolean;
    botHandle: string | null;
    postingEnabled: boolean;
    hasBearer: boolean;
    hasUserContext: boolean;
    listenerRunning: boolean;
    listener: { botHandle: string | null; ingested: number; skipped: number; errors: number; lastPollAt: number | null; uptime: number } | null;
  }>,
  twitterManual: (body: { tweetUrlOrId: string; text: string; authorHandle?: string }) =>
    json('/api/twitter/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};

// ---- Socket singleton ----
// Sandbox: Caddy routes /?XTransformPort=3003 → bot-relay (path: '/').
// Production: Caddy/nginx routes /socket.io/* → bot-relay (path: '/socket.io/').
// Set NEXT_PUBLIC_SOCKET_URL=/ in production → frontend uses same-origin default path.
let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (_socket) return _socket;
  const deployUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  const opts = {
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 10000,
  };
  if (deployUrl) {
    // Production: same-origin, default socket.io path (/socket.io/)
    _socket = io(opts);
  } else {
    // Sandbox: Caddy XTransformPort pattern, path = '/'
    _socket = io('/?XTransformPort=3003', { ...opts, path: '/' });
  }
  return _socket;
}
