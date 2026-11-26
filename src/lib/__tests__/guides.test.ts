import { GUIDE_FILES, GUIDES_URL, guideEdition, guideLinks, guideUrl } from '@/lib/guides';
import type { AppRole } from '@/lib/types';

const { readdirSync } = jest.requireActual('fs') as { readdirSync(path: string): string[] };

const titles = (club: string | null, roles: AppRole[]) =>
  guideLinks(club, roles).map((guide) => guide.title);

describe('guideEdition', () => {
  it('gives West Coast Thunder its own edition, however the code is typed', () => {
    expect(guideEdition('THUNDER')).toBe('thunder');
    expect(guideEdition(' thunder ')).toBe('thunder');
  });

  it('gives every other club, and no club, the FirstPass HQ edition', () => {
    for (const code of ['DEMO', 'BAYSIDE', 'TESTCLUB', 'THUNDER2', '', null, undefined]) {
      expect(guideEdition(code)).toBe('generic');
    }
  });
});

describe('guideLinks', () => {
  it('offers each role its own guide, in the club’s edition', () => {
    const expected: [AppRole, string, string][] = [
      ['athlete', 'Guide for athletes', 'athletes'],
      ['guardian', 'Guide for parents and guardians', 'guardians'],
      ['coach', 'Guide for coaches', 'coaches'],
      ['manager', 'Guide for managers', 'managers'],
      ['physio', 'Guide for physios', 'physios'],
      ['statistician', 'Guide for statisticians', 'statisticians'],
      ['committee', 'Guide for committee members', 'committee'],
      ['admin', 'Guide for admins', 'admins'],
      ['volunteer', 'Guide for temporary helpers', 'temporary-helpers'],
      ['guest', 'Guide for guests', 'guests'],
    ];
    for (const [role, title, file] of expected) {
      expect(guideLinks('THUNDER', [role])).toEqual([
        { role, title, url: `${GUIDES_URL}/thunder/user-guide-${file}.pdf` },
      ]);
      expect(guideLinks('DEMO', [role])).toEqual([
        { role, title, url: `${GUIDES_URL}/generic/user-guide-${file}.pdf` },
      ]);
    }
  });

  it('offers one guide per role held, main role first, each once', () => {
    expect(titles('THUNDER', ['coach', 'guardian', 'coach'])).toEqual([
      'Guide for coaches',
      'Guide for parents and guardians',
    ]);
    expect(titles('THUNDER', ['guardian', 'admin', 'committee'])).toEqual([
      'Guide for parents and guardians',
      'Guide for admins',
      'Guide for committee members',
    ]);
  });

  it('leaves the guest guide out for anyone with another guide', () => {
    // A coach whose roles are paused shows as a guest but still coaches.
    expect(titles('THUNDER', ['guest', 'coach'])).toEqual(['Guide for coaches']);
  });

  it('gives the guest guide to someone with no guide of their own', () => {
    expect(titles('THUNDER', ['studio'])).toEqual(['Guide for guests']);
    expect(titles('THUNDER', [])).toEqual(['Guide for guests']);
    // Studio adds nothing in HQ, so a manager who also runs Studio reads the managers' guide.
    expect(titles('THUNDER', ['manager', 'studio'])).toEqual(['Guide for managers']);
  });

  it('only ever links to the published guides, over https', () => {
    for (const guide of guideLinks('THUNDER', ['athlete', 'coach', 'admin', 'guest'])) {
      expect(guide.url.startsWith(`${GUIDES_URL}/`)).toBe(true);
      expect(guide.url).toMatch(/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9/-]+\.pdf$/);
    }
  });
});

describe('the guides the app links to', () => {
  // The PDFs in docs/pdfs are what "Publish guides" puts online: every guide
  // the app can link to must be among them, for both editions it uses.
  const published = (edition: string) =>
    readdirSync(`docs/pdfs/${edition}/user-guides`).map(
      (name) => /-user-guide-(.+)-build-\d+\.pdf$/.exec(name)?.[1],
    );

  it.each(['thunder', 'generic'])('are all in docs/pdfs/%s/user-guides', (edition) => {
    expect([...published(edition)].sort()).toEqual([...GUIDE_FILES].sort());
  });

  it('are addressed the way scripts/build-guides-site.py names them', () => {
    expect(guideUrl('THUNDER', 'athletes')).toBe(
      'https://zapheus-runplaywin.github.io/FirstPassHQ/guides/thunder/user-guide-athletes.pdf',
    );
  });
});
