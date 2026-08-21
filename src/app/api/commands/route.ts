// GET /api/commands — list available commands (registry).

import { NextResponse } from 'next/server';
import { COMMANDS } from '@/lib/bot/registry';
import { rateLimitStatus } from '@/lib/bot/ratelimit';

export async function GET() {
  return NextResponse.json({ commands: COMMANDS, rateLimits: rateLimitStatus() });
}
