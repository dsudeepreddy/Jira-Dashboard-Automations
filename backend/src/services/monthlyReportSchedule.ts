import fs from 'node:fs';
import path from 'node:path';
import {
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  mondayScheduleKey,
  reportPeriodKey,
  shouldSkipAlreadySent as shouldSkipAlreadySentShared,
  zonedParts,
  type ZonedParts,
} from '../shared/monthlyReportSchedule';

export {
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  mondayScheduleKey,
  reportPeriodKey,
  zonedParts,
};
export type { ZonedParts };

type PersistedScheduleState = {
  lastMondayKey?: string;
  lastMonthlyKey?: string;
  lastWeeklyKey?: string;
  lastPeriodKey?: string;
  lastSentAt?: string;
  lastWeeklySentAt?: string;
};

function defaultStatePath(): string {
  return process.env.MONTHLY_REPORT_STATE_FILE
    || path.join(process.cwd(), 'data', 'monthly-report-schedule.json');
}

export function readScheduleState(filePath = defaultStatePath()): PersistedScheduleState {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedScheduleState;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function writeScheduleState(state: PersistedScheduleState, filePath = defaultStatePath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const previous = readScheduleState(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify({ ...previous, ...state }, null, 2)}\n`, 'utf8');
}

export function shouldSkipAlreadySent(options: {
  scheduleKey: string;
  periodKey?: string;
  state: PersistedScheduleState;
  oncePerPeriod?: boolean;
  kind?: 'monthly' | 'weekly';
}): boolean {
  const lastScheduleKey = options.kind === 'weekly'
    ? options.state.lastWeeklyKey
    : (options.state.lastMonthlyKey || options.state.lastMondayKey);
  return shouldSkipAlreadySentShared({
    scheduleKey: options.scheduleKey,
    periodKey: options.periodKey,
    lastScheduleKey,
    lastPeriodKey: options.state.lastPeriodKey,
    oncePerPeriod: options.oncePerPeriod,
  });
}
