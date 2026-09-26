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

/** One auto-send per local calendar Monday (YYYY-MM-DD of that Monday). */
export function mondayScheduleKey(local: ZonedParts): string {
  return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

export function isMonthlyReportDue(local: ZonedParts, dueWeekday: number, dueHour: number): boolean {
  return local.weekday === dueWeekday && local.hour === dueHour;
}

export function reportPeriodKey(now = new Date()): string {
  return previousMonthWindow(now).startDate.slice(0, 7);
}

export function shouldSkipAlreadySent(options: {
  mondayKey: string;
  periodKey: string;
  lastMondayKey?: string;
  lastPeriodKey?: string;
  oncePerPeriod?: boolean;
}): boolean {
  if (options.lastMondayKey === options.mondayKey) return true;
  if (options.oncePerPeriod && options.lastPeriodKey === options.periodKey) return true;
  return false;
}
