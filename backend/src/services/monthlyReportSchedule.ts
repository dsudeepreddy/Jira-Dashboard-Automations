import fs from 'node:fs';
import os from 'node:os';
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

export type ScheduleStatePathInfo = {
  path: string;
  source: 'env' | 'app-data' | 'repo-data' | 'home' | 'tmpdir';
  fallbackUsed: boolean;
  preferredPath: string;
  error?: string;
};

let cachedStatePathInfo: ScheduleStatePathInfo | null = null;

/**
 * Strip quotes/BOM that often sneak into container -e / .env values.
 * (MONTHLY_REPORT_STATE_FILE is read from process.env, not zod-cleaned env.)
 */
function cleanPathEnv(value: string | undefined): string {
  if (!value) return '';
  let text = value.trim();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1).trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

/**
 * Backend package root (`/app` in container, `.../backend` locally).
 * From compiled `dist/services` that is two levels up — NOT three
 * (three levels from `/app/dist/services` wrongly becomes `/`).
 */
function packageRoot(): string {
  return path.resolve(__dirname, '../..');
}

/**
 * Directory used to resolve relative MONTHLY_REPORT_STATE_FILE values.
 * - Container (`/app`): package root
 * - Local monorepo: repo root (parent of `backend/`) when present
 */
function statePathBase(): string {
  const pkg = packageRoot();
  if (pkg === '/app') return pkg;
  // Never treat filesystem root as a base (broken 3-level resolve used to do this).
  if (pkg === path.parse(pkg).root) return '/app';

  const parent = path.resolve(pkg, '..');
  try {
    if (
      fs.existsSync(path.join(parent, 'backend', 'package.json'))
      && fs.existsSync(path.join(parent, 'package.json'))
    ) {
      return parent;
    }
  } catch {
    // ignore
  }
  return pkg;
}

function resolveConfiguredPath(configured: string): string {
  const cleaned = cleanPathEnv(configured);
  if (!cleaned) {
    return path.join(statePathBase(), 'data', 'monthly-report-schedule.json');
  }
  if (path.isAbsolute(cleaned)) return cleaned;
  return path.resolve(statePathBase(), cleaned);
}

function preferredStatePath(): string {
  const configured = cleanPathEnv(process.env.MONTHLY_REPORT_STATE_FILE);
  if (configured) return resolveConfiguredPath(configured);
  // Container image: WORKDIR /app with dist/ + /app/data (see backend/Dockerfile).
  try {
    if (
      fs.existsSync('/app/data')
      || (fs.existsSync('/app/dist') && fs.existsSync('/app/package.json'))
    ) {
      return '/app/data/monthly-report-schedule.json';
    }
  } catch {
    // ignore
  }
  return path.join(statePathBase(), 'data', 'monthly-report-schedule.json');
}

function candidateStatePaths(): Array<{ path: string; source: ScheduleStatePathInfo['source'] }> {
  const preferred = preferredStatePath();
  const configured = cleanPathEnv(process.env.MONTHLY_REPORT_STATE_FILE);
  const out: Array<{ path: string; source: ScheduleStatePathInfo['source'] }> = [];
  const push = (filePath: string, source: ScheduleStatePathInfo['source']) => {
    // Never attempt mkdir on filesystem root or quote-corrupted paths.
    if (!filePath || filePath === '/' || filePath.includes("'") || filePath.includes('"')) {
      return;
    }
    if (!out.some((item) => item.path === filePath)) {
      out.push({ path: filePath, source });
    }
  };

  if (configured) {
    push(resolveConfiguredPath(configured), 'env');
  }
  push('/app/data/monthly-report-schedule.json', 'app-data');
  push(path.join(statePathBase(), 'data', 'monthly-report-schedule.json'), 'repo-data');

  try {
    const home = os.homedir();
    if (home && home !== '/') {
      push(
        path.join(home, '.local', 'share', 'jira-dashboard', 'monthly-report-schedule.json'),
        'home',
      );
    }
  } catch {
    // ignore
  }

  push(
    path.join(os.tmpdir(), 'jira-dashboard', 'monthly-report-schedule.json'),
    'tmpdir',
  );

  const preferredIdx = out.findIndex((item) => item.path === preferred);
  if (preferredIdx > 0) {
    const [item] = out.splice(preferredIdx, 1);
    out.unshift(item);
  } else if (preferredIdx < 0 && preferred) {
    push(preferred, configured ? 'env' : 'repo-data');
    const again = out.findIndex((item) => item.path === preferred);
    if (again > 0) {
      const [item] = out.splice(again, 1);
      out.unshift(item);
    }
  }
  return out;
}

