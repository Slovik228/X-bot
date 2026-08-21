'use client';

import { useState } from 'react';
import { Avatar } from './avatar';
import { ModelBadge } from './model-badge';
import type { Tweet } from '@/lib/x-client';
import { cn } from '@/lib/utils';
import {
  MessageCircle,
  Repeat2,
  Heart,
  BarChart3,
  Bookmark,
  Share,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export interface TypingState {
  model?: string;
  routingNote?: string;
  at?: string;
}

export function TweetCard({
  tweet,
  replies,
  repliesMap = {},
  typing,
  typingMap = {},
  depth = 0,
  isThreadContinuation = false,
  onReply,
  onQuote,
}: {
  tweet: Tweet;
  replies?: Tweet[];
  repliesMap?: Record<string, Tweet[]>;
  typing?: TypingState | null;
  typingMap?: Record<string, TypingState>;
  depth?: number;
  isThreadContinuation?: boolean;
  onReply?: (t: Tweet) => void;
  onQuote?: (t: Tweet) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const isBot = tweet.isBot;
  const childReplies = replies && replies.length ? replies : (repliesMap[tweet.id] || []);
  const childTyping = typing !== undefined ? typing : typingMap[tweet.id] || null;
  const showThreadLine = childReplies.length > 0 || childTyping;

  return (
    <div className={cn('relative', isThreadContinuation && 'border-l border-neutral-800 pl-4 ml-[20px]')}>
      <article className="flex gap-3 px-4 py-3 transition-colors hover:bg-neutral-900/40">
        <Avatar name={tweet.author.name} color={tweet.author.avatarColor} isBot={tweet.author.isBot} size={40} />
        <div className="min-w-0 flex-1">
          {/* header */}
          <div className="flex items-center gap-1 text-sm">
            <span className="font-bold text-neutral-50 hover:underline truncate">{tweet.author.name}</span>
            {tweet.author.isVerified && (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-500" fill="currentColor" />
            )}
            <span className="text-neutral-500 truncate">@{tweet.author.handle}</span>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-500 shrink-0">{timeAgo(tweet.createdAt)}</span>
            {isBot && <ModelBadge model={tweet.botModel} command={tweet.botCommand} className="ml-1" />}
            {isThreadContinuation && tweet.threadTotal > 1 && (
              <span className="ml-auto text-[11px] text-neutral-600">
                {tweet.threadIndex + 1}/{tweet.threadTotal}
              </span>
            )}
          </div>

          {/* content */}
          {tweet.content && (
            <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-neutral-100">
              {renderContent(tweet.content)}
            </div>
          )}

          {/* image */}
          {tweet.imageUrl && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-neutral-800">
              <img src={tweet.imageUrl} alt="attachment" className="max-h-96 w-full object-cover" />
            </div>
          )}

          {/* quoted tweet */}
          {tweet.quoted && <QuotedTweet tweet={tweet.quoted} />}

          {/* sources */}
          {tweet.sources && tweet.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tweet.sources.map((s, i) => (
                <a
                  key={i}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-800"
                  title={s.title}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.host}</span>
                </a>
              ))}
            </div>
          )}

          {/* actions */}
          <div className="mt-2 flex items-center justify-between text-neutral-500 max-w-md">
            <button
              onClick={() => onReply?.(tweet)}
              className="group flex items-center gap-1 text-xs hover:text-sky-400"
              title="Reply"
            >
              <MessageCircle className="h-4 w-4 group-hover:scale-110 transition-transform" />
              <span>{tweet.replyCount || ''}</span>
            </button>
            <button className="group flex items-center gap-1 text-xs hover:text-emerald-400" title="Repost">
              <Repeat2 className="h-4 w-4 group-hover:scale-110 transition-transform" />
            </button>
            <button
              onClick={() => setLiked((v) => !v)}
              className={cn('group flex items-center gap-1 text-xs', liked ? 'text-pink-500' : 'hover:text-pink-500')}
              title="Like"
            >
              <Heart className="h-4 w-4 transition-transform group-hover:scale-110" fill={liked ? 'currentColor' : 'none'} />
              <span>{liked ? '1' : ''}</span>
            </button>
            <button className="group flex items-center gap-1 text-xs hover:text-sky-400" title="Views">
              <BarChart3 className="h-4 w-4 group-hover:scale-110 transition-transform" />
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setSaved((v) => !v)}
                className={cn('hover:text-sky-400', saved && 'text-sky-400')}
                title="Bookmark"
              >
                <Bookmark className="h-4 w-4" fill={saved ? 'currentColor' : 'none'} />
              </button>
              {onQuote && (
                <button onClick={() => onQuote(tweet)} className="hover:text-sky-400" title="Quote">
                  <Share className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </article>

      {/* thread line + replies */}
      {showThreadLine && (
        <div className="relative">
          {childReplies.map((r) => (
            <TweetCard
              key={r.id}
              tweet={r}
              repliesMap={repliesMap}
              typingMap={typingMap}
              depth={depth + 1}
              isThreadContinuation
              onReply={onReply}
              onQuote={onQuote}
            />
          ))}
          {childTyping && <TypingCard state={childTyping} />}
        </div>
      )}
    </div>
  );
}

function TypingCard({ state }: { state: TypingState }) {
  return (
    <div className="flex items-center gap-3 border-l border-neutral-800 px-4 py-3 ml-[20px]">
      <Avatar name="AI X Bot" color="#6366f1" isBot size={32} />
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        <span className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-500" />
        </span>
        <span>AI X Bot is thinking</span>
        {state.model && <ModelBadge model={state.model} />}
        {state.routingNote && <span className="text-neutral-600">· {state.routingNote}</span>}
      </div>
    </div>
  );
}

function QuotedTweet({ tweet }: { tweet: Tweet }) {
  return (
    <div className="mt-2 rounded-2xl border border-neutral-800 p-3 transition-colors hover:bg-neutral-900/50">
      <div className="flex items-center gap-1 text-sm">
        <span className="font-bold text-neutral-200">{tweet.author.name}</span>
        {tweet.author.isVerified && <CheckCircle2 className="h-3 w-3 text-sky-500" fill="currentColor" />}
        <span className="text-neutral-500">@{tweet.author.handle}</span>
        <span className="text-neutral-600">·</span>
        <span className="text-neutral-500">{timeAgo(tweet.createdAt)}</span>
      </div>
      {tweet.content && <div className="mt-0.5 whitespace-pre-wrap text-sm text-neutral-200">{renderContent(tweet.content)}</div>}
      {tweet.imageUrl && (
        <div className="mt-2 overflow-hidden rounded-xl border border-neutral-800">
          <img src={tweet.imageUrl} alt="quoted" className="max-h-72 w-full object-cover" />
        </div>
      )}
    </div>
  );
}

// Render tweet content with @handles and links highlighted.
function renderContent(text: string) {
  const parts = text.split(/(@\w+|https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => {
    if (/^@\w+$/.test(p)) {
      return (
        <span key={i} className="text-sky-400 hover:underline">
          {p}
        </span>
      );
    }
    if (/^https?:\/\//.test(p)) {
      return (
        <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline break-all">
          {p}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
