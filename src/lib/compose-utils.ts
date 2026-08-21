// Pure helpers for the compose box (shared by ComposeBox + sidebars).
// Reads the bot handle from NEXT_PUBLIC_BOT_HANDLE (inlined at build time).

const BOT_HANDLE_ENV =
  (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_BOT_HANDLE) || 'aixbot';
export const BOT_MENTION = `@${BOT_HANDLE_ENV}`;
const HANDLE_RE = new RegExp(`@${BOT_HANDLE_ENV}\\b`, 'i');
const HANDLE_SPACE_RE = new RegExp(`@${BOT_HANDLE_ENV}\\b\\s*`, 'i');
const MODEL_TOKENS = ['claude', 'gpt', 'gemini', 'grok', 'deepseek', 'auto'];

export const MAX_COMPOSE = 280;

/**
 * Ensure the text starts with an @bot mention.
 */
export function ensureMention(t: string): string {
  if (HANDLE_RE.test(t)) return t;
  return `${BOT_MENTION} ${t}`.trim();
}

/**
 * Insert a command token (/model or /action) right after the @bot mention.
 * If it's a model command, any existing model token is replaced first.
 */
export function insertCommand(currentText: string, cmd: string): string {
  const token = `/${cmd} `;
  let t = ensureMention((currentText || '').trimStart());

  if (MODEL_TOKENS.includes(cmd)) {
    t = t.replace(/\/(?:claude|gpt|gemini|grok|deepseek|auto)\b\s*/gi, '');
  }

  const m = HANDLE_SPACE_RE.exec(t);
  if (m) {
    const idx = m.index + m[0].length;
    t = t.slice(0, idx) + token + t.slice(idx);
  } else {
    t = `${BOT_MENTION} ${token}${t}`;
  }
  return t.trim();
}
