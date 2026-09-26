'use client';

import { AlertTriangle, AppWindow, BarChart3, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardList, Download, Filter, FolderKanban, Activity, CheckCircle2, ClipboardCheck, TrendingUp } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardIssue, DashboardPayload, ExportIssuesPayload, IssuePagePayload } from '@/shared/dashboardContract';
import { atlassianIssueUrl, UNTAGGED_LABEL } from '@/shared/dashboardContract';
import { downloadAuditWorkbook } from '@/lib/exportAuditWorkbook';
import { AmbientBackground } from './AmbientBackground';
import { GlassCard } from './GlassCard';
import { MetricCard } from './MetricCard';
import { StatusDistributionChart } from './StatusDistributionChart';
import { ThroughputTrendChart } from './ThroughputTrendChart';
import { AssigneeLoadChart, VelocityChart, WipAgingChart } from './FlowCharts';
import { FieldBarChart } from './FieldCharts';
import { InsightsView } from './InsightsView';
import { ThemeToggle } from './ThemeToggle';

type Filters = {
  projectKey: string;
  sprintId: string;
  issueType: string;
  label: string;
  epicKey: string;
  licenseBu: string;
  auditType: string;
  application: string;
  startDate: string;
  endDate: string;
};

const EMPTY_FILTERS: Filters = {
  projectKey: '', sprintId: '', issueType: '', label: '',
  epicKey: '', licenseBu: '', auditType: '', application: '',
  startDate: '', endDate: '',
};

