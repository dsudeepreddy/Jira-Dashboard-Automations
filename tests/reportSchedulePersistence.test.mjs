import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schedule = require('../backend/dist/services/monthlyReportSchedule.js');
const { createReportScheduler } = require('../backend/dist/services/reportScheduler.js');

function tempStateFile() {
  return path.join(os.tmpdir(), `jira-report-schedule-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

test('weekly claim blocks duplicate sends before SMTP finishes', () => {
  const file = tempStateFile();
  try {
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), true);
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), false);
    schedule.completeWeeklySend('2026-10-13', file);
    assert.equal(schedule.shouldSkipAlreadySent({
      scheduleKey: '2026-10-13',
      state: schedule.readScheduleState(file),
      kind: 'weekly',
    }), true);
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), false);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.weekly.2026-10-13.lock`, { force: true });
  }
});

test('weekly claim release allows retry after failure', () => {
  const file = tempStateFile();
  try {
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), true);
    schedule.releaseWeeklyClaim('2026-10-13', file);
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), true);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.weekly.2026-10-13.lock`, { force: true });
  }
});

test('weekly claim release does not undo a completed send', () => {
  const file = tempStateFile();
  try {
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), true);
    schedule.completeWeeklySend('2026-10-13', file);
    schedule.releaseWeeklyClaim('2026-10-13', file);
    assert.equal(schedule.readScheduleState(file).lastWeeklyKey, '2026-10-13');
    assert.equal(schedule.tryClaimWeeklySend('2026-10-13', file), false);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.weekly.2026-10-13.lock`, { force: true });
  }
});

test('monthly claim blocks duplicates the same way', () => {
  const file = tempStateFile();
  try {
    assert.equal(schedule.tryClaimMonthlySend('2026-11-01', '2026-10', file), true);
    assert.equal(schedule.tryClaimMonthlySend('2026-11-01', '2026-10', file), false);
    schedule.completeMonthlySend('2026-11-01', '2026-10', file);
    const state = schedule.readScheduleState(file);
    assert.equal(state.lastMonthlyKey, '2026-11-01');
    assert.equal(state.lastPeriodKey, '2026-10');
    assert.equal(schedule.tryClaimMonthlySend('2026-11-01', '2026-10', file), false);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.monthly.2026-11-01.lock`, { force: true });
  }
});

test('60 overlapping weekly ticks send exactly once (spam regression)', async () => {
  const file = tempStateFile();
  let sendCount = 0;
  const events = [];

  // Monday 2026-10-12 09:00 IST = 03:30 UTC
  const dueInstant = new Date('2026-10-12T03:30:00.000Z');

  const scheduler = createReportScheduler({
    timezone: 'Asia/Kolkata',
    monthlyEnabled: false,
    monthlyDay: 1,
    monthlyHour: 9,
    weeklyEnabled: true,
    weeklyWeekday: 1,
    weeklyHour: 9,
    isEmailConfigured: () => true,
    stateFile: file,
    now: () => dueInstant,
    log: (payload) => events.push(payload),
    error: (payload) => events.push(payload),
    sendMonthly: async () => ({ subject: 'm', recipients: [] }),
    sendWeekly: async () => {
      sendCount += 1;
      // Simulate slow Jira + SMTP (> 1 minute of work relative to overlapping ticks)
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { subject: 'weekly', recipients: ['a@example.com'], periodLabel: 'week' };
    },
  });

  try {
    // Fire 60 ticks the way setInterval does (overlapping, not awaited).
    const started = [];
    for (let i = 0; i < 60; i += 1) {
      started.push(scheduler.tick());
    }
    await Promise.all(started);

    assert.equal(sendCount, 1, `expected 1 weekly send, got ${sendCount}`);
    const sent = events.filter((e) => e.event === 'weekly_report_sent');
    assert.equal(sent.length, 1);
    assert.equal(schedule.readScheduleState(file).lastWeeklyKey, '2026-10-12');
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.weekly.2026-10-12.lock`, { force: true });
  }
});

test('60 overlapping monthly ticks send exactly once (spam regression)', async () => {
  const file = tempStateFile();
  let sendCount = 0;

  // 1 Nov 2026 09:00 IST = 03:30 UTC (Sunday)
  const dueInstant = new Date('2026-11-01T03:30:00.000Z');

  const scheduler = createReportScheduler({
    timezone: 'Asia/Kolkata',
    monthlyEnabled: true,
    monthlyDay: 1,
    monthlyHour: 9,
    weeklyEnabled: false,
    weeklyWeekday: 1,
    weeklyHour: 9,
    isEmailConfigured: () => true,
    stateFile: file,
    now: () => dueInstant,
    log: () => undefined,
    error: () => undefined,
    sendWeekly: async () => ({ subject: 'w', recipients: [] }),
    sendMonthly: async () => {
      sendCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { subject: 'monthly', recipients: ['a@example.com'] };
    },
  });

  try {
    await Promise.all(Array.from({ length: 60 }, () => scheduler.tick()));
    assert.equal(sendCount, 1, `expected 1 monthly send, got ${sendCount}`);
    assert.equal(schedule.readScheduleState(file).lastMonthlyKey, '2026-11-01');
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.monthly.2026-11-01.lock`, { force: true });
  }
});

test('failed weekly send can retry once, then success blocks further sends', async () => {
  const file = tempStateFile();
  let attempts = 0;
  const dueInstant = new Date('2026-10-12T03:30:00.000Z');

  const scheduler = createReportScheduler({
    timezone: 'Asia/Kolkata',
    monthlyEnabled: false,
    monthlyDay: 1,
    monthlyHour: 9,
    weeklyEnabled: true,
    weeklyWeekday: 1,
    weeklyHour: 9,
    isEmailConfigured: () => true,
    stateFile: file,
    now: () => dueInstant,
    log: () => undefined,
    error: () => undefined,
    sendMonthly: async () => ({ subject: 'm', recipients: [] }),
    sendWeekly: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('SMTP down');
      return { subject: 'weekly', recipients: ['a@example.com'] };
    },
  });

  try {
    await scheduler.tick(); // fails, releases claim
    assert.equal(attempts, 1);
    await scheduler.tick(); // succeeds
    assert.equal(attempts, 2);
    await scheduler.tick(); // skipped
    await scheduler.tick();
    assert.equal(attempts, 2);
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.weekly.2026-10-12.lock`, { force: true });
  }
});

test('probeScheduleStateWritable accepts a writable directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-sched-probe-'));
  const file = path.join(dir, 'monthly-report-schedule.json');
  try {
    assert.equal(schedule.probeScheduleStateWritable(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureScheduleStatePath falls back when preferred path is not writable', () => {
  const previous = process.env.MONTHLY_REPORT_STATE_FILE;
  // /proc is never creatable as a nested dir for this purpose on Linux/macOS sandboxes.
  const blocked = path.join('/proc', `no-write-${Date.now()}`, 'monthly-report-schedule.json');
  process.env.MONTHLY_REPORT_STATE_FILE = blocked;
  schedule.resetScheduleStatePathCache();
  try {
    const info = schedule.ensureScheduleStatePath();
    assert.equal(info.preferredPath, blocked);
    assert.equal(info.fallbackUsed, true);
    assert.ok(!info.error, info.error || 'expected writable fallback');
    assert.notEqual(info.path, blocked);
    assert.equal(schedule.probeScheduleStateWritable(info.path), null);
  } finally {
    if (previous === undefined) delete process.env.MONTHLY_REPORT_STATE_FILE;
    else process.env.MONTHLY_REPORT_STATE_FILE = previous;
    schedule.resetScheduleStatePathCache();
  }
});
