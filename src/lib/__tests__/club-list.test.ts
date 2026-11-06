/**
 * The list of clubs and associations the app can connect to, built from the
 * build's environment (src/constants/clubs.ts).
 */

const BASE = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://thunder.example.test',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'thunder-key',
  EXPO_PUBLIC_CLUB_CODE: 'THUNDER',
  EXPO_PUBLIC_CLUB_NAME: 'West Coast Thunder',
};

const ASSOCIATION = {
  EXPO_PUBLIC_CLUB_2_CODE: 'wcmmna',
  EXPO_PUBLIC_CLUB_2_NAME: 'Sample Association',
  EXPO_PUBLIC_CLUB_2_URL: 'https://association.example.test',
  EXPO_PUBLIC_CLUB_2_ANON_KEY: 'association-key',
};

const saved = { ...process.env };

/** Loads a fresh copy of the club list with these values in the environment. */
function loadClubs(env: Record<string, string>) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXPO_PUBLIC_')) delete process.env[key];
  }
  Object.assign(process.env, env);
  let mod: typeof import('@/constants/clubs') | undefined;
  jest.isolateModules(() => {
    mod = jest.requireActual('@/constants/clubs');
  });
  return mod!;
}

afterEach(() => {
  process.env = { ...saved };
});

describe('club list', () => {
  it('has only the home club when no other club or association is set', () => {
    const { Clubs } = loadClubs(BASE);
    expect(Clubs.map((c) => c.code)).toEqual(['THUNDER']);
  });

  it('adds a second organisation from the environment, with its own project', () => {
    const { Clubs, findClub } = loadClubs({ ...BASE, ...ASSOCIATION });
    expect(Clubs.map((c) => c.code)).toEqual(['THUNDER', 'WCMMNA']);
    expect(findClub('Wcm mna')).toEqual({
      code: 'WCMMNA',
      name: 'Sample Association',
      supabaseUrl: 'https://association.example.test',
      anonKey: 'association-key',
    });
    // Each code reaches only its own project.
    expect(findClub('thunder')?.supabaseUrl).toBe('https://thunder.example.test');
  });

  it('adds a third organisation too', () => {
    const { Clubs } = loadClubs({
      ...BASE,
      ...ASSOCIATION,
      EXPO_PUBLIC_CLUB_3_CODE: 'STORM',
      EXPO_PUBLIC_CLUB_3_NAME: 'Sample Storm',
      EXPO_PUBLIC_CLUB_3_URL: 'https://storm.example.test',
      EXPO_PUBLIC_CLUB_3_ANON_KEY: 'storm-key',
    });
    expect(Clubs.map((c) => c.code)).toEqual(['THUNDER', 'WCMMNA', 'STORM']);
  });

  it('leaves out an organisation that is missing any value', () => {
    for (const missing of Object.keys(ASSOCIATION)) {
      const { Clubs } = loadClubs({ ...BASE, ...ASSOCIATION, [missing]: '' });
      expect(Clubs.map((c) => c.code)).toEqual(['THUNDER']);
    }
  });

  it("never lets another organisation take the home club's code", () => {
    const { Clubs, findClub } = loadClubs({ ...BASE, ...ASSOCIATION, EXPO_PUBLIC_CLUB_2_CODE: 'thunder' });
    expect(Clubs).toHaveLength(1);
    expect(findClub('THUNDER')?.supabaseUrl).toBe('https://thunder.example.test');
  });

  it('keeps the first of two organisations with the same code', () => {
    const { Clubs } = loadClubs({
      ...BASE,
      ...ASSOCIATION,
      EXPO_PUBLIC_TEST_CLUB_2_CODE: 'WCMMNA',
      EXPO_PUBLIC_TEST_CLUB_2_NAME: 'Duplicate',
      EXPO_PUBLIC_TEST_CLUB_2_URL: 'https://duplicate.example.test',
      EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY: 'duplicate-key',
    });
    expect(Clubs.map((c) => c.name)).toEqual(['West Coast Thunder', 'Sample Association']);
  });
});
