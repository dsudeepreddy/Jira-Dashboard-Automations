'use client';

import { AlertTriangle, BarChart3, ChevronLeft, ChevronRight, Filter, FolderKanban, Gauge, Activity, TimerReset } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardPayload, IssuePagePayload } from '@/shared/dashboardContract';
import { atlassianIssueUrl } from '@/shared/dashboardContract';
import { AmbientBackground } from './AmbientBackground';
import { GlassCard } from './GlassCard';
import { MetricCard } from './MetricCard';
import { StatusDistributionChart } from './StatusDistributionChart';
import { ThroughputTrendChart } from './ThroughputTrendChart';
import { AssigneeLoadChart, VelocityChart, WipAgingChart } from './FlowCharts';
import { ThemeToggle } from './ThemeToggle';

type Filters = {
  projectKey: string;
  sprintId: string;
  issueType: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FILTERS: Filters = { projectKey: '', sprintId: '', issueType: '', startDate: '', endDate: '' };

function Skeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="glass-card h-32">
          <div className="shimmer h-full w-full" />
        </div>
      ))}
    </div>
  );
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    projectKey: params.get('projectKey') || '',
    sprintId: params.get('sprintId') || '',
    issueType: params.get('issueType') || '',
    startDate: params.get('startDate') || '',
    endDate: params.get('endDate') || '',
  };
}

