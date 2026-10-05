import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  zonedParts,
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  reportPeriodKey,
  shouldSkipAlreadySent,
} = require('./.tmp/monthlyReportSchedule.js');
const { previousWeekWindow } = require('./.tmp/monthlyReport.js');

test('zonedParts maps Monday 09:00 Asia/Kolkata correctly', () => {
  // 2026-09-28 09:00 IST = 03:30 UTC
  const local = zonedParts(new Date('2026-09-28T03:30:00.000Z'), 'Asia/Kolkata');
  assert.equal(local.weekday, 1);
  assert.equal(local.hour, 9);
  assert.equal(local.day, 28);
  assert.equal(localDateKey(local), '2026-09-28');
  assert.equal(isWeeklyReportDue(local, 1, 9), true);
  assert.equal(isWeeklyReportDue(local, 1, 8), false);
  assert.equal(isMonthlyReportDue(local, 1, 9), false);
});

test('monthly report is due on the 1st at 09:00', () => {
  // 2026-10-01 09:00 IST = 03:30 UTC
  const local = zonedParts(new Date('2026-10-01T03:30:00.000Z'), 'Asia/Kolkata');
  assert.equal(local.day, 1);
  assert.equal(local.hour, 9);
  assert.equal(isMonthlyReportDue(local, 1, 9), true);
  assert.equal(isMonthlyReportDue(local, 1, 8), false);
  assert.equal(isWeeklyReportDue(local, 1, 9), false); // Oct 1 2026 is Thursday
});

test('reportPeriodKey is previous calendar month', () => {
  assert.equal(reportPeriodKey(new Date('2026-09-28T03:30:00.000Z')), '2026-08');
  assert.equal(reportPeriodKey(new Date('2026-10-05T03:30:00.000Z')), '2026-09');
});

test('previousWeekWindow is prior Mon–Sun in timezone', () => {
  // Monday 2026-10-05 09:00 IST → previous week Sep 28 – Oct 4
  const window = previousWeekWindow(new Date('2026-10-05T03:30:00.000Z'), 'Asia/Kolkata');
  assert.equal(window.startDate, '2026-09-28');
  assert.equal(window.endDate, '2026-10-04');
  assert.match(window.periodLabel, /Sep 28/);
});

test('shouldSkipAlreadySent prevents duplicate schedule keys', () => {
  assert.equal(shouldSkipAlreadySent({
    scheduleKey: '2026-10-01',
    periodKey: '2026-09',
    lastScheduleKey: '2026-10-01',
    lastPeriodKey: '2026-09',
  }), true);
  assert.equal(shouldSkipAlreadySent({
    scheduleKey: '2026-11-01',
    periodKey: '2026-10',
    lastScheduleKey: '2026-10-01',
    lastPeriodKey: '2026-09',
  }), false);
  assert.equal(shouldSkipAlreadySent({
    scheduleKey: '2026-10-06',
    lastScheduleKey: '2026-09-29',
  }), false);
  assert.equal(shouldSkipAlreadySent({
    scheduleKey: '2026-10-12',
    periodKey: '2026-09',
    lastScheduleKey: '2026-10-05',
    lastPeriodKey: '2026-09',
    oncePerPeriod: true,
  }), true);
});
