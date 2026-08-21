'use client';

import { useState } from 'react';
import { Avatar } from './avatar';
import type { Account } from './compose-box';
import type { ModelInfo, RateLimits } from '@/lib/x-client';
import { BOT_MENTION } from '@/lib/compose-utils';
import { cn } from '@/lib/utils';
import { Wifi, WifiOff, Activity, Gauge, Twitter, Link2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

export function RightPanel({
  me,
  accounts,
  models,
  defaultModel,
  onSetDefaultModel,
  rateLimits,
  socketConnected,
  onInsertCommand,
  twitter,
}: {
  me: string;
  accounts: Account[];
  models: ModelInfo[];
  defaultModel: string;
  onSetDefaultModel: (m: string) => void;
  rateLimits: RateLimits | null;
  socketConnected: boolean;
  onInsertCommand: (cmd: string) => void;
  twitter: {
    configured: boolean;
    botHandle: string | null;
    postingEnabled: boolean;
    listenerRunning: boolean;
    listener: { ingested: number } | null;
  } | null;
}) {
  const meAccount = accounts.find((a) => a.handle === me);
  const globalPct = rateLimits ? (rateLimits.globalUsedThisMinute / rateLimits.globalPerMin) * 100 : 0;
  const dailyPct = rateLimits ? (rateLimits.dailyUsed / rateLimits.dailyCap) * 100 : 0;

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-neutral-800 p-3 xl:flex">
      {/* status */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-center gap-2 text-sm">
          {socketConnected ? (
            <Wifi className="h-4 w-4 text-emerald-400" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-400" />
          )}
          <span className="font-semibold text-neutral-100">{socketConnected ? 'Live' : 'Reconnecting…'}</span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">
          Real-time mention listener active. Bot replies are pushed to all clients.
        </p>
      </div>

      <TwitterCard twitter={twitter} />

      {/* me card */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-center gap-2">
          <Avatar name={meAccount?.name || 'You'} color={meAccount?.avatarColor || '#10b981'} isBot={meAccount?.isBot} size={32} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-neutral-100">{meAccount?.name || 'You'}</div>
            <div className="truncate text-xs text-neutral-500">@{me}</div>
          </div>
        </div>
        <label className="mt-3 block text-[11px] text-neutral-400">Default model preference</label>
        <select
          value={defaultModel}
          onChange={(e) => onSetDefaultModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.emoji} {m.label} — {m.provider}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[10px] text-neutral-600">
          Used when you mention the bot without a <code className="text-neutral-400">/model</code> command.
        </p>
      </div>

      {/* rate limits */}
      {rateLimits && (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <Gauge className="h-4 w-4 text-amber-400" /> Rate limits
          </div>
          <LimitBar
            label="Global / min"
            used={rateLimits.globalUsedThisMinute}
            cap={rateLimits.globalPerMin}
            pct={globalPct}
          />
          <LimitBar label="Daily API cap" used={rateLimits.dailyUsed} cap={rateLimits.dailyCap} pct={dailyPct} />
          <div className="mt-2 flex items-center gap-1 text-[10px] text-neutral-500">
            <Activity className="h-3 w-3" />
            Per-user: {rateLimits.perUserPerMin}/min · cooldown enforced
          </div>
        </div>
      )}

      {/* quick examples */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">Try these</h3>
        <div className="space-y-1">
          {[
          `${BOT_MENTION} /claude explain stablecoins`,
            `${BOT_MENTION} /grok what happened in crypto today?`,
            `${BOT_MENTION} /compare why is BTC dropping?`,
            `${BOT_MENTION} /research AI agent market`,
            `${BOT_MENTION} /search ETH gas fees now`,
            `${BOT_MENTION} /code debounce in ts`,
          ].map((ex) => (
            <button
              key={ex}
              onClick={() => onInsertCommand(ex.replace(/^@\S+ \//, '').split(' ')[0])}
              className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              title={ex}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto rounded-2xl border border-neutral-800/60 p-3 text-[10px] text-neutral-600">
        <p>
          <b className="text-neutral-400">Tip:</b> reply to a bot answer to continue the conversation —
          the bot reads the whole thread as memory.
        </p>
      </div>
    </aside>
  );
}

function LimitBar({ label, used, cap, pct }: { label: string; used: number; cap: number; pct: number }) {
  const danger = pct > 80;
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex items-center justify-between text-[11px]">
        <span className="text-neutral-400">{label}</span>
        <span className="tabular-nums text-neutral-500">
          {used}/{cap}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={cn('h-full rounded-full transition-all', danger ? 'bg-red-500' : 'bg-amber-400')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function TwitterCard({ twitter }: { twitter: RightPanelProps['twitter'] }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  if (!twitter || !twitter.configured) {
    return (
      <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
        <div className="flex items-center gap-2 text-sm">
          <Twitter className="h-4 w-4 text-neutral-600" />
          <span className="font-semibold text-neutral-300">Twitter</span>
          <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-500">off</span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-600">
          Add API keys to <code className="text-neutral-500">.env</code> to enable real-X integration.
        </p>
      </div>
    );
  }

  const posting = twitter.postingEnabled;
  const ingested = twitter.listener?.ingested ?? 0;

  async function runManual() {
    if (!url.trim() || !text.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { api } = await import('@/lib/x-client');
      const r = await api.twitterManual({ tweetUrlOrId: url.trim(), text: text.trim() });
      const posted = r.postedToTwitter?.filter((p) => p.twitterId).length || 0;
      setResult({
        ok: true,
        msg: r.postingEnabled
          ? `✓ Bot replied${posted > 0 ? ` · ${posted} tweet(s) posted to X` : ' · (posting attempted)'}`
          : `✓ Processed locally (posting disabled — add access tokens to .env)`,
      });
      setUrl('');
      setText('');
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
      <div className="flex items-center gap-2 text-sm">
        <Twitter className={cn('h-4 w-4', posting ? 'text-emerald-400' : 'text-amber-400')} />
        <span className="font-semibold text-neutral-100">Twitter</span>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px]',
            posting ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400',
          )}
        >
          {posting ? 'read+write' : 'read-only'}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
        <span>bot: @{twitter.botHandle || '—'}</span>
        <span className="flex items-center gap-1">
          <span className={cn('h-1.5 w-1.5 rounded-full', twitter.listenerRunning ? 'animate-pulse bg-emerald-400' : 'bg-red-400')} />
          listener {twitter.listenerRunning ? 'on' : 'off'} · {ingested} ingested
        </span>
      </div>

      {/* Free-tier notice */}
      {!posting && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-[10px] text-amber-300">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Free tier: auto-listening needs Basic ($100/mo). Use the manual trigger below, and add{' '}
            <code>ACCESS_TOKEN</code> + <code>ACCESS_TOKEN_SECRET</code> to <code>.env</code> to post replies to X.
          </span>
        </div>
      )}

      {/* manual trigger */}
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-400">
          <Link2 className="h-3 w-3" /> Manual trigger (paste a real tweet)
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://x.com/user/status/123…"
          className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-sky-500 focus:outline-none"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="@yourbot /claude what is BTC price?"
          rows={2}
          className="w-full resize-none rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] text-neutral-100 placeholder:text-neutral-600 focus:border-sky-500 focus:outline-none"
        />
        <button
          onClick={runManual}
          disabled={!url.trim() || !text.trim() || busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-500 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-400 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Twitter className="h-3 w-3" />}
          {busy ? 'Processing…' : 'Run bot + reply'}
        </button>
        {result && (
          <div
            className={cn(
              'flex items-start gap-1.5 rounded-md p-2 text-[10px]',
              result.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300',
            )}
          >
            {result.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
            <span>{result.msg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

type RightPanelProps = Parameters<typeof RightPanel>[0];
