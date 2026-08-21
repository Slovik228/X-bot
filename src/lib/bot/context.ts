// Context collector. Gathers the full X context around a mention:
// the tweet text, author, quoted tweet, parent tweet, the surrounding thread,
// attached image, and links — plus conversation memory (prior bot replies in
// the reply chain).

import { db } from '@/lib/db';
import type { CollectedContext } from './types';
import { BOT_HANDLE } from './types';

const URL_REGEX = /https?:\/\/[^\s]+/gi;

export async function collectContext(tweetId: string): Promise<CollectedContext> {
  const tweet = await db.tweet.findUnique({
    where: { id: tweetId },
    include: {
      author: true,
      quoted: { include: { author: true } },
      parent: { include: { author: true } },
    },
  });
  if (!tweet) throw new Error('tweet not found');

  const links = (tweet.content.match(URL_REGEX) || []) as string[];

  // Walk UP the reply chain to build the thread (root -> ... -> current).
  const chain: { author: string; text: string; isBot: boolean; model: string | null }[] = [];
  let cur = tweet.parent;
  const visited = new Set<string>([tweet.id]);
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.unshift({
      author: cur.author.handle,
      text: cur.content,
      isBot: cur.isBot,
      model: cur.botModel,
    });
    // fetch parent's parent
    const next = await db.tweet.findUnique({
      where: { id: cur.id },
      include: { parent: { include: { author: true } } },
    });
    cur = next?.parent ?? null;
  }

  // Conversation memory: the chain becomes alternating user/assistant turns.
  // We treat non-bot authors as 'user' and bot authors as 'assistant'.
  const memory = chain.map((c) => ({
    role: (c.isBot ? 'assistant' : 'user') as 'user' | 'assistant',
    author: c.author,
    text: c.text,
    model: c.model,
  }));

  return {
    tweetId: tweet.id,
    authorHandle: tweet.author.handle,
    authorName: tweet.author.name,
    text: tweet.content,
    imageUrl: tweet.imageUrl,
    quoted: tweet.quoted
      ? {
          author: tweet.quoted.author.handle,
          text: tweet.quoted.content,
          imageUrl: tweet.quoted.imageUrl,
        }
      : null,
    parent: tweet.parent
      ? { author: tweet.parent.author.handle, text: tweet.parent.content }
      : null,
    thread: chain,
    links,
    memory,
  };
}

/**
 * Build a compact text block describing the gathered context, for injection
 * into the model prompt.
 */
export function renderContext(ctx: CollectedContext): string {
  const parts: string[] = [];
  parts.push(`Author: @${ctx.authorHandle}`);
  if (ctx.text) parts.push(`Their tweet: "${ctx.text}"`);
  if (ctx.imageUrl) parts.push(`(attached image: ${ctx.imageUrl})`);
  if (ctx.quoted) {
    parts.push(
      `Quoted tweet by @${ctx.quoted.author}: "${ctx.quoted.text}"` +
        (ctx.quoted.imageUrl ? ` (with image: ${ctx.quoted.imageUrl})` : ''),
    );
  }
  if (ctx.parent) {
    parts.push(`In reply to @${ctx.parent.author}: "${ctx.parent.text}"`);
  }
  if (ctx.thread.length > 0) {
    parts.push(
      'Thread context so far:\n' +
        ctx.thread
          .map(
            (t, i) =>
              `  ${i + 1}. @${t.author}${t.isBot ? ` (bot/${t.model || 'auto'})` : ''}: ${t.text}`,
          )
          .join('\n'),
    );
  }
  if (ctx.links.length > 0) {
    parts.push('Links in tweet: ' + ctx.links.join(', '));
  }
  return parts.join('\n');
}

export { BOT_HANDLE };
