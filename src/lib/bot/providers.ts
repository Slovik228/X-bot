// Provider adapters — uses any OpenAI-compatible API (Groq, OpenAI, Together, etc.)
// Groq is the default: free, fast, works from any IP. Get a key at console.groq.com/keys.
//
// Each "model" (claude/gpt/gemini/grok/deepseek) is simulated by injecting that
// model's personality system prompt (from personas.ts). The underlying LLM is
// the same, but the persona makes each respond distinctly.
// To use real provider APIs later, set AI_BASE_URL per model.

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import type { ModelId, BotSource } from './types';
import { getModel } from './registry';
import { buildSystemPrompt } from './personas';

// ---- AI API config ----
// Set AI_API_KEY + AI_BASE_URL + AI_MODEL in .env or Fly secrets.
// Default: Groq (free, fast, works from any IP).
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1';
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || 'llama-3.2-90b-vision-preview';

interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Call an OpenAI-compatible /chat/completions endpoint.
 * Works with Groq, OpenAI, Together AI, OpenRouter, etc.
 */
async function chatCompletion(
  messages: ChatMsg[],
  opts: { temperature?: number; model?: string; maxTokens?: number } = {},
): Promise<string> {
  if (!AI_API_KEY) {
    throw new Error('AI_API_KEY not set. Get a free key at https://console.groq.com/keys and set AI_API_KEY env var.');
  }

  const body: Record<string, unknown> = {
    model: opts.model || AI_MODEL,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: opts.temperature ?? 0.6,
    max_completion_tokens: opts.maxTokens ?? 1024,
    top_p: 0.95,
    // Disable reasoning/thinking mode — we want direct answers, not chain-of-thought.
    // Qwen3 on Groq outputs its thinking process by default; this hides it.
    reasoning_effort: 'none',
    reasoning_format: 'hidden',
  };

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return (content || '').trim();
}

/**
 * Run a text completion as a given simulated model.
 * The model's personality system prompt is prepended.
 */
