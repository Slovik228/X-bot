// Bot engine — the orchestrator.
// Pipeline: parse mention -> resolve model/action -> collect context ->
// route to provider (text/vision/search/compare/research) -> process response
// into tweet-sized chunks -> return BotRunResult for the publisher.

import { db } from '@/lib/db';
import type {
  BotRunResult,
  BotReplyChunk,
  BotSource,
  ModelId,
  ActionId,
  CollectedContext,
  ParsedMention,
} from './types';
import { BOT_HANDLE } from './types';
import { getModel } from './registry';
import { parseMention } from './parser';
import { collectContext, renderContext } from './context';
import { completeAsModel, completeVisionAsModel, webSearch, fetchCryptoData, detectCryptoSymbols } from './providers';
import { splitIntoChunks, formatSources, shortenForCompare } from './response';
import { checkRateLimit } from './ratelimit';

const COMPARE_MODELS: ModelId[] = ['grok', 'claude', 'gpt'];

/**
 * Resolve which model to use:
 * 1. explicit /model command
 * 2. user's saved default preference
 * 3. "auto" routing
 */
async function resolveModel(
  parsed: ParsedMention,
  handle: string,
  ctx: CollectedContext,
): Promise<{ model: ModelId; note: string }> {
  if (parsed.model && parsed.model !== 'auto') {
    return { model: parsed.model, note: `routed to ${parsed.model}` };
  }
  // user preference
  const pref = await db.userPref.findUnique({ where: { handle } });
  if (pref?.defaultModel && pref.defaultModel !== 'auto' && !parsed.model) {
    return { model: pref.defaultModel as ModelId, note: `user default → ${pref.defaultModel}` };
  }
  // auto routing
  const m = autoRoute(ctx, parsed);
  return { model: m.model, note: m.note };
}

/**
 * /auto heuristics: pick the optimal model based on task signals.
 */
function autoRoute(ctx: CollectedContext, parsed: ParsedMention): { model: ModelId; note: string } {
  const q = (parsed.query + ' ' + ctx.text).toLowerCase();
  if (ctx.imageUrl) return { model: 'gemini', note: 'vision task → gemini' };
  if (/\b(code|function|bug|debug|implement|script|compile|refactor|api|class)\b/.test(q))
    return { model: 'gpt', note: 'code task → gpt' };
  if (/\b(math|prove|proof|algorithm|complexity|equation|integral|derivative)\b/.test(q))
    return { model: 'deepseek', note: 'reasoning task → deepseek' };
  if (/\b(news|today|current|price|crypto|btc|eth|market|happening|latest)\b/.test(q))
    return { model: 'grok', note: 'real-time task → grok' };
  if (/\b(analyze|analysis|argument|essay|compare|nuance|trade.?off|implication)\b/.test(q))
    return { model: 'claude', note: 'analysis task → claude' };
  return { model: 'gpt', note: 'general task → gpt' };
}

