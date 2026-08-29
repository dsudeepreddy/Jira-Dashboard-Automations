'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FieldSlice } from '@/shared/dashboardContract';
import { ChartPanel, ChartTooltip } from './ChartShell';

export function FieldBarChart({
  data = [],
  eyebrow,
  title,
  hint,
  emptyLabel,
}: {
  data: FieldSlice[];
  eyebrow: string;
  title: string;
  hint?: string;
  emptyLabel: string;
}) {
  return (
    <ChartPanel eyebrow={eyebrow} title={title} hint={hint}>
      <div className="h-72">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="count" name="Issues" radius={[0, 8, 8, 0]} animationDuration={900}>
                {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">{emptyLabel}</div>
        )}
      </div>
    </ChartPanel>
  );
}
