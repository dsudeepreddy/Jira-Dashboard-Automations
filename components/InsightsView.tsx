'use client';

import { Boxes, Flag, Hash, Layers } from 'lucide-react';
import type { FieldMetrics } from '@/shared/dashboardContract';
import { FieldBarChart } from './FieldCharts';
import { GlassCard } from './GlassCard';
import { MetricCard } from './MetricCard';
import { StatusDistributionChart } from './StatusDistributionChart';

export function InsightsView({ fieldMetrics }: { fieldMetrics?: FieldMetrics }) {
  if (!fieldMetrics) return null;

  const coverage = fieldMetrics.labeledIssues + fieldMetrics.unlabeledIssues;
  const labeledShare = coverage ? (fieldMetrics.labeledIssues / coverage) * 100 : 0;

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="License / BU" value={fieldMetrics.uniqueLicenseBus ?? 0} icon={Layers} tone="cyan" />
        <MetricCard title="Audit types" value={fieldMetrics.uniqueAuditTypes ?? 0} icon={Hash} tone="mint" />
        <MetricCard title="Applications" value={fieldMetrics.uniqueApplications ?? 0} icon={Boxes} tone="violet" />
        <MetricCard title="FY epics" value={fieldMetrics.uniqueEpics ?? 0} icon={Flag} tone="amber" />
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <FieldBarChart
          data={fieldMetrics.licenseBus || []}
          eyebrow="License / BU"
          title="Work by business unit"
          emptyLabel="No License/BU values on issues in this filter."
        />
        <FieldBarChart
          data={fieldMetrics.auditTypes || []}
          eyebrow="Audit type"
          title="Work by audit type"
          emptyLabel="No Audit Type values on issues in this filter."
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <FieldBarChart
          data={fieldMetrics.applications || []}
          eyebrow="Application"
          title="Work by application"
          emptyLabel="No Application values on issues in this filter."
        />
        <FieldBarChart
          data={fieldMetrics.epics || []}
          eyebrow="Financial year"
          title="Work by FY epic"
          emptyLabel="No epic links on issues in this filter."
        />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Unique tags" value={fieldMetrics.uniqueLabels} icon={Hash} tone="cyan" />
        <MetricCard title="Tagged issues" value={fieldMetrics.labeledIssues} icon={Layers} tone="mint" />
        <MetricCard title="Untagged issues" value={fieldMetrics.unlabeledIssues} icon={Flag} tone="amber" />
        <MetricCard title="Components" value={fieldMetrics.uniqueComponents} icon={Boxes} tone="violet" />
      </section>
      <GlassCard spotlight={false} className="px-5 py-4">
        <p className="eyebrow">Tag coverage</p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {labeledShare.toFixed(1)}% of issues in this filter have at least one Jira label.
          Counts by tag can exceed the issue total because an issue may carry several labels.
        </p>
      </GlassCard>
      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <FieldBarChart
          data={fieldMetrics.labels}
          eyebrow="Jira labels"
          title="Work by tag"
          hint="Top labels in the current filter."
          emptyLabel="No labels on issues in this filter."
        />
        <StatusDistributionChart
          eyebrow="Priority"
          title="Mix by priority"
          data={fieldMetrics.priorities.map((item) => ({ name: item.name, value: item.count, color: item.color }))}
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <FieldBarChart
          data={fieldMetrics.issueTypes}
          eyebrow="Issue type"
          title="Volume by type"
          emptyLabel="No issue types in this filter."
        />
        <FieldBarChart
          data={fieldMetrics.components}
          eyebrow="Components"
          title="Work by component"
          emptyLabel="No components on issues in this filter."
        />
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <FieldBarChart
          data={fieldMetrics.projects}
          eyebrow="Project"
          title="Volume by project"
          emptyLabel="No project keys in this filter."
        />
        <GlassCard className="p-5">
          <p className="eyebrow">Tag throughput</p>
          <h2 className="section-title">Completion by label</h2>
          <p className="mt-1 mb-4 text-xs text-slate-500 dark:text-slate-400">Done vs open for each label, plus story points still attached to those issues.</p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/10">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-white/80 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Issues</th>
                  <th className="px-4 py-3">Open</th>
                  <th className="px-4 py-3">Done</th>
                  <th className="px-4 py-3">Done %</th>
                  <th className="px-4 py-3">Points</th>
                </tr>
              </thead>
              <tbody>
                {fieldMetrics.labels.length ? fieldMetrics.labels.map((row) => (
                  <tr key={row.name} className="border-t border-slate-100/80 dark:border-white/[0.04]">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: row.color }} />
                        {row.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.count}</td>
                    <td className="px-4 py-3 tabular-nums">{row.openCount}</td>
                    <td className="px-4 py-3 tabular-nums">{row.doneCount}</td>
                    <td className="px-4 py-3 tabular-nums">{row.completionRate.toFixed(1)}</td>
                    <td className="px-4 py-3 tabular-nums">{row.points}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No labels to summarize.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </section>
    </>
  );
}
