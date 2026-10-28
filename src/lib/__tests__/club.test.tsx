/**
 * The club's name, colours, logo and feature switches (src/lib/club.tsx),
 * from "Club settings" in section 10 of docs/user-guide.md.
 *
 * Features an admin hasn't touched take the app's default: on, except Season
 * KPIs and Affiliation records, which start off. Signed-out screens show
 * what this device saw last time for the club it's connected to, never
 * another club's look; once signed in, the latest settings load and are
 * saved for next time.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Colors } from '@/constants/theme';
import {
  ClubProvider,
  defaultLogo,
  FEATURES,
  firstPassLogo,
  offByDefault,
  resolveClub,
  useClub,
  useClubColors,
  useFeature,
  useSquads,
  type ClubProfile,
} from '@/lib/club';
import { supabase } from '@/lib/supabase';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
let mockChosen: { code: string; name: string } | null = { code: 'THUNDER', name: 'West Coast Thunder' };
jest.mock('@/lib/club-choice', () => ({ useClubChoice: () => ({ club: mockChosen }) }));

/** The values constantsClubMock gives the logos. */
const HQ_ON_DARK = 1;
const HQ_ON_LIGHT = 2;
const MARK_ON_DARK = 4;
const MARK_ON_LIGHT = 5;

function saved(extra: Partial<ClubProfile> = {}): ClubProfile {
  return {
    club_name: 'West Coast Thunder',
    short_name: 'Thunder',
    background_colour: '#102030',
    text_colour: '#ffffff',
    hero_colour: '#ff8800',
    logo_path: null,
    features: {},
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

const client = supabase as unknown as {
  rpc: jest.Mock;
  storage: { from: jest.Mock };
};

beforeEach(async () => {
  mockChosen = { code: 'THUNDER', name: 'West Coast Thunder' };
  await AsyncStorage.clear();
  client.rpc.mockReset();
  client.storage.from.mockReset();
  client.storage.from.mockImplementation((bucket: string) => ({
    getPublicUrl: (path: string) => ({
      data: { publicUrl: `https://example.test/${bucket}/${path}` },
    }),
  }));
});

describe('resolveClub', () => {
  it('uses the build’s defaults when nothing is saved', () => {
    const club = resolveClub(null);
    expect(club.name).toBe('FirstPass HQ');
    expect(club.shortName).toBe('FirstPass');
    expect(club.colors.background).toBe('#0F172A');
    expect(club.colors.text).toBe('#FFFFFF');
    expect(club.colors.tint).toBe('#F75C03');
    expect(club.hasLogo).toBe(false);
    // The FirstPass mark that reads on the navy background.
    expect(club.logo).toBe(MARK_ON_DARK);
    expect(club.squads).toBe(true);
    expect(club.affiliation).toBe(false);
  });

  it('starts every feature on except training load flags, Season KPIs and the registers', () => {
    const offs = ['trainingLoad', 'kpis', 'registers'];
    const { features } = resolveClub(null);
    for (const f of FEATURES) {
      expect([f.key, features[f.key]]).toEqual([f.key, !offs.includes(f.key)]);
    }
    expect(FEATURES.filter(offByDefault).map((f) => f.key)).toEqual(offs);
  });

  it('turns off only what the admin turned off, and Season KPIs on only when turned on', () => {
    const { features } = resolveClub(
      saved({ features: { injuries: false, messages: true, kpis: true } }),
    );
    expect(features.injuries).toBe(false);
    expect(features.messages).toBe(true);
    expect(features.kpis).toBe(true);
    expect(features.calendar).toBe(true);
  });

  it.each([
    [{ kpis: 'yes' as unknown as boolean }, false],
    [{ kpis: null as unknown as boolean }, false],
  ])('treats anything but true as Season KPIs off: %p', (features, on) => {
    expect(resolveClub(saved({ features })).features.kpis).toBe(on);
  });

  it('uses squads unless turned off, and affiliation only once turned on', () => {
    expect(resolveClub(saved({ features: { squads: false } })).squads).toBe(false);
    expect(resolveClub(saved({ features: { affiliation: true } })).affiliation).toBe(true);
    expect(resolveClub(saved({ features: { affiliation: false } })).affiliation).toBe(false);
  });

  it('uses the saved name, and the colours in capitals', () => {
    const club = resolveClub(saved());
    expect(club.name).toBe('West Coast Thunder');
    expect(club.shortName).toBe('Thunder');
    expect(club.colors.background).toBe('#102030');
    expect(club.colors.text).toBe('#FFFFFF');
    expect(club.colors.tint).toBe('#FF8800');
  });

  it.each(['red', '#FFF', '#GGGGGG', ''])('falls back to the default for a colour like %p', (bad) => {
    const club = resolveClub(saved({ background_colour: bad, hero_colour: bad, club_name: '' }));
    expect(club.colors.background).toBe('#0F172A');
    expect(club.colors.tint).toBe('#F75C03');
    expect(club.name).toBe('FirstPass HQ');
  });

  it('shows the club’s own logo from the branding bucket once uploaded', () => {
    const club = resolveClub(saved({ logo_path: 'logo-v2.png' }));
    expect(club.hasLogo).toBe(true);
    expect(club.logo).toEqual({ uri: 'https://example.test/club-branding/logo-v2.png' });
    expect(client.storage.from).toHaveBeenCalledWith('club-branding');
  });

  it('picks the FirstPass mark that reads on a light background', () => {
    expect(resolveClub(saved({ background_colour: '#FAFAFA', text_colour: '#111111' })).logo).toBe(
      MARK_ON_LIGHT,
    );
  });
});

describe('the logos for a background', () => {
  it.each([
    ['#0F172A', HQ_ON_DARK, MARK_ON_DARK],
    ['#000000', HQ_ON_DARK, MARK_ON_DARK],
    ['#FFFFFF', HQ_ON_LIGHT, MARK_ON_LIGHT],
    ['#F1C40F', HQ_ON_LIGHT, MARK_ON_LIGHT],
  ])('on %s', (background, hq, mark) => {
    expect(firstPassLogo(background)).toBe(hq);
    expect(defaultLogo(background)).toBe(mark);
  });
});

describe('ClubProvider', () => {
  const wrapper = (signedIn: boolean) => {
    function Wrapper({ children }: { children: ReactNode }) {
      return <ClubProvider signedIn={signedIn}>{children}</ClubProvider>;
    }
    return Wrapper;
  };

  function rpcReturns(rows: ClubProfile[] | null, error: { message: string } | null = null) {
    client.rpc.mockImplementation(async () => ({ data: rows, error }));
  }

  async function open(signedIn: boolean) {
    const hook = renderHook(
      () => ({ club: useClub(), injuries: useFeature('injuries'), squads: useSquads() }),
      { wrapper: wrapper(signedIn) },
    );
    await act(async () => {});
    return hook;
  }

  it('signed out, shows what this device saw last for this club, without asking the database', async () => {
    await AsyncStorage.setItem('club-profile:THUNDER', JSON.stringify(saved({ features: { injuries: false } })));
    rpcReturns([saved()]);
    const { result } = await open(false);
    expect(result.current.club.ready).toBe(true);
    expect(result.current.club.name).toBe('West Coast Thunder');
    expect(result.current.injuries).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('never shows another club’s saved look', async () => {
    await AsyncStorage.setItem('club-profile:STORM', JSON.stringify(saved({ club_name: 'Sample Storm' })));
    const { result } = await open(false);
    expect(result.current.club.name).toBe('FirstPass HQ');
  });

  it('before a club is picked, uses the build’s defaults and is ready at once', async () => {
    mockChosen = null;
    await AsyncStorage.setItem('club-profile:THUNDER', JSON.stringify(saved()));
    const { result } = renderHook(() => useClub(), { wrapper: wrapper(false) });
    expect(result.current.ready).toBe(true);
    await act(async () => {});
    expect(result.current.name).toBe('FirstPass HQ');
  });

  it('signed in, loads the latest settings and saves them for this club', async () => {
    rpcReturns([saved({ club_name: 'Thunder Netball', features: { squads: false } })]);
    const { result } = await open(true);
    expect(client.rpc).toHaveBeenCalledWith('club_profile');
    expect(result.current.club.name).toBe('Thunder Netball');
    expect(result.current.squads).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem('club-profile:THUNDER'))!)).toMatchObject({
      club_name: 'Thunder Netball',
    });
  });

  it.each([
    ['an error', null, { message: 'offline' }],
    ['no rows', [], null],
  ])('keeps the saved look when loading gives %s', async (_l, rows, error) => {
    await AsyncStorage.setItem('club-profile:THUNDER', JSON.stringify(saved({ club_name: 'Saved Name' })));
    rpcReturns(rows as ClubProfile[] | null, error);
    const { result } = await open(true);
    expect(result.current.club.name).toBe('Saved Name');
    expect(JSON.parse((await AsyncStorage.getItem('club-profile:THUNDER'))!).club_name).toBe('Saved Name');
  });

  it('reload fetches the settings again, as after an admin saves them', async () => {
    rpcReturns([saved({ club_name: 'Before' })]);
    const { result } = await open(true);
    rpcReturns([saved({ club_name: 'After', features: { injuries: false } })]);
    await act(async () => {
      await result.current.club.reload();
    });
    expect(result.current.club.name).toBe('After');
    expect(result.current.injuries).toBe(false);
  });

  it('the latest settings win over a slower read of the saved ones', async () => {
    await AsyncStorage.setItem('club-profile:THUNDER', JSON.stringify(saved({ club_name: 'Old' })));
    const getItem = AsyncStorage.getItem as jest.Mock;
    let release: (v: string | null) => void = () => {};
    getItem.mockImplementationOnce(() => new Promise((r) => (release = r)));
    rpcReturns([saved({ club_name: 'New' })]);
    const { result } = await open(true);
    expect(result.current.club.name).toBe('New');
    await act(async () => release(JSON.stringify(saved({ club_name: 'Old' }))));
    expect(result.current.club.name).toBe('New');
  });
});

describe('outside ClubProvider', () => {
  it('useClub refuses', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Bare() {
      useClub();
      return null;
    }
    expect(() => render(<Bare />)).toThrow('useClub must be used inside ClubProvider');
    error.mockRestore();
  });

  it('useClubColors gives the build’s palette', () => {
    const { result } = renderHook(() => useClubColors());
    expect(result.current).toBe(Colors);
  });
});
