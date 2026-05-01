import {
  purgeStaleDocuments,
  purgeOldActivityLogs,
  purgeStaleUsers,
  purgeExpiredHostSessions,
} from './database.js';

interface CleanupConfig {
  documentTtlDays: number;
  activityLogTtlDays: number;
  userTtlDays: number;
  intervalHours: number;
}

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`Invalid ${name}=${raw}, using default ${defaultValue}`);
    return defaultValue;
  }
  return n;
}

function readConfig(): CleanupConfig {
  return {
    documentTtlDays: readNumberEnv('DOCUMENT_TTL_DAYS', 30),
    activityLogTtlDays: readNumberEnv('ACTIVITY_LOG_TTL_DAYS', 90),
    userTtlDays: readNumberEnv('USER_TTL_DAYS', 90),
    intervalHours: readNumberEnv('CLEANUP_INTERVAL_HOURS', 24),
  };
}

async function runOnce(config: CleanupConfig): Promise<void> {
  const tasks: Array<[string, () => Promise<number>]> = [];

  if (config.documentTtlDays > 0) {
    tasks.push([
      `documents older than ${config.documentTtlDays}d`,
      () => purgeStaleDocuments(config.documentTtlDays),
    ]);
  }
  if (config.activityLogTtlDays > 0) {
    tasks.push([
      `activity_logs older than ${config.activityLogTtlDays}d`,
      () => purgeOldActivityLogs(config.activityLogTtlDays),
    ]);
  }
  if (config.userTtlDays > 0) {
    tasks.push([
      `users not seen in ${config.userTtlDays}d`,
      () => purgeStaleUsers(config.userTtlDays),
    ]);
  }
  // Always purge expired host sessions — the expiration is per-row, not
  // configurable here, so there's no TTL knob to gate this on.
  tasks.push(['expired host sessions', () => purgeExpiredHostSessions()]);

  for (const [label, fn] of tasks) {
    try {
      const deleted = await fn();
      if (deleted > 0) {
        console.log(`Cleanup: removed ${deleted} ${label}`);
      }
    } catch (error) {
      console.error(`Cleanup failed for ${label}:`, error);
    }
  }
}

// Start the periodic cleanup job. `isDbAvailable` is read fresh on each tick
// so the job picks up a database that came online after startup. Returns a
// stop function so tests / shutdown hooks can cancel the timer.
export function startCleanupJob(isDbAvailable: () => boolean): () => void {
  const config = readConfig();

  const allDisabled =
    config.documentTtlDays === 0 &&
    config.activityLogTtlDays === 0 &&
    config.userTtlDays === 0;

  if (allDisabled || config.intervalHours === 0) {
    console.log('Cleanup job disabled by configuration');
    return () => {};
  }

  console.log(
    `Cleanup job: every ${config.intervalHours}h ` +
      `(documents=${config.documentTtlDays}d, activity_logs=${config.activityLogTtlDays}d, users=${config.userTtlDays}d)`
  );

  const tick = () => {
    if (!isDbAvailable()) return;
    runOnce(config).catch((error) => {
      console.error('Cleanup tick failed:', error);
    });
  };

  // Don't run immediately on startup — give the DB connection a moment to
  // settle and avoid blocking the server's first connections.
  const startupDelay = setTimeout(tick, 30_000);
  const interval = setInterval(tick, config.intervalHours * 60 * 60 * 1000);

  return () => {
    clearTimeout(startupDelay);
    clearInterval(interval);
  };
}
