'use client';

import { motion } from 'framer-motion';
import { Activity, BarChart3, ChevronLeft, ChevronRight, CircleDashed, Filter, FolderKanban, Gauge, TimerReset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardPayload } from '@/shared/dashboardContract';
import { MetricCard } from './MetricCard';
import { StatusDistributionChart } from './StatusDistributionChart';
import { ThroughputTrendChart } from './ThroughputTrendChart';
import { ThemeToggle } from './ThemeToggle';

const velocityTheme = { primary: '#22d3ee', accent: '#a78bfa' };

type Filters = { projectKey: string; sprintId: string; issueType: string };

function VelocityChart({ data }: { data: Array<{ period: string; target: number; actual: number }> }) {
  return <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.35 }} className="glass-card p-5"><div className="mb-5"><p className="eyebrow">Sprint capacity</p><h2 className="section-title">Velocity / burndown</h2></div><div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}><defs><linearGradient id="velocity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor={velocityTheme.primary} stopOpacity={0.42} /><stop offset="95%" stopColor={velocityTheme.primary} stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-300/50 dark:text-slate-700/50" /><XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><Tooltip /><Area type="monotone" dataKey="actual" stroke={velocityTheme.primary} strokeWidth={2.5} fill="url(#velocity-fill)" animationDuration={1200} /><Area type="monotone" dataKey="target" stroke={velocityTheme.accent} strokeWidth={1.5} strokeDasharray="5 5" fill="transparent" animationDuration={1200} /></AreaChart></ResponsiveContainer></div></motion.section>;
}

