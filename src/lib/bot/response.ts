// Response processor. Takes a raw model response and splits it into
// tweet-sized chunks (with Reply k/N markers), formats web-search sources,
// and produces the final BotReplyChunk[] the publisher will post.

import type { BotReplyChunk, BotSource } from './types';
import { MAX_TWEET_CHARS } from './types';

/**
 * Split a long response into <= MAX_TWEET_CHARS chunks.
 * Prefer splitting on paragraph breaks, then sentence breaks, then hard word wrap.
 * Each chunk gets a " k/N" suffix marker when total > 1.
 */
export function splitIntoChunks(text: string): BotReplyChunk[] {
  const clean = (text || '').trim();
  if (!clean) return [{ content: '(no response)', index: 0, total: 1 }];

  // Reserve room for the " k/N" marker (max " 999/999" ~ 9 chars).
  const reserve = 10;
  const limit = MAX_TWEET_CHARS - reserve;

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const para of paragraphs) {
    // If a single paragraph is longer than the limit, split it by sentences,
    // then by words.
    if (para.length > limit) {
      pushCurrent();
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sent of sentences) {
        if (sent.length > limit) {
          // hard word-wrap
          pushCurrent();
          const words = sent.split(/\s+/);
          for (const w of words) {
            if ((current + ' ' + w).trim().length > limit) {
              pushCurrent();
            }
            current = current ? current + ' ' + w : w;
          }
        } else if ((current + '\n' + sent).trim().length > limit) {
          pushCurrent();
          current = sent;
        } else {
          current = current ? current + ' ' + sent : sent;
        }
      }
    } else if ((current + '\n\n' + para).trim().length > limit) {
      pushCurrent();
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  pushCurrent();

  const total = chunks.length;
  return chunks.map((content, index) => {
    const marker = total > 1 ? ` ${index + 1}/${total}` : '';
    return { content: content + marker, index, total };
  });
}

/**
 * Format web-search sources into a compact source line block.
 */
export function formatSources(sources: BotSource[], max = 3): string {
  if (!sources.length) return '';
  return (
    'Sources:\n' +
    sources
      .slice(0, max)
      .map((s, i) => `${i + 1}. ${s.host} — ${s.title}`)
      .join('\n')
  );
}

/**
 * Shorten a single response for compare mode (one line per model).
 */
export function shortenForCompare(modelLabel: string, text: string, limit = 220): string {
  const one = (text || '')
    .replace(/\n{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (one.length <= limit) return `${modelLabel}: ${one}`;
  return `${modelLabel}: ${one.slice(0, limit - 1)}…`;
}
