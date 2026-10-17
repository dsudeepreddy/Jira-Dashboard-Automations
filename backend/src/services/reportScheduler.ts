import {
  completeMonthlySend,
  completeWeeklySend,
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  readScheduleState,
  releaseMonthlyClaim,
  releaseWeeklyClaim,
  reportPeriodKey,
  shouldSkipAlreadySent,
  tryClaimMonthlySend,
  tryClaimWeeklySend,
  zonedParts,
  getScheduleStatePath,
} from './monthlyReportSchedule';

export type ReportSchedulerDeps = {
  timezone: string;
  monthlyEnabled: boolean;
  monthlyDay: number;
  monthlyHour: number;
  weeklyEnabled: boolean;
  weeklyWeekday: number;
  weeklyHour: number;
  isEmailConfigured: () => boolean;
  sendMonthly: () => Promise<{ subject: string; recipients: string[]; messageId?: string }>;
  sendWeekly: () => Promise<{ subject: string; recipients: string[]; messageId?: string; periodLabel?: string }>;
  now?: () => Date;
  stateFile?: string;
  log?: (payload: Record<string, unknown>) => void;
  error?: (payload: Record<string, unknown>) => void;
};

/**
 * Single-flight report scheduler.
 * Safe against setInterval overlap: at most one successful weekly/monthly send per schedule key.
 */
export function createReportScheduler(deps: ReportSchedulerDeps) {
  const log = deps.log || ((payload) => console.log(JSON.stringify(payload)));
  const error = deps.error || ((payload) => console.error(JSON.stringify(payload)));
  const nowFn = deps.now || (() => new Date());
  const stateFile = deps.stateFile || getScheduleStatePath();

  let tickRunning = false;
  let loggedWaitingForMonthly = false;
  let loggedWaitingForWeekly = false;
  let loggedEmailNotConfigured = false;

  const tick = async () => {
    if (tickRunning) {
      log({ event: 'report_scheduler_tick_skipped', reason: 'previous_tick_still_running' });
      return;
    }
    tickRunning = true;

    try {
      if (!deps.isEmailConfigured()) {
        if (!loggedEmailNotConfigured) {
          loggedEmailNotConfigured = true;
          log({
            event: 'report_scheduler_skipped',
            reason: 'email_not_configured',
            detail: 'Set SMTP_HOST, SMTP_FROM, and MONTHLY_REPORT_TO (plus SMTP_PROXY if needed).',
          });
        }
        return;
      }
      loggedEmailNotConfigured = false;

      const now = nowFn();
      const local = zonedParts(now, deps.timezone);

      if (deps.monthlyEnabled) {
        if (!isMonthlyReportDue(local, deps.monthlyDay, deps.monthlyHour)) {
          if (!loggedWaitingForMonthly) {
            loggedWaitingForMonthly = true;
            log({
              event: 'monthly_report_waiting',
              timezone: deps.timezone,
              day: local.day,
              hour: local.hour,
              dueDay: deps.monthlyDay,
              dueHour: deps.monthlyHour,
            });
          }
        } else {
          loggedWaitingForMonthly = false;
          const scheduleKey = localDateKey(local);
          const periodKey = reportPeriodKey(now);
          const state = readScheduleState(stateFile);

          if (shouldSkipAlreadySent({
            scheduleKey,
            periodKey,
            state,
            oncePerPeriod: true,
            kind: 'monthly',
            nowMs: now.getTime(),
          })) {
            log({
              event: 'monthly_report_skipped',
              reason: 'already_sent_or_claimed',
              scheduleKey,
              periodKey,
            });
          } else if (!tryClaimMonthlySend(scheduleKey, periodKey, stateFile, now.getTime())) {
            log({
              event: 'monthly_report_skipped',
              reason: 'claim_failed_or_race',
              scheduleKey,
              periodKey,
            });
          } else {
            try {
              const result = await deps.sendMonthly();
              completeMonthlySend(scheduleKey, periodKey, stateFile);
              log({
                event: 'monthly_report_sent',
                subject: result.subject,
                recipients: result.recipients,
                messageId: result.messageId,
                scheduleKey,
                periodKey,
              });
            } catch (err) {
              releaseMonthlyClaim(scheduleKey, stateFile);
              error({
                event: 'monthly_report_failed',
                scheduleKey,
                periodKey,
                error: err instanceof Error ? err.message : 'unknown',
                detail: 'Claim released; will retry while still in the due hour.',
              });
            }
          }
        }
      }

      if (deps.weeklyEnabled) {
        if (!isWeeklyReportDue(local, deps.weeklyWeekday, deps.weeklyHour)) {
          if (!loggedWaitingForWeekly) {
            loggedWaitingForWeekly = true;
            log({
              event: 'weekly_report_waiting',
              timezone: deps.timezone,
              weekday: local.weekday,
              hour: local.hour,
              dueWeekday: deps.weeklyWeekday,
              dueHour: deps.weeklyHour,
            });
          }
        } else {
          loggedWaitingForWeekly = false;
          const scheduleKey = localDateKey(local);
          const state = readScheduleState(stateFile);

          if (shouldSkipAlreadySent({
            scheduleKey,
            state,
            kind: 'weekly',
            nowMs: now.getTime(),
          })) {
            log({
              event: 'weekly_report_skipped',
              reason: 'already_sent_or_claimed',
              scheduleKey,
              lastWeeklyKey: state.lastWeeklyKey || null,
              weeklyClaimKey: state.weeklyClaimKey || null,
            });
          } else if (!tryClaimWeeklySend(scheduleKey, stateFile, now.getTime())) {
            log({
              event: 'weekly_report_skipped',
              reason: 'claim_failed_or_race',
              scheduleKey,
            });
          } else {
            try {
              const result = await deps.sendWeekly();
              completeWeeklySend(scheduleKey, stateFile);
              log({
                event: 'weekly_report_sent',
                subject: result.subject,
                recipients: result.recipients,
                messageId: result.messageId,
                scheduleKey,
                periodLabel: result.periodLabel,
              });
            } catch (err) {
              releaseWeeklyClaim(scheduleKey, stateFile);
              error({
                event: 'weekly_report_failed',
                scheduleKey,
                error: err instanceof Error ? err.message : 'unknown',
                detail: 'Claim released; will retry while still in the due hour.',
              });
            }
          }
        }
      }
    } finally {
      tickRunning = false;
    }
  };

  return {
    tick,
    getStateFile: () => stateFile,
  };
}
