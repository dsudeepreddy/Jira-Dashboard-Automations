'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartPanel, ChartTooltip } from './ChartShell';

type StatusDatum = { name: string; value: number; color: string };

export function StatusDistributionChart({
  data,
  eyebrow = 'Portfolio health',
  title = 'Status mix',
}: {
  data: StatusDatum[];
  eyebrow?: string;
  title?: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <ChartPanel eyebrow={eyebrow} title={title} delay={0.18} action={<span className="status-chip">{total} issues</span>}>
      <div className="relative h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {data.map((entry, index) => (
                <linearGradient key={entry.name} id={`status-${index}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={entry.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={entry.color} stopOpacity={0.35} />
                </linearGradient>
              ))}
            </defs>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={74} outerRadius={104} paddingAngle={5} stroke="none" animationDuration={900}>
              {data.map((entry, index) => <Cell key={entry.name} fill={`url(#status-${index})`} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="numeric text-4xl font-medium text-slate-950 dark:text-white">{total}</span>
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">tracked</span>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-4 dark:border-white/10">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color, boxShadow: `0 0 10px ${entry.color}` }} />
            <span className="truncate">{entry.name}</span>
            <strong className="ml-auto tabular-nums text-slate-900 dark:text-white">{entry.value}</strong>
          </div>
        ))}
      </div>
    </ChartPanel>
  );
}
