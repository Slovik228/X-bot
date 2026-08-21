// Publisher: persists bot reply chunks as a reply thread to the original
// mention tweet, and returns the saved tweet objects (for the API response
// and for socket broadcast).

import { db } from '@/lib/db';
import { randomUUID } from 'crypto';
import type { BotRunResult } from './types';
import { BOT_HANDLE } from './types';

export async function getBotUser() {
  let bot = await db.xUser.findUnique({ where: { handle: BOT_HANDLE } });
  if (!bot) {
    bot = await db.xUser.create({
      data: {
        handle: BOT_HANDLE,
        name: 'AI X Bot',
        bio: 'Multi-model AI bot. Mention me with /claude /gpt /gemini /grok /deepseek /auto /compare /research /search',
        avatarColor: '#6366f1',
        isBot: true,
        isVerified: true,
      },
    });
  }
  return bot;
}

export async function publishBotReply(
  parentTweetId: string,
  result: BotRunResult,
) {
  const bot = await getBotUser();
  const runId = randomUUID();
  const sourcesJson = result.sources.length ? JSON.stringify(result.sources) : null;

  // Save the mention tweet's bot metadata (model/action) for display.
  await db.tweet.update({
    where: { id: parentTweetId },
    data: { botModel: result.model, botCommand: result.action },
  }).catch(() => {});

  // Save each chunk as a threaded reply. Each chunk replies to the previous one.
  const saved: Awaited<ReturnType<typeof db.tweet.create>>[] = [];
  let prevId = parentTweetId;
  for (const chunk of result.chunks) {
    const t = await db.tweet.create({
      data: {
        authorId: bot.id,
        content: chunk.content,
        parentId: prevId,
        isBot: true,
        botModel: result.model,
        botCommand: result.action,
        botRunId: runId,
        threadIndex: chunk.index,
        threadTotal: chunk.total,
        sources: chunk.index === chunk.total - 1 ? sourcesJson : null,
      },
      include: { author: true },
    });
    saved.push(t);
    prevId = t.id;
  }

  return { saved, runId, bot };
}
