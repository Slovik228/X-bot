'use client';

import { Avatar } from './avatar';
import { ModelBadge } from './model-badge';
import type { ModelInfo, CommandInfo } from '@/lib/x-client';
import { CheckCircle2, Zap, Eye, Code2, Search, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LeftSidebar({
  models,
  commands,
  onInsertCommand,
}: {
  models: ModelInfo[];
  commands: CommandInfo[];
  onInsertCommand: (cmd: string) => void;
}) {
  const modelCmds = commands.filter((c) => c.type === 'model');
  const actionCmds = commands.filter((c) => c.type === 'action');

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-neutral-800 lg:flex">
      {/* bot profile */}
      <div className="flex items-center gap-2 border-b border-neutral-800 p-4">
        <Avatar name="AI X Bot" color="#6366f1" isBot size={36} />
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate font-bold text-neutral-50">AI X Bot</span>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-500" fill="currentColor" />
          </div>
          <div className="truncate text-xs text-neutral-500">@aixbot</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* models */}
        <Section title="Models" hint="click to insert">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => onInsertCommand(m.id)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-900"
            >
              <span className="mt-0.5 text-base">{m.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1">
                  <span className="text-sm font-semibold text-neutral-100">{m.label}</span>
                  <span className="text-[10px] text-neutral-600">{m.provider}</span>
                </span>
                <span className="block truncate text-[11px] text-neutral-500">{m.description}</span>
                <span className="mt-0.5 flex gap-1">
                  {m.capabilities.vision && <Cap icon="eye" />}
                  {m.capabilities.code && <Cap icon="code" />}
                  {m.capabilities.reasoning && <Cap icon="brain" />}
                  {m.capabilities.search && <Cap icon="search" />}
                  <Cap icon="speed" label={m.capabilities.speed} />
                </span>
              </span>
            </button>
          ))}
        </Section>

        {/* actions */}
        <Section title="Actions">
          {actionCmds.map((c) => (
            <button
              key={c.id}
              onClick={() => onInsertCommand(c.id)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-900"
            >
              <span className="mt-0.5 text-sky-400">/</span>
              <span className="min-w-0 flex-1">
                <span className="text-sm font-semibold text-neutral-100">{c.label.slice(1)}</span>
                <span className="block text-[11px] text-neutral-500">{c.description}</span>
              </span>
            </button>
          ))}
        </Section>
      </div>

      <div className="border-t border-neutral-800 p-3 text-[10px] leading-relaxed text-neutral-600">
        Mention <span className="text-neutral-400">@aixbot</span> with a command + question. The bot
        replies in-thread. Powered by local models (simulated providers).
      </div>
    </aside>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-800/60 p-2">
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Cap({ icon, label }: { icon: string; label?: string }) {
  const cls = 'h-3 w-3 text-neutral-600';
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-neutral-900 px-1 py-0.5 text-[9px] text-neutral-500" title={icon}>
      {icon === 'eye' && <Eye className={cls} />}
      {icon === 'code' && <Code2 className={cls} />}
      {icon === 'brain' && <Brain className={cls} />}
      {icon === 'search' && <Search className={cls} />}
      {icon === 'speed' && <Zap className={cls} />}
      {label && <span>{label}</span>}
    </span>
  );
}
