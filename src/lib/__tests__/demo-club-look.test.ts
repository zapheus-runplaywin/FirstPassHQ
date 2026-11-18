import { ClubDefaults } from '@/constants/club';
import { contrastRatio, isHexColour, makeColors } from '@/constants/theme';

/**
 * The demo club's look, the Perth Pumpkins, is saved by "Reset demo club"
 * (supabase/demo-club.sql). These check the saved colours work in the app the
 * way Club settings asks of any club: text and buttons that read on the
 * background.
 */
jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);

const { readFileSync } = jest.requireActual('fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
};
const sql = readFileSync('supabase/demo-club.sql', 'utf8');

function saved(column: string) {
  const found = new RegExp(`${column} = '([^']*)'`).exec(sql);
  if (!found) throw new Error(`supabase/demo-club.sql doesn't set ${column}`);
  return found[1];
}

describe("the demo club's look", () => {
  const background = saved('background_colour');
  const text = saved('text_colour');
  const hero = saved('hero_colour');

  it('is the Perth Pumpkins, with a short name that fits file names', () => {
    expect(saved('club_name')).toBe('Perth Pumpkins');
    expect(saved('short_name')).toBe('Pumpkins');
  });

  it('saves colours the way Club settings does: capitals, and light or dark text', () => {
    for (const colour of [background, text, hero]) {
      expect(isHexColour(colour)).toBe(true);
      expect(colour).toBe(colour.toUpperCase());
    }
    expect(['#FFFFFF', '#000000']).toContain(text);
  });

  it('has text and buttons that read on its background', () => {
    const colors = makeColors({ background, text, hero });
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textSecondary, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.accent, colors.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, colors.backgroundElement)).toBeGreaterThanOrEqual(4.5);
  });

  it("is its own look, not the app's built-in one", () => {
    expect(background).not.toBe(ClubDefaults.background);
    expect(hero).not.toBe(ClubDefaults.hero);
  });
});
