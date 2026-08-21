// POST /api/twitter/ingest — internal endpoint called by the twitter-listener
// mini-service when a real mention of the bot is detected on X.
//
// Body: { tweet, author, referenced, users, includes }
// Header: X-Internal-Secret must match TWITTER_INTERNAL_SECRET.
//
// Flow:
// 1. dedupe by tweet.twitterId (409 if already ingested)
// 2. upsert author as XUser (handle, name, twitterUid, verified)
// 3. resolve quoted / replied-to referenced tweets (create them too, so context works)
// 4. create the mention Tweet row (twitterId set, imageUrl from media if any)
// 5. broadcast bot:typing, run engine, publish reply chunks to DB
// 6. IF posting is enabled (OAuth1 access tokens): post reply chunks back to Twitter
//    as a thread (first chunk replies to the mention, subsequent chunks reply to prev)
// 7. broadcast bot:reply per chunk, bot:done
//
// Returns 200 { ok, tweetId, replies } or 409 { ok, skipped: true } or 401/500.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runBot } from '@/lib/bot/engine';
import { publishBotReply } from '@/lib/bot/publish';
import { broadcast } from '@/lib/bot/relay';
import { serializeTweet } from '@/lib/bot/serialize';
import {
  postingEnabled,
  postReplyTweet,
  extractImageUrl,
  extractReferenced,
  getTweetWithContext,
} from '@/lib/twitter/client';
import type { TweetV2, UserV2 } from 'twitter-api-v2';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SECRET = process.env.TWITTER_INTERNAL_SECRET || '';

