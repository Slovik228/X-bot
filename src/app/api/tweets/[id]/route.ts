// GET /api/tweets/[id] — a single tweet with its reply thread (all descendants
// flattened in chronological order, grouped by botRunId for thread display).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeTweet } from '@/lib/bot/serialize';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tweet = await db.tweet.findUnique({
    where: { id },
    include: {
      author: true,
      quoted: { include: { author: true } },
      _count: { select: { replies: true } },
    },
  });
  if (!tweet) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Fetch the whole reply subtree (depth-first-ish by createdAt).
  const replies = await db.tweet.findMany({
    where: { parentId: id },
    orderBy: { createdAt: 'asc' },
    include: {
      author: true,
      quoted: { include: { author: true } },
      _count: { select: { replies: true } },
    },
  });

  return NextResponse.json({
    tweet: serializeTweet(tweet),
    replies: replies.map(serializeTweet),
  });
}
