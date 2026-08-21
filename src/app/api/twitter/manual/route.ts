// POST /api/twitter/manual — manual trigger for the Free tier.
// The user pastes a tweet URL (or ID) + the mention text they saw on real X.
// We create a local Tweet (with the real twitterId for dedup + reply targeting),
// run the bot, and IF posting is enabled, post the reply back to Twitter as a
// reply to that tweet ID. Works on Free tier because POST /2/tweets doesn't need
// read access — only the tweet ID (which the user provides).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runBot } from '@/lib/bot/engine';
import { publishBotReply } from '@/lib/bot/publish';
import { broadcast } from '@/lib/bot/relay';
import { serializeTweet } from '@/lib/bot/serialize';
import { postingEnabled, postReplyTweet, BOT_HANDLE } from '@/lib/twitter/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function parseTweetId(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;
  const m = /\/status\/(\d+)/.exec(s);
  if (m) return m[1];
  return null;
}

function parseAuthorFromUrl(input: string): string | null {
  const m = /(?:twitter\.com|x\.com)\/([^/]+)\/status\//.exec(input || '');
  if (m && m[1] && m[1] !== 'i') return m[1].replace(/^@/, '');
  return null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    tweetUrlOrId?: string;
    text?: string;
    authorHandle?: string;
    authorName?: string;
  };

  const twitterId = parseTweetId(body.tweetUrlOrId || '');
  const text = (body.text || '').trim();
  if (!twitterId) {
    return NextResponse.json({ error: 'Could not parse a tweet ID. Paste a full x.com URL or a numeric ID.' }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: 'text is required (the mention text you saw on X)' }, { status: 400 });
  }

  const existing = await db.tweet.findUnique({ where: { twitterId } });
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already processed', tweetId: existing.id }, { status: 409 });
  }

  const handle = (body.authorHandle || parseAuthorFromUrl(body.tweetUrlOrId || '') || 'twitter_user').toLowerCase();
  const name = body.authorName || handle;
  const authorRow = await db.xUser.upsert({
    where: { handle },
    update: {},
    create: { handle, name, avatarColor: '#0ea5e9' },
  });

  const mention = await db.tweet.create({
    data: {
      authorId: authorRow.id,
      content: text,
      twitterId,
      mentionTarget: BOT_HANDLE || 'aixbot',
    },
    include: { author: true },
  });

  await broadcast('bot:typing', {
    tweetId: mention.id,
    authorHandle: authorRow.handle,
    snippet: text.slice(0, 80),
    source: 'twitter-manual',
    at: new Date().toISOString(),
  });

  let result;
  try {
    result = await runBot(mention.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await broadcast('bot:error', { tweetId: mention.id, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const { saved } = await publishBotReply(mention.id, result);

  const posted: { chunkIndex: number; twitterId: string | null; error?: string }[] = [];
  if (postingEnabled()) {
    let prevTwitterId = twitterId;
    for (let i = 0; i < saved.length; i++) {
      const chunk = saved[i];
      try {
        const postedId = await postReplyTweet(chunk.content.slice(0, 280), prevTwitterId);
        posted.push({ chunkIndex: i, twitterId: postedId });
        if (postedId) {
          await db.tweet.update({ where: { id: chunk.id }, data: { twitterId: postedId } });
          prevTwitterId = postedId;
        }
      } catch (err) {
        posted.push({ chunkIndex: i, twitterId: null, error: err instanceof Error ? err.message : 'unknown' });
        break;
      }
    }
  }

  for (const t of saved) {
    const fresh = await db.tweet.findUnique({ where: { id: t.id }, include: { author: true } });
    if (!fresh) continue;
    const dto = serializeTweet({ ...fresh, quoted: null, _count: { replies: 0 } });
    await broadcast('bot:reply', {
      parentTweetId: mention.id,
      replyTweet: dto,
      source: 'twitter-manual',
      routingNote: result.routingNote,
      model: result.model,
    });
  }
  await broadcast('bot:done', { tweetId: mention.id, source: 'twitter-manual' });

  return NextResponse.json({
    ok: true,
    source: 'twitter-manual',
    mentionTweetId: mention.id,
    twitterMentionId: twitterId,
    model: result.model,
    action: result.action,
    routingNote: result.routingNote,
    replyCount: saved.length,
    postedToTwitter: posted,
    postingEnabled: postingEnabled(),
  });
}
