// POST /api/tweets — compose a tweet (as a simulated X user).
// Body: { handle, content, imageUrl?, parentId?, quotedId? }
// Returns the created tweet. If the text @mentions the bot, the caller is
// expected to then POST /api/bot/process to trigger the bot (or rely on the
// frontend socket flow).

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { serializeTweet } from '@/lib/bot/serialize';
import { mentionsBot } from '@/lib/bot/parser';
import { BOT_HANDLE } from '@/lib/bot/types';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { handle, content, imageUrl, parentId, quotedId } = body as {
    handle?: string;
    content?: string;
    imageUrl?: string | null;
    parentId?: string | null;
    quotedId?: string | null;
  };

  if (!handle || !content || !content.trim()) {
    return NextResponse.json({ error: 'handle and content are required' }, { status: 400 });
  }

  // Ensure the user exists.
  let user = await db.xUser.findUnique({ where: { handle } });
  if (!user) {
    return NextResponse.json({ error: `user @${handle} not found` }, { status: 404 });
  }

  const mentioned = mentionsBot(content);
  const mentionTarget = mentioned ? BOT_HANDLE : null;

  const tweet = await db.tweet.create({
    data: {
      authorId: user.id,
      content: content.trim(),
      imageUrl: imageUrl || null,
      parentId: parentId || null,
      quotedId: quotedId || null,
      mentionTarget,
    },
    include: {
      author: true,
      quoted: { include: { author: true } },
      _count: { select: { replies: true } },
    },
  });

  return NextResponse.json({ tweet: serializeTweet(tweet), mentionsBot: mentioned });
}
