/**
 * @jest-environment node
 */
// The nightly purge deletes children's injury records and files, which can't
// be undone. These tests pin its order (files before records), that it stops
// at the first error, its batching and buckets, its secret check, and that
// every run records itself so admins can see when it last ran.

import {
  allowed,
  BATCH,
  handlePurge,
  runPurge,
  serviceKey,
  type Env,
  type PurgeClient,
} from '../purge';

type Err = { message: string; code?: string };

/** What each rpc returns; anything not listed returns { data: null, error: null }. */
type Script = {
  rpc?: Record<string, { data?: unknown; error?: Err | null }>;
  /** Fails the nth call (1-based) to remove() on a bucket. */
  removeError?: { bucket: string; call: number; error: Err };
};

function fakeClient(script: Script = {}) {
  const calls: string[] = [];
  const removed: { bucket: string; paths: string[] }[] = [];
  const counts: Record<string, number> = {};
  const args: Record<string, unknown>[] = [];
  const client: PurgeClient = {
    rpc: jest.fn(async (fn: string, given?: Record<string, unknown>) => {
      calls.push(`rpc:${fn}`);
      if (fn === 'record_purge_run') args.push(given ?? {});
      const r = script.rpc?.[fn];
      return { data: r?.data ?? null, error: r?.error ?? null };
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push(`remove:${bucket}`);
          removed.push({ bucket, paths });
          counts[bucket] = (counts[bucket] ?? 0) + 1;
          const e = script.removeError;
          if (e && e.bucket === bucket && e.call === counts[bucket]) return { error: e.error };
          return { error: null };
        },
      }),
    },
  };
  return { client, calls, removed, recorded: args };
}

function fakeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function env(values: Record<string, string>): Env {
  return { get: (name) => values[name] };
}

