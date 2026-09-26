'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FieldSlice } from '@/shared/dashboardContract';
import { ChartPanel, ChartTooltip } from './ChartShell';

/** Distinct hues per audit type (shared by both SLA charts). */
const AUDIT_TYPE_COLORS = [
  '#0891b2', // cyan
  '#7c3aed', // violet
  '#059669', // emerald
  '#d97706', // amber
  '#dc2626', // red
  '#2563eb', // blue
  '#0d9488', // teal
  '#ea580c', // orange
  '#4f46e5', // indigo
  '#65a30d', // lime
  '#db2777', // pink (one accent only)
  '#0284c7', // sky
];

function colorForAuditType(name: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  // Stable by name; mix in index so adjacent bars stay distinct if hashes collide.
  return AUDIT_TYPE_COLORS[(hash + index) % AUDIT_TYPE_COLORS.length];
}

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

export function ValidationTimeBarChart({
  data = [],
  eyebrow = 'Validation Stage Tracking',
  title = 'Validation Time by Audit Type',
  hint = 'Average days issues spent in validation statuses.',
  emptyLabel = 'No validation history tracked for any audit type.',
}: {
  data: Array<{ auditType: string; avgDays: number; count: number }>;
  eyebrow?: string;
  title?: string;
  hint?: string;
  emptyLabel?: string;
}) {
  const chartData = data.map((item, index) => ({
    name: item.auditType,
    avgDays: item.avgDays,
    count: item.count,
    color: colorForAuditType(item.auditType, index),
  }));

  return (
    <ChartPanel eyebrow={eyebrow} title={title} hint={hint}>
      <div className="h-72">
        {chartData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              />
              <Bar dataKey="avgDays" name="Avg Days" radius={[0, 8, 8, 0]} animationDuration={900}>
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
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
