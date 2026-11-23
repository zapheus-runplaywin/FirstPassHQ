/**
 * The app's own log on the device (src/lib/log.ts). It must never hold
 * anything about a person or a secret: keys that look like names, emails,
 * dates of birth, notes, health or tokens are redacted, while ids and counts
 * are kept. Lines are written in batches (errors at once), and the files
 * rotate at 20 MB, keeping at most 10.
 */
import { AppState } from 'react-native';

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  class MockFile {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    create() {
      files.set(this.uri, '');
    }
    writeSync(text: string, options?: { append?: boolean }) {
      if (MockFile.failWrites) throw new Error('disk full');
      files.set(this.uri, (options?.append ? (files.get(this.uri) ?? '') : '') + text);
    }
    textSync() {
      return files.get(this.uri) ?? '';
    }
    delete() {
      files.delete(this.uri);
    }
    moveSync(to: MockFile) {
      files.set(to.uri, files.get(this.uri) ?? '');
      files.delete(this.uri);
    }
    static failWrites = false;
  }
  class MockDirectory {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}/${name}`;
    }
    create() {}
  }
  return { File: MockFile, Directory: MockDirectory, Paths: { document: { uri: 'doc:' }, cache: { uri: 'cache:' } }, __files: files };
});

type Log = typeof import('@/lib/log');
const fsMock = () =>
  jest.requireMock('expo-file-system') as { __files: Map<string, string>; File: { failWrites: boolean } };
const LOG = 'doc:/logs/app.log';

let log: Log;
let consoleLog: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;
let consoleError: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') });
  fsMock().__files.clear();
  fsMock().File.failWrites = false;
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  // A fresh module each time: the log keeps its file size and batch in memory.
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    log = require('@/lib/log');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const written = () => fsMock().__files.get(LOG) ?? '';

describe('what a line holds', () => {
  it('stamps the time, level and scope', () => {
    log.logger('fixtures').info('Loaded games', { count: 3 });
    log.flushLog();
    expect(written()).toBe('2026-10-18T02:00:00.000Z INFO  [fixtures] Loaded games {"count":3}\n');
  });

  it('redacts anything personal or secret, keeping ids and counts', () => {
    log.logger('auth').info('Signed in', {
      user_id: 'u1',
      athleteId: 'a1',
      member_count: 2,
      full_name: 'Sample Child',
      email: 'child@example.test',
      date_of_birth: '2011-03-02',
      dob: '2011',
      phone: '0400',
      address: '1 Sample St',
      note: 'Felt sick',
      medical: 'asthma',
      access_token: 'abc',
      password: 'pw',
      Authorization: 'Bearer x',
      grade_name: 'Division 1',
      competition: 'Winter',
      nested: { guardian_email: 'p@example.test', team_id: 't1' },
      list: [{ name: 'Someone' }],
    });
    log.flushLog();
    const data = JSON.parse(written().split(' Signed in ')[1]);
    expect(data).toEqual({
      user_id: 'u1',
      athleteId: 'a1',
      member_count: 2,
      full_name: '[redacted]',
      email: '[redacted]',
      date_of_birth: '[redacted]',
      dob: '[redacted]',
      phone: '[redacted]',
      address: '[redacted]',
      note: '[redacted]',
      medical: '[redacted]',
      access_token: '[redacted]',
      password: '[redacted]',
      Authorization: '[redacted]',
      grade_name: 'Division 1',
      competition: 'Winter',
      nested: { guardian_email: '[redacted]', team_id: 't1' },
      list: [{ name: '[redacted]' }],
    });
    expect(written()).not.toMatch(/Sample Child|child@example|2011-03-02|Felt sick|Bearer/);
  });

  it('writes an error as its name and message only', () => {
    log.logger('x').warn('Failed', { error: new TypeError('bad thing') });
    log.flushLog();
    expect(written()).toContain('{"error":{"error":"TypeError","message":"bad thing"}}');
  });

  it('cuts off deep nesting and long lists', () => {
    log.logger('x').info('Deep', { a: { b: { c: { d: { e: { f: 1 } } } } }, many: Array.from({ length: 30 }, (_, i) => i) });
    log.flushLog();
    const data = JSON.parse(written().split(' Deep ')[1]);
    expect(data.a.b.c.d.e).toBe('[…]');
    expect(data.many).toHaveLength(20);
  });

  it('notes data it can’t write out', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    log.logger('x').info('Loop', { loop: [loop, loop, loop] as unknown });
    log.logger('x').info('Big', { n: BigInt(1) as unknown });
    log.flushLog();
    expect(written()).toContain('[x] Big [unserialisable data]');
  });
});

describe('when lines are written', () => {
  it('batches lines for a second, in order', () => {
    const l = log.logger('x');
    l.info('one');
    l.debug('two');
    expect(written()).toBe('');
    jest.advanceTimersByTime(1000);
    const lines = written().trim().split('\n');
    expect(lines.map((line) => line.split('] ')[1])).toEqual(['one', 'two']);
    expect(lines[1]).toContain('DEBUG [x]');
  });

  it('writes an error at once, with what was waiting', () => {
    const l = log.logger('x');
    l.info('before');
    l.error('Broke', { count: 1 });
    expect(written().trim().split('\n')).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('ERROR [x] Broke'));
  });

  it('also prints to the console in development', () => {
    log.logger('x').debug('hello');
    log.logger('x').warn('careful');
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('DEBUG [x] hello'));
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('WARN  [x] careful'));
  });

  it('a full disk only warns, and the app carries on', () => {
    fsMock().File.failWrites = true;
    expect(() => log.logger('x').error('Broke')).not.toThrow();
    expect(consoleWarn).toHaveBeenCalledWith('Couldn’t write the app log', expect.any(Error));
    fsMock().File.failWrites = false;
    log.logger('x').error('Again');
    expect(written()).toContain('Again');
  });

  it('flushing with nothing waiting writes nothing', () => {
    log.flushLog();
    expect(fsMock().__files.size).toBe(0);
  });
});

describe('rotation', () => {
  it('moves a full app.log to app.1.log, and so on, dropping the tenth', () => {
    const files = fsMock().__files;
    const big = 'x'.repeat(20 * 1024 * 1024 - 10);
    files.set(LOG, big);
    for (let i = 1; i <= 9; i++) files.set(`doc:/logs/app.${i}.log`, `old ${i}`);
    log.logger('x').error('Overflow');
    expect(files.get('doc:/logs/app.1.log')).toBe(big);
    expect(files.get('doc:/logs/app.2.log')).toBe('old 1');
    expect(files.get('doc:/logs/app.9.log')).toBe('old 8');
    expect([...files.values()]).not.toContain('old 9');
    expect(files.get(LOG)).toContain('Overflow');
    expect(files.size).toBe(10);
  });

  it('doesn’t rotate a file with room left', () => {
    fsMock().__files.set(LOG, 'start\n');
    log.logger('x').error('More');
    expect(fsMock().__files.has('doc:/logs/app.1.log')).toBe(false);
    expect(written()).toMatch(/^start\n.*More\n$/s);
  });

  it('lists the log files newest first, after writing what was waiting', () => {
    const files = fsMock().__files;
    files.set('doc:/logs/app.2.log', 'b');
    log.logger('x').info('waiting');
    const listed = log.logFiles().map((f) => f.uri);
    expect(listed).toEqual(['doc:/logs/app.log', 'doc:/logs/app.2.log']);
    expect(written()).toContain('waiting');
  });
});

describe('starting the app log', () => {
  type Handler = (error: unknown, isFatal?: boolean) => void;
  let previous: jest.Mock;
  let installed: Handler | null;

  beforeEach(() => {
    previous = jest.fn();
    installed = null;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: Handler) => {
        installed = h;
      },
    };
  });

  it('logs the start once, without personal details', () => {
    const listen = jest.spyOn(AppState, 'addEventListener');
    log.startAppLog({ version: '1.2.3', email: 'me@example.test' });
    log.startAppLog({ version: 'again' });
    log.flushLog();
    expect(written().match(/App started/g)).toHaveLength(1);
    expect(written()).toContain('"version":"1.2.3"');
    expect(written()).toContain('"email":"[redacted]"');
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('writes the log when the app goes to the background', () => {
    const listen = jest.spyOn(AppState, 'addEventListener');
    log.startAppLog({});
    // This test's copy of the module registers last.
    const onChange = listen.mock.calls[listen.mock.calls.length - 1][1] as (state: string) => void;
    log.logger('x').info('queued');
    onChange('active');
    expect(written()).not.toContain('queued');
    onChange('background');
    expect(written()).toContain('queued');
  });

  it('logs a crash at once, then passes it on', () => {
    log.startAppLog({});
    const crash = new Error('boom');
    installed!(crash, true);
    expect(written()).toContain('ERROR [app] Crash {"error":{"error":"Error","message":"boom"},"stack":"Error: boom');
    expect(previous).toHaveBeenCalledWith(crash, true);
    installed!('just text', false);
    expect(written()).toContain('[app] Uncaught error {"error":"just text","stack":null}');
  });
});

describe('the log "Send app log" shares', () => {
  const SHARED = 'cache:/firstpass-hq-app-log.txt';

  it('is nothing when there is no log yet', () => {
    expect(log.shareableLog()).toBeNull();
    expect(fsMock().__files.has(SHARED)).toBe(false);
  });

  it('puts every log file in one file, oldest line first, writing waiting lines first', () => {
    fsMock().__files.set('doc:/logs/app.2.log', 'oldest\n');
    fsMock().__files.set('doc:/logs/app.1.log', 'older\n');
    log.logger('x').info('newest');
    const file = log.shareableLog();
    expect(file?.uri).toBe(SHARED);
    const text = fsMock().__files.get(SHARED)!;
    expect(text.startsWith('oldest\nolder\n')).toBe(true);
    expect(text).toContain('INFO  [x] newest');
  });

  it('keeps only the newest part, starting at a whole line, and replaces an earlier copy', () => {
    fsMock().__files.set(SHARED, 'stale');
    const line = `${'a'.repeat(99)}\n`;
    fsMock().__files.set('doc:/logs/app.1.log', line.repeat(40000)); // about 4 MB
    fsMock().__files.set('doc:/logs/app.2.log', 'too old to send\n');
    fsMock().__files.set('doc:/logs/app.log', `${'b'.repeat(99)}\n`.repeat(20000)); // about 2 MB
    log.shareableLog();
    const text = fsMock().__files.get(SHARED)!;
    expect(text.length).toBeLessThanOrEqual(log.SHARE_BYTES);
    expect(text.length).toBeGreaterThan(log.SHARE_BYTES - 100);
    expect(text).not.toContain('stale');
    expect(text).not.toContain('too old');
    expect(text.startsWith('a')).toBe(true);
    expect(text.split('\n')[0]).toHaveLength(99);
    expect(text.endsWith(`${'b'.repeat(99)}\n`)).toBe(true);
  });
});
