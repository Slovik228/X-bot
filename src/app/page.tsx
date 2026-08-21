'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ComposeBox, type Account } from '@/components/x/compose-box';
import { TweetCard, type TypingState } from '@/components/x/tweet-card';
import { LeftSidebar } from '@/components/x/left-sidebar';
import { RightPanel } from '@/components/x/right-panel';
import { Avatar } from '@/components/x/avatar';
import {
  api,
  getSocket,
  type Tweet,
  type ModelInfo,
  type CommandInfo,
  type RateLimits,
} from '@/lib/x-client';
import { insertCommand } from '@/lib/compose-utils';
import { toast } from 'sonner';
import { Bot, RefreshCw, Wifi, WifiOff, Twitter, Radio } from 'lucide-react';

type TwitterStatus = {
  configured: boolean;
  botHandle: string | null;
  postingEnabled: boolean;
  hasBearer: boolean;
  hasUserContext: boolean;
  listenerRunning: boolean;
  listener: { botHandle: string | null; ingested: number; skipped: number; errors: number; lastPollAt: number | null; uptime: number } | null;
} | null;

export default function Page() {
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [repliesMap, setRepliesMap] = useState<Record<string, Tweet[]>>({});
  const [typingMap, setTypingMap] = useState<Record<string, TypingState>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [me, setMe] = useState('you');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [rateLimits, setRateLimits] = useState<RateLimits | null>(null);
  const [defaultModel, setDefaultModel] = useState('auto');
  const [socketConnected, setSocketConnected] = useState(false);
  const [replyTo, setReplyTo] = useState<Tweet | null>(null);
  const [quoteTo, setQuoteTo] = useState<Tweet | null>(null);
  const [composeText, setComposeText] = useState('');
  const [composeImage, setComposeImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [twitter, setTwitter] = useState<TwitterStatus>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- init ----
  useEffect(() => {
    (async () => {
      try {
        const seedRes = await api.seed();
        const accs: Account[] = (seedRes.users || []).filter((u: Account) => !u.isBot);
        setAccounts(accs);
        if (accs.length && !accs.find((a) => a.handle === me)) setMe(accs[0].handle);

        const [tl, mods, cmds] = await Promise.all([api.timeline(), api.models(), api.commands()]);
        setTweets(tl);
        setModels(mods);
        setCommands(cmds.commands);
        setRateLimits(cmds.rateLimits);

        // load replies for top-level tweets that already have them
        for (const t of tl) {
          if (t.replyCount > 0) {
            api.tweet(t.id).then((d) => {
              setRepliesMap((prev) => ({ ...prev, [t.id]: d.replies }));
            });
          }
        }
      } catch (e) {
        console.error(e);
        toast.error('Failed to load timeline');
      } finally {
        setLoading(false);
      }
    })();

    // twitter status
    api.twitterStatus().then(setTwitter).catch(() => {});
  }, []);

  // ---- socket ----
  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onTyping = (p: { tweetId: string; routingNote?: string; model?: string }) => {
      setTypingMap((prev) => ({ ...prev, [p.tweetId]: { routingNote: p.routingNote, model: p.model } }));
    };
    const onReply = (p: { parentTweetId: string; replyTweet: Tweet; routingNote?: string; model?: string }) => {
      setRepliesMap((prev) => {
        const existing = prev[p.parentTweetId] || [];
        if (existing.find((t) => t.id === p.replyTweet.id)) return prev;
        return { ...prev, [p.parentTweetId]: [...existing, p.replyTweet] };
      });
      // keep typing live (in case of multi-chunk) but update model note
      setTypingMap((prev) =>
        p.routingNote ? { ...prev, [p.parentTweetId]: { routingNote: p.routingNote, model: p.model } } : prev,
      );
    };
    const onDone = (p: { tweetId: string }) => {
      setTypingMap((prev) => {
        const next = { ...prev };
        delete next[p.tweetId];
        return next;
      });
      // refresh rate limits
      api.commands().then((d) => setRateLimits(d.rateLimits)).catch(() => {});
    };
    const onError = (p: { tweetId: string; error: string }) => {
      toast.error(`Bot error: ${p.error}`);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('bot:typing', onTyping);
    socket.on('bot:reply', onReply);
    socket.on('bot:done', onDone);
    socket.on('bot:error', onError);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('bot:typing', onTyping);
      socket.off('bot:reply', onReply);
      socket.off('bot:done', onDone);
      socket.off('bot:error', onError);
    };
  }, []);

  // ---- preferences per account ----
  useEffect(() => {
    if (!me) return;
    api.preferences(me).then((p) => setDefaultModel(p.defaultModel || 'auto')).catch(() => {});
  }, [me]);

  // ---- handlers ----
  const triggerBot = useCallback((tweet: Tweet) => {
    // immediate typing feedback via relay
    const socket = getSocket();
    socket.emit('mention:trigger', { tweetId: tweet.id, authorHandle: tweet.author.handle, snippet: tweet.content.slice(0, 80) });
    setTypingMap((prev) => ({ ...prev, [tweet.id]: { routingNote: 'processing…' } }));
    // fire-and-forget the pipeline; results come back over socket
    api.processBot(tweet.id).catch((e) => {
      toast.error(`Bot failed: ${e instanceof Error ? e.message : 'unknown'}`);
    });
  }, []);

  const handlePosted = useCallback(
    (tweet: Tweet, mentionsBot: boolean) => {
      if (tweet.parentId) {
        // it's a reply
        setRepliesMap((prev) => ({
          ...prev,
          [tweet.parentId]: [...(prev[tweet.parentId] || []), tweet],
        }));
      } else {
        setTweets((prev) => [tweet, ...prev]);
      }
      setReplyTo(null);
      setQuoteTo(null);
      if (mentionsBot) triggerBot(tweet);
    },
    [triggerBot],
  );

  const handleInsertCommand = useCallback(
    (cmd: string) => {
      setComposeText((t) => insertCommand(t, cmd));
    },
    [],
  );

  const handleSetDefaultModel = useCallback(
    (m: string) => {
      setDefaultModel(m);
      api.setPreference(me, m).then(() => toast.success(`Default model set to ${m}`)).catch(() => toast.error('Could not save preference'));
    },
    [me],
  );

  const handleReply = useCallback((t: Tweet) => {
    setReplyTo(t);
    setQuoteTo(null);
    const botHandle = process.env.NEXT_PUBLIC_BOT_HANDLE || 'aixbot';
    setComposeText((cur) => (new RegExp(`@${botHandle}\\b`, 'i').test(cur) ? cur : `@${botHandle} `));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleQuote = useCallback((t: Tweet) => {
    setQuoteTo(t);
    setReplyTo(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      const tl = await api.timeline();
      setTweets(tl);
      setRepliesMap({});
      for (const t of tl) {
        if (t.replyCount > 0) {
          api.tweet(t.id).then((d) => setRepliesMap((prev) => ({ ...prev, [t.id]: d.replies })));
        }
      }
    } catch {
      toast.error('Refresh failed');
    }
  }, []);

  // periodic rate-limit refresh
  useEffect(() => {
    refreshTimer.current = setInterval(() => {
      api.commands().then((d) => setRateLimits(d.rateLimits)).catch(() => {});
      api.twitterStatus().then(setTwitter).catch(() => {});
    }, 15000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  const meAccount = accounts.find((a) => a.handle === me);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold">AI X Bot</div>
              <div className="hidden text-[10px] text-neutral-500 sm:block">multi-model · mention-driven</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* mobile account picker */}
            <select
              value={me}
              onChange={(e) => setMe(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 lg:hidden"
            >
              {accounts.map((a) => (
                <option key={a.handle} value={a.handle}>
                  @{a.handle}
                </option>
              ))}
            </select>
            <span className="hidden items-center gap-1 rounded-full border border-neutral-800 px-2 py-1 text-[11px] sm:flex">
              {socketConnected ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-red-400" />}
              {socketConnected ? 'Live' : 'Offline'}
            </span>
            <TwitterBadge status={twitter} />
            <button
              onClick={handleRefresh}
              className="rounded-md border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* main 3-col */}
      <div className="mx-auto flex w-full max-w-7xl flex-1">
        <LeftSidebar models={models} commands={commands} onInsertCommand={handleInsertCommand} />

        <main className="min-w-0 flex-1 border-x border-neutral-800">
          <ComposeBox
            me={me}
            accounts={accounts}
            models={models}
            text={composeText}
            onTextChange={setComposeText}
            imageUrl={composeImage}
            onImageUrlChange={setComposeImage}
            replyTo={replyTo}
            quoteTo={quoteTo}
            onMeChange={setMe}
            onCancelReply={() => setReplyTo(null)}
            onCancelQuote={() => setQuoteTo(null)}
            onPosted={handlePosted}
          />

          {/* timeline */}
          <div className="divide-y divide-neutral-900">
            {loading ? (
              <div className="space-y-3 p-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-neutral-800" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-800" />
                      <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-800" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-800" />
                    </div>
                  </div>
                ))}
              </div>
            ) : tweets.length === 0 ? (
              <EmptyState onInsert={handleInsertCommand} />
            ) : (
              tweets.map((t) => (
                <TweetCard
                  key={t.id}
                  tweet={t}
                  repliesMap={repliesMap}
                  typingMap={typingMap}
                  onReply={handleReply}
                  onQuote={handleQuote}
                />
              ))
            )}
          </div>
        </main>

        <RightPanel
          me={me}
          accounts={accounts}
          models={models}
          defaultModel={defaultModel}
          onSetDefaultModel={handleSetDefaultModel}
          rateLimits={rateLimits}
          socketConnected={socketConnected}
          onInsertCommand={handleInsertCommand}
          twitter={twitter}
        />
      </div>

      {/* sticky footer */}
      <footer className="mt-auto border-t border-neutral-800 bg-neutral-950">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-3 text-[11px] text-neutral-600 sm:flex-row">
          <div className="flex items-center gap-2">
            <Avatar name="AI X Bot" color="#6366f1" isBot size={20} />
            <span>
              <b className="text-neutral-400">AI X Bot</b> — X-native gateway to multiple AI models. Mention{' '}
              <code className="text-neutral-400">@aixbot</code> with a command.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span>
              Models: <b className="text-neutral-400">{models.length}</b>
            </span>
            <span>
              Commands: <b className="text-neutral-400">{commands.length}</b>
            </span>
            <span className="text-neutral-700">· local-model demo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({ onInsert }: { onInsert: (cmd: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 p-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500">
        <Bot className="h-9 w-9 text-white" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-neutral-100">No tweets yet</h2>
        <p className="mt-1 max-w-sm text-sm text-neutral-500">
          Compose a tweet mentioning <code className="text-sky-400">@aixbot</code> to ask the bot. Try a command:
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {['claude', 'grok', 'compare', 'research', 'auto'].map((c) => (
          <button
            key={c}
            onClick={() => onInsert(c)}
            className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            /{c}
          </button>
        ))}
      </div>
    </div>
  );
}

function TwitterBadge({ status }: { status: TwitterStatus }) {
  if (!status || !status.configured) {
    return (
      <span
        className="hidden items-center gap-1 rounded-full border border-neutral-800 px-2 py-1 text-[11px] text-neutral-500 md:flex"
        title="Twitter integration not configured"
      >
        <Twitter className="h-3 w-3" /> Twitter off
      </span>
    );
  }
  const color = status.postingEnabled ? 'text-emerald-400' : 'text-amber-400';
  const label = status.postingEnabled
    ? `Twitter · @${status.botHandle} · read+write`
    : `Twitter · @${status.botHandle || '—'} · read-only`;
  const listenerOk = status.listenerRunning;
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-neutral-800 px-2 py-1 text-[11px] md:flex"
      title={
        status.postingEnabled
          ? 'Listening for real mentions AND posting replies to Twitter'
          : 'Listening for real mentions (posting disabled — add access tokens to .env)'
      }
    >
      <Twitter className={`h-3 w-3 ${color}`} />
      <span className={color}>{label}</span>
      <span className="flex items-center gap-0.5" title={listenerOk ? 'Listener running' : 'Listener offline'}>
        <Radio className={`h-3 w-3 ${listenerOk ? 'text-emerald-400' : 'text-red-400'} ${listenerOk ? 'animate-pulse' : ''}`} />
        {status.listener?.ingested ?? 0}
      </span>
    </span>
  );
}
