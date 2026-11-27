/**
 * The club's colour is for links, buttons and the current tab. Where
 * something is up to (needs you, done, stood down, flagged) is never in it:
 * on a gold club a warning mustn't look like a link. Status goes through
 * `StatusLine` (src/components/status-line.tsx) instead.
 *
 * This counts the text each screen draws in the club's colour. When it fails
 * for a file you changed: status text uses `StatusLine`; a new link or button
 * is fine, so put its file's new count here.
 */
type DirEntry = { name: string; isDirectory(): boolean };
const { readdirSync, readFileSync } = jest.requireActual('fs') as {
  readdirSync(dir: string, options: { withFileTypes: true }): DirEntry[];
  readFileSync(path: string, encoding: 'utf8'): string;
};

/** Jest runs from the project root. */
const SRC = `${process.cwd()}/src`;

/** Text in the club's colour: `themeColor` or a text `color`, not a border, background or icon. */
const CLUB_COLOURED_TEXT =
  /themeColor="(?:tint|accent)"|themeColor=\{[^}\n]*'(?:tint|accent)'|(?<![A-Za-z])color:[^,}\n]*theme\.(?:tint|accent)/g;

/** Every link, button and code shown in the club's colour, by file. */
const LINKS_AND_BUTTONS: Record<string, number> = {
  // Links and buttons made of words.
  'components/check-in-sheet.tsx': 2,
  'components/group-actions.tsx': 1,
  'components/member-tabs.tsx': 1,
  'components/policy-links.tsx': 1,
  'components/safeguarding.tsx': 2,
  'components/team-event-manage.tsx': 1,
  'components/week-date-field.tsx': 1,
  'components/wwcc-application.tsx': 2,
  'components/home/cards.tsx': 1,
  'components/home/club-hub.tsx': 1,
  'app/join.tsx': 1,
  'app/sign-in.tsx': 1,
  'app/attendance/new.tsx': 1,
  'app/attendance/family/[id].tsx': 1,
  'app/admin/[id].tsx': 1,
  'app/admin/calendars.tsx': 3,
  'app/admin/seasons.tsx': 1,
  'app/admin/squads.tsx': 9,
  'app/admin/place/[id].tsx': 1,
  'app/admin/club/brand.tsx': 2,
  'app/training/index.tsx': 2,
  'app/training/review.tsx': 1,
  'app/training/requirement/[id].tsx': 2,
  'app/event/[id].tsx': 3,
  'app/event/edit.tsx': 1,
  'app/injuries/[id].tsx': 2,
  'app/conduct/[id].tsx': 1,
  'app/medical/[id].tsx': 1,
  'app/concerns/message-access/[id].tsx': 1,
  // The links under the one-screen views, with the user guide among them.
  'app/(tabs)/index.tsx': 4,
  'app/(tabs)/messages.tsx': 2,
  // Start again, on a message kept from earlier.
  'app/messages/new.tsx': 1,
  // Five links and the "Next up" label on Today's first card.
  'components/home/today.tsx': 6,
  // Arrows that step a date, and the arrow at the end of a to-do.
  'components/date-field.tsx': 1,
  'components/task-row.tsx': 1,
  // Two links, and the chart's key in the colour of its line.
  'components/load-monitoring.tsx': 3,
  // A code to read out or type in.
  'components/guardian-link.tsx': 1,
  'components/home/banners.tsx': 1,
  // Who wrote each post in a group.
  'app/messages/group/[id].tsx': 1,
};

function screens(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return screens(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

function clubColouredText() {
  const found: Record<string, number> = {};
  for (const path of screens(SRC)) {
    const count = readFileSync(path, 'utf8').match(CLUB_COLOURED_TEXT)?.length ?? 0;
    if (count > 0) found[path.slice(SRC.length + 1)] = count;
  }
  return found;
}

describe('text in the club’s colour', () => {
  it('is only the links, buttons and codes listed here, never a status', () => {
    expect(clubColouredText()).toEqual(LINKS_AND_BUTTONS);
  });

  it('is found by the pattern, and borders, backgrounds and icons are not', () => {
    const count = (source: string) => source.match(CLUB_COLOURED_TEXT)?.length ?? 0;
    expect(count('<ThemedText type="small" themeColor="tint">')).toBe(1);
    expect(count('<ThemedText themeColor="accent">')).toBe(1);
    expect(count("<ThemedText themeColor={warn ? 'tint' : 'textSecondary'}>")).toBe(1);
    expect(count('<ThemedText style={{ color: theme.tint }}>')).toBe(1);
    expect(count('<ThemedText style={{ color: present ? theme.accent : ABSENT }}>')).toBe(1);
    expect(count('<View style={{ backgroundColor: theme.accent }} />')).toBe(0);
    expect(count('<Card style={{ borderColor: theme.accent }} />')).toBe(0);
    expect(count('<Icon name="plus" color={theme.tint} />')).toBe(0);
    expect(count('<StatusLine text="Locked" tone="attention" />')).toBe(0);
  });
});
