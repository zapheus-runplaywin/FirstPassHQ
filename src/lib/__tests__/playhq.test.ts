import { gamesFor, parsePlayhqLink, summarisePlayhqGames, type PlayhqGame } from '@/lib/playhq';

function game(overrides: Partial<PlayhqGame> = {}): PlayhqGame {
  return {
    id: 'g1',
    date: '2026-10-24',
    time: '14:00',
    timezone: 'Australia/Perth',
    round: 'Round 3',
    is_final: false,
    grade: '17 & Under',
    venue: 'State Netball Centre',
    court: 'Court 4',
    status: 'UPCOMING',
    home: { id: 'us', name: 'Our Club' },
    away: { id: 'them', name: 'Swans' },
    ...overrides,
  };
}

describe('parsePlayhqLink', () => {
  const link = 'https://www.playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d';

  it('reads a competition link', () => {
    expect(parsePlayhqLink(link)).toEqual({ tenant: 'netball-australia', seasonCode: 'ec69e46d', url: link });
  });

  it('reads a link with a page after it', () => {
    expect(parsePlayhqLink(`${link}/fixture`)?.seasonCode).toBe('ec69e46d');
    expect(parsePlayhqLink(`${link}/teams`)?.url).toBe(link);
    expect(parsePlayhqLink(`${link}?tab=1`)?.url).toBe(link);
    expect(parsePlayhqLink(`${link}#ladder`)?.url).toBe(link);
  });

  it('reads a link without https or www, and with spaces around it', () => {
    expect(parsePlayhqLink('playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d')?.url).toBe(link);
    expect(parsePlayhqLink(`  http://playhq.com/netball-australia/org/perth-netball/winter-2026/ec69e46d  `)?.url).toBe(
      link,
    );
  });

  it('lower-cases the tenant and season code', () => {
    expect(parsePlayhqLink('https://www.playhq.com/Netball-Australia/org/Perth/Winter/EC69E46D')).toEqual({
      tenant: 'netball-australia',
      seasonCode: 'ec69e46d',
      url: 'https://www.playhq.com/Netball-Australia/org/Perth/Winter/EC69E46D',
    });
  });

  it('rejects links that are not a PlayHQ season', () => {
    expect(parsePlayhqLink('')).toBeNull();
    expect(parsePlayhqLink('https://example.com/netball-australia/org/a/b/ec69e46d')).toBeNull();
    expect(parsePlayhqLink('https://www.playhq.com/netball-australia/org/perth-netball')).toBeNull();
    // The season code is hex, at least six characters.
    expect(parsePlayhqLink('https://www.playhq.com/netball-australia/org/a/b/ec69e')).toBeNull();
    expect(parsePlayhqLink('https://www.playhq.com/netball-australia/org/a/b/zzzzzzzz')).toBeNull();
    expect(parsePlayhqLink('https://www.playhq.com/netball-australia/org/a/b/ec69e46dzz')).toBeNull();
    expect(parsePlayhqLink('https://www.playhq.com.evil.com/netball-australia/org/a/b/ec69e46d')).toBeNull();
  });
});

describe('summarisePlayhqGames', () => {
  const now = new Date(2026, 9, 18, 12);

  it('counts games a year either side of today, and byes', () => {
    expect(
      summarisePlayhqGames(
        [
          { date: '2025-10-17', status: 'COMPLETED' },
          { date: '2025-10-18', status: 'COMPLETED' },
          { date: '2026-10-17', status: 'COMPLETED' },
          { date: '2026-10-18', status: 'UPCOMING' },
          { date: '2027-10-18', status: 'UPCOMING' },
          { date: '2027-10-19', status: 'UPCOMING' },
          { date: '2026-11-01', status: 'BYE' },
          { date: '2020-01-01', status: 'BYE' },
        ],
        now,
      ),
    ).toEqual({ pastCount: 2, upcomingCount: 2, byeCount: 2 });
  });

  it('is all zero with no games', () => {
    expect(summarisePlayhqGames([], now)).toEqual({ pastCount: 0, upcomingCount: 0, byeCount: 0 });
  });
});

describe('gamesFor', () => {
  const competition = {
    id: 'c',
    name: 'Winter 2026',
    teams: [],
    games: [
      game({ id: 'home' }),
      game({ id: 'away', home: { id: 'them', name: 'Swans' }, away: { id: 'us', name: 'Our Club' } }),
      game({ id: 'other', home: { id: 'x', name: 'X' }, away: { id: 'y', name: 'Y' } }),
      game({ id: 'bye', status: 'BYE', away: null }),
    ],
  };

  it('keeps the team’s games with the opponent and whether they are at home', () => {
    const games = gamesFor(competition, 'us');
    expect(games.map((g) => [g.id, g.opponent, g.is_home])).toEqual([
      ['home', 'Swans', true],
      ['away', 'Swans', false],
      ['bye', null, null],
    ]);
  });

  it('copies the game details', () => {
    expect(gamesFor(competition, 'us')[0]).toEqual({
      id: 'home',
      date: '2026-10-24',
      time: '14:00',
      timezone: 'Australia/Perth',
      round: 'Round 3',
      is_final: false,
      grade: '17 & Under',
      venue: 'State Netball Centre',
      court: 'Court 4',
      status: 'UPCOMING',
      opponent: 'Swans',
      is_home: true,
    });
  });

  it('is empty for a team with no games', () => {
    expect(gamesFor(competition, 'nobody')).toEqual([]);
  });
});
