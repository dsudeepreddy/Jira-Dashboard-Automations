'use client';

import type { LucideIcon } from 'lucide-react';
import { GlassCard } from './GlassCard';

type MetricCardProps = {
  title: string;
  value: number;
  suffix?: string;
  icon: LucideIcon;
  tone: 'cyan' | 'mint' | 'violet' | 'amber';
  decimals?: number;
  delay?: number;
};

const tones = {
  cyan: { icon: 'from-cyan-400/25 to-blue-500/10 text-cyan-500', glow: 'bg-cyan-400' },
  mint: { icon: 'from-emerald-400/25 to-teal-500/10 text-emerald-500', glow: 'bg-emerald-400' },
  violet: { icon: 'from-violet-400/25 to-fuchsia-500/10 text-violet-500', glow: 'bg-violet-400' },
  amber: { icon: 'from-amber-400/25 to-orange-500/10 text-amber-500', glow: 'bg-amber-400' },
};

export function MetricCard({ title, value, suffix, icon: Icon, tone, decimals = 0 }: MetricCardProps) {
  const palette = tones[tone];
  return (
    <GlassCard>
      <article className="relative p-5">
        <div className={`absolute inset-x-8 top-0 h-px ${palette.glow} opacity-70`} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{title}</p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="numeric text-[1.85rem] font-medium leading-none tracking-tight text-slate-950 dark:text-white">
                {value.toFixed(decimals)}
              </span>
              {suffix ? <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{suffix}</span> : null}
            </div>
          </div>
          <div className={`rounded-2xl bg-gradient-to-br p-3 ${palette.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </article>
    </GlassCard>
  );
}