const ISSUE_SORT_OPTIONS = [
  { value: 'updated-desc', label: 'Latest updated' },
  { value: 'updated-asc', label: 'Oldest updated' },
  { value: 'created-desc', label: 'Latest created' },
  { value: 'created-asc', label: 'Oldest created' },
  { value: 'key-asc', label: 'Key A–Z' },
  { value: 'key-desc', label: 'Key Z–A' },
] as const;

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
    label: params.get('label') || '',
    epicKey: params.get('epicKey') || '',
    licenseBu: params.get('licenseBu') || '',
    auditType: params.get('auditType') || '',
    application: params.get('application') || '',
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
  const [issueSort, setIssueSort] = useState('updated-desc');
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
        if (!response.ok) throw new Error(payload.detail || payload.details || payload.error || 'Failed to load dashboard data.');
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

  useEffect(() => setIssuePage(1), [filters, issuePageSize, issueSort]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadIssues() {
      const params = toQuery(filters);
      params.set('page', String(issuePage));
      params.set('pageSize', String(issuePageSize));
      params.set('sort', issueSort);
      const response = await fetch(`/api/jira/issues?${params}`, { signal: controller.signal, cache: 'no-store' });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (response.ok) setIssues(payload as IssuePagePayload);
    }
    loadIssues().catch(() => undefined);
    return () => controller.abort();
  }, [filters, issuePage, issuePageSize, issueSort]);

  const metrics = useMemo(() => {
    if (!data) return [];
    return [
      { title: "Total Jira's", value: data.metrics.totalIssues, icon: FolderKanban, tone: 'cyan' as const },
      { title: "Open Jira's", value: data.metrics.openIssues, icon: Activity, tone: 'amber' as const },
      { title: "Under Validation Jira's", value: data.metrics.underValidationCount ?? 0, icon: ClipboardCheck, tone: 'violet' as const },
      { title: "Done Jira's", value: data.metrics.doneCount ?? 0, icon: CheckCircle2, tone: 'mint' as const },
    ];
  }, [data]);

  const secondaryMetrics = useMemo(() => {
    if (!data) return [];
    return [
      {
        title: 'License / BU',
        value: data.metrics.fieldMetrics?.uniqueLicenseBus ?? 0,
        icon: Building2,
        tone: 'cyan' as const,
      },
      {
        title: 'Audit types',
        value: data.metrics.fieldMetrics?.uniqueAuditTypes ?? 0,
        icon: ClipboardList,
        tone: 'violet' as const,
      },
      {
        title: 'Applications',
        value: data.metrics.fieldMetrics?.uniqueApplications ?? 0,
        icon: AppWindow,
        tone: 'amber' as const,
      },
      {
        title: 'Monthly throughput',
        value: data.metrics.avgMonthlyThroughput ?? data.metrics.avgWeeklyThroughput,
        icon: TrendingUp,
        tone: 'mint' as const,
        decimals: 1,
      },
    ];
  }, [data]);

  const exportExcel = useCallback(async () => {
    if (!data) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(`/api/jira/export?${toQuery(filters)}`, { cache: 'no-store' });
      const payload = await response.json() as ExportIssuesPayload & { detail?: string; error?: string };
      if (!response.ok) throw new Error(payload.detail || payload.error || 'Export failed');
      downloadAuditWorkbook(data, payload.issues as DashboardIssue[]);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [data, filters]);

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
  const labelOptions = useMemo(() => {
    const seen = new Set<string>();
    return (data?.labels || []).filter((label) => {
      const name = label.name.trim().toLowerCase();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [data?.labels]);

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
                  <button
                    type="button"
                    onClick={() => { void exportExcel(); }}
                    disabled={!data || exporting}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-cyan-400/60 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:text-cyan-300"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exporting ? 'Exporting…' : 'Export Excel'}
                  </button>
                  <div className="hidden text-right sm:block">
                    <p className="eyebrow">{syncLabel}</p>
                    <p className="numeric mt-1 text-[11px] text-slate-700 dark:text-slate-200">{lastSync}</p>
                  </div>
                  <ThemeToggle />
                </div>
              </div>
              <div className="border-t border-slate-200/70 pt-3 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setIsFiltersExpanded((prev) => !prev)}
                  className="flex w-full items-center justify-between text-sm font-medium text-slate-700 transition hover:text-cyan-600 dark:text-slate-200 dark:hover:text-cyan-400"
                >
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-cyan-500" />
                    <span>Filters</span>
                    {Object.values(filters).some(Boolean) && (
                      <span className="ml-1.5 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>{isFiltersExpanded ? 'Collapse' : 'Expand'}</span>
                    {isFiltersExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </button>
              </div>
              {isFiltersExpanded && (
                <div className="space-y-3 border-t border-slate-200/70 pt-3 dark:border-white/10">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    <select
                      aria-label="Project"
                      title={projectOptions.find((project) => project.key === draft.projectKey)?.name || 'All projects'}
                      value={draft.projectKey}
                      onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All projects</option>
                      {projectOptions.map((project) => <option key={project.id} value={project.key}>{project.name}</option>)}
                    </select>
                    <select
                      aria-label="Financial year epic"
                      title={data?.epics?.find((epic) => epic.key === draft.epicKey)?.name || 'All FY epics'}
                      value={draft.epicKey}
                      onChange={(event) => setDraft({ ...draft, epicKey: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All FY epics</option>
                      {(data?.epics || []).map((epic) => <option key={epic.key} value={epic.key}>{epic.name}</option>)}
                    </select>
                    <select
                      aria-label="License / BU"
                      title={draft.licenseBu || 'All License/BU'}
                      value={draft.licenseBu}
                      onChange={(event) => setDraft({ ...draft, licenseBu: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All License/BU</option>
                      {(data?.licenseBus || []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                    </select>
                    <select
                      aria-label="Application"
                      title={draft.application || 'All applications'}
                      value={draft.application}
                      onChange={(event) => setDraft({ ...draft, application: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All applications</option>
                      {(data?.applications || []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                    </select>
                    <select
                      aria-label="Sprint"
                      title={data?.sprints?.find((sprint) => String(sprint.id) === draft.sprintId)?.name || 'All sprints'}
                      value={draft.sprintId}
                      onChange={(event) => setDraft({ ...draft, sprintId: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All sprints</option>
                      {(data?.sprints || []).map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name}</option>)}
                    </select>
                    <select
                      aria-label="Issue type"
                      title={draft.issueType || 'All types'}
                      value={draft.issueType}
                      onChange={(event) => setDraft({ ...draft, issueType: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All types</option>
                      {issueTypeOptions.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}
                    </select>
                    <select
                      aria-label="Tag"
                      title={draft.label === UNTAGGED_LABEL ? 'Untagged' : draft.label || 'All tags'}
                      value={draft.label}
                      onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                      className="control w-full min-w-0"
                    >
                      <option value="">All tags</option>
                      <option value={UNTAGGED_LABEL}>Untagged</option>
                      {labelOptions.map((label) => <option key={label.id} value={label.name}>{label.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <input
                      aria-label="Created from"
                      type="date"
                      value={draft.startDate}
                      max={draft.endDate || undefined}
                      onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                      className="control w-full sm:w-[11rem]"
                    />
                    <input
                      aria-label="Created to"
                      type="date"
                      value={draft.endDate}
                      min={draft.startDate || undefined}
                      onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                      className="control w-full sm:w-[11rem]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => commitFilters(draft)}
                        disabled={!dirty || invalidRange}
                        className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                      >
                        {loading && data ? 'Applying…' : 'Apply'}
                      </button>
                      <button type="button" onClick={() => commitFilters(EMPTY_FILTERS)} className="control font-medium text-slate-600 dark:text-slate-300">Reset</button>
                    </div>
                  </div>
                  {invalidRange ? <p className="text-xs text-amber-700 dark:text-amber-300">Created from must be on or before Created to.</p> : null}
                </div>
              )}
            </div>
          </GlassCard>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
          <div>
            <p className="eyebrow mb-3">SRE audit</p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-5xl">
              Audit work, <span className="text-cyan-600 dark:text-cyan-300">by FY.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Project-level flow metrics by default. Open View more to pick an audit type and see stage completion, team/reviewer SLAs, and out-of-SLA tickets.
            </p>
          </div>
          <GlassCard spotlight={false} className="px-5 py-4">
            <p className="eyebrow">Active filter</p>
            <p className="mt-2 text-lg font-semibold">
              {filters.projectKey || 'All projects'}
              <span className="mx-2 text-slate-300 dark:text-white/20">/</span>
              {filters.epicKey ? data?.epics?.find((epic) => epic.key === filters.epicKey)?.name || filters.epicKey : 'All FY epics'}
              {filters.licenseBu ? (
                <>
                  <span className="mx-2 text-slate-300 dark:text-white/20">/</span>
                  {filters.licenseBu}
                </>
              ) : null}
              {filters.application ? (
                <>
                  <span className="mx-2 text-slate-300 dark:text-white/20">/</span>
                  {filters.application}
                </>
              ) : null}
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

        {exportError ? (
          <GlassCard spotlight={false} className="border-red-300/70 bg-red-50/80 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            Export failed: {exportError}
          </GlassCard>
        ) : null}

        {loading && !data ? <Skeleton /> : data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => <MetricCard key={metric.title} {...metric} />)}
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {secondaryMetrics.map((metric) => <MetricCard key={metric.title} {...metric} />)}
            </section>

            <section className="grid gap-5 xl:grid-cols-2 xl:items-stretch">
              <StatusDistributionChart data={data.metrics.statusBreakdown} />
              <ThroughputTrendChart data={data.metrics.createdVsResolved} />
            </section>

            <section className="grid gap-5 xl:grid-cols-2 xl:items-stretch">
              <AssigneeLoadChart data={data.metrics.assigneeLoad} />
              <WipAgingChart data={data.metrics.wipAging} />
            </section>

            <FieldBarChart
              data={data.metrics.auditInsights?.workByAuditType || []}
              eyebrow="Volume"
              title="Work by audit type"
              hint="Total tickets for each audit type in the current filter."
              emptyLabel="No Audit Type values on issues in this filter."
            />

            <InsightsView
              auditInsights={data.metrics.auditInsights}
              auditTypeOptions={data.auditTypes}
            />

            <section className="grid gap-5 xl:grid-cols-2 xl:items-stretch">
              <VelocityChart data={data.metrics.velocityTrend} basis={data.metrics.velocityBasis} />
              <GlassCard className="h-full p-5">
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
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    Sort
                    <select value={issueSort} onChange={(event) => setIssueSort(event.target.value)} className="control py-1.5">
                      {ISSUE_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    Per page
                    <select value={issuePageSize} onChange={(event) => setIssuePageSize(Number(event.target.value))} className="control py-1.5">
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/10">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="sticky top-0 bg-white/80 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur-md dark:bg-slate-950/70 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Key</th>
                      <th className="px-4 py-3">Summary</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Audit type</th>
                      <th className="px-4 py-3">Assignee</th>
                      <th className="px-4 py-3">Latest comment</th>
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
                        <td className="max-w-[160px] truncate px-4 py-3 text-slate-600 dark:text-slate-300">
                          {(issue.auditType || []).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400/40 to-indigo-500/40 text-[9px] font-semibold">{initials(issue.assignee)}</span>
                            <span className="text-slate-600 dark:text-slate-300">{issue.assignee || 'Unassigned'}</span>
                          </span>
                        </td>
                        <td className="max-w-[320px] px-4 py-3">
                          {issue.latestComment ? (
                            <div>
                              <p className="line-clamp-2 text-slate-700 dark:text-slate-200" title={issue.latestComment.text}>
                                {issue.latestComment.text}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                {issue.latestComment.author}
                                <span className="mx-1">·</span>
                                {new Date(issue.latestComment.updated).toLocaleString()}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">{new Date(issue.updated).toLocaleString()}</td>
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
