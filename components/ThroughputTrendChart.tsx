'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartPanel, ChartTooltip } from './ChartShell';

type ThroughputDatum = { period: string; created: number; resolved: number };

export function ThroughputTrendChart({ data }: { data: ThroughputDatum[] }) {
  const chartData = data.map((row) => ({
    period: row.period,
    opened: Number(row.created) || 0,
    closed: Number(row.resolved) || 0,
  }));

  return (
    <ChartPanel
      className="h-full"
      eyebrow="Delivery rhythm"
      title="Monthly throughput"
      hint="Tickets opened vs closed by calendar month (axis: YYYY-Mon)."
      delay={0.24}
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} barGap={4} barCategoryGap="18%" margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={48} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
            <Bar dataKey="opened" name="Opened" fill="#0891b2" radius={[6, 6, 0, 0]} animationDuration={900} maxBarSize={36} />
            <Bar dataKey="closed" name="Closed" fill="#7c3aed" radius={[6, 6, 0, 0]} animationDuration={900} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}
