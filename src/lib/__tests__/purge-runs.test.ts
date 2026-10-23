import { purgeRunLine, toPurgeRunStatus, type PurgeRunStatus } from '@/lib/purge-runs';

const status = (over: Partial<PurgeRunStatus> = {}): PurgeRunStatus => ({
  last_run_at: '2026-10-22T18:17:00Z',
  last_ok_at: '2026-10-22T18:17:00Z',
  failed_step: null,
  overdue: false,
  ...over,
});

describe('toPurgeRunStatus', () => {
  it('reads the rpc row', () => {
    expect(
      toPurgeRunStatus({ last_run_at: 'a', last_ok_at: 'b', failed_step: 'removing documents', overdue: true }),
    ).toEqual({ last_run_at: 'a', last_ok_at: 'b', failed_step: 'removing documents', overdue: true });
  });

  it('is null without a row (not an admin)', () => {
    expect(toPurgeRunStatus(null)).toBeNull();
    expect(toPurgeRunStatus(undefined)).toBeNull();
    expect(toPurgeRunStatus('row')).toBeNull();
  });

  it('treats anything but true as not overdue, and blanks as missing', () => {
    expect(toPurgeRunStatus({ overdue: 'true', last_run_at: '', failed_step: 3 })).toEqual({
      last_run_at: null,
      last_ok_at: null,
      failed_step: null,
      overdue: false,
    });
  });
});

describe('purgeRunLine', () => {
  it('is null without a status', () => {
    expect(purgeRunLine(null)).toBeNull();
  });

  it('says when it last ran', () => {
    const line = purgeRunLine(status());
    expect(line?.warning).toBe(false);
    expect(line?.text).toMatch(/^Last run .+\.$/);
  });

  it('says it hasn’t run yet', () => {
    expect(purgeRunLine(status({ last_run_at: null, last_ok_at: null }))).toEqual({
      text: 'The nightly removal hasn’t run yet.',
      warning: false,
    });
  });

  it('says where a failed run stopped, without warning before it is overdue', () => {
    const line = purgeRunLine(status({ last_run_at: '2026-10-23T18:17:00Z', failed_step: 'removing documents' }));
    expect(line?.warning).toBe(false);
    expect(line?.text).toMatch(/^The last run, .+, stopped while removing documents\. The next run carries on from there\.$/);
  });

  it('warns once overdue, since it last finished', () => {
    const line = purgeRunLine(status({ overdue: true }));
    expect(line?.warning).toBe(true);
    expect(line?.text).toMatch(/^Old records haven’t been removed since .+\. Ask FirstPass to check the nightly removal\.$/);
  });

  it('warns once overdue when it never finished', () => {
    expect(purgeRunLine(status({ overdue: true, last_ok_at: null, last_run_at: null }))).toEqual({
      text: 'Old records haven’t been removed yet. Ask FirstPass to check the nightly removal.',
      warning: true,
    });
  });

  it('warns with where the latest run stopped', () => {
    const line = purgeRunLine(status({ overdue: true, last_ok_at: null, failed_step: 'removing old records' }));
    expect(line?.text).toMatch(
      /^Old records haven’t been removed yet\. The last run, .+, stopped while removing old records\. Ask FirstPass/,
    );
  });

  it('ignores a failed step with no run time', () => {
    expect(purgeRunLine(status({ last_run_at: null, last_ok_at: null, failed_step: 'x' }))?.text).toBe(
      'The nightly removal hasn’t run yet.',
    );
  });
});
