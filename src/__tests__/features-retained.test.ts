/**
 * "All features must be retained" (Matt, 25 November 2026, on the redesign).
 *
 * `data/before-redesign.json` is what the app had just before the redesign
 * began (commit 884d77e): every screen, every place a link or button goes,
 * every database function and table it calls, and every edge function. Each
 * one must still be in the app. Moving a screen or renaming a tab is fine; a
 * screen nothing opens any more, or a database function nothing calls, is a
 * feature that went missing.
 *
 * When this fails for something taken out on purpose, with Matt's yes: remove
 * that one line from the JSON in the same pull request and say so in it. When
 * it fails for anything else, the change dropped a feature: put it back.
 */
import before from './data/before-redesign.json';

type DirEntry = { name: string; isDirectory(): boolean };
const { readdirSync, readFileSync } = jest.requireActual('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(path: string, encoding: 'utf8'): string;
};

/** Jest runs from the project root. */
const SRC = `${process.cwd()}/src`;

/** Every source file the app ships, as [path under src, text]. Tests don't count. */
function sourceFiles(dir = SRC): [string, string][] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): [string, string][] => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [[path.slice(SRC.length + 1), readFileSync(path, 'utf8')]] : [];
  });
}

const files = sourceFiles();

/** The address a route file answers: groups like (tabs) and a closing /index don't show in it. */
function screenOf(file: string): string {
  const parts = file
    .replace(/^app\//, '')
    .replace(/\.tsx$/, '')
    .split('/')
    .filter((part) => !/^\(.*\)$/.test(part));
  if (parts[parts.length - 1] === 'index') parts.pop();
  return `/${parts.join('/')}`;
}

const screens = new Set(
  files
    .map(([file]) => file)
    .filter((file) => file.startsWith('app/') && !/(^|\/)(_layout|\+[^/]*)\.tsx$/.test(file))
    .map(screenOf),
);

/** Every match of a pattern's first group, across the app. */
function all(pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const [, text] of files) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

/** Where links and buttons go: any quoted address, with `${...}` read as [p]. */
const links = new Set(
  [...all(/['"`](\/[A-Za-z0-9_\-/${}.[\]()]*?)['"`]/g)]
    .map((link) => link.replace(/\$\{[^}]*\}/g, '[p]'))
    .filter((link) => /^\/[a-z[(]/.test(link)),
);
const databaseFunctions = all(/\.rpc\(\s*['"]([a-z0-9_]+)/g);
const tables = all(/\.from\(\s*['"]([a-z0-9_]+)/g);
const edgeFunctions = all(/functions\.invoke\(\s*['"]([a-z0-9_-]+)/g);

const missing = (wanted: string[], have: Set<string>) => wanted.filter((one) => !have.has(one));

describe('everything the app had before the redesign is still in it', () => {
  it('the list is the whole app as it was: 138 screens, 139 link targets, 370 database functions', () => {
    expect(before.screens).toHaveLength(138);
    expect(before.links).toHaveLength(139);
    expect(before.databaseFunctions).toHaveLength(370);
    expect(before.tables).toHaveLength(34);
    expect(before.edgeFunctions).toHaveLength(3);
  });

  it('every screen still has its address', () => {
    expect(missing(before.screens, screens)).toEqual([]);
  });

  it('something still opens every place a link or button went', () => {
    expect(missing(before.links, links)).toEqual([]);
  });

  it('every database function is still called', () => {
    expect(missing(before.databaseFunctions, databaseFunctions)).toEqual([]);
  });

  it('every table is still read or written', () => {
    expect(missing(before.tables, tables)).toEqual([]);
  });

  it('every edge function is still called', () => {
    expect(missing(before.edgeFunctions, edgeFunctions)).toEqual([]);
  });
});

describe('how the check reads the app', () => {
  it('a screen keeps its address when it moves into the tabs', () => {
    expect(screenOf('app/(tabs)/index.tsx')).toBe('/');
    expect(screenOf('app/(tabs)/calendar.tsx')).toBe('/calendar');
    expect(screenOf('app/messages/[id].tsx')).toBe('/messages/[id]');
    expect(screenOf('app/admin/club/index.tsx')).toBe('/admin/club');
  });

  it('the layouts are not screens', () => {
    expect(screens.has('/_layout')).toBe(false);
    expect(screens.has('/(tabs)')).toBe(false);
  });

  it('finds what the app has today, so an empty search can’t pass for "nothing missing"', () => {
    expect(screens.size).toBeGreaterThanOrEqual(before.screens.length);
    expect(links.has('/concern/new')).toBe(true);
    expect(databaseFunctions.has('save_check_in')).toBe(true);
    expect(tables.has('profiles')).toBe(true);
    expect(missing(['/no-such-screen'], screens)).toEqual(['/no-such-screen']);
  });
});