function paths(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}/${i}.pdf`);
}

const ALL_STEPS = [
  'rpc:expired_injury_documents',
  'rpc:purge_expired_injuries',
  'rpc:cleared_injury_documents',
  'rpc:mark_removed_injury_documents',
  'rpc:expired_certificate_documents',
  'rpc:expired_session_plan_files',
  'rpc:purge_expired_records',
  'rpc:purge_expired_surveys',
  'rpc:purge_expired_assessments',
];

/** A whole run: every step, then the run recording itself. */
const RUN = [...ALL_STEPS, 'rpc:record_purge_run'];

describe('handlePurge: method and secret', () => {
  function request(method: string, key?: string) {
    return new Request('https://example.test/functions/v1/purge-expired-injuries', {
      method,
      headers: key === undefined ? {} : { 'x-purge-key': key },
    });
  }

  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('refuses %s with 405 and never builds a client', async (method) => {
    const makeClient = jest.fn();
    const response = await handlePurge(request(method, 'secret'), {
      env: env({ PURGE_SECRET: 'secret' }),
      logger: fakeLogger(),
      makeClient,
    });
    expect(response.status).toBe(405);
    expect(await response.text()).toBe('Method not allowed');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'not-the-secret'],
    ['a prefix of it', 'secre'],
    ['longer than it', 'secret-and-more'],
    ['different case', 'SECRET'],
  ])('refuses a %s x-purge-key with 403 and never builds a client', async (_label, key) => {
    const makeClient = jest.fn();
    const response = await handlePurge(request('POST', key), {
      env: env({ PURGE_SECRET: 'secret' }),
      logger: fakeLogger(),
      makeClient,
    });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden');
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('runs the purge with the right x-purge-key, without the unset-secret warning', async () => {
    const { client, calls } = fakeClient();
    const logger = fakeLogger();
    const response = await handlePurge(request('POST', 'secret'), {
      env: env({ PURGE_SECRET: 'secret' }),
      logger,
      makeClient: () => client,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toEqual(RUN);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('runs the purge when PURGE_SECRET is not set, and warns', async () => {
    const { client, calls } = fakeClient();
    const logger = fakeLogger();
    const response = await handlePurge(request('POST'), { env: env({}), logger, makeClient: () => client });
    expect(response.status).toBe(200);
    expect(calls).toEqual(RUN);
    expect(logger.warn).toHaveBeenCalledWith(
      'PURGE_SECRET is not set, so anyone can run the purge. Set it with supabase secrets set.',
    );
  });

  it('fails without running anything when no service key is available', async () => {
    const { client, calls } = fakeClient();
    const e = env({});
    await expect(
      handlePurge(request('POST'), {
        env: e,
        logger: fakeLogger(),
        makeClient: () => {
          serviceKey(e);
          return client;
        },
      }),
    ).rejects.toThrow('No service key available to the function');
    expect(calls).toEqual([]);
  });
});

describe('allowed: constant-time secret compare', () => {
  const withKey = (key: string) =>
    new Request('https://example.test', { method: 'POST', headers: { 'x-purge-key': key } });

  it('accepts only the exact secret, whatever the lengths', () => {
    const logger = fakeLogger();
    const e = env({ PURGE_SECRET: 's3cr3t-value' });
    expect(allowed(withKey('s3cr3t-value'), e, logger)).toBe(true);
    expect(allowed(withKey('s3cr3t-valu'), e, logger)).toBe(false);
    expect(allowed(withKey('s3cr3t-value!'), e, logger)).toBe(false);
    expect(allowed(withKey('x'), e, logger)).toBe(false);
    expect(allowed(withKey('s3cr3t-valuE'), e, logger)).toBe(false);
    expect(allowed(withKey('s3cr3t-value'.repeat(10)), e, logger)).toBe(false);
  });

  it('does not accept a key that only matches after padding with zero bytes', () => {
    // Bytes past the shorter one compare as 0, so the length check is what
    // refuses a key that is the secret without its trailing NUL.
    const e = env({ PURGE_SECRET: 'abc\u0000' });
    expect(allowed(withKey('abc'), e, fakeLogger())).toBe(false);
  });

  it('compares multi-byte secrets by their UTF-8 bytes', () => {
    const e = env({ PURGE_SECRET: 'clé-über' });
    expect(allowed(withKey('clé-über'), e, fakeLogger())).toBe(true);
    expect(allowed(withKey('cle-uber'), e, fakeLogger())).toBe(false);
  });
});

describe('serviceKey', () => {
  it('prefers the default secret key, then falls back to the legacy service role key', () => {
    expect(
      serviceKey(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_1"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy' })),
    ).toBe('sb_secret_1');
    expect(serviceKey(env({ SUPABASE_SECRET_KEYS: '{"other":"x"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe(
      'legacy',
    );
    expect(serviceKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' }))).toBe('legacy');
    expect(() => serviceKey(env({}))).toThrow('No service key available to the function');
  });
});

describe('runPurge: order', () => {
  it('removes every kind of file before the records it belongs to', async () => {
    const { client, calls } = fakeClient({
      rpc: {
        expired_injury_documents: { data: ['a/1.pdf'] },
        cleared_injury_documents: { data: ['b/1.pdf'] },
        expired_certificate_documents: { data: ['c/1.pdf'] },
        expired_session_plan_files: { data: ['d/1.pdf'] },
      },
    });
    const response = await runPurge(client, fakeLogger());
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      'rpc:expired_injury_documents',
      'remove:injury-documents',
      'rpc:purge_expired_injuries',
      'rpc:cleared_injury_documents',
      'remove:injury-documents',
      'rpc:mark_removed_injury_documents',
      'rpc:expired_certificate_documents',
      'remove:training-certificates',
      'rpc:expired_session_plan_files',
      'remove:session-plans',
      'rpc:purge_expired_records',
      'rpc:purge_expired_surveys',
      'rpc:purge_expired_assessments',
      'rpc:record_purge_run',
    ]);
  });

  it('sends each list to its own bucket', async () => {
    const { client, removed } = fakeClient({
      rpc: {
        expired_injury_documents: { data: ['injury/expired.pdf'] },
        cleared_injury_documents: { data: ['injury/cleared.pdf'] },
        expired_certificate_documents: { data: ['cert/old.pdf'] },
        expired_session_plan_files: { data: ['plan/old.pdf'] },
      },
    });
    await runPurge(client, fakeLogger());
    expect(removed).toEqual([
      { bucket: 'injury-documents', paths: ['injury/expired.pdf'] },
      { bucket: 'injury-documents', paths: ['injury/cleared.pdf'] },
      { bucket: 'training-certificates', paths: ['cert/old.pdf'] },
      { bucket: 'session-plans', paths: ['plan/old.pdf'] },
    ]);
  });

  it('makes no storage calls when nothing has expired (null or empty lists)', async () => {
    const { client, calls } = fakeClient({
      rpc: { expired_injury_documents: { data: [] }, cleared_injury_documents: { data: null } },
    });
    const response = await runPurge(client, fakeLogger());
    expect(response.status).toBe(200);
    expect(calls).toEqual(RUN);
  });
});

describe('runPurge: batching', () => {
  it('uses batches of 500', () => {
    expect(BATCH).toBe(500);
  });

  it.each([
    ['injury-documents', 'expired_injury_documents'],
    ['injury-documents', 'cleared_injury_documents'],
    ['training-certificates', 'expired_certificate_documents'],
    ['session-plans', 'expired_session_plan_files'],
  ])('removes 1,201 files from %s (listed by %s) in 3 calls, in order, each file once', async (bucket, list) => {
    const files = paths(list, 1201);
    const { client, removed } = fakeClient({ rpc: { [list]: { data: files } } });
    await runPurge(client, fakeLogger());
    const batches = removed.filter((r) => r.bucket === bucket);
    expect(batches.map((b) => b.paths.length)).toEqual([500, 500, 201]);
    expect(batches.flatMap((b) => b.paths)).toEqual(files);
  });

  it('uses exactly one call for 500 files and two for 501', async () => {
    const a = fakeClient({ rpc: { expired_injury_documents: { data: paths('x', 500) } } });
    await runPurge(a.client, fakeLogger());
    expect(a.removed.map((r) => r.paths.length)).toEqual([500]);

    const b = fakeClient({ rpc: { expired_injury_documents: { data: paths('x', 501) } } });
    await runPurge(b.client, fakeLogger());
    expect(b.removed.map((r) => r.paths.length)).toEqual([500, 1]);
  });
});

describe('runPurge: stops at the first error', () => {
  /** The calls before the failed run recorded itself, which is always last. */
  async function failsAt(script: Script, step: string, detail: string) {
    const { client, calls, recorded } = fakeClient(script);
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(500);
    // The caller learns only the step; the detail goes to the logs.
    expect(await response.json()).toEqual({ error: `Failed while ${step}` });
    expect(logger.error).toHaveBeenCalledWith(`Purge failed while ${step}: ${detail}`);
    expect(logger.log).not.toHaveBeenCalled();
    // The failed run is recorded with the step it stopped at, never the detail.
    expect(calls[calls.length - 1]).toBe('rpc:record_purge_run');
    expect(recorded).toEqual([{ p_ok: false, p_failed_step: step, p_counts: null }]);
    return calls.slice(0, -1);
  }

  const rpcSteps: [string, string][] = [
    ['expired_injury_documents', 'listing expired documents'],
    ['purge_expired_injuries', 'purging injuries'],
    ['cleared_injury_documents', 'listing cleared injury documents'],
    ['mark_removed_injury_documents', 'marking removed injury documents'],
    ['expired_certificate_documents', 'listing expired certificates'],
    ['expired_session_plan_files', 'listing expired session plan files'],
    ['purge_expired_records', 'removing old records'],
    ['purge_expired_surveys', 'removing old surveys'],
    ['purge_expired_assessments', 'removing old selection assessments'],
  ];

  it.each(rpcSteps)('an error from %s stops the run (%s)', async (fn, step) => {
    const calls = await failsAt({ rpc: { [fn]: { error: { message: 'boom 42', code: 'XX000' } } } }, step, 'boom 42');
    const at = ALL_STEPS.indexOf(`rpc:${fn}`);
    expect(calls).toEqual(ALL_STEPS.slice(0, at + 1));
  });

  it('never purges injury records after a failed document removal', async () => {
    const calls = await failsAt(
      {
        rpc: { expired_injury_documents: { data: paths('a', 2) } },
        removeError: { bucket: 'injury-documents', call: 1, error: { message: 'storage down' } },
      },
      'removing documents',
      'storage down',
    );
    expect(calls).toEqual(['rpc:expired_injury_documents', 'remove:injury-documents']);
    expect(calls).not.toContain('rpc:purge_expired_injuries');
  });

  it('stops at a failed later batch, without trying the rest or purging records', async () => {
    const calls = await failsAt(
      {
        rpc: { expired_injury_documents: { data: paths('a', 1201) } },
        removeError: { bucket: 'injury-documents', call: 2, error: { message: 'timeout' } },
      },
      'removing documents',
      'timeout',
    );
    expect(calls).toEqual([
      'rpc:expired_injury_documents',
      'remove:injury-documents',
      'remove:injury-documents',
    ]);
  });

  it('does not mark cleared documents removed after a failed removal', async () => {
    const calls = await failsAt(
      {
        rpc: { cleared_injury_documents: { data: ['b/1.pdf'] } },
        removeError: { bucket: 'injury-documents', call: 1, error: { message: 'nope' } },
      },
      'removing cleared injury documents',
      'nope',
    );
    expect(calls.at(-1)).toBe('remove:injury-documents');
    expect(calls).not.toContain('rpc:mark_removed_injury_documents');
  });

  it('does not remove old records after a failed certificate removal', async () => {
    const calls = await failsAt(
      {
        rpc: { expired_certificate_documents: { data: ['c/1.pdf'] } },
        removeError: { bucket: 'training-certificates', call: 1, error: { message: 'nope' } },
      },
      'removing certificates',
      'nope',
    );
    expect(calls.at(-1)).toBe('remove:training-certificates');
    expect(calls).not.toContain('rpc:purge_expired_records');
  });

  it('does not remove old records after a failed session plan removal', async () => {
    const calls = await failsAt(
      {
        rpc: { expired_session_plan_files: { data: ['d/1.pdf'] } },
        removeError: { bucket: 'session-plans', call: 1, error: { message: 'nope' } },
      },
      'removing session plan files',
      'nope',
    );
    expect(calls.at(-1)).toBe('remove:session-plans');
    expect(calls).not.toContain('rpc:purge_expired_records');
  });
});

describe('runPurge: projects without session plans yet', () => {
  it('carries on when expired_session_plan_files does not exist (PGRST202)', async () => {
    const { client, calls } = fakeClient({
      rpc: {
        expired_session_plan_files: { error: { message: 'Could not find the function', code: 'PGRST202' } },
      },
    });
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(200);
    expect(calls).toEqual(RUN);
    expect(calls).not.toContain('remove:session-plans');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([['PGRST203'], ['42883'], [undefined]])('stops on any other error code (%s)', async (code) => {
    const { client, calls } = fakeClient({
      rpc: { expired_session_plan_files: { error: { message: 'other', code } } },
    });
    const response = await runPurge(client, fakeLogger());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed while listing expired session plan files' });
    expect(calls).not.toContain('rpc:purge_expired_records');
  });

  it('carries on when purge_expired_assessments does not exist yet (PGRST202), recording nothing for it', async () => {
    const { client, calls, recorded } = fakeClient({
      rpc: {
        purge_expired_assessments: { error: { message: 'Could not find the function', code: 'PGRST202' } },
      },
    });
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(200);
    expect(calls).toEqual(RUN);
    expect(recorded[0]).toMatchObject({ p_ok: true, p_counts: { assessments: null } });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([['PGRST203'], ['42883'], [undefined]])(
    'stops on any other error from purge_expired_assessments (%s)',
    async (code) => {
      const { client, recorded } = fakeClient({
        rpc: { purge_expired_assessments: { error: { message: 'other', code } } },
      });
      const response = await runPurge(client, fakeLogger());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Failed while removing old selection assessments' });
      expect(recorded).toEqual([
        { p_ok: false, p_failed_step: 'removing old selection assessments', p_counts: null },
      ]);
    },
  );

  it('PGRST202 is tolerated only for functions newer than the job, not for other lists', async () => {
    const { client, calls } = fakeClient({
      rpc: { expired_injury_documents: { error: { message: 'missing', code: 'PGRST202' } } },
    });
    const response = await runPurge(client, fakeLogger());
    expect(response.status).toBe(500);
    expect(calls).toEqual(['rpc:expired_injury_documents', 'rpc:record_purge_run']);
  });
});

describe('runPurge: success', () => {
  it('returns only { ok: true } and logs counts, never names or paths', async () => {
    const injuryPaths = ['club/athlete-jane-citizen/xray.pdf', 'club/athlete-sam-sample/scan.pdf'];
    const { client } = fakeClient({
      rpc: {
        expired_injury_documents: { data: injuryPaths },
        purge_expired_injuries: { data: 3 },
        cleared_injury_documents: { data: ['club/athlete-jane-citizen/letter.pdf'] },
        mark_removed_injury_documents: { data: 1 },
        expired_certificate_documents: { data: paths('club/coach-alex-example', 4) },
        expired_session_plan_files: { data: paths('club/plan', 2) },
        purge_expired_records: { data: { attendance: 7 } },
        purge_expired_surveys: { data: 0 },
        purge_expired_assessments: { data: { enabled: true, selection_rounds: 2 } },
      },
    });
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(logger.log.mock.calls).toEqual([
      ['Purged 2 document(s) and 3 injury record(s)'],
      ['Removed 1 cleared injury file(s); marked 1 document(s)'],
      ['Removed 4 certificate file(s) and 2 session plan file(s); old records: {"attendance":7}; old surveys: 0; old selection rounds: {"enabled":true,"selection_rounds":2}'],
    ]);
    const logged = JSON.stringify([logger.log.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).not.toMatch(/jane|sam|alex|athlete|coach|\.pdf|club\//i);
  });
});

describe('runPurge: recording the run', () => {
  it('records a finished run with what it removed', async () => {
    const { client, recorded } = fakeClient({
      rpc: {
        expired_injury_documents: { data: paths('a', 3) },
        purge_expired_injuries: { data: 2 },
        cleared_injury_documents: { data: paths('b', 1) },
        mark_removed_injury_documents: { data: 1 },
        expired_certificate_documents: { data: paths('c', 4) },
        expired_session_plan_files: { data: paths('d', 5) },
        purge_expired_records: { data: { check_ins: 7 } },
        purge_expired_surveys: { data: { surveys: 1 } },
        purge_expired_assessments: { data: { enabled: true, selection_rounds: 3 } },
      },
    });
    const response = await runPurge(client, fakeLogger());
    expect(response.status).toBe(200);
    expect(recorded).toEqual([
      {
        p_ok: true,
        p_failed_step: null,
        p_counts: {
          documents: 3,
          injuries: 2,
          cleared_injury_files: 1,
          marked_documents: 1,
          certificates: 4,
          session_plan_files: 5,
          records: { check_ins: 7 },
          surveys: { surveys: 1 },
          assessments: { enabled: true, selection_rounds: 3 },
        },
      },
    ]);
  });

  it('records a finished run that removed nothing', async () => {
    const { client, recorded } = fakeClient();
    await runPurge(client, fakeLogger());
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ p_ok: true, p_failed_step: null });
    expect(recorded[0].p_counts).toMatchObject({ documents: 0, certificates: 0, session_plan_files: 0 });
  });

  it('fails a finished run it could not record, so the workflow shows it', async () => {
    const { client, calls } = fakeClient({ rpc: { record_purge_run: { error: { message: 'no table' } } } });
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed while recording the run' });
    expect(logger.error).toHaveBeenCalledWith("Couldn't record the purge run: no table");
    expect(calls).toEqual(RUN);
  });

  it('still reports the first error when a failed run could not be recorded either', async () => {
    const { client, calls } = fakeClient({
      rpc: {
        purge_expired_records: { error: { message: 'boom' } },
        record_purge_run: { error: { message: 'database down' } },
      },
    });
    const logger = fakeLogger();
    const response = await runPurge(client, logger);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed while removing old records' });
    expect(logger.error).toHaveBeenCalledWith('Purge failed while removing old records: boom');
    expect(logger.error).toHaveBeenCalledWith("Couldn't record the purge run: database down");
    expect(calls[calls.length - 1]).toBe('rpc:record_purge_run');
    expect(calls).not.toContain('rpc:purge_expired_surveys');
  });

  it('records a run only once', async () => {
    const ok = fakeClient();
    await runPurge(ok.client, fakeLogger());
    expect(ok.calls.filter((c) => c === 'rpc:record_purge_run')).toHaveLength(1);
    const bad = fakeClient({ rpc: { purge_expired_injuries: { error: { message: 'x' } } } });
    await runPurge(bad.client, fakeLogger());
    expect(bad.calls.filter((c) => c === 'rpc:record_purge_run')).toHaveLength(1);
  });
});
