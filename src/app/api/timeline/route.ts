// GET /api/timeline — top-level tweets (no parent), newest first, with author
// and quoted tweet. Replies are loaded separately per-thread on the client.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeTweet } from '@/lib/bot/serialize';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tweets = await db.tweet.findMany({
    where: { parentId: null },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      author: true,
      quoted: { include: { author: true } },
      _count: { select: { replies: true } },
    },
  });
  return NextResponse.json({ tweets: tweets.map(serializeTweet) });
}
