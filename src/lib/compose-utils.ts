// Pure helpers for the compose box (shared by ComposeBox + sidebars).

const BOT_MENTION = '@aixbot';
const MODEL_TOKENS = ['claude', 'gpt', 'gemini', 'grok', 'deepseek', 'auto'];

export const MAX_COMPOSE = 280;

/**
 * Ensure the text starts with an @aixbot mention.
 */
export function ensureMention(t: string): string {
  if (/@aixbot\b/i.test(t)) return t;
  return `${BOT_MENTION} ${t}`.trim();
}

/**
 * Insert a command token (/model or /action) right after the @aixbot mention.
 * If it's a model command, any existing model token is replaced first.
 */
export function insertCommand(currentText: string, cmd: string): string {
  const token = `/${cmd} `;
  let t = ensureMention((currentText || '').trimStart());

  if (MODEL_TOKENS.includes(cmd)) {
    t = t.replace(/\/(?:claude|gpt|gemini|grok|deepseek|auto)\b\s*/gi, '');
  }

  const m = /@aixbot\b\s*/i.exec(t);
  if (m) {
    const idx = m.index + m[0].length;
    t = t.slice(0, idx) + token + t.slice(idx);
  } else {
    t = `${BOT_MENTION} ${token}${t}`;
  }
  return t.trim();
}