function buildUserPrompt(
  action: ActionId | null,
  ctx: CollectedContext,
  parsed: ParsedMention,
): string {
  const ctxBlock = renderContext(ctx);
  const q = parsed.query;

  // Build a context-awareness directive: tell the model to USE the gathered context.
  const contextDirectives: string[] = [];
  if (ctx.quoted) contextDirectives.push(`The user QUOTED a tweet by @${ctx.quoted.author}. Its full text: "${ctx.quoted.text}". You are being asked about THIS quoted tweet. Your response MUST be about the quoted tweet's content.`);
  if (ctx.parent) contextDirectives.push(`This tweet is a REPLY to @${ctx.parent.author}. The parent tweet's full text: "${ctx.parent.text}". The user is asking about / reacting to that parent tweet. Your response MUST relate to the parent tweet's actual topic.`);
  if (ctx.thread.length > 0) contextDirectives.push(`This is inside a thread with ${ctx.thread.length} prior message(s). Read them above and stay coherent with the conversation's actual topic.`);
  if (ctx.imageUrl) contextDirectives.push(`The user attached an image. Look at it and respond to what's actually in the image.`);
  if (ctx.links.length > 0) contextDirectives.push(`The tweet contains links: ${ctx.links.join(', ')}. The topic is likely related to those links.`);

  const contextNote =
    contextDirectives.length > 0
      ? `\n\n═══ CRITICAL — TWEET CONTEXT (the user is asking about THIS, not about crypto) ═══\n${contextDirectives.map((d) => `• ${d}`).join('\n')}\n\nANTI-TOPIC-DRIFT RULE: Identify the ACTUAL topic of the referenced tweet (parent/quoted). If it is about fish, ocean, nature, art, a person, news, sports, food, science, or ANY non-crypto topic — respond about THAT topic. Do NOT pivot to crypto, tokenomics, staking, trading, or markets unless the referenced tweet is genuinely about crypto. The user said "tell me more about this" — "this" = the referenced tweet, not crypto.`
      : '';

  // When there's no explicit query, infer intent from action/context.
  let task: string;
  switch (action) {
    case 'summarize':
      task =
        q ||
        (ctx.thread.length
          ? 'Summarize this thread concisely — the key points and any conclusion.'
          : ctx.quoted
            ? 'Summarize the quoted tweet in a crisp way.'
            : 'Summarize the tweet.');
      break;
    case 'translate':
      task = q
        ? `Translate the following text. Target language is given in the request. Request: "${q}".\nText to translate: "${ctx.text.replace(new RegExp(`@${BOT_HANDLE}\\b`, 'i'), '').trim()}"`
        : `Translate the tweet into English (or infer target). Tweet: "${ctx.text}"`;
      break;
    case 'analyze':
      task =
        q ||
        (ctx.quoted
          ? 'Analyze the quoted tweet — intent, tone, accuracy, strengths and weak points.'
          : ctx.imageUrl
            ? 'Analyze the image in detail — what it shows, any notable details, and your read on it.'
            : 'Analyze the tweet — intent, tone, and substance.');
      break;
    case 'code':
      task = q || 'Write clean, idiomatic code for the task implied by the tweet context. Brief explanation if needed.';
      break;
    case 'search':
      task = q || ctx.text.replace(new RegExp(`@${BOT_HANDLE}\\b`, 'i'), '').trim();
      break;
    case 'research':
      task = q || 'Research the topic implied by the tweet context.';
      break;
    case 'compare':
      task = q || 'Explain the topic in the tweet.';
      break;
    default:
      task = q || 'Respond helpfully to the tweet, using any provided context. If the tweet is a question, answer it. If it\'s a statement, engage with it genuinely.';
  }

  return `Context:\n${ctxBlock}${contextNote}\n\nTask: ${task}\n\nReply natively as a social media reply, IN YOUR PERSONA'S VOICE. Keep it short, punchy, useful. No markdown headings. Plain text only. Do not start with "Sure!" or "Great question!" — just answer.`;
}

async function runText(
  model: ModelId,
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<string> {
  const userPrompt = buildUserPrompt(parsed.action, ctx, parsed);
  const messages = [
    ...ctx.memory.slice(-6).map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.text,
    })),
    { role: 'user' as const, content: userPrompt },
  ];
  return completeAsModel(model, messages);
}

