/**
 * Saving the club's settings from the split pages (Club brand, Club features,
 * Club options): what each page sends back for the parts it doesn't change.
 * The screens' own tests are in src/__tests__/admin-club-settings.test.tsx.
 */
import { FEATURES, type Features } from '@/lib/club';
import { featuresToSave, saveClubProfile, savedLook } from '@/lib/club-settings';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('@/lib/club-choice', () => ({ useClubChoice: () => ({ club: null }) }));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);

const rpc = supabase.rpc as jest.Mock;

/** Every feature on its default: on, except those marked off by default. */
const defaults = () =>
  Object.fromEntries(
    FEATURES.map((f) => [f.key, !('offByDefault' in f && f.offByDefault)]),
  ) as Features;

beforeEach(() => rpc.mockReset());

describe('savedLook', () => {
  it('sends a club on the built-in look back as empty values', () => {
    expect(savedLook(null)).toEqual({
      clubName: '',
      shortName: '',
      background: '',
      text: '',
      hero: '',
      logoPath: '',
    });
    expect(savedLook(undefined).clubName).toBe('');
  });

  it('sends the saved look back exactly as saved', () => {
    expect(
      savedLook({
        club_name: 'Sample Netball Club',
        short_name: 'Sample',
        background_colour: '#FFFFFF',
        text_colour: '#000000',
        hero_colour: '#2274A5',
        logo_path: 'logo-1.png',
        features: { calendar: false },
        updated_at: '2026-11-01T00:00:00Z',
      }),
    ).toEqual({
      clubName: 'Sample Netball Club',
      shortName: 'Sample',
      background: '#FFFFFF',
      text: '#000000',
      hero: '#2274A5',
      logoPath: 'logo-1.png',
    });
  });
});

describe('featuresToSave', () => {
  it('stores nothing when every feature is on its default and squads are on', () => {
    expect(featuresToSave(defaults(), true)).toEqual({});
  });

  it('stores only switches away from their defaults, and squads only when off', () => {
    expect(
      featuresToSave({ ...defaults(), messages: false, kpis: true, registers: true }, false),
    ).toEqual({ messages: false, kpis: true, registers: true, squads: false });
  });
});

describe('saveClubProfile', () => {
  it('sends the look, features and squads in one save', async () => {
    rpc.mockResolvedValue({ error: null });
    const look = savedLook(null);
    expect(await saveClubProfile({ ...look, clubName: 'Hawks' }, defaults(), false)).toBeNull();
    expect(rpc).toHaveBeenCalledWith('admin_update_club_profile', {
      p_club_name: 'Hawks',
      p_short_name: '',
      p_background_colour: '',
      p_text_colour: '',
      p_hero_colour: '',
      p_logo_path: '',
      p_features: { squads: false },
    });
  });

  it('returns the database’s refusal', async () => {
    rpc.mockResolvedValue({ error: { message: 'Only admins can change club settings' } });
    expect(await saveClubProfile(savedLook(null), defaults(), true)).toBe(
      'Only admins can change club settings',
    );
  });
});
