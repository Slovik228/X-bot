'use client';

import { useRef, useState } from 'react';
import { Avatar } from './avatar';
import { api, type Tweet } from '@/lib/x-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { insertCommand, ensureMention, MAX_COMPOSE, BOT_MENTION } from '@/lib/compose-utils';
import { ImagePlus, X, Sparkles, CornerUpLeft, Quote } from 'lucide-react';

const QUICK_MODELS = ['claude', 'gpt', 'gemini', 'grok', 'deepseek', 'auto'];
const QUICK_ACTIONS = ['summarize', 'search', 'research', 'compare', 'analyze', 'code', 'translate'];

export interface Account {
  handle: string;
  name: string;
  avatarColor: string;
  isBot: boolean;
}

export function ComposeBox({
  me,
  accounts,
  text,
  onTextChange,
  imageUrl,
  onImageUrlChange,
  replyTo,
  quoteTo,
  onMeChange,
  onCancelReply,
  onCancelQuote,
  onPosted,
}: {
  me: string;
  accounts: Account[];
  text: string;
  onTextChange: (t: string) => void;
  imageUrl: string | null;
  onImageUrlChange: (url: string | null) => void;
  replyTo: Tweet | null;
  quoteTo: Tweet | null;
  onMeChange: (h: string) => void;
  onCancelReply: () => void;
  onCancelQuote: () => void;
  onPosted: (tweet: Tweet, mentionsBot: boolean) => void;
}) {
  const [ui, setUi] = useState<{ busy: boolean; uploading: boolean; error: string | null }>({
    busy: false,
    uploading: false,
    error: null,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const meAccount = accounts.find((a) => a.handle === me) || accounts[0];

  const remaining = MAX_COMPOSE - text.length;
  const over = remaining < 0;

  function doInsert(cmd: string) {
    onTextChange(insertCommand(text, cmd));
    requestAnimationFrame(() => {
      const ta = taRef.current;
      ta?.focus();
      const end = ta?.value.length ?? 0;
      ta?.setSelectionRange(end, end);
    });
  }

  async function handleFile(file: File) {
    setUi((s) => ({ ...s, uploading: true, error: null }));
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        try {
          const url = await api.upload(dataUrl);
          onImageUrlChange(url);
        } catch {
          setUi((s) => ({ ...s, error: 'Upload failed' }));
        } finally {
          setUi((s) => ({ ...s, uploading: false }));
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setUi((s) => ({ ...s, error: 'Upload failed', uploading: false }));
    }
  }

  async function post() {
    if (!text.trim() || over) return;
    setUi((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await api.postTweet({
        handle: me,
        content: text.trim(),
        imageUrl,
        parentId: replyTo?.id || null,
        quotedId: quoteTo?.id || null,
      });
      onPosted(res.tweet, res.mentionsBot);
      onTextChange('');
      onImageUrlChange(null);
    } catch (e) {
      setUi((s) => ({ ...s, error: e instanceof Error ? e.message : 'post failed' }));
    } finally {
      setUi((s) => ({ ...s, busy: false }));
    }
  }

  return (
    <div className="border-b border-neutral-800 p-3">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <span className="truncate">
            Replying to <b className="text-neutral-200">@{replyTo.author.handle}</b>: {replyTo.content.slice(0, 60)}
          </span>
          <button onClick={onCancelReply} className="ml-auto shrink-0 text-neutral-500 hover:text-neutral-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {quoteTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          <Quote className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">
            Quoting <b className="text-neutral-200">@{quoteTo.author.handle}</b>: {quoteTo.content.slice(0, 60)}
          </span>
          <button onClick={onCancelQuote} className="ml-auto shrink-0 text-neutral-500 hover:text-neutral-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <Avatar name={meAccount?.name || 'You'} color={meAccount?.avatarColor || '#10b981'} isBot={meAccount?.isBot} size={40} />
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">Posting as</span>
            <select
              value={me}
              onChange={(e) => onMeChange(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
            >
              {accounts.map((a) => (
                <option key={a.handle} value={a.handle}>
                  @{a.handle} {a.isBot ? '(bot)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => onTextChange(ensureMention(text.trimStart()))}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
            >
              <Sparkles className="h-3 w-3" /> {BOT_MENTION}
            </button>
          </div>

          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={`Mention ${BOT_MENTION} to ask the bot...\ne.g. ${BOT_MENTION} /claude what's wrong with this tokenomics?`}
            className="min-h-[88px] resize-none border-0 bg-transparent p-0 text-[15px] text-neutral-100 placeholder:text-neutral-600 focus-visible:ring-0"
          />

          {imageUrl && (
            <div className="relative mt-2 inline-block">
              <img src={imageUrl} alt="preview" className="max-h-48 rounded-xl border border-neutral-800" />
              <button
                onClick={() => onImageUrlChange(null)}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white hover:bg-black"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {QUICK_MODELS.map((m) => (
              <button
                key={m}
                onClick={() => doInsert(m)}
                className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
              >
                /{m}
              </button>
            ))}
            <span className="mx-1 self-center text-neutral-700">|</span>
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a}
                onClick={() => doInsert(a)}
                className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800"
              >
                /{a}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2 border-t border-neutral-800/60 pt-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={ui.uploading}
              className="rounded-full p-1.5 text-sky-400 hover:bg-sky-500/10 disabled:opacity-50"
              title="Attach image (vision)"
            >
              <ImagePlus className="h-4.5 w-4.5" />
            </button>
            {ui.uploading && <span className="text-[11px] text-neutral-500">uploading…</span>}
            {ui.error && <span className="text-[11px] text-red-400">{ui.error}</span>}
            <div className="ml-auto flex items-center gap-3">
              <span className={cn('text-xs tabular-nums', over ? 'text-red-400' : remaining < 30 ? 'text-amber-400' : 'text-neutral-500')}>
                {remaining}
              </span>
              <Button
                onClick={post}
                disabled={!text.trim() || over || ui.busy}
                size="sm"
                className="rounded-full bg-neutral-50 px-4 font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                {ui.busy ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
