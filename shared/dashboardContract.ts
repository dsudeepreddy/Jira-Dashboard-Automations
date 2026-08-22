export interface DashboardFilters {
  projectKey?: string;
  sprintId?: number;
  issueType?: string;
  startDate?: string;
  endDate?: string;
}

export interface DashboardMetrics {
  totalIssues: number;
  completionRate: number;
  velocity: number;
  avgCycleTimeDays: number;
  createdVsResolved: Array<{ period: string; created: number; resolved: number }>;
  statusBreakdown: Array<{ name: string; value: number; color: string }>;
  velocityTrend: Array<{ period: string; target: number; actual: number }>;
}

export interface DashboardPayload {
  projects: Array<{ id: string; key: string; name: string; projectTypeKey?: string }>;
  sprints: Array<{ id: number; name: string; state: string; startDate?: string; endDate?: string; completeDate?: string }>;
  issueTypes: Array<{ id: string; name: string; description?: string }>;
  statuses: Array<{ id: string; name: string; statusCategory?: { key: string; name: string } }>;
  issues: Array<{
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
  }>;
  metrics: DashboardMetrics;
  filters: DashboardFilters;
  meta: {
    source: 'jira';
    issueCount: number;
    requestId?: string;
  };
}
