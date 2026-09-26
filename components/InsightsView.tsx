'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AuditInsights, FieldMetrics, SlaBreachTicket } from '@/shared/dashboardContract';
import { atlassianIssueUrl } from '@/shared/dashboardContract';
import { ChartPanel, ChartTooltip } from './ChartShell';
import { FieldBarChart, ValidationTimeBarChart } from './FieldCharts';
import { GlassCard } from './GlassCard';
import { StatusDistributionChart } from './StatusDistributionChart';

function filterBreaches(tickets: SlaBreachTicket[], auditType: string) {
  if (!auditType) return tickets;
  return tickets.filter((ticket) => ticket.auditTypes.includes(auditType));
}

function BreachTable({
  title,
  hint,
  tickets,
  emptyLabel,
}: {
  title: string;
  hint: string;
  tickets: SlaBreachTicket[];
  emptyLabel: string;
}) {
  return (
    <GlassCard className="p-5">
      <p className="eyebrow">Out of SLA</p>
      <h2 className="section-title">{title}</h2>
      <p className="mt-1 mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>
      <div className="overflow-x-auto rounded-2xl border border-slate-200/60 dark:border-white/10">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-white/80 text-[10px] uppercase tracking-wider text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Summary</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assignee</th>
              <th className="px-4 py-3">Elapsed</th>
              <th className="px-4 py-3">State</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length ? tickets.map((ticket) => (
              <tr key={`${ticket.key}-${ticket.state}`} className="border-t border-slate-100/80 dark:border-white/[0.04]">
                <td className="px-4 py-3">
                  <a
                    href={atlassianIssueUrl(ticket.key)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-cyan-700 hover:underline dark:text-cyan-300"
                  >
                    {ticket.key}
                  </a>
                </td>
                <td className="max-w-[280px] truncate px-4 py-3 text-slate-700 dark:text-slate-200">{ticket.summary}</td>
                <td className="px-4 py-3">{ticket.status}</td>
                <td className="px-4 py-3">{ticket.assignee || 'Unassigned'}</td>
                <td className="px-4 py-3 tabular-nums">
                  {ticket.slaDays.toFixed(1)}d
                  <span className="ml-1 text-[11px] text-slate-500">/ {ticket.targetDays}d</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                    ticket.state === 'in_flight'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200'
                  }`}
                  >
                    {ticket.state === 'in_flight' ? 'In flight' : 'Completed late'}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">{emptyLabel}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

export function InsightsView({
  fieldMetrics,
  auditInsights,
  auditTypeOptions = [],
}: {
  fieldMetrics?: FieldMetrics;
  auditInsights?: AuditInsights | null;
  auditTypeOptions?: Array<{ id: string; name: string }>;
}) {
  const [selectedAuditType, setSelectedAuditType] = useState('');
  const insights = auditInsights;

  const stageData = useMemo(() => {
    if (!insights) return null;
    if (!selectedAuditType) return null;
    return insights.statusByAuditType.find((row) => row.auditType === selectedAuditType) || null;
  }, [insights, selectedAuditType]);

  const teamSla = useMemo(() => {
    if (!insights || !selectedAuditType) return null;
    return insights.teamSlaByAuditType.find((row) => row.auditType === selectedAuditType) || null;
  }, [insights, selectedAuditType]);

  const reviewerSla = useMemo(() => {
    if (!insights || !selectedAuditType) return null;
    return insights.reviewerSlaByAuditType.find((row) => row.auditType === selectedAuditType) || null;
  }, [insights, selectedAuditType]);

  const teamBreaches = useMemo(
    () => filterBreaches(insights?.teamSlaBreaches || [], selectedAuditType),
    [insights, selectedAuditType],
  );
  const reviewerBreaches = useMemo(
    () => filterBreaches(insights?.reviewerSlaBreaches || [], selectedAuditType),
    [insights, selectedAuditType],
  );

  if (!insights) return null;

  const options = auditTypeOptions.length
    ? auditTypeOptions
    : insights.workByAuditType.map((row) => ({ id: row.name, name: row.name }));

  return (
    <section className="space-y-5 rounded-3xl border border-cyan-400/20 bg-cyan-50/30 p-4 dark:border-cyan-400/15 dark:bg-cyan-500/[0.05] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Audit types</p>
          <h2 className="section-title">Workflow, SLAs & breaches</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">
            Project-level view above; pick an audit type for stage completion, team/reviewer SLAs, and out-of-SLA tickets.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          Audit type
          <select
            aria-label="Select audit type for detailed dashboards"
            value={selectedAuditType}
            onChange={(event) => setSelectedAuditType(event.target.value)}
            className="control min-w-[14rem] py-2 text-sm text-slate-800 dark:text-slate-100"
          >
            <option value="">All audit types</option>
            {options.map((item) => (
              <option key={item.id} value={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>

      <FieldBarChart
        data={insights.workByAuditType}
        eyebrow="Volume"
        title="Work by audit type"
        hint="Total tickets for each audit type in the current filter."
        emptyLabel="No Audit Type values on issues in this filter."
      />

      {selectedAuditType ? (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            <StatusDistributionChart
              data={stageData?.stages || []}
              eyebrow="Completion by stage"
              title={`${selectedAuditType} workflow`}
            />
            <ChartPanel
              eyebrow="Stage counts"
              title={`${selectedAuditType} ticket stages`}
              hint="Approve/Approved, To Do, On Hold, In Progress, Under Validation, Done."
            >
              <div className="h-72">
                {stageData?.stages?.some((row) => row.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stageData.stages} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-300/40 dark:text-white/10" />
                      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                      <Bar dataKey="value" name="Tickets" radius={[0, 8, 8, 0]} animationDuration={900}>
                        {stageData.stages.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No tickets for this audit type in the current filter.
                  </div>
                )}
              </div>
            </ChartPanel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <GlassCard className="p-5">
              <p className="eyebrow">Team SLA</p>
              <h2 className="section-title">Approved → Under Validation</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Average days from first Approved transition to first Under Validation for {selectedAuditType}.
              </p>
              <p className="numeric mt-4 text-4xl font-medium tracking-tight">
                {teamSla ? teamSla.avgDays.toFixed(1) : '—'}
                <span className="ml-2 text-sm font-medium text-slate-500">days</span>
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {teamSla ? `${teamSla.count} completed transition${teamSla.count === 1 ? '' : 's'}` : 'No completed team SLAs yet'}
                {' · '}target {insights.teamSlaTargetDays}d
              </p>
            </GlassCard>
            <GlassCard className="p-5">
              <p className="eyebrow">Reviewer SLA</p>
              <h2 className="section-title">Under Validation → Done</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Average days from first Under Validation transition to Done / resolution for {selectedAuditType}.
              </p>
              <p className="numeric mt-4 text-4xl font-medium tracking-tight">
                {reviewerSla ? reviewerSla.avgDays.toFixed(1) : '—'}
                <span className="ml-2 text-sm font-medium text-slate-500">days</span>
              </p>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {reviewerSla ? `${reviewerSla.count} completed transition${reviewerSla.count === 1 ? '' : 's'}` : 'No completed reviewer SLAs yet'}
                {' · '}target {insights.reviewerSlaTargetDays}d
              </p>
            </GlassCard>
          </div>
        </>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <ValidationTimeBarChart
            data={insights.teamSlaByAuditType}
            eyebrow="Team SLA"
            title="Approved → Under Validation by audit type"
            hint="Average days from first Approved to first Under Validation. Select an audit type for stage and breach detail."
            emptyLabel="No completed team SLAs yet. Sync with changelog to populate."
          />
          <ValidationTimeBarChart
            data={insights.reviewerSlaByAuditType}
            eyebrow="Reviewer SLA"
            title="Under Validation → Done by audit type"
            hint="Average days from first Under Validation to Done. Select an audit type for stage and breach detail."
            emptyLabel="No completed reviewer SLAs yet. Sync with changelog to populate."
          />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <BreachTable
          title={selectedAuditType ? `Team SLA breaches · ${selectedAuditType}` : 'Team SLA breaches'}
          hint={`Tickets over the usual team SLA of ${insights.teamSlaTargetDays} days (Approved → Under Validation), including in-flight aging.`}
          tickets={teamBreaches}
          emptyLabel="No team SLA breaches in this view."
        />
        <BreachTable
          title={selectedAuditType ? `Reviewer SLA breaches · ${selectedAuditType}` : 'Reviewer SLA breaches'}
          hint={`Tickets over the usual reviewer SLA of ${insights.reviewerSlaTargetDays} days (Under Validation → Done), including in-flight aging.`}
          tickets={reviewerBreaches}
          emptyLabel="No reviewer SLA breaches in this view."
        />
      </div>

      {fieldMetrics ? (
        <details className="rounded-2xl border border-slate-200/70 bg-white/40 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
            More field breakdowns (labels, components, priorities)
          </summary>
          <div className="mt-4 grid gap-5 xl:grid-cols-2">
            <FieldBarChart
              data={fieldMetrics.labels}
              eyebrow="Tags"
              title="By label"
              emptyLabel="No labels in this filter."
            />
            <FieldBarChart
              data={fieldMetrics.components}
              eyebrow="Structure"
              title="By component"
              emptyLabel="No components in this filter."
            />
            <FieldBarChart
              data={fieldMetrics.priorities}
              eyebrow="Priority"
              title="By priority"
              emptyLabel="No priorities in this filter."
            />
            <FieldBarChart
              data={fieldMetrics.applications}
              eyebrow="Apps"
              title="By application"
              emptyLabel="No applications in this filter."
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}
