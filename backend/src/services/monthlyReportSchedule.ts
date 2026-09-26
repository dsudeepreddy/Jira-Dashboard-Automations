import fs from 'node:fs';
import path from 'node:path';
import {
  isMonthlyReportDue,
  mondayScheduleKey,
  reportPeriodKey,
  shouldSkipAlreadySent as shouldSkipAlreadySentShared,
  zonedParts,
  type ZonedParts,
} from '../shared/monthlyReportSchedule';

export {
  isMonthlyReportDue,
  mondayScheduleKey,
  reportPeriodKey,
  zonedParts,
};
export type { ZonedParts };

type PersistedScheduleState = {
  lastMondayKey?: string;
  lastPeriodKey?: string;
  lastSentAt?: string;
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
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function shouldSkipAlreadySent(options: {
  mondayKey: string;
  periodKey: string;
  state: PersistedScheduleState;
  oncePerPeriod?: boolean;
}): boolean {
  return shouldSkipAlreadySentShared({
    mondayKey: options.mondayKey,
    periodKey: options.periodKey,
    lastMondayKey: options.state.lastMondayKey,
    lastPeriodKey: options.state.lastPeriodKey,
    oncePerPeriod: options.oncePerPeriod,
  });
}
