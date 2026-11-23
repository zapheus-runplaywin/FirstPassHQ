/**
 * Crash reports (src/lib/crash-reports.ts). They are off unless the build has
 * a Sentry address in the EU, and never run in Expo Go, on the web or in
 * development. A report keeps only the fields the module lists, with every
 * text scrubbed, so nothing about a person (names, emails, dates of birth,
 * member ids, message text, tokens) reaches Sentry. The property test at the
 * end puts a sample member's details everywhere in a report and checks that
 * none of them survives.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import * as fc from 'fast-check';

import {
  KEPT,
  crashReportAddress,
  crashReportsOn,
  isEuDsn,
  rememberPersonalValues,
  reportCrash,
  resetCrashReportsForTests,
  scrubReport,
  scrubText,
  setCrashReportScreen,
  startCrashReports,
} from '@/lib/crash-reports';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockUuids = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7${String(++mockUuids).padStart(4, '0')}`,
}));

// The build check runs on Expo's servers with Node alone, so it has its own copy of the rule.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const buildCheck = require('../../../scripts/check-build-settings.js') as {
  EU_DSN: RegExp;
};

const DSN = `https://${'0123456789abcdef'.repeat(2)}@o4508000000000001.ingest.de.sentry.io/4508000000000002`;
const US_DSN = `https://${'0123456789abcdef'.repeat(2)}@o4508000000000001.ingest.us.sentry.io/4508000000000002`;
const OLD_US_DSN = `https://${'0123456789abcdef'.repeat(2)}@o1.ingest.sentry.io/2`;
const ON = { dsn: DSN, platform: 'ios', executionEnvironment: 'standalone', isDev: false };

const init = Sentry.init as jest.Mock;
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetCrashReportsForTests();
  await AsyncStorage.clear();
});

describe('when reports are sent', () => {
  it('sends from iPhone and Android store and preview builds with an EU address', () => {
    expect(crashReportAddress(ON)).toBe(DSN);
    expect(crashReportAddress({ ...ON, platform: 'android', executionEnvironment: 'bare' })).toBe(DSN);
    expect(crashReportAddress({ ...ON, dsn: `  ${DSN}\n` })).toBe(DSN);
  });

  it.each([
    ['no address', { dsn: undefined }],
    ['a blank address', { dsn: ' ' }],
    ['an address in the US', { dsn: US_DSN }],
    ['an older US address', { dsn: OLD_US_DSN }],
    ['something else', { dsn: 'https://example.com/1' }],
    ['development', { isDev: true }],
    ['the web', { platform: 'web' }],
    ['Expo Go', { executionEnvironment: 'storeClient' }],
  ])('sends nothing with %s', (_name, change) => {
    expect(crashReportAddress({ ...ON, ...change })).toBeNull();
  });

  it('agrees with the build check on which addresses are in the EU', () => {
    const addresses = [
      DSN,
      US_DSN,
      OLD_US_DSN,
      `${DSN}/`,
      DSN.replace('https', 'http'),
      DSN.replace('0123456789abcdef', 'short'),
      DSN.replace('.de.', '.de.evil.'),
      DSN.replace('ingest.de.sentry.io', 'ingest.de.sentry.io.example.com'),
      `https://${'a'.repeat(32)}@o1.ingest.de.sentry.io/2`,
      '',
    ];
    for (const address of addresses) {
      expect([address, isEuDsn(address)]).toEqual([address, buildCheck.EU_DSN.test(address)]);
    }
    expect(isEuDsn(DSN)).toBe(true);
    expect(isEuDsn(US_DSN)).toBe(false);
  });
});

describe('starting', () => {
  const details = {
    dsn: DSN,
    platform: 'android',
    executionEnvironment: 'standalone',
    isDev: false,
    version: { build: 760, commit: 'abc1234', updateId: 'update-1' },
    channel: 'preview',
  };

  it('does not start Sentry when reports are off', () => {
    expect(startCrashReports({ ...details, dsn: undefined })).toBe(false);
    expect(startCrashReports({ ...details, isDev: true })).toBe(false);
    expect(startCrashReports({ ...details, executionEnvironment: 'storeClient' })).toBe(false);
    expect(startCrashReports({ ...details, platform: 'web' })).toBe(false);
    expect(init).not.toHaveBeenCalled();
    expect(crashReportsOn()).toBe(false);
    reportCrash(new Error('boom'));
    setCrashReportScreen(['injuries', '[id]']);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.setTag).not.toHaveBeenCalled();
  });

  it('starts once, with everything that could carry personal data turned off', () => {
    expect(startCrashReports(details)).toBe(true);
    expect(startCrashReports(details)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'preview',
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      enableNetworkBreadcrumbs: false,
      enableNetworkEventBreadcrumbs: false,
      enableAutoSessionTracking: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      reportAccessibilityIdentifier: false,
      enableCaptureFailedRequests: false,
      enableLogs: false,
    });
    // No performance tracing, profiling, session replay or feedback widget.
    for (const off of ['tracesSampleRate', 'tracesSampler', 'profilesSampleRate', 'replaysSessionSampleRate', 'replaysOnErrorSampleRate']) {
      expect(options[off]).toBeUndefined();
    }
    expect(options.beforeBreadcrumb({ message: 'anything' })).toBeNull();
    const defaults = ['Breadcrumbs', 'HttpContext', 'ModulesLoader', 'ExpoConstants', 'ReactNativeErrorHandlers', 'DeviceContext'].map((name) => ({ name }));
    expect(options.integrations(defaults).map((i: { name: string }) => i.name)).toEqual([
      'ReactNativeErrorHandlers',
      'DeviceContext',
    ]);
    expect(crashReportsOn()).toBe(true);
  });

  it('tags which code ran, never who ran it', () => {
    startCrashReports(details);
    expect((Sentry.setTag as jest.Mock).mock.calls).toEqual([
      ['build', 760],
      ['commit', 'abc1234'],
      ['update', 'update-1'],
      ['channel', 'preview'],
    ]);
  });

  it('leaves out the tags it has no value for', () => {
    startCrashReports({ ...details, version: { build: null, commit: null, updateId: null }, channel: null });
    expect(Sentry.setTag).not.toHaveBeenCalled();
    expect(init.mock.calls[0][0].environment).toBe('unknown');
  });

  it('names the install with a random id it keeps, and puts only that id on reports', async () => {
    startCrashReports(details);
    await settle();
    const id = await AsyncStorage.getItem('crash-reports.install-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Sentry.setUser).toHaveBeenCalledWith({ id });

    const report = init.mock.calls[0][0].beforeSend({ user: { id: 'member-1', email: 'a@b.test', ip_address: '1.2.3.4' } });
    expect(report.user).toEqual({ id });

    // The same id next time the app starts.
    resetCrashReportsForTests();
    jest.clearAllMocks();
    startCrashReports(details);
    await settle();
    expect(Sentry.setUser).toHaveBeenCalledWith({ id });
  });

  it('still starts when the phone storage fails, with no id at all', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('no storage'));
    startCrashReports(details);
    await settle();
    expect(Sentry.setUser).not.toHaveBeenCalled();
    expect(init.mock.calls[0][0].beforeSend({ user: { id: 'member-1' } }).user).toEqual({});
  });

  it('records the screen as its pattern and reports caught errors', () => {
    startCrashReports(details);
    jest.clearAllMocks();
    setCrashReportScreen(['injuries', '[id]']);
    expect(Sentry.setTag).toHaveBeenCalledWith('screen', '/injuries/[id]');
    setCrashReportScreen([]);
    expect(Sentry.setTag).toHaveBeenCalledWith('screen', '/');
    const error = new Error('boom');
    reportCrash(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});

describe('scrubbing text', () => {
  it.each([
    ['an email', 'No member with jane.citizen+club@example.com', 'No member with [email]'],
    ['a member id', 'Profile 3f2b8c1e-1234-4abc-9def-0123456789ab not found', 'Profile [id] not found'],
    ['a date of birth', 'Born 2011-03-02 is under 13', 'Born [date] is under 13'],
    ['a written date', 'Expires 02/03/2027', 'Expires [date]'],
    ['a phone number', 'Call 0400 123 456 now', 'Call [number] now'],
    ['an international number', 'Call +61 400 123 456', 'Call [number]'],
    ['a card number', 'Card WWC1234567E', 'Card WWC[number]E'],
    ['quoted text', 'Message "See you at training, Jane" failed', 'Message "…" failed'],
    ['single-quoted text', "Value 'Jane Citizen' is too long", 'Value "…" is too long'],
    ['curly-quoted text', 'Name “Jane” and ‘Jo’', 'Name "…" and "…"'],
    ['a database error detail', 'Key (playhq_email)=(jane) already exists.', 'Key (playhq_email)=(…) already exists.'],
    ['a web address query', 'GET https://abc.supabase.co/rest/v1/profiles?id=eq.1&select=* failed', 'GET https://abc.supabase.co/rest/v1/profiles?[query] failed'],
    ['an old Supabase key', 'apikey eyJhbGciOi.eyJyb2xlIjoi.c2lnbmF0dXJl', '[token]'],
    ['a new Supabase key', 'key sb_secret_abc123 leaked', 'key [token] leaked'],
    ['a bearer token', 'Authorization: Bearer abc.def', 'Authorization: [token]'],
  ])('removes %s', (_name, text, expected) => {
    expect(scrubText(text)).toBe(expected);
  });

  it('keeps apostrophes in ordinary words', () => {
    expect(scrubText('Couldn’t load the club’s data')).toBe('Couldn’t load the club’s data');
    expect(scrubText("Couldn't load the club's data")).toBe("Couldn't load the club's data");
    expect(scrubText('TypeError: undefined is not a function')).toBe('TypeError: undefined is not a function');
  });

  it('keeps short numbers such as counts and line numbers', () => {
    expect(scrubText('Expected 3 rows, got 120')).toBe('Expected 3 rows, got 120');
  });

  it('cuts very long text', () => {
    expect(scrubText('x'.repeat(5000))).toHaveLength(1000);
  });

  it('removes the signed-in member’s own name and emails, whole words only', () => {
    rememberPersonalValues(['Annabel Citizen', 'Bel', 'annabel@example.com', null, undefined, ' ']);
    expect(scrubText('Annabel Citizen opened it')).toBe('[personal] opened it');
    expect(scrubText('Hi annabel, from citizen')).toBe('Hi [personal], from [personal]');
    expect(scrubText('Bel saved')).toBe('[personal] saved');
    expect(scrubText('Annual belts')).toBe('Annual belts');
    // Remembered emails go even when they don't look like one any more.
    expect(scrubText('user annabel@example.com')).toBe('user [personal]');
    rememberPersonalValues();
    expect(scrubText('Annabel opened it')).toBe('Annabel opened it');
  });

  it('copes with names that have regular expression characters in them', () => {
    rememberPersonalValues(['Jo (Coach) Smith+']);
    expect(scrubText('Jo (Coach) Smith+ left')).toBe('[personal] left');
  });
});

describe('scrubbing a report', () => {
  const event = {
    event_id: '0123456789abcdef0123456789abcdef',
    timestamp: 1795000000,
    level: 'fatal',
    platform: 'javascript',
    release: 'au.pivt.firstpass.hq@1.0.0+23',
    dist: '23',
    environment: 'preview',
    sdk: { name: 'sentry.javascript.react-native', version: '8.28.1' },
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///index.android.bundle', debug_id: '3f2b8c1e-1234-4abc-9def-0123456789ab' }] },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Couldn’t save jane@example.com',
          mechanism: { type: 'onerror', handled: false, data: { email: 'jane@example.com' } },
          stacktrace: {
            frames: [
              { filename: 'app:///index.android.bundle', function: 'save', lineno: 10, colno: 2, in_app: true, vars: { email: 'jane@example.com' }, context_line: 'x' },
            ],
          },
        },
      ],
    },
    threads: { values: [{ id: 1, crashed: true, name: 'Jane’s thread', stacktrace: { frames: [{ function: 'main', vars: { a: 1 } }] } }] },
    message: 'Saving "Jane"',
    logentry: { message: 'Saving %s', params: ['Jane'] },
    request: { url: 'https://abc.supabase.co/rest/v1/profiles?email=eq.jane@example.com', headers: { Authorization: 'Bearer x' } },
    user: { id: 'member-1', email: 'jane@example.com', username: 'jane', ip_address: '1.2.3.4' },
    breadcrumbs: [{ message: 'Opened Jane Citizen' }],
    server_name: 'Jane’s iPhone',
    transaction: '/injuries/3f2b8c1e-1234-4abc-9def-0123456789ab',
    modules: { react: '19' },
    tags: { build: 760, screen: '/injuries/[id]', member: 'Jane', 'event.origin': 'javascript' },
    extra: { full_name: 'Jane Citizen', member_id: '3f2b8c1e-1234-4abc-9def-0123456789ab', count: 3, nested: { note: 'sore' } },
    contexts: {
      device: { name: 'Jane’s iPhone', model: 'iPhone15,2', family: 'iOS', device_unique_identifier: 'abc' },
      os: { name: 'iOS', version: '18.1', build: '22B83' },
      app: { app_version: '1.0.0', app_build: '23', device_app_hash: 'abc' },
      culture: { timezone: 'Australia/Perth', locale: 'en_AU' },
      react: { componentStack: 'at Greeting ("Jane")' },
      trace: { trace_id: 'abc' },
      expo_constants: { owner: 'someone' },
    },
  };
  const scrubbed = scrubReport(event, 'install-1') as Record<string, unknown> & typeof event;

  it('keeps the ids of the report and of the code exactly, so Sentry can match source maps', () => {
    for (const key of KEPT.asIs) {
      if (key in event) expect(scrubbed[key as keyof typeof event]).toEqual(event[key as keyof typeof event]);
    }
  });

  it('drops the request, breadcrumbs, member, server name, modules and anything it does not list', () => {
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.transaction).toBeUndefined();
    expect(scrubbed.modules).toBeUndefined();
    expect(scrubbed.breadcrumbs).toEqual([]);
    expect(scrubbed.user).toEqual({ id: 'install-1' });
    expect(scrubReport({ user: { id: 'member-1' } }, null)).toEqual({ contexts: {}, tags: {}, breadcrumbs: [], user: {} });
  });

  it('scrubs the error and drops local variables and mechanism data', () => {
    expect(scrubbed.exception.values[0]).toEqual({
      type: 'Error',
      value: 'Couldn’t save [email]',
      mechanism: { type: 'onerror', handled: false },
      stacktrace: { frames: [{ filename: 'app:///index.android.bundle', function: 'save', lineno: 10, colno: 2, in_app: true }] },
    });
    expect(scrubbed.threads).toEqual({ values: [{ id: 1, crashed: true, stacktrace: { frames: [{ function: 'main' }] } }] });
    expect(scrubbed.message).toBe('Saving "…"');
    expect(scrubbed.logentry).toEqual({ message: 'Saving %s' });
  });

  it('keeps phone and app details without the phone’s name or identifiers', () => {
    expect(scrubbed.contexts).toEqual({
      device: { model: 'iPhone15,2', family: 'iOS' },
      os: { name: 'iOS', version: '18.1', build: '22B83' },
      app: { app_version: '1.0.0', app_build: '23' },
      react: { componentStack: 'at Greeting ("…")' },
    });
  });

  it('keeps only its own tags, and redacts and scrubs extra details', () => {
    expect(scrubbed.tags).toEqual({ build: 760, screen: '/injuries/[id]', 'event.origin': 'javascript' });
    expect(scrubbed.extra).toEqual({ full_name: '[redacted]', member_id: '[id]', count: 3, nested: { note: '[redacted]' } });
  });

  it('copes with reports that have odd shapes', () => {
    expect(() => scrubReport({ exception: { values: [{}] }, threads: [], contexts: null, tags: null, extra: 'x' }, null)).not.toThrow();
    const deep: Record<string, unknown> = {};
    let at = deep;
    for (let i = 0; i < 10; i++) at = at.next = {} as Record<string, unknown>;
    expect(JSON.stringify(scrubReport({ extra: { deep, list: Array.from({ length: 80 }, () => 1) } }, null))).toContain('[…]');
  });
});

describe('no personal detail reaches a report (property test)', () => {
  // Words without vowels, so none can match a field name or placeholder in the report itself.
  const word = fc.stringMatching(/^[A-Z][bcdfghjklmnpqrstvwxz]{2,9}$/);
  const lower = fc.stringMatching(/^[bcdfghjklmnpqrstvwxz]{3,8}$/);
  const member = fc.record({
    first: word,
    last: word,
    emailUser: fc.tuple(lower, lower).map(([a, b]) => `${a}.${b}`),
    id: fc.uuid(),
    dob: fc.date({ min: new Date('1950-01-01'), max: new Date('2015-12-31'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
    phone: fc.stringMatching(/^04\d{8}$/),
    note: fc.tuple(word, lower, lower).map((w) => w.join(' ')),
  });

  it('leaves out the member’s name, email, id, date of birth, phone and message text wherever they are put', () => {
    fc.assert(
      fc.property(member, (m) => {
        const name = `${m.first} ${m.last}`;
        const email = `${m.emailUser}@example.com`;
        rememberPersonalValues([name, email]);
        const everywhere = {
          full_name: name, email, member_id: m.id, date_of_birth: m.dob, phone: m.phone, note: m.note,
          text: `${name} <${email}> ${m.id} ${m.dob} ${m.phone} "${m.note}"`,
        };
        const report = scrubReport(
          {
            message: everywhere.text,
            logentry: { message: everywhere.text, params: Object.values(everywhere) },
            exception: {
              values: [{
                type: m.first,
                value: `${everywhere.text} Key (email)=(${m.emailUser}) '${m.note}'`,
                mechanism: { type: 'generic', data: everywhere },
                stacktrace: { frames: [{ function: 'f', vars: everywhere }] },
              }],
            },
            threads: { values: [{ id: 1, name, stacktrace: { frames: [{ vars: everywhere }] } }] },
            request: { url: `https://abc.supabase.co/rest/v1/x?email=eq.${email}`, data: everywhere },
            user: { id: m.id, email, username: name },
            breadcrumbs: [{ message: everywhere.text, data: everywhere }],
            tags: { screen: `/admin/${m.id}`, person: name },
            extra: { ...everywhere, nested: [everywhere] },
            contexts: { device: { name: `${m.first}’s phone`, model: 'Pixel 9' }, react: { componentStack: everywhere.text }, profile: everywhere },
            server_name: name,
            transaction: `/admin/${m.id}`,
          },
          'install-1',
        );
        const json = JSON.stringify(report);
        for (const value of [m.first, m.last, m.emailUser, m.id, m.dob, m.phone, ...m.note.split(' ')]) {
          const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
          if (pattern.test(json)) throw new Error(`${value} is in ${json}`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
