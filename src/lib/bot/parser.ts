// Mention parser. Extracts the requested model / action / query from a tweet
// that @mentions the bot.
//
// Examples:
//   "@aixbot what is BTC price?"            -> model=null, action=null, query="what is BTC price?"
//   "@aixbot /claude explain this"          -> model=claude, action=null, query="explain this"
//   "@aixbot /gpt /summarize"               -> model=gpt, action=summarize, query=""
//   "@aixbot /compare why is BTC dropping"  -> model=null, action=compare, query="why is BTC dropping"
//   "@aixbot /research AI agent market"     -> action=research
//   "@aixbot /translate to ru hello world"  -> action=translate, query="to ru hello world"

import type { ParsedMention, ModelId, ActionId } from './types';
import { BOT_HANDLE } from './types';
import { isModelCommand, isActionCommand } from './registry';

// Aliases for the 'image' action — users can type any of these.
const IMAGE_ALIASES: Record<string, string> = {
  img: 'image',
  image: 'image',
  draw: 'image',
  create: 'image',
  generate: 'image',
  gen: 'image',
  // Russian aliases
  'нарисуй': 'image',
  'создай': 'image',
  'сгенерируй': 'image',
  'картинку': 'image',
  'фото': 'image',
  'рисунок': 'image',
};

export function parseMention(rawText: string, hasImage = false): ParsedMention | null {
  const text = rawText || '';
  // Find the @bot mention (case-insensitive).
  const mentionRegex = new RegExp(`@${BOT_HANDLE}\\b`, 'i');
  if (!mentionRegex.test(text)) return null;

  // Remove the @handle token; keep everything else.
  const withoutMention = text.replace(mentionRegex, ' ').trim();

  // Tokenize while preserving the rest as a string.
  const tokens = withoutMention.split(/\s+/).filter(Boolean);

  let model: ModelId | null = null;
  let action: ActionId | null = null;
  const remaining: string[] = [];

  for (const tok of tokens) {
    if (tok.startsWith('/')) {
      const cmd = tok.slice(1).toLowerCase();
      if (!model && isModelCommand(cmd)) {
        model = cmd as ModelId;
        continue;
      }
      if (!action) {
        // Check image aliases first (before isActionCommand, which doesn't know about them)
        if (IMAGE_ALIASES[cmd]) {
          action = 'image' as ActionId;
          continue;
        }
        if (isActionCommand(cmd)) {
          action = cmd as ActionId;
          continue;
        }
      }
      // unknown slash token -> treat as plain text (keep it)
      remaining.push(tok);
    } else {
      remaining.push(tok);
    }
  }

  const query = remaining.join(' ').trim();

  return {
    mentionedHandle: BOT_HANDLE,
    model,
    action,
    query,
    rawText: text,
    hasImage,
  };
}

/**
 * Decide whether a tweet text mentions the bot at all.
 */
export function mentionsBot(text: string): boolean {
  return new RegExp(`@${BOT_HANDLE}\\b`, 'i').test(text || '');
}
