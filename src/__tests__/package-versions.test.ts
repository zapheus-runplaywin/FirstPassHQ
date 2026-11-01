// The overrides in package.json move packages that other packages bring in
// off versions that are deprecated or have advisories. These tests fail if a
// package update or a fresh lockfile brings an old copy back.

type Lock = { packages: Record<string, { version?: string }> };

const lock = require('../../package-lock.json') as Lock;

function versionsOf(name: string): string[] {
  return Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`))
    .map(([, entry]) => entry.version ?? '');
}

function atLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < b.length; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

describe('package versions in package-lock.json', () => {
  it('has no glob older than 13 (glob 7 and 10 are deprecated and unsupported)', () => {
    const versions = versionsOf('glob');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((v) => !atLeast(v, '13.0.0'))).toEqual([]);
  });

  it('has no whatwg-encoding, which jsdom replaced with @exodus/bytes', () => {
    expect(versionsOf('whatwg-encoding')).toEqual([]);
    expect(versionsOf('@exodus/bytes').length).toBeGreaterThan(0);
  });

  it('has no inflight, which glob 7 needed and leaks memory', () => {
    expect(versionsOf('inflight')).toEqual([]);
  });

  it('has qs 6.17.1 or newer (GHSA-4mjr-xmp4-gh2g and three other DoS advisories)', () => {
    const versions = versionsOf('qs');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((v) => !atLeast(v, '6.17.1'))).toEqual([]);
  });

  it('has test-exclude 8 or newer, which uses glob 13', () => {
    expect(versionsOf('test-exclude').filter((v) => !atLeast(v, '8.0.0'))).toEqual([]);
  });

  it('keeps the atLeast check honest', () => {
    expect(atLeast('13.0.6', '13.0.0')).toBe(true);
    expect(atLeast('10.5.0', '13.0.0')).toBe(false);
    expect(atLeast('6.17.1', '6.17.1')).toBe(true);
    expect(atLeast('6.16.9', '6.17.1')).toBe(false);
    expect(atLeast('7.0.0', '6.17.1')).toBe(true);
  });
});
