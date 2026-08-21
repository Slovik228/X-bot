// GET /api/twitter/status — returns the Twitter integration config + live listener health.
// Used by the UI to show the connection badge.

import { NextResponse } from 'next/server';
import { twitterStatus } from '@/lib/twitter/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const status = twitterStatus();

  // Also ping the listener health endpoint for live counters.
  // On Fly, listener runs on a separate machine; use LISTENER_URL env if set.
  const listenerUrl = process.env.LISTENER_URL || 'http://localhost:3004';
  let listener: { ok: boolean; botHandle: string | null; ingested: number; skipped: number; errors: number; lastPollAt: number | null; uptime: number } | null = null;
  try {
    const r = await fetch(`${listenerUrl}/internal/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) listener = await r.json();
  } catch {
    listener = null;
  }

  return NextResponse.json({
    ...status,
    listenerRunning: !!listener,
    listener: listener
      ? {
          botHandle: listener.botHandle,
          ingested: listener.ingested,
          skipped: listener.skipped,
          errors: listener.errors,
          lastPollAt: listener.lastPollAt,
          uptime: listener.uptime,
        }
      : null,
  });
}
