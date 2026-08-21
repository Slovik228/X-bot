// POST /api/bot/process — run the bot pipeline for a mention tweet.
// Body: { tweetId }
// 1. broadcast bot:typing (so all clients show the "thinking" indicator)
// 2. run engine
// 3. publish reply chunks to DB
// 4. broadcast bot:reply for each chunk, then bot:done
// Returns the saved reply tweets.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runBot } from '@/lib/bot/engine';
import { publishBotReply } from '@/lib/bot/publish';
import { broadcast } from '@/lib/bot/relay';
import { serializeTweet } from '@/lib/bot/serialize';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { tweetId } = (await req.json().catch(() => ({}))) as { tweetId?: string };
  if (!tweetId) return NextResponse.json({ error: 'tweetId required' }, { status: 400 });

  const mention = await db.tweet.findUnique({
    where: { id: tweetId },
    include: { author: true },
  });
  if (!mention) return NextResponse.json({ error: 'tweet not found' }, { status: 404 });

  // Tell all clients the bot is thinking about this tweet.
  await broadcast('bot:typing', {
    tweetId,
    authorHandle: mention.author.handle,
    snippet: mention.content.slice(0, 80),
    at: new Date().toISOString(),
  });

  try {
    const result = await runBot(tweetId);
    const { saved } = await publishBotReply(tweetId, result);

    // Broadcast each reply chunk (with the parent mention id so clients can
    // attach it under the right tweet).
    for (const t of saved) {
      const dto = serializeTweet({
        ...t,
        quoted: null,
        _count: { replies: 0 },
      });
      await broadcast('bot:reply', {
        parentTweetId: tweetId,
        replyTweet: dto,
        routingNote: result.routingNote,
        model: result.model,
      });
    }
    await broadcast('bot:done', { tweetId });

    return NextResponse.json({
      ok: true,
      model: result.model,
      action: result.action,
      routingNote: result.routingNote,
      replies: saved.map((t) =>
        serializeTweet({ ...t, quoted: null, _count: { replies: 0 } }),
      ),
      comparisons: result.comparisons,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    await broadcast('bot:error', { tweetId, error: message });
    // Still post a graceful error reply so the user sees something.
    const { saved } = await publishBotReply(tweetId, {
      model: 'auto',
      requestedModel: null,
      action: null,
      chunks: [
        {
          content: `⚠️ Bot error: ${message.slice(0, 200)}`,
          index: 0,
          total: 1,
        },
      ],
      sources: [],
      comparisons: [],
      routingNote: 'error',
    });
    await broadcast('bot:done', { tweetId });
    return NextResponse.json(
      { ok: false, error: message, replies: saved.map((t) => serializeTweet({ ...t, quoted: null, _count: { replies: 0 } })) },
      { status: 500 },
    );
  }
}
