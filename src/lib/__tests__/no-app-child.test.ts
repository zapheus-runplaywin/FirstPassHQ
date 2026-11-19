import { childDetailsProblem, newestSeasonGroups, noAppLabel, withNoAppLabel } from '@/lib/no-app-child';
import type { Team } from '@/lib/types';

// Today is pinned: whether a child is under 18 turns on it. CI runs in UTC.
beforeAll(() => jest.useFakeTimers({ now: new Date('2026-11-19T02:00:00Z') }));
afterAll(() => jest.useRealTimers());

describe('childDetailsProblem', () => {
  it('accepts a child under 18, including one under 13', () => {
    expect(childDetailsProblem('Sam Small', '04/05/2016')).toBeNull();
    expect(childDetailsProblem('Riley Rookie', '20/11/2008')).toBeNull();
  });

  it.each([
    ['', '04/05/2016', 'Enter the child’s name.'],
    ['   ', '04/05/2016', 'Enter the child’s name.'],
    ['x'.repeat(81), '04/05/2016', 'Keep the child’s name to 80 characters.'],
    ['Sam Small', '', 'Enter the child’s date of birth as DD/MM/YYYY.'],
    ['Sam Small', '2016-05-04', 'Enter the child’s date of birth as DD/MM/YYYY.'],
    ['Sam Small', '20/11/2026', 'That date of birth is in the future.'],
  ])('refuses %j born %j', (name, dob, problem) => {
    expect(childDetailsProblem(name, dob)).toBe(problem);
  });

  it('refuses someone 18 today, and accepts them the day before their birthday', () => {
    expect(childDetailsProblem('Kai Senior', '19/11/2008')).toMatch(/^Only children under 18/);
    expect(childDetailsProblem('Kai Senior', '20/11/2008')).toBeNull();
  });
});

describe('newestSeasonGroups', () => {
  const team = (id: string, extra: Partial<Team>): Team => ({
    id,
    name: id,
    sort_order: 0,
    kind: 'squad',
    season: 2026,
    squad_id: null,
    selections_completed_at: null,
    ...extra,
  });

  it('lists the newest season, each squad followed by its teams', () => {
    const groups = newestSeasonGroups([
      team('Open', { sort_order: 2 }),
      team('Old', { season: 2025 }),
      team('Open Gold', { kind: 'team', squad_id: 'Open', sort_order: 2 }),
      team('Juniors', { sort_order: 1 }),
      team('Open Blue', { kind: 'team', squad_id: 'Open', sort_order: 1 }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['Juniors', 'Open', 'Open Blue', 'Open Gold']);
  });

  it('is empty with no squads or teams', () => {
    expect(newestSeasonGroups([])).toEqual([]);
  });
});

describe('withNoAppLabel', () => {
  it('marks only members with no sign-in', () => {
    expect(withNoAppLabel('Sam Small', true)).toBe(`Sam Small · ${noAppLabel}`);
    expect(withNoAppLabel('Jordan Junior', false)).toBe('Jordan Junior');
    expect(withNoAppLabel('Jordan Junior', undefined)).toBe('Jordan Junior');
  });
});