export async function completeAsModel(
  modelId: ModelId,
  messages: ChatMsg[],
  opts: { temperature?: number; retries?: number } = {},
): Promise<string> {
  const systemPrompt = buildSystemPrompt(modelId);

  const finalMessages: ChatMsg[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // Per-persona temperature for voice consistency.
  const temp = opts.temperature ?? personaTemperature(modelId);
  const retries = opts.retries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await chatCompletion(finalMessages, { temperature: temp });
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
 */
function resolveImageDataUrl(imageUrl: string): string {
  if (imageUrl.startsWith('data:')) return imageUrl;
  if (/^https?:\/\//.test(imageUrl)) return imageUrl;
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
 */
export async function completeVisionAsModel(
  modelId: ModelId,
  prompt: string,
  imageUrl: string,
  contextText: string,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(modelId);
  const fullPrompt =
    `${systemPrompt}\n\n${contextText ? `Context:\n${contextText}\n\n` : ''}` +
    `User request: ${prompt || 'Describe and analyze this image.'}`;

  const dataUrl = resolveImageDataUrl(imageUrl);

  const retries = 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body = {
        model: AI_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: fullPrompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.5,
        max_tokens: 1024,
      };
      const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Vision API error ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      return (data?.choices?.[0]?.message?.content || '').trim();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) {
        console.error('[provider] completeVisionAsModel error:', err instanceof Error ? err.message : 'unknown');
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

/**
 * Perform a web search. Uses DuckDuckGo's HTML endpoint (free, no API key needed).
 * Returns normalized sources.
 */
export async function webSearch(query: string, num = 6): Promise<BotSource[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SlopiusBot/1.0)',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const sources: BotSource[] = [];

    // Parse DuckDuckGo HTML results (result links + snippets).
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;

    const links: { url: string; title: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null && links.length < num) {
      const rawUrl = m[1];
      // DDG wraps URLs in a redirect; extract the actual URL.
      const urlMatch = /uddg=([^&]+)/.exec(rawUrl);
      const actualUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      links.push({ url: actualUrl, title });
    }

    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null && snippets.length < num) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }

    for (let i = 0; i < links.length; i++) {
      sources.push({
        title: links[i].title,
        url: links[i].url,
        host: hostOf(links[i].url),
        snippet: snippets[i] || '',
      });
    }

    return sources;
  } catch (err) {
    console.error('[provider] webSearch error:', err instanceof Error ? err.message : 'unknown');
    return [];
  }
}

/**
 * Fetch current crypto market data using CoinGecko's free API (no key needed).
 */
export async function fetchCryptoData(symbols: string[]): Promise<{ text: string; sources: BotSource[] }> {
  if (!symbols.length) return { text: '', sources: [] };

  // Map common tickers to CoinGecko coin IDs.
  const coinIdMap: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
    DOGE: 'dogecoin', XRP: 'ripple', BNB: 'binancecoin', AVAX: 'avalanche-2',
    DOT: 'polkadot', LINK: 'chainlink', MATIC: 'matic-network', ARB: 'arbitrum',
    OP: 'optimism', APT: 'aptos', SUI: 'sui', TON: 'the-open-network',
    SHIB: 'shiba-inu', PEPE: 'pepe', LTC: 'litecoin', TRX: 'tron',
    NEAR: 'near', INJ: 'injective-protocol', TIA: 'celestia', SEI: 'sei-network',
    KAS: 'kaspa', WLD: 'worldcoin-wld', RENDER: 'render-token', RNDR: 'render-token',
  };

  const coinIds = symbols
    .map((s) => ({ symbol: s, id: coinIdMap[s.toUpperCase()] }))
    .filter((s) => s.id);

  if (!coinIds.length) {
    return { text: `Could not map ${symbols.join(', ')} to known coins.`, sources: [] };
  }

  const idsParam = coinIds.map((c) => c.id).join(',');
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();

    const lines: string[] = [];
    const sources: BotSource[] = [{ title: 'CoinGecko', url: 'https://coingecko.com', host: 'coingecko.com' }];

    for (const c of coinIds) {
      const d = data[c.id];
      if (d) {
        const price = d.usd;
        const change = d.usd_24h_change;
        const mcap = d.usd_market_cap;
        lines.push(
          `${c.symbol}: $${price.toLocaleString()} (${change >= 0 ? '+' : ''}${change.toFixed(2)}% 24h)` +
            (mcap ? ` | Market Cap: $${(mcap / 1e9).toFixed(2)}B` : ''),
        );
      }
    }

    return {
      text: lines.length ? `Real-time market data (CoinGecko):\n${lines.join('\n')}` : '',
      sources,
    };
  } catch (err) {
    console.error('[provider] fetchCryptoData error:', err instanceof Error ? err.message : 'unknown');
    return { text: '', sources: [] };
  }
}

/**
 * Detect crypto symbols/tickers mentioned in a text.
 */
export function detectCryptoSymbols(text: string): string[] {
  const found = new Set<string>();
  const dollar = text.match(/\$([A-Z]{2,6})\b/g);
  if (dollar) for (const m of dollar) found.add(m.slice(1));
  const nameMap: Record<string, string> = {
    bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', ether: 'ETH',
    solana: 'SOL', sol: 'SOL', cardano: 'ADA', ada: 'ADA', dogecoin: 'DOGE',
    doge: 'DOGE', ripple: 'XRP', xrp: 'XRP', binance: 'BNB', bnb: 'BNB',
    avalanche: 'AVAX', avax: 'AVAX', polkadot: 'DOT', dot: 'DOT',
    chainlink: 'LINK', link: 'LINK', polygon: 'MATIC', matic: 'MATIC',
    arbitrum: 'ARB', arb: 'ARB', optimism: 'OP', aptos: 'APT', apt: 'APT',
    sui: 'SUI', toncoin: 'TON', ton: 'TON', shiba: 'SHIB', shib: 'SHIB',
    pepe: 'PEPE', litecoin: 'LTC', ltc: 'LTC', tron: 'TRX', trx: 'TRX',
    near: 'NEAR', injective: 'INJ', inj: 'INJ', celestia: 'TIA', tia: 'TIA',
    sei: 'SEI', kaspa: 'KAS', kas: 'KAS', worldcoin: 'WLD', wld: 'WLD',
    render: 'RENDER', rndr: 'RENDER',
  };
  const lower = text.toLowerCase();
  const tokens = lower.match(/[a-z]+/g) || [];
  for (const t of tokens) {
    if (nameMap[t]) found.add(nameMap[t]);
  }
  const blacklist = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'HAS', 'HIS']);
  return Array.from(found).filter((s) => !blacklist.has(s)).slice(0, 5);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