function Skeleton() { return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/60" />)}</div>; }

export function DashboardLayout() {
  const [filters, setFilters] = useState<Filters>({ projectKey: '', sprintId: '', issueType: '' });
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuePage, setIssuePage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(25);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        if (filters.projectKey) params.set('projectKey', filters.projectKey);
        if (filters.sprintId) params.set('sprintId', filters.sprintId);
        if (filters.issueType) params.set('issueType', filters.issueType);
        const response = await fetch(`/api/jira?${params}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.detail || payload.details || 'Failed to load dashboard data.');
        setData(payload as DashboardPayload);
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name !== 'AbortError') setError(requestError.message);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    load();
    return () => controller.abort();
  }, [filters]);

  useEffect(() => setIssuePage(1), [filters, issuePageSize]);

  const metrics = useMemo(() => data ? [
    { title: 'Total issues', value: data.metrics.totalIssues, icon: FolderKanban, tone: 'cyan' as const },
    { title: 'Completion rate', value: data.metrics.completionRate, suffix: '%', decimals: 1, icon: Gauge, tone: 'mint' as const },
    { title: 'Velocity', value: data.metrics.velocity, icon: Activity, tone: 'violet' as const },
    { title: 'Avg cycle time', value: data.metrics.avgCycleTimeDays, suffix: 'days', decimals: 1, icon: TimerReset, tone: 'amber' as const },
  ] : [], [data]);
  const totalPages = Math.max(1, Math.ceil((data?.issues.length || 0) / issuePageSize));
  const visibleIssues = data?.issues.slice((issuePage - 1) * issuePageSize, issuePage * issuePageSize) || [];

  return <main className="min-h-screen px-4 py-5 text-slate-900 sm:px-6 lg:px-8 dark:text-white"><div className="mx-auto max-w-[1440px] space-y-5">
    <header className="glass-card flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between"><div><div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.85)]" /><span className="eyebrow text-emerald-600 dark:text-emerald-300">Live Jira insights</span></div><h1 className="font-display text-3xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-4xl">Operations, in focus.</h1><p className="mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">A clear view across delivery health, issue flow, and sprint momentum.</p></div><div className="flex items-center gap-3"><div className="hidden text-right sm:block"><p className="eyebrow">Source</p><p className="mt-1 text-sm font-medium text-slate-700 dark:text-slate-200">{data?.meta?.source === 'jira' ? 'Jira Cloud' : 'Connecting'}</p></div><ThemeToggle /></div></header>
    <section className="glass-card flex flex-wrap items-center gap-3 p-4"><div className="flex items-center gap-2 pr-2 text-sm font-medium text-slate-700 dark:text-slate-200"><Filter className="h-4 w-4 text-cyan-500" />Filters</div><select aria-label="Project" value={filters.projectKey} onChange={(event) => setFilters((current) => ({ ...current, projectKey: event.target.value }))} className="control"><option value="">All projects</option>{data?.projects.map((project) => <option key={project.id} value={project.key}>{project.name}</option>)}</select><select aria-label="Sprint" value={filters.sprintId} onChange={(event) => setFilters((current) => ({ ...current, sprintId: event.target.value }))} className="control"><option value="">All sprints</option>{data?.sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}</select><select aria-label="Issue type" value={filters.issueType} onChange={(event) => setFilters((current) => ({ ...current, issueType: event.target.value }))} className="control"><option value="">All types</option>{data?.issueTypes.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}</select><button type="button" onClick={() => setFilters({ projectKey: '', sprintId: '', issueType: '' })} className="control font-medium text-cyan-600 dark:text-cyan-300">Reset</button></section>
    {error ? <div className="glass-card border-red-300/70 bg-red-50/70 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">{error}</div> : null}
    {loading ? <Skeleton /> : data ? <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{metrics.map((metric, index) => <MetricCard key={metric.title} {...metric} delay={index * 0.07} />)}</section>
      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]"><StatusDistributionChart data={data.metrics.statusBreakdown} /><ThroughputTrendChart data={data.metrics.createdVsResolved} /></section>
      <section className="grid gap-5 xl:grid-cols-2"><VelocityChart data={data.metrics.velocityTrend} /><motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.4 }} className="glass-card p-5"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Signal board</p><h2 className="section-title">Operational summary</h2></div><BarChart3 className="h-5 w-5 text-cyan-500" /></div><div className="grid gap-3 sm:grid-cols-2">{[['Open issues', data.metrics.statusBreakdown.find((item) => item.name === 'Open')?.value || 0], ['Blocked items', data.metrics.statusBreakdown.find((item) => item.name === 'Blocked')?.value || 0], ['Avg throughput', Math.round(data.metrics.createdVsResolved.reduce((sum, item) => sum + item.resolved, 0) / Math.max(data.metrics.createdVsResolved.length, 1))], ['Data source', 'Jira Cloud']].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-800/50"><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 font-display text-xl font-semibold text-slate-950 dark:text-white">{value}</p></div>)}</div></motion.section></section>
      <section className="glass-card overflow-hidden p-5"><div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Live work queue</p><h2 className="section-title">Issues</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{data.issues.length} Jira issues loaded</p></div><label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">Per page<select value={issuePageSize} onChange={(event) => setIssuePageSize(Number(event.target.value))} className="control py-1.5"><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-slate-200/80 text-[10px] uppercase tracking-wider text-slate-500 dark:border-slate-700/80"><tr><th className="px-3 py-3">Key</th><th className="px-3 py-3">Summary</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Updated</th></tr></thead><tbody>{visibleIssues.map((issue) => <tr key={issue.id} className="border-b border-slate-100/80 transition-colors hover:bg-cyan-50/40 dark:border-slate-800/80 dark:hover:bg-slate-800/40"><td className="px-3 py-3 font-medium text-cyan-600 dark:text-cyan-300">{issue.key}</td><td className="max-w-[420px] truncate px-3 py-3 text-slate-700 dark:text-slate-200">{issue.summary}</td><td className="px-3 py-3 text-slate-600 dark:text-slate-300">{issue.status}</td><td className="px-3 py-3 text-slate-600 dark:text-slate-300">{issue.issuetype?.name || '—'}</td><td className="px-3 py-3 text-slate-500 dark:text-slate-400">{new Date(issue.updated).toLocaleDateString()}</td></tr>)}</tbody></table></div><div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"><span>Page {issuePage} of {totalPages}</span><div className="flex gap-2"><button type="button" aria-label="Previous issue page" disabled={issuePage === 1} onClick={() => setIssuePage((page) => Math.max(1, page - 1))} className="icon-button"><ChevronLeft className="h-4 w-4" /></button><button type="button" aria-label="Next issue page" disabled={issuePage >= totalPages} onClick={() => setIssuePage((page) => Math.min(totalPages, page + 1))} className="icon-button"><ChevronRight className="h-4 w-4" /></button></div></div></section>
    </> : null}
  </div></main>;
}
