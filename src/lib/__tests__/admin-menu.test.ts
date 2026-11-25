/**
 * adminMenuItems: the admin's menu, sorted alphabetically by title (Matt, 19
 * November 2026: "there are so many"), as "Everything, A to Z" lists it. The
 * screen test (src/__tests__/administration-by-feature.test.tsx) checks each
 * tile shows and opens; these check the order, the live Members line and the
 * switches. The Club tab's areas are in club-areas.test.ts.
 */
import { adminMenuItems } from '@/lib/admin-menu';
import type { FeatureKey, Features } from '@/lib/club';

// Every switch in FEATURES (src/lib/club.tsx); the type check fails if one is missing.
const KEYS = Object.keys({
  messages: true,
  chatGroups: true,
  calendar: true,
  checkIns: true,
  trainingLoad: true,
  injuries: true,
  attendance: true,
  sessionPlans: true,
  surveys: true,
  captainPolls: true,
  awards: true,
  liveStreams: true,
  goals: true,
  integrity: true,
  kpis: true,
  registers: true,
  selectionAssessments: true,
} satisfies Record<FeatureKey, true>) as FeatureKey[];

const allFeatures = (on: boolean) => Object.fromEntries(KEYS.map((k) => [k, on])) as Features;

const titles = (features: Features, squads = true) =>
  adminMenuItems({ features, squads, membersDetail: 'No requests waiting' }).map((i) => i.title);

describe('adminMenuItems', () => {
  it('lists every item alphabetically with every feature on', () => {
    expect(titles(allFeatures(true))).toEqual([
      'Absence reasons',
      'Awards',
      'Calendars',
      'Chat groups',
      'Club brand',
      'Club captains',
      'Club features',
      'Club options',
      'Club password',
      'Code of conduct',
      'Fixtures',
      'Games',
      'Integrity training courses',
      'Invite members',
      'Members',
      'Record keeping',
      'Reports',
      'Safeguarding',
      'Season KPI reviews',
      'Seasons',
      'Selection rounds and criteria',
      'Squads and teams',
    ]);
  });

  it('lists the always-on items alphabetically with every feature off', () => {
    expect(titles(allFeatures(false))).toEqual([
      'Club brand',
      'Club features',
      'Club options',
      'Club password',
      'Code of conduct',
      'Games',
      'Invite members',
      'Members',
      'Record keeping',
      'Reports',
      'Safeguarding',
      'Seasons',
      'Squads and teams',
    ]);
  });

  it('sorts Teams by its own name in a club without squads', () => {
    const list = titles(allFeatures(false), false);
    expect(list).not.toContain('Squads and teams');
    expect(list.at(-1)).toBe('Teams');
    expect(list.indexOf('Teams')).toBeGreaterThan(list.indexOf('Seasons'));
  });

  it('keeps any combination of switches in alphabetical order', () => {
    const keys = KEYS;
    for (let mask = 0; mask < 1 << keys.length; mask += 37) {
      const features = Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))])) as Features;
      for (const squads of [true, false]) {
        const list = titles(features, squads);
        const sorted = [...list].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
        expect(list).toEqual(sorted);
        expect(new Set(list).size).toBe(list.length);
      }
    }
  });

  it('gives Members the live requests line it was handed', () => {
    const items = adminMenuItems({
      features: allFeatures(true),
      squads: true,
      membersDetail: '3 requests waiting for approval',
    });
    expect(items.find((i) => i.title === 'Members')).toMatchObject({
      title: 'Members',
      detail: '3 requests waiting for approval',
      href: '/admin',
      icon: 'users',
      short: 'members',
    });
  });

  it('gives every item an icon, a short name and words to find it by', () => {
    // The type check keeps each icon to one the app has (IconName).
    const items = adminMenuItems({ features: allFeatures(true), squads: true, membersDetail: '' });
    for (const item of items) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.short.length).toBeGreaterThan(0);
      expect(Array.isArray(item.keywords)).toBe(true);
    }
    // A short name is how the item reads inside a sentence, and no two are the same.
    expect(new Set(items.map((i) => i.short)).size).toBe(items.length);
  });

  it('names nothing the same as a card the Club tab shows beside it', () => {
    // Integrity training and Selection assessments are cards there too.
    const list = titles(allFeatures(true));
    expect(list).not.toContain('Integrity training');
    expect(list).not.toContain('Selection assessments');
  });

  it('gives every item its own screen', () => {
    const items = adminMenuItems({ features: allFeatures(true), squads: true, membersDetail: '' });
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
  });

  it('splits the club’s settings into four pages that every club has, whatever is switched on', () => {
    for (const features of [allFeatures(true), allFeatures(false)]) {
      const items = adminMenuItems({ features, squads: false, membersDetail: '' });
      const pages = Object.fromEntries(items.map((i) => [i.title, i.href]));
      expect(pages).toMatchObject({
        'Club brand': '/admin/club/brand',
        'Club features': '/admin/club/features',
        'Club options': '/admin/club/options',
        'Record keeping': '/admin/club/records',
      });
      expect(items.map((i) => i.title)).not.toContain('Club settings');
    }
  });

  it('shows Fixtures while any of calendar, awards or goals is on', () => {
    for (const key of ['calendar', 'awards', 'goals'] as const) {
      expect(titles({ ...allFeatures(false), [key]: true })).toContain('Fixtures');
    }
    expect(titles(allFeatures(false))).not.toContain('Fixtures');
  });
});
