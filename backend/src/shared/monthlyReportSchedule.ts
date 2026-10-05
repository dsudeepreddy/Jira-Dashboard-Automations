import { previousMonthWindow } from './monthlyReport';

export type ZonedParts = {
  weekday: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function zonedParts(now: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[read('weekday')] ?? -1,
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
  };
}

/** Local calendar date key YYYY-MM-DD. */
export function localDateKey(local: ZonedParts): string {
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

/** @deprecated Use localDateKey — kept for weekly Monday schedule keys. */
export function mondayScheduleKey(local: ZonedParts): string {
  return localDateKey(local);
}

/** Monthly: due on calendar day-of-month at dueHour (e.g. 1st at 09:00). */
export function isMonthlyReportDue(local: ZonedParts, dueDay: number, dueHour: number): boolean {
  return local.day === dueDay && local.hour === dueHour;
}

/** Weekly: due on weekday at dueHour (e.g. Monday=1 at 09:00). */
export function isWeeklyReportDue(local: ZonedParts, dueWeekday: number, dueHour: number): boolean {
  return local.weekday === dueWeekday && local.hour === dueHour;
}

export function reportPeriodKey(now = new Date()): string {
  return previousMonthWindow(now).startDate.slice(0, 7);
}

export function shouldSkipAlreadySent(options: {
  scheduleKey: string;
  periodKey?: string;
  lastScheduleKey?: string;
  lastPeriodKey?: string;
  /** @deprecated alias for scheduleKey */
  mondayKey?: string;
  lastMondayKey?: string;
  oncePerPeriod?: boolean;
}): boolean {
  const scheduleKey = options.scheduleKey || options.mondayKey || '';
  const lastScheduleKey = options.lastScheduleKey || options.lastMondayKey;
  if (lastScheduleKey && scheduleKey && lastScheduleKey === scheduleKey) return true;
  if (options.oncePerPeriod && options.periodKey && options.lastPeriodKey === options.periodKey) return true;
  return false;
}
