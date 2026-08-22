'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartPanel, ChartTooltip } from './ChartShell';

type ThroughputDatum = { period: string; created: number; resolved: number };

export function ThroughputTrendChart({ data }: { data: ThroughputDatum[] }) {
  return (
    <ChartPanel eyebrow="Delivery rhythm" title="Throughput" hint="Created vs completed work by ISO week." delay={0.24}>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={6} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="created-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
              <linearGradient id="resolved-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#c4b5fd" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={32} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar dataKey="created" name="Created" fill="url(#created-bar)" radius={[8, 8, 0, 0]} animationDuration={1200} />
            <Bar dataKey="resolved" name="Resolved" fill="url(#resolved-bar)" radius={[8, 8, 0, 0]} animationDuration={1200} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}
