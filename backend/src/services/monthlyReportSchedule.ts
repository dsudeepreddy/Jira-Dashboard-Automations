import fs from 'node:fs';
import path from 'node:path';
import {
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  mondayScheduleKey,
  reportPeriodKey,
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

export type PersistedScheduleState = {
  lastMondayKey?: string;
  lastMonthlyKey?: string;
  lastWeeklyKey?: string;
  lastPeriodKey?: string;
  lastSentAt?: string;
  lastWeeklySentAt?: string;
  weeklyClaimKey?: string;
  weeklyClaimAt?: string;
  monthlyClaimKey?: string;
  monthlyClaimAt?: string;
};

/** How long a crash-left claim blocks retries (ms). Long enough to cover the due hour. */
export const CLAIM_TTL_MS = 55 * 60 * 1000;

/** Repo root from compiled `dist/services` (or `src/services` under ts-node). */
function repoRoot(): string {
  return path.resolve(__dirname, '../../..');
}

/**
 * Resolve schedule state path.
 * Relative MONTHLY_REPORT_STATE_FILE values are anchored to the repo root so
 * cwd (systemd WorkingDirectory, pm2, `node dist/server.js` from backend/) cannot
 * silently change the file and lose anti-spam claims.
 */
function defaultStatePath(): string {
  const configured = process.env.MONTHLY_REPORT_STATE_FILE?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(repoRoot(), configured);
  }
  // Optional container mount — only if that directory already exists.
  try {
    if (fs.existsSync('/app/data')) {
      return '/app/data/monthly-report-schedule.json';
    }
  } catch {
    // ignore
  }
  return path.join(repoRoot(), 'data', 'monthly-report-schedule.json');
}

export function getScheduleStatePath(): string {
  return defaultStatePath();
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
  const merged = { ...previous, ...state };
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function replaceScheduleState(state: PersistedScheduleState, filePath = defaultStatePath()): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

function lockPathFor(kind: 'weekly' | 'monthly', scheduleKey: string, filePath: string): string {
  return `${filePath}.${kind}.${scheduleKey}.lock`;
}

function isClaimFresh(claimAt: string | undefined, nowMs: number): boolean {
  if (!claimAt) return true; // treat missing timestamp as still blocking (safe against spam)
  const ts = Date.parse(claimAt);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts < CLAIM_TTL_MS;
}

export function shouldSkipAlreadySent(options: {
  scheduleKey: string;
  periodKey?: string;
  state: PersistedScheduleState;
  oncePerPeriod?: boolean;
  kind?: 'monthly' | 'weekly';
  nowMs?: number;
}): boolean {
  const kind = options.kind || 'monthly';
  const nowMs = options.nowMs ?? Date.now();

  if (kind === 'weekly') {
    if (options.state.lastWeeklyKey === options.scheduleKey) return true;
    if (
      options.state.weeklyClaimKey === options.scheduleKey
      && isClaimFresh(options.state.weeklyClaimAt, nowMs)
    ) {
      return true;
    }
    return false;
  }

  if (options.state.lastMonthlyKey === options.scheduleKey) return true;
  if (options.state.lastMondayKey === options.scheduleKey) return true;
  if (
    options.state.monthlyClaimKey === options.scheduleKey
    && isClaimFresh(options.state.monthlyClaimAt, nowMs)
  ) {
    return true;
  }
  if (
    options.oncePerPeriod
    && options.periodKey
    && options.state.lastPeriodKey === options.periodKey
  ) {
    return true;
  }
  return false;
}

function tryCreateExclusiveLock(lockPath: string): boolean {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, `${new Date().toISOString()}\n`, { flag: 'wx' });
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    if (code === 'EEXIST') return false;
    throw error;
  }
}

function removeLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

/**
 * Atomically claim a weekly send slot.
 * Returns false if already sent, already claimed, or another process holds the lock.
 */
export function tryClaimWeeklySend(
  scheduleKey: string,
  filePath = defaultStatePath(),
  nowMs = Date.now(),
): boolean {
  const state = readScheduleState(filePath);
  if (shouldSkipAlreadySent({ scheduleKey, state, kind: 'weekly', nowMs })) {
    return false;
  }

  // Stale claim from a crashed process — clear so we can reclaim once.
  if (state.weeklyClaimKey === scheduleKey && !isClaimFresh(state.weeklyClaimAt, nowMs)) {
    const cleared = { ...state };
    delete cleared.weeklyClaimKey;
    delete cleared.weeklyClaimAt;
    replaceScheduleState(cleared, filePath);
    removeLock(lockPathFor('weekly', scheduleKey, filePath));
  }

  const lockPath = lockPathFor('weekly', scheduleKey, filePath);
  if (!tryCreateExclusiveLock(lockPath)) {
    return false;
  }

  // Re-read after lock to close TOCTOU with another process.
  const latest = readScheduleState(filePath);
  if (shouldSkipAlreadySent({ scheduleKey, state: latest, kind: 'weekly', nowMs })) {
    removeLock(lockPath);
    return false;
  }

  writeScheduleState({
    weeklyClaimKey: scheduleKey,
    weeklyClaimAt: new Date(nowMs).toISOString(),
  }, filePath);
  return true;
}

