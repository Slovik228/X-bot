// Rate limiter. Simple in-memory sliding-window limits per handle.
// Limits (tunable): per-user requests per minute, cooldown after a burst,
// global requests per minute, and a daily cap to bound API cost.

const WINDOW_MS = 60_000; // 1 minute
const PER_USER_PER_MIN = 8;
const GLOBAL_PER_MIN = 30;
const DAILY_CAP = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const userHits = new Map<string, number[]>();
const globalHits: number[] = [];
let dailyCount = 0;
let dailyResetAt = Date.now() + DAY_MS;

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryInMs?: number;
}

export function checkRateLimit(handle: string): RateLimitResult {
  const now = Date.now();

  // Reset daily counter if needed.
  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + DAY_MS;
  }
  if (dailyCount >= DAILY_CAP) {
    return { allowed: false, reason: 'Daily API cost cap reached. Try again tomorrow.' };
  }

  // Global window.
  const gCut = now - WINDOW_MS;
  while (globalHits.length && globalHits[0] < gCut) globalHits.shift();
  if (globalHits.length >= GLOBAL_PER_MIN) {
    const retryInMs = globalHits[0] + WINDOW_MS - now;
    return {
      allowed: false,
      reason: `Bot is busy (${GLOBAL_PER_MIN}/min global limit).`,
      retryInMs,
    };
  }

  // Per-user window.
  const hits = userHits.get(handle) || [];
  while (hits.length && hits[0] < gCut) hits.shift();
  if (hits.length >= PER_USER_PER_MIN) {
    const retryInMs = hits[0] + WINDOW_MS - now;
    return {
      allowed: false,
      reason: `Rate limit: ${PER_USER_PER_MIN} requests/min for @${handle}. Cooldown ${Math.ceil(retryInMs / 1000)}s.`,
      retryInMs,
    };
  }

  // Allowed — record.
  hits.push(now);
  userHits.set(handle, hits);
  globalHits.push(now);
  dailyCount++;
  return { allowed: true };
}

export function rateLimitStatus() {
  const now = Date.now();
  const gCut = now - WINDOW_MS;
  while (globalHits.length && globalHits[0] < gCut) globalHits.shift();
  return {
    globalUsedThisMinute: globalHits.length,
    globalPerMin: GLOBAL_PER_MIN,
    perUserPerMin: PER_USER_PER_MIN,
    dailyUsed: dailyCount,
    dailyCap: DAILY_CAP,
    dailyResetsInMs: Math.max(0, dailyResetAt - now),
  };
}
