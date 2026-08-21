// Provider adapters. Each "model" is simulated via the LOCAL z-ai-web-dev-sdk
// (the available local AI service) by injecting that model's personality system
// prompt. To switch to real provider APIs later, replace the bodies of these
// functions — the rest of the engine stays the same.

import ZAI from 'z-ai-web-dev-sdk';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import type { ModelId, BotSource } from './types';
import { getModel } from './registry';
import { buildSystemPrompt } from './personas';

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;

export async function getZai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Run a text completion as a given simulated model.
 * The model's personality system prompt is prepended.
 * Retries on transient errors (429 / network) with exponential backoff.
 */
export async function completeAsModel(
  modelId: ModelId,
  messages: ChatMsg[],
  opts: { temperature?: number; retries?: number } = {},
): Promise<string> {
  const model = getModel(modelId);
  // Use the richly-differentiated persona system prompt (personas.ts).
  const systemPrompt =
    buildSystemPrompt(modelId) ||
    model?.systemPrompt ||
    'You are a helpful AI assistant replying on a social timeline. Be concise and native to the platform. No markdown headings.';

  const zai = await getZai();
  const finalMessages: { role: 'assistant' | 'user'; content: string }[] = [
    { role: 'assistant', content: systemPrompt },
    ...messages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content,
    })),
  ];

  // Slight temperature variation per persona for voice consistency.
  const temp = opts.temperature ?? personaTemperature(modelId);
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: finalMessages,
        thinking: { type: 'disabled' },
        temperature: temp,
      } as any);
      const out = completion.choices[0]?.message?.content;
      return (out || '').trim();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /429|rate|too many|timeout|network|fetch failed|econnreset/i.test(msg);
      if (!transient || attempt === retries) {
        console.error('[provider] completeAsModel error:', msg);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// Per-persona temperature: Grok is a bit more creative/varied, DeepSeek more deterministic.
function personaTemperature(modelId: ModelId): number {
  switch (modelId) {
    case 'grok':
      return 0.95;
    case 'deepseek':
      return 0.4;
    case 'gemini':
      return 0.5;
    case 'claude':
      return 0.7;
    case 'gpt':
      return 0.7;
    default:
      return 0.7;
  }
}

/**
 * Resolve an image reference to a data URL the VLM can ingest.
 * - data: URLs pass through.
 * - http(s) URLs pass through (the VLM fetches them).
 * - relative "/uploads/..." paths are read from public/ and base64-encoded.
 */
function resolveImageDataUrl(imageUrl: string): string {
  if (imageUrl.startsWith('data:')) return imageUrl;
  if (/^https?:\/\//.test(imageUrl)) return imageUrl;
  // relative path served from public/
  const fsPath = join(process.cwd(), 'public', imageUrl);
  if (!existsSync(fsPath)) {
    throw new Error(`image not found: ${imageUrl}`);
  }
  const buf = readFileSync(fsPath);
  const ext = extname(fsPath).slice(1).toLowerCase().replace('jpeg', 'jpg');
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Run a vision (image) completion as a given simulated model.
 * Uses the SDK's createVision endpoint with image_url content.
 */
export async function completeVisionAsModel(
  modelId: ModelId,
  prompt: string,
  imageUrl: string,
  contextText: string,
): Promise<string> {
  const model = getModel(modelId);
  const systemPrompt =
    buildSystemPrompt(modelId) ||
    model?.systemPrompt ||
    'You are a helpful AI assistant analyzing an image on a social timeline. Be concise.';

  const zai = await getZai();
  const fullPrompt =
    `${systemPrompt}\n\n${contextText ? `Context:\n${contextText}\n\n` : ''}` +
    `User request: ${prompt || 'Describe and analyze this image.'}\n\n` +
    `Analyze the image AND respond in your persona's voice. Reference what you actually see in the image.`;

  const dataUrl = resolveImageDataUrl(imageUrl);

  const retries = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: fullPrompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      } as any);
      const out = response.choices[0]?.message?.content;
      return (out || '').trim();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === retries) {
        console.error('[provider] completeVisionAsModel error:', msg);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

/**
 * Perform a web search via the local SDK and return normalized sources.
 */
export async function webSearch(query: string, num = 6): Promise<BotSource[]> {
  const zai = await getZai();
  try {
    const results = (await zai.functions.invoke('web_search', {
      query,
      num,
    })) as any[];
    if (!Array.isArray(results)) return [];
    return results.map((r) => ({
      title: r.name || r.title || '',
      url: r.url || '',
      host: r.host_name || hostOf(r.url || ''),
      snippet: r.snippet || '',
    }));
  } catch (err) {
    console.error('[provider] webSearch error:', err);
    return [];
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Fetch current crypto market data (price, 24h change, market cap) for one or
 * more symbols/tickers. Uses web_search to get real-time numbers, then returns
 * a compact text block the model can cite.
 *
 * @param symbols e.g. ['BTC', 'ETH'] or ['SOL'] — case-insensitive
 */
export async function fetchCryptoData(symbols: string[]): Promise<{ text: string; sources: BotSource[] }> {
  if (!symbols.length) return { text: '', sources: [] };
  const zai = await getZai();
  const sources: BotSource[] = [];
  const lines: string[] = [];

  // Search per symbol (parallel) for current price + market context.
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const q = `${sym.toUpperCase()} price USD 24h change market cap today`;
      try {
        const r = (await zai.functions.invoke('web_search', { query: q, num: 5 })) as any[];
        if (!Array.isArray(r)) return { sym, text: '', srcs: [] as BotSource[] };
        const srcs: BotSource[] = r.map((x) => ({
          title: x.name || '',
          url: x.url || '',
          host: x.host_name || hostOf(x.url || ''),
          snippet: x.snippet || '',
        }));
        sources.push(...srcs);
        const snippets = srcs.slice(0, 4).map((s) => `- ${s.host}: ${s.snippet}`).join('\n');
        return { sym, text: `${sym.toUpperCase()}:\n${snippets}`, srcs };
      } catch {
        return { sym, text: '', srcs: [] as BotSource[] };
      }
    }),
  );

  for (const r of results) {
    if (r.text) lines.push(r.text);
  }

  return {
    text: lines.length ? `Real-time market data (from web search, may be a few minutes stale):\n\n${lines.join('\n\n')}` : '',
    sources,
  };
}

/**
 * Detect crypto symbols/tickers mentioned in a text. Returns uppercase symbols.
 * Matches $TICKER, bare tickers like BTC/ETH, and common names.
 */
export function detectCryptoSymbols(text: string): string[] {
  const found = new Set<string>();
  // $TICKER pattern
  const dollar = text.match(/\$([A-Z]{2,6})\b/g);
  if (dollar) for (const m of dollar) found.add(m.slice(1));
  // Common tickers by name (case-insensitive)
  const nameMap: Record<string, string> = {
    bitcoin: 'BTC', btc: 'BTC',
    ethereum: 'ETH', eth: 'ETH', ether: 'ETH',
    solana: 'SOL', sol: 'SOL',
    cardano: 'ADA', ada: 'ADA',
    dogecoin: 'DOGE', doge: 'DOGE',
    ripple: 'XRP', xrp: 'XRP',
    binance: 'BNB', bnb: 'BNB',
    avalanche: 'AVAX', avax: 'AVAX',
    polkadot: 'DOT', dot: 'DOT',
    chainlink: 'LINK', link: 'LINK',
    polygon: 'MATIC', matic: 'MATIC',
    arbitrum: 'ARB', arb: 'ARB',
    optimism: 'OP', 'op ': 'OP',
    aptos: 'APT', apt: 'APT',
    sui: 'SUI',
    toncoin: 'TON', ton: 'TON',
    shiba: 'SHIB', shib: 'SHIB',
    pepe: 'PEPE',
    litecoin: 'LTC', ltc: 'LTC',
    tron: 'TRX', trx: 'TRX',
    near: 'NEAR',
    injective: 'INJ', inj: 'INJ',
    celestia: 'TIA', tia: 'TIA',
    seir: 'SEI', sei: 'SEI',
    kaspa: 'KAS', kas: 'KAS',
    worldcoin: 'WLD', wld: 'WLD',
    rendchain: 'RENDER', render: 'RENDER', rndr: 'RENDER',
  };
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z]+/g) || [];
  for (const t of tokens) {
    if (nameMap[t]) found.add(nameMap[t]);
  }
  // Filter out very common false positives
  const blacklist = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'HAS', 'HIS']);
  return Array.from(found).filter((s) => !blacklist.has(s)).slice(0, 5);
}
