import type { LatestHumanComment } from './comments';

export const UNTAGGED_LABEL = '__untagged__';

export interface DashboardFilters {
  projectKey?: string;
  sprintId?: number;
  issueType?: string;
  label?: string;
  epicKey?: string;
  licenseBu?: string;
  auditType?: string;
  application?: string;
  startDate?: string;
  endDate?: string;
}

/** Official Atlassian browse URL. Do not derive this from JIRA_DOMAIN (API/proxy hosts). */
export const ATLASSIAN_BROWSE_BASE_URL = 'https://phonepe.atlassian.net/browse';

export function atlassianIssueUrl(issueKey: string) {
  return `${ATLASSIAN_BROWSE_BASE_URL}/${issueKey}`;
}

export interface DashboardIssue {
  id: string;
  key: string;
  summary: string;
  status?: string;
  created: string;
  updated: string;
  resolved?: string | null;
  issuetype?: { name?: string };
  project?: { key?: string; name?: string };
  priority?: { name?: string };
  assignee?: string | null;
  storyPoints?: number | null;
  flagged?: boolean;
  latestComment?: LatestHumanComment | null;
  validationDays?: number;
  auditType?: string[];
  application?: string[];
  licenseBu?: string[];
  epicKey?: string | null;
  epicName?: string | null;
  teamSlaDays?: number | null;
  reviewerSlaDays?: number | null;
}

export interface AssigneeStageSlice {
  status: string;
  count: number;
  keys: string[];
  color: string;
}

export interface AssigneeLoadRow {
  name: string;
  openCount: number;
  points: number;
  stages: AssigneeStageSlice[];
}

export interface ExportIssuesPayload {
  issues: DashboardIssue[];
  total: number;
  truncated: boolean;
  requestId?: string;
}

export interface FieldSlice {
  name: string;
  count: number;
  openCount: number;
  doneCount: number;
  points: number;
  completionRate: number;
  color: string;
}

export interface FieldMetrics {
  uniqueLabels: number;
  labeledIssues: number;
  unlabeledIssues: number;
  uniqueComponents: number;
  uniqueLicenseBus: number;
  uniqueAuditTypes: number;
  uniqueApplications: number;
  uniqueEpics: number;
  labels: FieldSlice[];
  components: FieldSlice[];
  priorities: FieldSlice[];
  issueTypes: FieldSlice[];
  projects: FieldSlice[];
  licenseBus: FieldSlice[];
  auditTypes: FieldSlice[];
  applications: FieldSlice[];
  epics: FieldSlice[];
}

export interface SlaSummary {
  avgDays: number;
  medianDays: number;
  p90Days: number;
  completedCount: number;
  inFlightCount: number;
  aging: Array<{ bucket: string; count: number }>;
}

export interface SlaBreachTicket {
  key: string;
  summary: string;
  assignee: string | null;
  status: string;
  auditTypes: string[];
  slaDays: number;
  targetDays: number;
  state: 'completed' | 'in_flight';
}

export interface AuditStatusByType {
  auditType: string;
  total: number;
  stages: Array<{ name: string; value: number; color: string }>;
}

export interface AuditInsights {
  workByAuditType: FieldSlice[];
  statusByAuditType: AuditStatusByType[];
  teamSlaByAuditType: Array<{ auditType: string; avgDays: number; count: number }>;
  reviewerSlaByAuditType: Array<{ auditType: string; avgDays: number; count: number }>;
  teamSlaTargetDays: number;
  reviewerSlaTargetDays: number;
  teamSlaBreaches: SlaBreachTicket[];
  reviewerSlaBreaches: SlaBreachTicket[];
}

export interface DashboardMetrics {
  totalIssues: number;
  openIssues: number;
  underValidationCount: number;
  doneCount: number;
  blockedCount: number;
  completionRate: number;
  velocity: number;
  velocityUnit: 'points' | 'issues';
  avgCycleTimeDays: number;
  avgLeadTimeDays: number;
  avgWeeklyThroughput: number;
  avgMonthlyThroughput: number;
  createdVsResolved: Array<{ period: string; created: number; resolved: number }>;
  statusBreakdown: Array<{ name: string; value: number; color: string }>;
  velocityTrend: Array<{ period: string; target: number; actual: number }>;
  velocityBasis: 'sprint' | 'week';
  wipAging: Array<{ bucket: string; count: number }>;
  assigneeLoad: AssigneeLoadRow[];
  timeInStatus: Array<{ status: string; avgDays: number; count: number }>;
  forecast: {
    remainingIssues: number;
    avgWeeklyThroughput: number;
    estimatedWeeks: number | null;
    estimatedDate: string | null;
  };
  fieldMetrics: FieldMetrics;
  validationTimeByAuditType: Array<{ auditType: string; avgDays: number; count: number }>;
  auditInsights: AuditInsights;
  teamSlaByAuditType: Array<{ auditType: string; avgDays: number; count: number }>;
  reviewerSlaByAuditType: Array<{ auditType: string; avgDays: number; count: number }>;
}

export interface DashboardPayload {
  projects: Array<{ id: string; key: string; name: string; projectTypeKey?: string }>;
  sprints: Array<{ id: number; name: string; state: string; startDate?: string; endDate?: string; completeDate?: string }>;
  issueTypes: Array<{ id: string; name: string; description?: string }>;
  labels: Array<{ id: string; name: string }>;
  epics: Array<{ key: string; name: string }>;
  licenseBus: Array<{ id: string; name: string }>;
  auditTypes: Array<{ id: string; name: string }>;
  applications: Array<{ id: string; name: string }>;
  statuses: Array<{ id: string; name: string; statusCategory?: { key: string; name: string } }>;
  metrics: DashboardMetrics;
  filters: DashboardFilters;
  meta: {
    source: 'jira';
    issueCount: number;
    requestId?: string;
    persistence?: 'percona' | 'jira-direct';
    lastSuccessAt?: string | null;
    lastSyncedAt?: string | null;
    lastError?: string | null;
    stale?: boolean;
    truncated?: boolean;
    browseBaseUrl?: string;
    fetchedAt?: string;
  };
}

export interface IssuePagePayload {
  issues: DashboardIssue[];
  page: number;
  pageSize: number;
  total: number;
  requestId?: string;
}
