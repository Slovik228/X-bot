// POST /api/seed — seed demo X users and a few sample tweets so the timeline
// isn't empty. Idempotent (upsert by handle).

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BOT_HANDLE } from '@/lib/bot/types';

export async function POST() {
  const users = [
    { handle: BOT_HANDLE, name: 'AI X Bot', avatarColor: '#6366f1', bio: 'Multi-model AI bot. Mention me with /claude /gpt /gemini /grok /deepseek /auto /compare /research /search', isBot: true, isVerified: true },
    { handle: 'satoshi', name: 'Satoshi', avatarColor: '#f59e0b', bio: 'crypto curious', isVerified: true },
    { handle: 'devara', name: 'Dev Aria', avatarColor: '#ec4899', bio: 'building things', isVerified: false },
    { handle: 'newsmax', name: 'News Max', avatarColor: '#0ea5e9', bio: 'real-time news', isVerified: true },
    { handle: 'you', name: 'You', avatarColor: '#10b981', bio: 'this is your test account', isVerified: false },
  ];

  for (const u of users) {
    await db.xUser.upsert({
      where: { handle: u.handle },
      update: {},
      create: u,
    });
  }

  const satoshi = await db.xUser.findUnique({ where: { handle: 'satoshi' } });
  const devara = await db.xUser.findUnique({ where: { handle: 'devara' } });
  const newsmax = await db.xUser.findUnique({ where: { handle: 'newsmax' } });

  // A couple of seed top-level tweets (only if timeline is empty).
  const existing = await db.tweet.count({ where: { parentId: null } });
  if (existing === 0 && satoshi && devara && newsmax) {
    await db.tweet.create({
      data: {
        authorId: newsmax.id,
        content: "ETH gas fees just hit a 6-month low. L2 adoption is working.",
      },
    });
    await db.tweet.create({
      data: {
        authorId: satoshi.id,
        content: "Hot take: most tokenomics fail because unlocks favor insiders over users. Change my mind.",
      },
    });
    await db.tweet.create({
      data: {
        authorId: devara.id,
        content: "Spent the morning debugging a nasty race condition. Turns out the fix was one line. 🫠",
      },
    });
  }

  const all = await db.xUser.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json({
    ok: true,
    users: all.map((u) => ({
      handle: u.handle,
      name: u.name,
      avatarColor: u.avatarColor,
      bio: u.bio,
      isBot: u.isBot,
      isVerified: u.isVerified,
    })),
  });
}
