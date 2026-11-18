/**
 * The club list (src/constants/clubs.ts) and the demo club (docs/environments.md,
 * "The demo club"; design tab D2). Only a build given the two demo variables
 * lists DEMO, only that entry carries the demo flag, and the club the build is
 * made for can never carry it, so a real club never shows a password box.
 */
type ClubsModule = typeof import('@/constants/clubs');

const BASE = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://live.example.test',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'live-key',
  EXPO_PUBLIC_CLUB_CODE: 'THUNDER',
  EXPO_PUBLIC_CLUB_NAME: 'West Coast Thunder',
};
const DEMO = {
  EXPO_PUBLIC_DEMO_CLUB_URL: 'https://test.example.test',
  EXPO_PUBLIC_DEMO_CLUB_ANON_KEY: 'test-key',
};
const NAMES = [
  ...Object.keys(BASE),
  ...Object.keys(DEMO),
  'EXPO_PUBLIC_TEST_CLUB_2_CODE',
  'EXPO_PUBLIC_TEST_CLUB_2_NAME',
  'EXPO_PUBLIC_TEST_CLUB_2_URL',
  'EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY',
];

/** The club list as a build with these variables would have it. */
function build(env: Record<string, string>): ClubsModule {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, env);
  let mod: ClubsModule | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual('@/constants/clubs');
  });
  return mod!;
}

afterAll(() => {
  for (const name of NAMES) delete process.env[name];
});

describe('a build with the two demo variables', () => {
  const clubs = build({ ...BASE, ...DEMO });

  it('lists the home club first, then DEMO', () => {
    expect(clubs.Clubs.map((c) => c.code)).toEqual(['THUNDER', 'DEMO']);
  });

  it('finds DEMO by its code, ignoring case and spaces, pointing at the test project', () => {
    expect(clubs.findClub(' de mo ')).toEqual({
      code: 'DEMO',
      name: 'Perth Pumpkins',
      supabaseUrl: 'https://test.example.test',
      anonKey: 'test-key',
      demo: true,
    });
  });

  it('signs in to DEMO with a password, and never to the home club', () => {
    expect(clubs.isDemoClub(clubs.findClub('DEMO'))).toBe(true);
    expect(clubs.isDemoClub(clubs.findClub('THUNDER'))).toBe(false);
    expect(clubs.findClub('THUNDER')?.demo).toBeUndefined();
  });

  it('treats nothing else as the demo club', () => {
    expect(clubs.isDemoClub(null)).toBe(false);
    expect(clubs.isDemoClub(undefined)).toBe(false);
    // The DEMO code without the flag, or the flag on another code.
    expect(clubs.isDemoClub({ ...clubs.findClub('DEMO')!, demo: undefined })).toBe(false);
    expect(
      clubs.isDemoClub({ code: 'STORM', name: 'Storm', supabaseUrl: 'x', anonKey: 'y', demo: true }),
    ).toBe(false);
  });
});

describe('a build without them', () => {
  it('has no demo club', () => {
    const clubs = build(BASE);
    expect(clubs.Clubs.map((c) => c.code)).toEqual(['THUNDER']);
    expect(clubs.findClub('DEMO')).toBeNull();
  });

  it('has none with only one of the two', () => {
    expect(build({ ...BASE, EXPO_PUBLIC_DEMO_CLUB_URL: DEMO.EXPO_PUBLIC_DEMO_CLUB_URL }).findClub('DEMO')).toBeNull();
    expect(build({ ...BASE, EXPO_PUBLIC_DEMO_CLUB_ANON_KEY: DEMO.EXPO_PUBLIC_DEMO_CLUB_ANON_KEY }).findClub('DEMO')).toBeNull();
  });
});

describe('the home club can never be the demo club', () => {
  it('a build made for the code DEMO keeps its own club, with no password box', () => {
    const clubs = build({ ...BASE, ...DEMO, EXPO_PUBLIC_CLUB_CODE: 'demo' });
    expect(clubs.Clubs).toHaveLength(1);
    expect(clubs.Clubs[0]).toEqual(
      expect.objectContaining({ code: 'DEMO', supabaseUrl: 'https://live.example.test' }),
    );
    expect(clubs.Clubs[0].demo).toBeUndefined();
    expect(clubs.isDemoClub(clubs.Clubs[0])).toBe(false);
    expect(clubs.isDemoClub({ ...clubs.Clubs[0], demo: true })).toBe(false);
  });

  it('listClubs drops a demo flag on the home club or any other club', () => {
    const clubs = build(BASE);
    const home = { code: 'THUNDER', name: 'Thunder', supabaseUrl: 'a', anonKey: 'b', demo: true as const };
    const other = { code: 'storm', name: 'Storm', supabaseUrl: 'c', anonKey: 'd', demo: true as const };
    const listed = clubs.listClubs(home, [other], null);
    expect(listed.map((c) => [c.code, c.demo])).toEqual([
      ['THUNDER', undefined],
      ['STORM', undefined],
    ]);
  });

  it('a demo club pointing at the home club\'s own project is left out', () => {
    const clubs = build({ ...BASE, ...DEMO, EXPO_PUBLIC_DEMO_CLUB_URL: BASE.EXPO_PUBLIC_SUPABASE_URL });
    expect(clubs.Clubs.map((c) => c.code)).toEqual(['THUNDER']);
    expect(clubs.findClub('DEMO')).toBeNull();
    expect(
      clubs.isDemoClub({
        code: 'DEMO',
        name: 'Demo',
        supabaseUrl: BASE.EXPO_PUBLIC_SUPABASE_URL,
        anonKey: 'k',
        demo: true,
      }),
    ).toBe(false);
  });

  it('a test club using the code DEMO is skipped for the demo club', () => {
    const clubs = build({
      ...BASE,
      ...DEMO,
      EXPO_PUBLIC_TEST_CLUB_2_CODE: 'DEMO',
      EXPO_PUBLIC_TEST_CLUB_2_NAME: 'Not the demo',
      EXPO_PUBLIC_TEST_CLUB_2_URL: 'https://other.example.test',
      EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY: 'other-key',
    });
    expect(clubs.Clubs.filter((c) => c.code === 'DEMO')).toHaveLength(1);
    // The first one listed wins, as for any taken code; it has no flag.
    expect(clubs.findClub('DEMO')?.name).toBe('Not the demo');
    expect(clubs.isDemoClub(clubs.findClub('DEMO'))).toBe(false);
  });
});

describe('demoClubFrom', () => {
  it('needs both the address and the key', () => {
    const clubs = build(BASE);
    expect(clubs.demoClubFrom({})).toBeNull();
    expect(clubs.demoClubFrom({ url: 'u' })).toBeNull();
    expect(clubs.demoClubFrom({ anonKey: 'k' })).toBeNull();
    expect(clubs.demoClubFrom({ url: 'u', anonKey: 'k' })?.demo).toBe(true);
  });
});