export function completeWeeklySend(scheduleKey: string, filePath = defaultStatePath()): void {
  const state = readScheduleState(filePath);
  const next: PersistedScheduleState = {
    ...state,
    lastWeeklyKey: scheduleKey,
    lastWeeklySentAt: new Date().toISOString(),
  };
  delete next.weeklyClaimKey;
  delete next.weeklyClaimAt;
  replaceScheduleState(next, filePath);
  // Keep the exclusive lock file as an extra same-day fence (EEXIST on next claim).
}

export function releaseWeeklyClaim(scheduleKey: string, filePath = defaultStatePath()): void {
  const state = readScheduleState(filePath);
  if (state.lastWeeklyKey === scheduleKey) return;
  const next: PersistedScheduleState = { ...state };
  if (next.weeklyClaimKey === scheduleKey) {
    delete next.weeklyClaimKey;
    delete next.weeklyClaimAt;
  }
  replaceScheduleState(next, filePath);
  removeLock(lockPathFor('weekly', scheduleKey, filePath));
}

export function tryClaimMonthlySend(
  scheduleKey: string,
  periodKey: string,
  filePath = defaultStatePath(),
  nowMs = Date.now(),
): boolean {
  const state = readScheduleState(filePath);
  if (shouldSkipAlreadySent({
    scheduleKey,
    periodKey,
    state,
    oncePerPeriod: true,
    kind: 'monthly',
    nowMs,
  })) {
    return false;
  }

  if (state.monthlyClaimKey === scheduleKey && !isClaimFresh(state.monthlyClaimAt, nowMs)) {
    const cleared = { ...state };
    delete cleared.monthlyClaimKey;
    delete cleared.monthlyClaimAt;
    replaceScheduleState(cleared, filePath);
    removeLock(lockPathFor('monthly', scheduleKey, filePath));
  }

  const lockPath = lockPathFor('monthly', scheduleKey, filePath);
  if (!tryCreateExclusiveLock(lockPath)) {
    return false;
  }

  const latest = readScheduleState(filePath);
  if (shouldSkipAlreadySent({
    scheduleKey,
    periodKey,
    state: latest,
    oncePerPeriod: true,
    kind: 'monthly',
    nowMs,
  })) {
    removeLock(lockPath);
    return false;
  }

  writeScheduleState({
    monthlyClaimKey: scheduleKey,
    monthlyClaimAt: new Date(nowMs).toISOString(),
  }, filePath);
  return true;
}

export function completeMonthlySend(
  scheduleKey: string,
  periodKey: string,
  filePath = defaultStatePath(),
): void {
  const state = readScheduleState(filePath);
  const next: PersistedScheduleState = {
    ...state,
    lastMonthlyKey: scheduleKey,
    lastPeriodKey: periodKey,
    lastSentAt: new Date().toISOString(),
  };
  delete next.monthlyClaimKey;
  delete next.monthlyClaimAt;
  replaceScheduleState(next, filePath);
}

export function releaseMonthlyClaim(scheduleKey: string, filePath = defaultStatePath()): void {
  const state = readScheduleState(filePath);
  if (state.lastMonthlyKey === scheduleKey) return;
  const next: PersistedScheduleState = { ...state };
  if (next.monthlyClaimKey === scheduleKey) {
    delete next.monthlyClaimKey;
    delete next.monthlyClaimAt;
  }
  replaceScheduleState(next, filePath);
  removeLock(lockPathFor('monthly', scheduleKey, filePath));
}

/** @deprecated Prefer tryClaimWeeklySend */
export function claimWeeklySend(scheduleKey: string, filePath = defaultStatePath()): void {
  tryClaimWeeklySend(scheduleKey, filePath);
}

/** @deprecated Prefer tryClaimMonthlySend */
export function claimMonthlySend(scheduleKey: string, filePath = defaultStatePath()): void {
  tryClaimMonthlySend(scheduleKey, '', filePath);
}