function colorFromId(id: string): string {
  const palette = ['#f59e0b', '#ec4899', '#0ea5e9', '#10b981', '#7c3aed', '#ef4444', '#14b8a6', '#8b5cf6'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

async function upsertTwitterUser(u: UserV2) {
  const handle = (u.username || 'unknown').toLowerCase();
  const name = u.name || handle;
  const isVerified = !!u.verified;
  const avatarColor = colorFromId(u.id || handle);
  // First try by twitterUid (the canonical link to a real X account).
  const byUid = await db.xUser.findUnique({ where: { twitterUid: u.id } });
  if (byUid) {
    // Update handle/name in case the user renamed their X account.
    if (byUid.handle !== handle || byUid.name !== name) {
      // If the new handle collides with a different local user, rename the
      // conflicting local one to avoid a unique-constraint violation.
      const conflict = await db.xUser.findUnique({ where: { handle } });
      if (conflict && conflict.id !== byUid.id) {
        await db.xUser.update({ where: { id: conflict.id }, data: { handle: `${conflict.handle}_x${conflict.twitterUid || conflict.id.slice(-4)}` } });
      }
      return db.xUser.update({ where: { id: byUid.id }, data: { handle, name, isVerified } });
    }
    if (byUid.isVerified !== isVerified) {
      return db.xUser.update({ where: { id: byUid.id }, data: { isVerified } });
    }
    return byUid;
  }
  // No existing twitterUid — create. Resolve handle conflicts by suffixing.
  let finalHandle = handle;
  const conflict = await db.xUser.findUnique({ where: { handle: finalHandle } });
  if (conflict) {
    finalHandle = `${handle}_x${u.id.slice(-6)}`;
  }
  return db.xUser.create({
    data: { handle: finalHandle, name, isVerified, avatarColor, twitterUid: u.id },
  });
}

export async function POST(req: NextRequest) {
  // auth
  const secret = req.headers.get('x-internal-secret');
  if (!SECRET || secret !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tweet: TweetV2;
    author?: UserV2;
    referenced?: TweetV2[];
    users?: UserV2[];
    includes?: any;
  };
  const tw = body.tweet;
  if (!tw || !tw.id) {
    return NextResponse.json({ error: 'tweet required' }, { status: 400 });
  }

  // dedupe by twitterId
  const existing = await db.tweet.findUnique({ where: { twitterId: tw.id } });
  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already ingested' }, { status: 409 });
  }

  // author
  let authorRow = null;
  if (tw.author_id) {
    const authorUser =
      body.author ||
      (body.users || []).find((u) => u.id === tw.author_id);
    if (authorUser) {
      authorRow = await upsertTwitterUser(authorUser);
    }
  }
  if (!authorRow) {
    // fallback: create a placeholder user
    authorRow = await db.xUser.upsert({
      where: { handle: 'twitter_user' },
      update: {},
      create: { handle: 'twitter_user', name: 'Twitter User', avatarColor: '#64748b' },
    });
  }

  // ACTIVELY fetch the full context of the mention tweet (parent, quoted, media)
  // rather than relying only on search includes — which are often incomplete.
  // This is what lets the bot "see" what tweet the user is actually asking about.
  let fullIncludes = body.includes || {};
  let fullRefTweets = body.referenced || [];
  let fullUsers = body.users || [];
  try {
    const fetched = await getTweetWithContext(tw.id);
    if (fetched?.tweet) {
      // Merge fetched includes over the search includes (fetched is richer).
      fullIncludes = { ...fullIncludes, ...(fetched.includes || {}) };
      const fetchedRefs = fetched.referenced || [];
      // Union: keep search refs + add fetched refs (dedupe by id).
      const seen = new Set(fullRefTweets.map((t) => t.id));
      for (const r of fetchedRefs) {
        if (!seen.has(r.id)) {
          fullRefTweets.push(r);
          seen.add(r.id);
        }
      }
      const seenU = new Set(fullUsers.map((u) => u.id));
      for (const u of fetched.users || []) {
        if (!seenU.has(u.id)) {
          fullUsers.push(u);
          seenU.add(u.id);
        }
      }
    }
  } catch (e) {
    console.error('[twitter/ingest] getTweetWithContext failed (non-fatal):', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    // continue with search-includes data only
  }

  const refs = extractReferenced(tw, fullRefTweets, fullUsers);
  let quotedId: string | null = null;
  let parentId: string | null = null;

  if (refs.quoted) {
    // quoted author may or may not be in users; handle gracefully
    const qAuthorUser = refs.quotedAuthor || fullUsers.find((u) => u.id === refs.quoted!.author_id);
    const qAuthor = qAuthorUser
      ? await upsertTwitterUser(qAuthorUser)
      : await db.xUser.upsert({
          where: { handle: 'quoted_author' },
          update: {},
          create: { handle: 'quoted_author', name: 'Quoted Author', avatarColor: '#64748b' },
        });
    const qRow = await db.tweet.upsert({
      where: { twitterId: refs.quoted.id },
      update: { content: refs.quoted.text || undefined },
      create: {
        authorId: qAuthor.id,
        content: refs.quoted.text || '',
        twitterId: refs.quoted.id,
      },
    });
    quotedId = qRow.id;
  }
  if (refs.repliedTo) {
    const pAuthorUser = refs.repliedToAuthor || fullUsers.find((u) => u.id === refs.repliedTo!.author_id);
    const pAuthor = pAuthorUser
      ? await upsertTwitterUser(pAuthorUser)
      : await db.xUser.upsert({
          where: { handle: 'parent_author' },
          update: {},
          create: { handle: 'parent_author', name: 'Parent Author', avatarColor: '#64748b' },
        });
    const pRow = await db.tweet.upsert({
      where: { twitterId: refs.repliedTo.id },
      update: { content: refs.repliedTo.text || undefined },
      create: {
        authorId: pAuthor.id,
        content: refs.repliedTo.text || '',
        twitterId: refs.repliedTo.id,
      },
    });
    parentId = pRow.id;
  }

  // image (vision) — from the merged includes
  const imageUrl = extractImageUrl(tw, fullIncludes) || null;

  // create the mention tweet
  const mention = await db.tweet.create({
    data: {
      authorId: authorRow.id,
      content: tw.text || '',
      imageUrl,
      parentId,
      quotedId,
      twitterId: tw.id,
      mentionTarget: process.env.TWITTER_BOT_HANDLE?.replace(/^@/, '') || 'aixbot',
    },
    include: { author: true },
  });

  // broadcast typing + run bot
  await broadcast('bot:typing', {
    tweetId: mention.id,
    authorHandle: authorRow.handle,
    snippet: (tw.text || '').slice(0, 80),
    source: 'twitter',
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

  // If posting is enabled, post the reply chunks back to Twitter as a thread.
  const posted: { chunkIndex: number; twitterId: string | null; error?: string }[] = [];
  if (postingEnabled()) {
    let prevTwitterId = tw.id; // reply to the original mention
    for (let i = 0; i < saved.length; i++) {
      const chunk = saved[i];
      try {
        const postedId = await postReplyTweet(chunk.content.slice(0, 280), prevTwitterId || undefined);
        posted.push({ chunkIndex: i, twitterId: postedId });
        if (postedId) {
          await db.tweet.update({ where: { id: chunk.id }, data: { twitterId: postedId } });
          prevTwitterId = postedId;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        posted.push({ chunkIndex: i, twitterId: null, error: message });
        console.error('[twitter] postReplyTweet failed:', message);
        break; // stop the thread on error
      }
    }
  } else {
    console.log('[twitter] posting disabled — reply kept local only (tweetId=%s)', mention.id);
  }

  // broadcast each reply chunk
  for (const t of saved) {
    const fresh = await db.tweet.findUnique({ where: { id: t.id }, include: { author: true } });
    if (!fresh) continue;
    const dto = serializeTweet({ ...fresh, quoted: null, _count: { replies: 0 } });
    await broadcast('bot:reply', {
      parentTweetId: mention.id,
      replyTweet: dto,
      source: 'twitter',
      routingNote: result.routingNote,
      model: result.model,
    });
  }
  await broadcast('bot:done', { tweetId: mention.id, source: 'twitter' });

  return NextResponse.json({
    ok: true,
    source: 'twitter',
    mentionTweetId: mention.id,
    twitterMentionId: tw.id,
    model: result.model,
    action: result.action,
    routingNote: result.routingNote,
    replyCount: saved.length,
    postedToTwitter: posted,
    postingEnabled: postingEnabled(),
  });
}
