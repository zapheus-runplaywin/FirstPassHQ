import { formatDateTime } from '@/lib/format';

/** When the nightly removal last ran, from `removal_run_status` (admins only). */
export type PurgeRunStatus = {
  last_run_at: string | null;
  last_ok_at: string | null;
  /** The step the latest run stopped at, such as "removing documents"; null when it finished. */
  failed_step: string | null;
  /** Remove old records is on and the removal hasn't finished for 2 days. */
  overdue: boolean;
};

/** Reads the rpc's row, or null when there is none (not an admin) or it's malformed. */
export function toPurgeRunStatus(row: unknown): PurgeRunStatus | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    last_run_at: text(r.last_run_at),
    last_ok_at: text(r.last_ok_at),
    failed_step: text(r.failed_step),
    overdue: r.overdue === true,
  };
}

/** The line under "Remove old records": when it last ran, and a warning when it needs looking at. */
export function purgeRunLine(status: PurgeRunStatus | null): { text: string; warning: boolean } | null {
  if (!status) return null;
  const when = (iso: string) => formatDateTime(new Date(iso));
  const stopped = status.failed_step && status.last_run_at
    ? `The last run, ${when(status.last_run_at)}, stopped while ${status.failed_step}.`
    : null;
  if (status.overdue) {
    const since = status.last_ok_at
      ? `Old records haven’t been removed since ${when(status.last_ok_at)}.`
      : 'Old records haven’t been removed yet.';
    return {
      text: [since, stopped, 'Ask FirstPass to check the nightly removal.'].filter(Boolean).join(' '),
      warning: true,
    };
  }
  if (stopped) return { text: `${stopped} The next run carries on from there.`, warning: false };
  if (status.last_ok_at) return { text: `Last run ${when(status.last_ok_at)}.`, warning: false };
  return { text: 'The nightly removal hasn’t run yet.', warning: false };
}
