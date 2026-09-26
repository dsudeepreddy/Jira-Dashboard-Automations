'use client';

import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-white/15 bg-slate-950/80 px-3 py-2.5 text-xs text-white shadow-2xl backdrop-blur-xl">
      {label ? <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">{label}</p> : null}
      {payload.map((item) => (
        <p key={item.name} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color, boxShadow: `0 0 10px ${item.color}` }} />
          <span className="text-slate-300">{item.name}</span>
          <strong className="ml-auto tabular-nums">{item.value}</strong>
        </p>
      ))}
    </div>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  hint,
  action,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="section-title">{title}</h2>
        {hint ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ChartPanel({
  children,
  className,
  delay: _delay,
  ...header
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  eyebrow: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <GlassCard className={className}>
      <div className="flex h-full flex-col p-5">
        <PanelHeader {...header} />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </GlassCard>
  );
}
