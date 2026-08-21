'use client';

import { cn } from '@/lib/utils';

const MODEL_META: Record<string, { label: string; color: string; emoji: string }> = {
  claude: { label: 'Claude', color: '#d97757', emoji: '🧠' },
  gpt: { label: 'GPT', color: '#10a37f', emoji: '⚡' },
  gemini: { label: 'Gemini', color: '#4285f4', emoji: '✨' },
  grok: { label: 'Grok', color: '#1d9bf0', emoji: '🫡' },
  deepseek: { label: 'DeepSeek', color: '#7c3aed', emoji: '🔮' },
  auto: { label: 'Auto', color: '#6366f1', emoji: '🎯' },
};

export function ModelBadge({
  model,
  command,
  className,
  size = 'sm',
}: {
  model: string | null;
  command?: string | null;
  className?: string;
  size?: 'sm' | 'md';
}) {
  if (!model) return null;
  const meta = MODEL_META[model] || { label: model, color: '#6b7280', emoji: '🤖' };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className,
      )}
      style={{
        color: meta.color,
        borderColor: `${meta.color}55`,
        backgroundColor: `${meta.color}1a`,
      }}
      title={`Answered by ${meta.label}`}
    >
      <span>{meta.emoji}</span>
      <span>{meta.label}</span>
      {command ? <span className="opacity-60">· /{command}</span> : null}
    </span>
  );
}

export function modelMeta(model: string) {
  return MODEL_META[model] || { label: model, color: '#6b7280', emoji: '🤖' };
}
