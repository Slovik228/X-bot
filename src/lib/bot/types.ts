// Core types for the Multi-Model AI X Bot engine.

export type ModelId =
  | 'claude'
  | 'gpt'
  | 'gemini'
  | 'grok'
  | 'deepseek'
  | 'auto';

export type ActionId =
  | 'summarize'
  | 'translate'
  | 'research'
  | 'search'
  | 'analyze'
  | 'code'
  | 'compare'
  | 'price'
  | 'token';

export interface ModelCapabilities {
  vision: boolean;
  code: boolean;
  reasoning: boolean;
  search: boolean;
  speed: 'fast' | 'medium' | 'slow';
}

export interface ModelInfo {
  id: ModelId;
  label: string;
  provider: string;
  color: string;
  badge: string;
  emoji: string;
  capabilities: ModelCapabilities;
  description: string;
  systemPrompt: string;
}

export interface CommandInfo {
  id: string;
  type: 'model' | 'action';
  label: string;
  description: string;
  usage: string;
}

export interface ParsedMention {
  mentionedHandle: string;
  model: ModelId | null;
  action: ActionId | null;
  query: string;
  rawText: string;
  hasImage: boolean;
}

export interface CollectedContext {
  tweetId: string;
  authorHandle: string;
  authorName: string;
  text: string;
  imageUrl: string | null;
  quoted: { author: string; text: string; imageUrl: string | null } | null;
  parent: { author: string; text: string } | null;
  thread: { author: string; text: string; isBot: boolean; model: string | null }[];
  links: string[];
  memory: { role: 'user' | 'assistant'; author: string; text: string; model: string | null }[];
}

export interface BotReplyChunk {
  content: string;
  index: number;
  total: number;
}

export interface BotSource {
  title: string;
  url: string;
  host: string;
  snippet?: string;
}

export interface BotRunResult {
  model: ModelId;
  requestedModel: ModelId | null;
  action: ActionId | null;
  chunks: BotReplyChunk[];
  sources: BotSource[];
  comparisons: { model: ModelId; text: string }[];
  routingNote: string;
}

// Bot handle: read from env (real X handle) or default to 'aixbot' (local sim).
export const BOT_HANDLE = (process.env.TWITTER_BOT_HANDLE || 'aixbot').trim().replace(/^@/, '');
export const BOT_NAME = 'AI X Bot';
export const MAX_TWEET_CHARS = 270;
