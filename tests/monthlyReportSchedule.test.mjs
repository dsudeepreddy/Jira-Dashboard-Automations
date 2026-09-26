import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  zonedParts,
  isMonthlyReportDue,
  mondayScheduleKey,
  reportPeriodKey,
  shouldSkipAlreadySent,
} = require('./.tmp/monthlyReportSchedule.js');

test('zonedParts maps Monday 09:00 Asia/Kolkata correctly', () => {
  // 2026-09-28 09:00 IST = 03:30 UTC
  const local = zonedParts(new Date('2026-09-28T03:30:00.000Z'), 'Asia/Kolkata');
  assert.equal(local.weekday, 1);
  assert.equal(local.hour, 9);
  assert.equal(local.day, 28);
  assert.equal(mondayScheduleKey(local), '2026-09-28');
  assert.equal(isMonthlyReportDue(local, 1, 9), true);
  assert.equal(isMonthlyReportDue(local, 1, 8), false);
});

test('reportPeriodKey is previous calendar month', () => {
  assert.equal(reportPeriodKey(new Date('2026-09-28T03:30:00.000Z')), '2026-08');
  assert.equal(reportPeriodKey(new Date('2026-10-05T03:30:00.000Z')), '2026-09');
});

test('shouldSkipAlreadySent prevents duplicate Monday sends', () => {
  assert.equal(shouldSkipAlreadySent({
    mondayKey: '2026-09-28',
    periodKey: '2026-08',
    lastMondayKey: '2026-09-28',
    lastPeriodKey: '2026-08',
  }), true);
  assert.equal(shouldSkipAlreadySent({
    mondayKey: '2026-10-05',
    periodKey: '2026-09',
    lastMondayKey: '2026-09-28',
    lastPeriodKey: '2026-08',
  }), false);
  assert.equal(shouldSkipAlreadySent({
    mondayKey: '2026-10-12',
    periodKey: '2026-09',
    lastMondayKey: '2026-10-05',
    lastPeriodKey: '2026-09',
    oncePerPeriod: true,
  }), true);
});
