'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AssigneeLoadRow } from '@/shared/dashboardContract';
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
      className="h-full"
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
    <ChartPanel className="h-full" eyebrow="Flow risk" title="In-progress aging" hint="In-progress issues by age, not the full backlog." delay={0.34}>
      <div className="h-72">
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

function AssigneeStageTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number; color?: string; name?: string }>;
  label?: string;
  rows: AssigneeLoadRow[];
}) {
  if (!active || !payload?.length) return null;
  const row = rows.find((item) => item.name === label);
  const stages = (payload || [])
    .filter((entry) => Number(entry.value) > 0)
    .map((entry) => {
      const status = String(entry.dataKey || entry.name || '');
      const stage = row?.stages.find((item) => item.status === status);
      return {
        status,
        count: Number(entry.value) || 0,
        color: entry.color || stage?.color || '#64748b',
        keys: stage?.keys || [],
      };
    });

  return (
    <div className="max-h-72 max-w-xs overflow-auto rounded-xl border border-slate-200/80 bg-white/95 p-3 text-xs shadow-lg dark:border-white/10 dark:bg-slate-950/95">
      <p className="font-semibold text-slate-800 dark:text-slate-100">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{row?.openCount ?? 0} open · {row?.points ?? 0} pts</p>
      <div className="mt-2 space-y-2">
        {stages.map((stage) => (
          <div key={stage.status}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
              <span className="font-medium text-slate-700 dark:text-slate-200">{stage.status}</span>
              <span className="ml-auto tabular-nums text-slate-500">{stage.count}</span>
            </div>
            {stage.keys.length ? (
              <p className="mt-1 pl-4 font-mono text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                {stage.keys.join(', ')}
                {stage.count > stage.keys.length ? '…' : ''}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AssigneeLoadChart({ data }: { data: AssigneeLoadRow[] }) {
  const statuses = [...new Map(
    data.flatMap((row) => row.stages || []).map((stage) => [stage.status, stage.color]),
  ).entries()];

  const chartData = data.map((row) => {
    const point: Record<string, string | number> = {
      name: row.name,
      openCount: row.openCount,
      points: row.points,
    };
    (row.stages || []).forEach((stage) => {
      point[stage.status] = stage.count;
    });
    return point;
  });

  return (
    <ChartPanel
      className="h-full"
      eyebrow="Team load"
      title="Open work by assignee"
      hint="Each bar stacks open tickets by current status. Hover a segment for stage and ticket keys."
      delay={0.38}
    >
      <div className="max-h-80 overflow-y-auto pr-1">
        <div style={{ height: Math.max(288, chartData.length * 36) }}>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={148} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                <Tooltip content={<AssigneeStageTooltip rows={data} />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {statuses.map(([status, color], index) => (
                  <Bar
                    key={status}
                    dataKey={status}
                    stackId="stages"
                    name={status}
                    fill={color}
                    radius={index === statuses.length - 1 ? [0, 8, 8, 0] : [0, 0, 0, 0]}
                    animationDuration={1000}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">No open work in this filter.</div>
          )}
        </div>
      </div>
    </ChartPanel>
  );
}