async function runSearch(
  model: ModelId,
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<{ text: string; sources: BotSource[] }> {
  const query = parsed.query || ctx.text.replace(new RegExp(`@${BOT_HANDLE}\\b`, 'i'), '').trim();
  const sources = await webSearch(query, 6);
  const sourcesBlock = sources
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.title} (${s.host})\n   ${s.snippet}`)
    .join('\n');
  const userPrompt =
    `Web search results for "${query}":\n${sourcesBlock}\n\n` +
    `Synthesize a concise, accurate answer for a social reply. Cite sources inline like (host). ` +
    `Keep it short and native to the timeline.`;
  const text = await completeAsModel(model, [
    { role: 'user', content: userPrompt },
  ]);
  return { text, sources };
}

/**
 * /price — fetch real-time crypto data for symbols in the query and let the
 * model synthesize a price + market read in its persona voice.
 */
async function runPrice(
  model: ModelId,
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<{ text: string; sources: BotSource[] }> {
  // Detect symbols from the query, then the tweet text.
  const fromQuery = detectCryptoSymbols(parsed.query);
  const fromTweet = detectCryptoSymbols(ctx.text);
  const symbols = Array.from(new Set([...fromQuery, ...fromTweet])).slice(0, 3);
  if (!symbols.length) {
    const text = await completeAsModel(model, [
      {
        role: 'user',
        content:
          'The user asked for a price but I could not detect which token. Reply in your persona asking them to specify a ticker (e.g. /price BTC).',
      },
    ]);
    return { text, sources: [] };
  }
  const { text: dataBlock, sources } = await fetchCryptoData(symbols);
  const userPrompt =
    `${dataBlock}\n\n` +
    `The user asked about the price of: ${symbols.join(', ')}.\n` +
    `Give a concise price + market read IN YOUR PERSONA'S VOICE. Cite the source (host) inline. ` +
    `Include the current price, 24h change if visible, and a one-line take. Don't fabricate numbers — use what's above.`;
  const text = await completeAsModel(model, [{ role: 'user', content: userPrompt }]);
  return { text, sources };
}

/**
 * /token — deep token analysis: fetch price data + do a web search for
 * tokenomics/risk, then synthesize a buy/sell read in the persona's voice.
 */
