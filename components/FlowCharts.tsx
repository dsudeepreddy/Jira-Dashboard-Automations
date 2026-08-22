'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartPanel, ChartTooltip } from './ChartShell';

const velocityTheme = { primary: '#22d3ee', accent: '#c4b5fd' };

export function VelocityChart({
  data,
  basis = 'sprint',
}: {
  data: Array<{ period: string; target: number; actual: number }>;
  basis?: 'sprint' | 'week';
}) {
  const empty = !data.length || data.every((row) => row.period === 'No data' && row.actual === 0);
  return (
    <ChartPanel
      eyebrow={basis === 'week' ? 'Completed by week' : 'Completed sprints'}
      title="Velocity"
      hint={basis === 'week'
        ? 'Sprint membership was missing, so this uses completed work by ISO week.'
        : 'Completed work vs rolling average of earlier sprints, including the active sprint.'}
      delay={0.3}
    >
      <div className="relative h-72">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">No completed work in this filter yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="velocity-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={velocityTheme.primary} stopOpacity={0.45} />
                  <stop offset="95%" stopColor={velocityTheme.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
              <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={32} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="actual" name="Actual" stroke={velocityTheme.primary} strokeWidth={2.4} fill="url(#velocity-fill)" animationDuration={1200} />
              <Area type="monotone" dataKey="target" name="Rolling avg" stroke={velocityTheme.accent} strokeWidth={1.6} strokeDasharray="6 6" fill="transparent" animationDuration={1200} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartPanel>
  );
}

export function WipAgingChart({ data }: { data: Array<{ bucket: string; count: number }> }) {
  return (
    <ChartPanel eyebrow="Flow risk" title="WIP aging" hint="In-progress issues by age, not the full backlog." delay={0.34}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="wip-bar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f97316" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
            <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={32} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar dataKey="count" name="In progress" fill="url(#wip-bar)" radius={[8, 8, 0, 0]} animationDuration={1200} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}

export function AssigneeLoadChart({ data }: { data: Array<{ name: string; openCount: number; points: number }> }) {
  return (
    <ChartPanel eyebrow="Team load" title="Open work by assignee" delay={0.38}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id="assignee-bar" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#6366f1" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
            <Bar dataKey="openCount" name="Open issues" fill="url(#assignee-bar)" radius={[0, 8, 8, 0]} animationDuration={1200} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartPanel>
  );
}
