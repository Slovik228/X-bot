'use client';

import { cn } from '@/lib/utils';

export function Avatar({
  name,
  color,
  isBot,
  size = 40,
  className,
}: {
  name: string;
  color: string;
  isBot?: boolean;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-inner',
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${shade(color, -25)})`,
        fontSize: size * 0.38,
      }}
      title={name}
    >
      {isBot ? '🤖' : initials || '?'}
    </div>
  );
}

// lighten/darken a hex color by percent (-100..100)
function shade(hex: string, percent: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  r = Math.max(0, Math.min(255, Math.round(r + (r * percent) / 100)));
  g = Math.max(0, Math.min(255, Math.round(g + (g * percent) / 100)));
  b = Math.max(0, Math.min(255, Math.round(b + (b * percent) / 100)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
