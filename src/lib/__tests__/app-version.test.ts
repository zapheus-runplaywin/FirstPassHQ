/**
 * The version and build shown at the foot of the opening screen, Find your
 * club, sign-in and home (src/lib/app-version.ts), so testers can say which
 * copy of the app they have.
 */
import { describeAppVersion, readAppVersion, type AppVersionDetails } from '@/lib/app-version';

const mockApplication = { nativeApplicationVersion: '1.0.0' as string | null, nativeBuildVersion: '23' as string | null };
const mockUpdates = {
  isEnabled: true,
  isEmbeddedLaunch: true,
  updateId: '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809' as string | null,
  createdAt: new Date(2026, 10, 20, 9) as Date | null,
};
const mockConstants = {
  executionEnvironment: 'standalone',
  expoConfig: { version: '1.0.0' } as { version?: string } | null,
};
const mockBuildInfo: { build: number | null; commit: string | null } = { build: 714, commit: 'feec4aa' };

jest.mock('expo-application', () => ({
  get nativeApplicationVersion() {
    return mockApplication.nativeApplicationVersion;
  },
  get nativeBuildVersion() {
    return mockApplication.nativeBuildVersion;
  },
}));
jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockUpdates.isEnabled;
  },
  get isEmbeddedLaunch() {
    return mockUpdates.isEmbeddedLaunch;
  },
  get updateId() {
    return mockUpdates.updateId;
  },
  get createdAt() {
    return mockUpdates.createdAt;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
  default: {
    get executionEnvironment() {
      return mockConstants.executionEnvironment;
    },
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));
jest.mock('@/constants/build-info.json', () => ({
  get build() {
    return mockBuildInfo.build;
  },
  get commit() {
    return mockBuildInfo.commit;
  },
}));

const day = (date: Date) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);

function details(overrides: Partial<AppVersionDetails> = {}): AppVersionDetails {
  return {
    version: '1.0.0',
    nativeBuild: '23',
    build: 714,
    commit: 'feec4aa',
    updateId: null,
    updateCreatedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockApplication.nativeApplicationVersion = '1.0.0';
  mockApplication.nativeBuildVersion = '23';
  mockUpdates.isEnabled = true;
  mockUpdates.isEmbeddedLaunch = true;
  mockUpdates.updateId = '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809';
  mockUpdates.createdAt = new Date(2026, 10, 20, 9);
  mockConstants.executionEnvironment = 'standalone';
  mockConstants.expoConfig = { version: '1.0.0' };
  mockBuildInfo.build = 714;
  mockBuildInfo.commit = 'feec4aa';
});

describe('describeAppVersion', () => {
  it('shows the store version, the store build and the build number on one line', () => {
    expect(describeAppVersion(details())).toEqual(['Version 1.0.0 (23) · Build 714']);
  });

  it('shows the short commit when the code has no build number', () => {
    expect(describeAppVersion(details({ build: null }))).toEqual([
      'Version 1.0.0 (23) · Commit feec4aa',
    ]);
  });

  it('prefers the build number to the commit', () => {
    expect(describeAppVersion(details({ build: 1 }))[0]).not.toContain('Commit');
  });

  it('leaves out the store build when there is none, as on the web', () => {
    expect(describeAppVersion(details({ nativeBuild: null }))).toEqual([
      'Version 1.0.0 · Build 714',
    ]);
  });

  it('shows the build alone when the version is unknown', () => {
    expect(describeAppVersion(details({ version: null, nativeBuild: '23' }))).toEqual(['Build 714']);
  });

  it('shows the version alone in a development copy', () => {
    expect(describeAppVersion(details({ nativeBuild: null, build: null, commit: null }))).toEqual([
      'Version 1.0.0',
    ]);
  });

  it('shows nothing when nothing is known', () => {
    expect(
      describeAppVersion(details({ version: null, nativeBuild: null, build: null, commit: null })),
    ).toEqual([]);
  });

  it('adds a second line for an over-the-air update, with its short id and date', () => {
    const createdAt = new Date(2026, 10, 20, 9);
    expect(
      describeAppVersion(
        details({ updateId: '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809', updateCreatedAt: createdAt }),
      ),
    ).toEqual(['Version 1.0.0 (23) · Build 714', `Update 1a2b3c4d · ${day(createdAt)}`]);
  });

  it('shows the update without a date when it has none, or a broken one', () => {
    expect(describeAppVersion(details({ updateId: 'abcdef0123', updateCreatedAt: null }))[1]).toBe(
      'Update abcdef01',
    );
    expect(
      describeAppVersion(details({ updateId: 'abcdef0123', updateCreatedAt: new Date('nope') }))[1],
    ).toBe('Update abcdef01');
  });

  it('shows the update line even when nothing else is known', () => {
    expect(
      describeAppVersion(
        details({ version: null, nativeBuild: null, build: null, commit: null, updateId: 'abcdef0123' }),
      ),
    ).toEqual(['Update abcdef01']);
  });
});

describe('readAppVersion', () => {
  it('reads the installed app, its build number and no update when it runs the code it was built with', () => {
    expect(readAppVersion()).toEqual({
      version: '1.0.0',
      nativeBuild: '23',
      build: 714,
      commit: 'feec4aa',
      updateId: null,
      updateCreatedAt: null,
    });
  });

  it('reads a downloaded over-the-air update', () => {
    mockUpdates.isEmbeddedLaunch = false;
    const read = readAppVersion();
    expect(read.updateId).toBe('1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809');
    expect(read.updateCreatedAt).toEqual(new Date(2026, 10, 20, 9));
  });

  it('shows no update when updates are off, as in development', () => {
    mockUpdates.isEnabled = false;
    mockUpdates.isEmbeddedLaunch = false;
    expect(readAppVersion().updateId).toBeNull();
    expect(readAppVersion().updateCreatedAt).toBeNull();
  });

  it('treats an update with no id or date as none', () => {
    mockUpdates.isEmbeddedLaunch = false;
    mockUpdates.updateId = null;
    mockUpdates.createdAt = null;
    expect(readAppVersion().updateId).toBeNull();
    expect(readAppVersion().updateCreatedAt).toBeNull();
  });

  it("uses the app config's version, not Expo Go's own, in Expo Go", () => {
    mockConstants.executionEnvironment = 'storeClient';
    mockApplication.nativeApplicationVersion = '58.0.0';
    mockApplication.nativeBuildVersion = '999';
    mockConstants.expoConfig = { version: '1.0.0' };
    const read = readAppVersion();
    expect(read.version).toBe('1.0.0');
    expect(read.nativeBuild).toBeNull();
  });

  it("falls back to the app config's version when the installed one is unknown, as on the web", () => {
    mockApplication.nativeApplicationVersion = null;
    mockApplication.nativeBuildVersion = null;
    mockConstants.expoConfig = { version: '2.1.0' };
    expect(readAppVersion()).toMatchObject({ version: '2.1.0', nativeBuild: null });
  });

  it('has no version when neither the app nor its config has one', () => {
    mockApplication.nativeApplicationVersion = null;
    mockConstants.expoConfig = null;
    expect(readAppVersion().version).toBeNull();
  });

  it("shows no build number or commit in a development copy, whose file has nulls", () => {
    mockBuildInfo.build = null;
    mockBuildInfo.commit = null;
    expect(readAppVersion()).toMatchObject({ build: null, commit: null });
  });

  it('ignores a build file of the wrong shape', () => {
    (mockBuildInfo as unknown as { build: string }).build = '714';
    (mockBuildInfo as unknown as { commit: number }).commit = 7;
    expect(readAppVersion()).toMatchObject({ build: null, commit: null });
  });
});