function toQuery(filters: Filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

export function DashboardLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams));
  const [draft, setDraft] = useState<Filters>(() => filtersFromParams(searchParams));
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [issues, setIssues] = useState<IssuePagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuePage, setIssuePage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(25);

  const dirty = JSON.stringify(draft) !== JSON.stringify(filters);
  const urlQuery = searchParams.toString();
  const invalidRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const dateSummary = [filters.startDate, filters.endDate].filter(Boolean).join(' → ') || 'Any created date';

  const commitFilters = useCallback((next: Filters) => {
    setFilters(next);
    setDraft(next);
    const query = toQuery(next).toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as never, { scroll: false });
  }, [pathname, router]);

  useEffect(() => {
    const fromUrl = filtersFromParams(new URLSearchParams(urlQuery));
    setFilters(fromUrl);
    setDraft(fromUrl);
  }, [urlQuery]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        if (!data) setLoading(true);
        setError(null);
        const response = await fetch(`/api/jira?${toQuery(filters)}`, { signal: controller.signal, cache: 'no-store' });
        const payload = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload.detail || payload.details || 'Failed to load dashboard data.');
        setData(payload as DashboardPayload);
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name !== 'AbortError') setError(requestError.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [filters]);

  useEffect(() => setIssuePage(1), [filters, issuePageSize]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadIssues() {
      const params = toQuery(filters);
      params.set('page', String(issuePage));
      params.set('pageSize', String(issuePageSize));
      const response = await fetch(`/api/jira/issues?${params}`, { signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok) setIssues(payload as IssuePagePayload);
    }
    loadIssues().catch(() => undefined);
    return () => controller.abort();
  }, [filters, issuePage, issuePageSize]);

  const metrics = useMemo(() => {
    if (!data) return [];
    const unit = data.metrics.velocityUnit === 'points' ? 'pts' : 'issues';
    return [
      { title: 'Total issues', value: data.metrics.totalIssues, icon: FolderKanban, tone: 'cyan' as const },
      { title: 'Completion rate', value: data.metrics.completionRate, suffix: '%', decimals: 1, icon: Gauge, tone: 'mint' as const },
      { title: `Velocity (${unit})`, value: data.metrics.velocity, decimals: 1, icon: Activity, tone: 'violet' as const },
      { title: 'Avg cycle time', value: data.metrics.avgCycleTimeDays, suffix: 'days', decimals: 1, icon: TimerReset, tone: 'amber' as const },
    ];
  }, [data]);

  const totalPages = Math.max(1, Math.ceil((issues?.total || 0) / issuePageSize));
  const refreshedAt = data?.meta.lastSuccessAt || data?.meta.fetchedAt;
  const lastSync = refreshedAt ? new Date(refreshedAt).toLocaleString() : 'Waiting for data';
  const live = Boolean(data) && !data?.meta.stale;
  const syncLabel = data?.meta.persistence === 'percona' ? 'Last snapshot sync' : 'Data refreshed';
  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    return (data?.projects || []).filter((project) => {
      if (!project.key || seen.has(project.key)) return false;
      seen.add(project.key);
      return true;
    });
  }, [data?.projects]);
  const issueTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    return (data?.issueTypes || []).filter((type) => {
      const name = type.name.trim().toLowerCase();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [data?.issueTypes]);

  return (
    <main className="relative isolate min-h-screen px-4 py-5 text-slate-900 sm:px-6 lg:px-8 dark:text-white">
      <AmbientBackground />
      <div className="relative z-10 mx-auto max-w-[1440px] space-y-5">
        <header className="sticky top-0 z-30 -mx-4 bg-gradient-to-b from-background via-background/90 to-transparent px-4 pb-3 pt-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <GlassCard spotlight={false} className="px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-[11px] font-semibold tracking-wide text-white dark:bg-white dark:text-slate-950">
                    JA
                  </div>
                  <div>
                    <p className="text-sm font-semibold tracking-tight">Jira Analytics</p>
                    <p className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      {data?.meta.stale ? 'Snapshot is stale' : data?.meta.persistence === 'percona' ? 'Persisted snapshot' : 'Live from Jira'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden text-right sm:block">
                    <p className="eyebrow">{syncLabel}</p>
                    <p className="numeric mt-1 text-[11px] text-slate-700 dark:text-slate-200">{lastSync}</p>
                  </div>
                  <ThemeToggle />
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <div className="flex shrink-0 items-center gap-2 pr-1 text-sm font-medium">
                    <Filter className="h-4 w-4 text-cyan-500" />
                    Filters
                  </div>
                  <select
                    aria-label="Project"
                    title={projectOptions.find((project) => project.key === draft.projectKey)?.name || 'All projects'}
                    value={draft.projectKey}
                    onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })}
                    className="control min-w-0 max-w-[14rem] flex-[1_1_11rem]"
                  >
                    <option value="">All projects</option>
                    {projectOptions.map((project) => <option key={project.id} value={project.key}>{project.name}</option>)}
                  </select>
                  <select
                    aria-label="Sprint"
                    title={data?.sprints.find((sprint) => String(sprint.id) === draft.sprintId)?.name || 'All sprints'}
                    value={draft.sprintId}
                    onChange={(event) => setDraft({ ...draft, sprintId: event.target.value })}
                    className="control min-w-0 max-w-[14rem] flex-[1_1_11rem]"
                  >
                    <option value="">All sprints</option>
                    {data?.sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
                  </select>
                  <select
                    aria-label="Issue type"
                    title={draft.issueType || 'All types'}
                    value={draft.issueType}
                    onChange={(event) => setDraft({ ...draft, issueType: event.target.value })}
                    className="control min-w-0 max-w-[11rem] flex-[1_1_8rem]"
                  >
                    <option value="">All types</option>
                    {issueTypeOptions.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}
                  </select>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
                  <input
                    aria-label="Created from"
                    type="date"
                    value={draft.startDate}
                    max={draft.endDate || undefined}
                    onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                    className="control w-[10.5rem] shrink-0"
                  />
                  <input
                    aria-label="Created to"
                    type="date"
                    value={draft.endDate}
                    min={draft.startDate || undefined}
                    onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                    className="control w-[10.5rem] shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => commitFilters(draft)}
                    disabled={!dirty || invalidRange}
                    className="shrink-0 rounded-xl bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                  >
                    {loading && data ? 'Applying…' : 'Apply'}
                  </button>
                  <button type="button" onClick={() => commitFilters(EMPTY_FILTERS)} className="control shrink-0 font-medium text-slate-600 dark:text-slate-300">Reset</button>
                </div>
                {invalidRange ? <p className="basis-full text-xs text-amber-700 dark:text-amber-300">Created from must be on or before Created to.</p> : null}
              </div>
            </div>
          </GlassCard>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
          <div>
            <p className="eyebrow mb-3">Delivery operations</p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              Operations, <span className="text-cyan-600 dark:text-cyan-300">in focus.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Cycle time, sprint velocity, and remaining throughput — computed on the server, presented as a studio-grade ops surface.
            </p>
          </div>
          <GlassCard spotlight={false} className="px-5 py-4">
            <p className="eyebrow">Active filter</p>
            <p className="mt-2 text-lg font-semibold">
              {filters.projectKey || 'All projects'}
              <span className="mx-2 text-slate-300 dark:text-white/20">/</span>
              {filters.sprintId ? data?.sprints.find((sprint) => String(sprint.id) === filters.sprintId)?.name || 'Sprint' : 'All sprints'}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{dateSummary}</p>
          </GlassCard>
        </section>

        {data?.meta.stale || data?.meta.lastError || data?.meta.truncated ? (
          <GlassCard spotlight={false} className="border-amber-300/60 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {data.meta.stale ? <p>Jira data is older than expected. Check backend sync or run <code className="font-mono">POST /api/v1/sync</code>.</p> : null}
                {data.meta.truncated ? <p>This view is capped at 10,000 issues. Narrow filters or raise the snapshot window.</p> : null}
                {data.meta.lastError ? <p className="mt-1">Last sync error: {data.meta.lastError}</p> : null}
              </div>
            </div>
          </GlassCard>
        ) : null}

        {error ? (
          <GlassCard spotlight={false} className="border-red-300/70 bg-red-50/80 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </GlassCard>
        ) : null}

        {loading && !data ? <Skeleton /> : data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => <MetricCard key={metric.title} {...metric} />)}
            </section>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Lead time', value: `${data.metrics.avgLeadTimeDays.toFixed(1)}`, unit: 'days', accent: 'from-cyan-400' },
                { label: 'Weekly throughput', value: data.metrics.avgWeeklyThroughput.toFixed(1), unit: 'issues', accent: 'from-indigo-400' },
                { label: 'Blocked / flagged', value: String(data.metrics.blockedCount), unit: 'open risks', accent: 'from-rose-400' },
                { label: 'Forecast', value: data.metrics.forecast.estimatedDate || 'n/a', unit: `${data.metrics.forecast.remainingIssues} remaining · ${data.metrics.forecast.estimatedWeeks ?? '∞'} weeks`, accent: 'from-fuchsia-400' },
              ].map((item) => (
                <GlassCard key={item.label} className="p-4">
                  <div className={`mb-3 h-1 w-10 rounded-full bg-gradient-to-r ${item.accent} to-transparent`} />
                  <p className="eyebrow">{item.label}</p>
                  <p className="numeric mt-2 text-2xl font-medium tracking-tight">{item.value}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{item.unit}</p>
                </GlassCard>
              ))}
            </section>
            <section className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
              <StatusDistributionChart data={data.metrics.statusBreakdown} />
              <ThroughputTrendChart data={data.metrics.createdVsResolved} />
            </section>
            <section className="grid gap-5 xl:grid-cols-2">
              <VelocityChart data={data.metrics.velocityTrend} basis={data.metrics.velocityBasis} />
              <WipAgingChart data={data.metrics.wipAging} />
            </section>
            <section className="grid gap-5 xl:grid-cols-2">
              <AssigneeLoadChart data={data.metrics.assigneeLoad} />
              <GlassCard className="p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <p className="eyebrow">Time in status</p>
                    <h2 className="section-title">Open work dwell</h2>
                  </div>
                  <BarChart3 className="h-5 w-5 text-cyan-500" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.metrics.timeInStatus.length ? data.metrics.timeInStatus.map((item) => (
                    <div key={item.status} className="rounded-2xl border border-slate-200/70 bg-white/50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.status}</p>
                      <p className="mt-2 numeric text-xl font-medium">{item.avgDays}d <span className="text-xs font-medium text-slate-500">· {item.count}</span></p>
                    </div>
                  )) : <p className="text-sm text-slate-500">No open issues in the current filter.</p>}
                </div>
              </GlassCard>
            </section>
            <GlassCard className="p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="eyebrow">Work queue</p>
                  <h2 className="section-title">Issues</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{issues?.total || 0} matching issues</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  Per page
                  <select value={issuePageSize} onChange={(event) => setIssuePageSize(Number(event.target.value))} className="control py-1.5">
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/10">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 bg-white/80 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur-md dark:bg-slate-950/70 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Key</th>
                      <th className="px-4 py-3">Summary</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Assignee</th>
                      <th className="px-4 py-3">Pts</th>
                      <th className="px-4 py-3">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(issues?.issues || []).map((issue) => {
                      const issueUrl = atlassianIssueUrl(issue.key);
                      return (
                      <tr
                        key={issue.id}
                        className="cursor-pointer border-t border-slate-100/80 transition-colors hover:bg-cyan-50/50 dark:border-white/[0.04] dark:hover:bg-cyan-400/[0.04]"
                        onClick={() => window.open(issueUrl, '_blank', 'noopener,noreferrer')}
                      >
                        <td className="px-4 py-3 font-mono text-[12px] font-medium text-cyan-700 dark:text-cyan-300">
                          <a
                            href={issueUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="hover:underline"
                          >
                            {issue.key}
                          </a>
                          {issue.flagged ? <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-rose-600 dark:text-rose-300">blocked</span> : null}
                        </td>
                        <td className="max-w-[420px] truncate px-4 py-3 text-slate-700 dark:text-slate-200">{issue.summary}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[11px] dark:border-white/10 dark:bg-white/5">{issue.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/40 to-indigo-500/40 text-[9px] font-semibold">{initials(issue.assignee)}</span>
                            <span className="text-slate-600 dark:text-slate-300">{issue.assignee || 'Unassigned'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">{issue.storyPoints ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">{new Date(issue.updated).toLocaleDateString()}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Page {issuePage} of {totalPages}</span>
                <div className="flex gap-2">
                  <button type="button" aria-label="Previous issue page" disabled={issuePage === 1} onClick={() => setIssuePage((page) => Math.max(1, page - 1))} className="icon-button">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label="Next issue page" disabled={issuePage >= totalPages} onClick={() => setIssuePage((page) => Math.min(totalPages, page + 1))} className="icon-button">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </GlassCard>
          </>
        ) : null}
      </div>
    </main>
  );
}
