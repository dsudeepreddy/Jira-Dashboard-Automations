import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import { getStoredSnapshot } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';
import { env } from '../config/env';
import type { DashboardIssue } from '../shared/dashboardContract';

const exportQuerySchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  label: z.string().optional(),
  epicKey: z.string().optional(),
  licenseBu: z.string().optional(),
  auditType: z.string().optional(),
  application: z.string().optional(),
  startDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

function toExportIssue(issue: {
  id: string;
  key: string;
  summary: string;
  status: string;
  created: string;
  updated: string;
  resolved?: string | null;
  issueType?: string;
  projectKey?: string;
  assignee?: string | null;
  storyPoints?: number | null;
  flagged?: boolean;
  auditType?: string[];
  application?: string[];
  licenseBu?: string[];
  epicKey?: string | null;
  epicName?: string | null;
  teamSlaDays?: number | null;
  reviewerSlaDays?: number | null;
  validationDays?: number;
}): DashboardIssue {
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved,
    issuetype: issue.issueType ? { name: issue.issueType } : undefined,
    project: issue.projectKey ? { key: issue.projectKey } : undefined,
    assignee: issue.assignee,
    storyPoints: issue.storyPoints,
    flagged: issue.flagged,
    auditType: issue.auditType || [],
    application: issue.application || [],
    licenseBu: issue.licenseBu || [],
    epicKey: issue.epicKey || null,
    epicName: issue.epicName || null,
    teamSlaDays: issue.teamSlaDays ?? null,
    reviewerSlaDays: issue.reviewerSlaDays ?? null,
    validationDays: issue.validationDays,
  };
}

/** Full filtered issue list for Excel export (no comments — keeps payload lean). */
export async function getExportIssuesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = exportQuerySchema.parse(req.query);
    const limit = env.JIRA_MAX_ISSUES;

    const raw = isDatabaseEnabled()
      ? await getStoredSnapshot(parsed)
      : (await jiraClient.searchIssues(parsed)).issues;

    const issues = raw.slice(0, limit).map(toExportIssue);
    return res.json({
      issues,
      total: issues.length,
      truncated: raw.length > limit || (!isDatabaseEnabled() && raw.length >= limit),
      requestId: res.locals.requestId,
    });
  } catch (error) {
    next(error);
  }
}
