/**
 * The navigation header stays a solid bar, so no screen starts underneath it.
 * On iOS 26 a see-through header hid the top of every screen, such as the
 * Members card on Administration, where it couldn't be tapped.
 */
import { rootStackOptions } from '@/constants/navigation';

// The project has no Node type definitions, so just what's used here.
type DirEntry = { name: string; isDirectory(): boolean };
const { readdirSync, readFileSync } = jest.requireActual('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(path: string, encoding: 'utf8'): string;
};

/** Jest runs from the project root. */
const APP_DIR = `${process.cwd()}/src/app`;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return routeFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('navigation header', () => {
  it('is solid, not see-through, on every screen', () => {
    expect(rootStackOptions.headerTransparent).toBe(false);
  });

  it('keeps the back button to just its arrow', () => {
    expect(rootStackOptions.headerBackButtonDisplayMode).toBe('minimal');
  });

  it('is what the app stack uses', () => {
    const layout = readFileSync(`${APP_DIR}/_layout.tsx`, 'utf8');
    expect(layout).toMatch(/<Stack\s+screenOptions=\{rootStackOptions\}>/);
  });

  it('is not made see-through by any one screen', () => {
    // Any of these brings back the see-through header for that screen.
    const seeThrough = /headerTransparent\s*:\s*(true|\{)|headerBackground\s*:|headerBlurEffect\s*:/;
    const offenders = routeFiles(APP_DIR).filter((file) => seeThrough.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
