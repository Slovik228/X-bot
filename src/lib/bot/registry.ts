// Model & command registry. Models are easily added/removed here.
// Each "provider" wraps the local z-ai-web-dev-sdk LLM with a richly-
// differentiated persona (see personas.ts) that SIMULATES the named model's
// style (testing with local models). To add a real API later, swap the
// provider implementation in providers.ts — the personas stay.

import type { ModelInfo, CommandInfo, ModelId, ActionId } from './types';

export const MODELS: ModelInfo[] = [
  {
    id: 'claude',
    label: 'Claude',
    provider: 'Anthropic',
    color: '#d97757',
    badge: 'CLD',
    emoji: '🧠',
    capabilities: { vision: true, code: true, reasoning: true, search: false, speed: 'medium' },
    description: 'Thoughtful, nuanced, honest about uncertainty. Great for analysis & careful takes.',
    systemPrompt: '', // populated from personas.ts at runtime
  },
  {
    id: 'gpt',
    label: 'GPT',
    provider: 'OpenAI',
    color: '#10a37f',
    badge: 'GPT',
    emoji: '⚡',
    capabilities: { vision: true, code: true, reasoning: true, search: false, speed: 'fast' },
    description: 'Direct, structured, confident. Strong with code and step-by-step reasoning.',
    systemPrompt: '',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    provider: 'Google',
    color: '#4285f4',
    badge: 'GEM',
    emoji: '✨',
    capabilities: { vision: true, code: true, reasoning: true, search: true, speed: 'fast' },
    description: 'Factual, grounded, multimodal-native. Great with images, data, and real-time info.',
    systemPrompt: '',
  },
  {
    id: 'grok',
    label: 'Grok',
    provider: 'xAI',
    color: '#1d9bf0',
    badge: 'GRK',
    emoji: '🫡',
    capabilities: { vision: false, code: true, reasoning: true, search: true, speed: 'fast' },
    description: 'Witty, real-time-aware, irreverent. Sharp takes on crypto, news, and culture.',
    systemPrompt: '',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'DeepSeek',
    color: '#7c3aed',
    badge: 'DSK',
    emoji: '🔮',
    capabilities: { vision: false, code: true, reasoning: true, search: false, speed: 'medium' },
    description: 'Rigorous, step-by-step, technically deep. Excels at math, proofs, and algorithms.',
    systemPrompt: '',
  },
  {
    id: 'auto',
    label: 'Auto',
    provider: 'Router',
    color: '#6366f1',
    badge: 'AUTO',
    emoji: '🎯',
    capabilities: { vision: true, code: true, reasoning: true, search: true, speed: 'medium' },
    description: 'Bot picks the best model for the task automatically.',
    systemPrompt: '',
  },
];

export const COMMANDS: CommandInfo[] = [
  // Model commands
  ...MODELS.filter((m) => m.id !== 'auto').map((m) => ({
    id: m.id,
    type: 'model' as const,
    label: `/${m.id}`,
    description: `Route to ${m.label} (${m.provider}).`,
    usage: `@aixbot /${m.id} your question`,
  })),
  {
    id: 'auto',
    type: 'model',
    label: '/auto',
    description: 'Let the bot choose the optimal model for the task.',
    usage: '@aixbot /auto analyze this contract',
  },
  // Action commands
  {
    id: 'summarize',
    type: 'action',
    label: '/summarize',
    description: 'Summarize the tweet, quoted tweet, or thread.',
    usage: '@aixbot /summarize',
  },
  {
    id: 'translate',
    type: 'action',
    label: '/translate',
    description: 'Translate text. Add target language, e.g. /translate to ru.',
    usage: '@aixbot /translate to ru',
  },
  {
    id: 'research',
    type: 'action',
    label: '/research',
    description: 'Deep research: searches multiple sources and synthesizes a thread.',
    usage: '@aixbot /research analyze the AI agent market',
  },
  {
    id: 'search',
    type: 'action',
    label: '/search',
    description: 'Quick web search with cited sources.',
    usage: "@aixbot /search what's happening with ETH?",
  },
  {
    id: 'analyze',
    type: 'action',
    label: '/analyze',
    description: 'Deep analysis of the tweet, quoted content, image, or token.',
    usage: '@aixbot /analyze',
  },
  {
    id: 'code',
    type: 'action',
    label: '/code',
    description: 'Generate or explain code.',
    usage: '@aixbot /code debounce in ts',
  },
  {
    id: 'compare',
    type: 'action',
    label: '/compare',
    description: 'Run the same prompt across multiple models and synthesize.',
    usage: '@aixbot /compare explain why BTC is dropping',
  },
  {
    id: 'price',
    type: 'action',
    label: '/price',
    description: 'Get real-time crypto price + market data for a ticker. e.g. /price BTC',
    usage: '@aixbot /price SOL',
  },
  {
    id: 'token',
    type: 'action',
    label: '/token',
    description: 'Deep token analysis: price, tokenomics, risks, buy/sell read.',
    usage: '@aixbot /token ARB',
  },
];

export const MODEL_IDS = MODELS.map((m) => m.id);
export const ACTION_IDS: ActionId[] = [
  'summarize',
  'translate',
  'research',
  'search',
  'analyze',
  'code',
  'compare',
  'price',
  'token',
];

export function getModel(id: ModelId): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelByCommand(cmd: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === cmd.toLowerCase());
}

export function isModelCommand(token: string): boolean {
  return MODELS.some((m) => m.id === token.toLowerCase());
}

export function isActionCommand(token: string): boolean {
  return ACTION_IDS.includes(token.toLowerCase() as ActionId);
}