async function runToken(
  model: ModelId,
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<{ text: string; sources: BotSource[] }> {
  const fromQuery = detectCryptoSymbols(parsed.query);
  const fromTweet = detectCryptoSymbols(ctx.text);
  const symbols = Array.from(new Set([...fromQuery, ...fromTweet])).slice(0, 2);
  if (!symbols.length) {
    const text = await completeAsModel(model, [
      {
        role: 'user',
        content:
          'The user asked for token analysis but I could not detect which token. Reply in your persona asking them to specify a ticker (e.g. /token ARB).',
      },
    ]);
    return { text, sources: [] };
  }
  const sym = symbols[0];
  // Parallel: price data + tokenomics/risk search
  const [priceData, tokSearch] = await Promise.all([
    fetchCryptoData([sym]),
    webSearch(`${sym} tokenomics unlock schedule team vesting FDV market cap risk analysis`, 6),
  ]);
  const sources = [...priceData.sources, ...tokSearch].slice(0, 8);
  const tokBlock = tokSearch
    .slice(0, 5)
    .map((s, i) => `${i + 1}. ${s.title} (${s.host})\n   ${s.snippet}`)
    .join('\n');
  const userPrompt =
    `Token analysis for ${sym}.\n\n` +
    `REAL-TIME PRICE DATA:\n${priceData.text}\n\n` +
    `TOKENOMICS / RISK CONTEXT:\n${tokBlock}\n\n` +
    `Synthesize a deep token read IN YOUR PERSONA'S VOICE. Cover: price/action, tokenomics quality, ` +
    `key risks (unlocks, inflation, team vesting), and a buy/sell/neutral stance appropriate to your persona. ` +
    `Cite sources inline (host). Be honest about uncertainty. This will be split into a thread if long.`;
  const text = await completeAsModel(model, [{ role: 'user', content: userPrompt }], {
    temperature: model === 'deepseek' ? 0.3 : model === 'grok' ? 0.85 : 0.5,
  });
  return { text, sources };
}

async function runResearch(
  model: ModelId,
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<{ text: string; sources: BotSource[] }> {
  const query = parsed.query || 'the topic in the tweet context';
  // Run searches sequentially to respect rate limits.
  const main = await webSearch(query, 6);
  const sub = await webSearch(`${query} analysis explained`, 4);
  const sources = dedupeSources([...main, ...sub]).slice(0, 8);
  const sourcesBlock = sources
    .map((s, i) => `${i + 1}. ${s.title} (${s.host})\n   ${s.snippet}`)
    .join('\n');
  const userPrompt =
    `Deep research task on: "${query}".\n` +
    `Gathered sources:\n${sourcesBlock}\n\n` +
    `Produce a structured research brief: key findings, context, and a balanced take. ` +
    `It will be split into a thread. Cite sources inline as (host). Be substantive but plain text.`;
  const text = await completeAsModel(model, [
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3 });
  return { text, sources };
}

async function runCompare(
  ctx: CollectedContext,
  parsed: ParsedMention,
): Promise<{
  chunks: BotReplyChunk[];
  comparisons: { model: ModelId; text: string }[];
}> {
  const userPrompt = buildUserPrompt('compare', ctx, parsed);
  // Run models sequentially to respect provider rate limits (avoids 429s).
  const results: { model: ModelId; text: string }[] = [];
  for (const m of COMPARE_MODELS) {
    try {
      const text = await completeAsModel(m, [{ role: 'user', content: userPrompt }]);
      results.push({ model: m, text });
    } catch (e) {
      results.push({ model: m, text: `(error: ${e instanceof Error ? e.message : 'failed'})` });
    }
  }

  const comparisons = results.map((r) => ({ model: r.model, text: r.text }));

  // Synthesis with a 4th model (claude).
  const synthInput = results
    .map((r) => `${getModel(r.model)?.label}: ${shortenForCompare('', r.text, 400)}`)
    .join('\n');
  const synth = await completeAsModel('claude', [
    {
      role: 'user',
      content:
        `Three models answered this prompt: "${parsed.query || 'the tweet'}".\n\n${synthInput}\n\n` +
        `Write a tight synthesis: where they agree, where they differ, and the best takeaway. ` +
        `Plain text, native social reply.`,
    },
  ]);

  // Build chunks: synthesis first, then a compact per-model line each.
  const pieces: string[] = [`🧪 Compare — synthesis:\n${synth}`];
  for (const r of results) {
    pieces.push(`${getModel(r.model)?.emoji} ${getModel(r.model)?.label}: ${shortenForCompare('', r.text, 230)}`);
  }
  const merged = pieces.join('\n\n');
  const chunks = splitIntoChunks(merged);
  return { chunks, comparisons };
}

function dedupeSources(srcs: BotSource[]): BotSource[] {
  const seen = new Set<string>();
  const out: BotSource[] = [];
  for (const s of srcs) {
    const key = s.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Run the full bot pipeline for a mention tweet. Returns the result to publish.
 */
export async function runBot(tweetId: string): Promise<BotRunResult> {
  const tweet = await db.tweet.findUnique({
    where: { id: tweetId },
    include: { author: true },
  });
  if (!tweet) throw new Error('tweet not found');

  // Rate limit
  const rl = checkRateLimit(tweet.author.handle);
  if (!rl.allowed) {
    return {
      model: 'auto',
      requestedModel: null,
      action: null,
      chunks: [{ content: `⏳ ${rl.reason || 'Rate limited.'}`, index: 0, total: 1 }],
      sources: [],
      comparisons: [],
      routingNote: 'rate limited',
    };
  }

  const parsed = parseMention(tweet.content, !!tweet.imageUrl);
  if (!parsed) {
    return {
      model: 'auto',
      requestedModel: null,
      action: null,
      chunks: [{ content: 'Mention not detected.', index: 0, total: 1 }],
      sources: [],
      comparisons: [],
      routingNote: 'no mention',
    };
  }

  const ctx = await collectContext(tweetId);

  // Resolve model + action
  const { model, note } = await resolveModel(parsed, tweet.author.handle, ctx);
  const action = parsed.action;

  // /compare is special — multi-model.
  if (action === 'compare') {
    const { chunks, comparisons } = await runCompare(ctx, parsed);
    return {
      model: 'claude',
      requestedModel: parsed.model,
      action,
      chunks,
      sources: [],
      comparisons,
      routingNote: `compare across ${COMPARE_MODELS.join(', ')}`,
    };
  }

  // Vision path: image present and (model supports vision or /analyze or /auto picked vision-capable model)
  const modelInfo = getModel(model);
  const wantsVision =
    ctx.imageUrl &&
    (action === 'analyze' || parsed.model === 'auto' || (modelInfo?.capabilities.vision && !action));
  if (wantsVision && ctx.imageUrl) {
    // If chosen model lacks vision, fall back to a vision-capable one.
    const visionModel: ModelId = modelInfo?.capabilities.vision ? model : 'gemini';
    const prompt =
      parsed.query ||
      (action === 'analyze' ? 'Analyze this image in detail.' : 'Describe and analyze this image.');
    const text = await completeVisionAsModel(visionModel, prompt, ctx.imageUrl, renderContext(ctx));
    return {
      model: visionModel,
      requestedModel: parsed.model,
      action,
      chunks: splitIntoChunks(text),
      sources: [],
      comparisons: [],
      routingNote:
        visionModel !== model ? `vision fallback → ${visionModel}` : `vision via ${visionModel}`,
    };
  }

  // Action routing
  let text = '';
  let sources: BotSource[] = [];
  if (action === 'search') {
    const r = await runSearch(model, ctx, parsed);
    text = r.text;
    sources = r.sources;
  } else if (action === 'research') {
    const r = await runResearch(model, ctx, parsed);
    text = r.text;
    sources = r.sources;
  } else if (action === 'price') {
    const r = await runPrice(model, ctx, parsed);
    text = r.text;
    sources = r.sources;
  } else if (action === 'token') {
    const r = await runToken(model, ctx, parsed);
    text = r.text;
    sources = r.sources;
  } else {
    // General path: if the tweet mentions crypto symbols AND asks about price/buy/sell,
    // auto-augment with real-time price data so the model has current numbers.
    // BUT only if the referenced context (parent/quoted) is actually crypto-related —
    // don't pull crypto prices when the user is asking about a fish tweet.
    const cryptoSymbols = detectCryptoSymbols(`${parsed.query} ${ctx.text}`);
    const cryptoIntent = /\b(price|buy|sell|hold|long|short|trade|worth|dump|pump|moon|bag|entry|exit|position|allocate|portfolio)\b/i.test(
      `${parsed.query} ${ctx.text}`,
    );
    // Determine if the referenced context is genuinely crypto.
    const contextText = `${ctx.quoted?.text || ''} ${ctx.parent?.text || ''} ${ctx.text || ''}`.toLowerCase();
    const contextIsCrypto = /\b(crypto|bitcoin|btc|ethereum|eth|token|coin|defi|staking|yield|tokenomics|blockchain|solana|sol|airdrop|nft|wallet|dex|amm|liquidity|swap|governance)\b/i.test(contextText);
    if (cryptoSymbols.length > 0 && cryptoIntent && contextIsCrypto) {
      const { text: dataBlock, sources: priceSources } = await fetchCryptoData(cryptoSymbols.slice(0, 2));
      sources = priceSources;
      const augmentedParsed: ParsedMention = {
        ...parsed,
        query: `${parsed.query}\n\n[REAL-TIME MARKET DATA — use these numbers, cite (host)]:\n${dataBlock}`,
      };
      text = await runText(model, ctx, augmentedParsed);
    } else {
      text = await runText(model, ctx, parsed);
    }
  }

  // Append sources line for search/research/price/token if not already cited.
  let chunks = splitIntoChunks(text);
  if (sources.length && (action === 'research' || action === 'token')) {
    const srcChunk = formatSources(sources, 4);
    if (srcChunk) {
      chunks = [...chunks, ...splitIntoChunks(srcChunk)];
      chunks = chunks.map((c, i) => ({ content: c.content, index: i, total: chunks.length }));
    }
  } else if (sources.length && (action === 'search' || action === 'price')) {
    const srcChunk = formatSources(sources, 3);
    if (srcChunk) {
      chunks = [...chunks, ...splitIntoChunks(srcChunk)];
      chunks = chunks.map((c, i) => ({ content: c.content, index: i, total: chunks.length }));
    }
  }

  return {
    model,
    requestedModel: parsed.model,
    action,
    chunks,
    sources,
    comparisons: [],
    routingNote: note,
  };
}