/**
 * Probe create/write/rename in the target directory.
 * Returns an error message when the process cannot persist schedule claims there.
 */
export function probeScheduleStateWritable(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const probe = path.join(
    dir,
    `.schedule-write-probe.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok\n', { flag: 'w' });
    fs.renameSync(probe, `${probe}.renamed`);
    fs.unlinkSync(`${probe}.renamed`);
    return null;
  } catch (error) {
    try {
      fs.unlinkSync(probe);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(`${probe}.renamed`);
    } catch {
      // ignore
    }
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    const message = error instanceof Error ? error.message : String(error);
    return code ? `${code}: ${message}` : message;
  }
}

/**
 * Pick a writable schedule state path (env → repo/app data → $HOME → tmp).
 * Cached for process lifetime. Call resetScheduleStatePathCache() in tests.
 */
export function ensureScheduleStatePath(): ScheduleStatePathInfo {
  if (cachedStatePathInfo) return cachedStatePathInfo;

  const preferred = preferredStatePath();
  const failures: string[] = [];

  for (const candidate of candidateStatePaths()) {
    const err = probeScheduleStateWritable(candidate.path);
    if (!err) {
      cachedStatePathInfo = {
        path: candidate.path,
        source: candidate.source,
        fallbackUsed: candidate.path !== preferred,
        preferredPath: preferred,
      };
      return cachedStatePathInfo;
    }
    failures.push(`${candidate.path} (${err})`);
  }

  const detail = failures.join('; ');
  cachedStatePathInfo = {
    path: preferred,
    source: cleanPathEnv(process.env.MONTHLY_REPORT_STATE_FILE) ? 'env' : 'repo-data',
    fallbackUsed: false,
    preferredPath: preferred,
    error: detail,
  };
  return cachedStatePathInfo;
}

export function resetScheduleStatePathCache(): void {
  cachedStatePathInfo = null;
}

function defaultStatePath(): string {
  return ensureScheduleStatePath().path;
}

export function getScheduleStatePath(): string {
  return defaultStatePath();
}

export function getScheduleStatePathInfo(): ScheduleStatePathInfo {
  return ensureScheduleStatePath();
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

function writeJsonAtomic(filePath: string, payload: PersistedScheduleState): void {
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot write report schedule state at ${filePath}`
      + (code ? ` (${code})` : '')
      + `: ${message}. Set MONTHLY_REPORT_STATE_FILE to a directory writable by the backend process `
      + `(example: /var/lib/jira-dashboard/monthly-report-schedule.json or ~/.local/share/jira-dashboard/...).`,
    );
  }
}

export function writeScheduleState(state: PersistedScheduleState, filePath = defaultStatePath()): void {
  const previous = readScheduleState(filePath);
  writeJsonAtomic(filePath, { ...previous, ...state });
}

export function replaceScheduleState(state: PersistedScheduleState, filePath = defaultStatePath()): void {
  writeJsonAtomic(filePath, state);
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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot create schedule lock at ${lockPath}`
      + (code ? ` (${code})` : '')
      + `: ${message}. Fix directory permissions or set MONTHLY_REPORT_STATE_FILE to a writable path.`,
    );
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
