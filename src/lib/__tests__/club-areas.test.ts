/**
 * The Club tab's areas (src/lib/club-areas.ts): which area each card and each
 * of the admin's links is in, what an area says, how the rows are laid out,
 * and what a search finds. Nothing here decides who sees a card or a link:
 * these check that whatever a member is given, all of it is somewhere, once.
 */
import * as fc from 'fast-check';

import { adminMenuItems } from '@/lib/admin-menu';
import type { FeatureKey, Features } from '@/lib/club';
import {
  AREA_ENTRIES,
  CLUB_AREAS,
  CLUB_CARDS,
  clubAreas,
  clubRows,
  clubWaitingTotal,
  FLAT_LIMIT,
  searchClub,
  searchMembers,
  shownIn,
  SUMMARY_NAMES,
  type ClubArea,
} from '@/lib/club-areas';
import { HOME_CARDS, placesFor, type HomeCard, type PlacementFacts } from '@/lib/home-layout';
import type { KpiRelation } from '@/lib/kpis';

// Every switch in FEATURES (src/lib/club.tsx); the type check fails if one is missing.
const KEYS = Object.keys({
  messages: true,
  chatGroups: true,
  calendar: true,
  teamEvents: true,
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
const menu = (features = allFeatures(true), squads = true) =>
  adminMenuItems({ features, squads, membersDetail: 'No requests waiting' });

/** Every card the Club tab can hold. */
const CLUB_CARD_NAMES = Object.keys(CLUB_CARDS) as HomeCard[];
/** What an admin with everything on is given. */
const ADMIN_CARDS: HomeCard[] = [
  'concerns',
  'checkIns',
  'attendance',
  'injuries',
  'administration',
  'registers',
  'surveys',
  'integrity',
  'kpis',
  'selectionAssessments',
];

const keysOf = (areas: ClubArea[]) => areas.flatMap((area) => area.entries.map((e) => e.key));
const titlesIn = (areas: ClubArea[], name: string) =>
  areas.find((area) => area.name === name)?.entries.map((e) => e.title);

describe('the five areas', () => {
  it('are People, Safety and conduct, Season, Reports and registers, and Club setup', () => {
    expect(CLUB_AREAS.map((area) => area.title)).toEqual([
      'People',
      'Safety and conduct',
      'Season',
      'Reports and registers',
      'Club setup',
    ]);
  });

  it('name every entry once', () => {
    const named = Object.values(AREA_ENTRIES).flat();
    expect(new Set(named).size).toBe(named.length);
  });

  it('name every one of the admin’s links, with every feature on', () => {
    const named = Object.values(AREA_ENTRIES).flat();
    for (const item of menu()) expect(named).toContain(String(item.href));
  });

  it('name every card the Club tab can hold', () => {
    const named = Object.values(AREA_ENTRIES).flat();
    for (const card of CLUB_CARD_NAMES) expect(named).toContain(card);
  });

  it('cover every card that can be placed in Club, apart from Administration (the menu)', () => {
    const relations: KpiRelation[] = ['self', 'guardian', 'setter', 'viewer'];
    const officer: PlacementFacts = {
      athlete: false,
      staff: false,
      guardian: false,
      clubOfficer: true,
      canSendSurveys: true,
      hasSurveys: true,
      hasOwnTraining: true,
      kpiRelations: relations,
    };
    const inClub = HOME_CARDS.filter((card) => placesFor(card, officer).includes('club'));
    expect(inClub).toContain('administration');
    expect(inClub.filter((card) => card !== 'administration').sort()).toEqual(
      [...CLUB_CARD_NAMES].sort(),
    );
  });

  it('put an admin’s things in order, most used first', () => {
    const areas = clubAreas({ cards: ADMIN_CARDS, links: menu() });
    expect(areas.map((area) => area.title)).toEqual(CLUB_AREAS.map((area) => area.title));
    expect(titlesIn(areas, 'people')).toEqual([
      'Members',
      'Check-ins',
      'Attendance',
      'Injuries',
      'Surveys',
      'Squads and teams',
      'Invite members',
      'Club captains',
    ]);
    expect(titlesIn(areas, 'safety')).toEqual([
      'Concerns',
      'Safeguarding',
      'Code of conduct',
      'Integrity training',
      'Integrity training courses',
    ]);
    expect(titlesIn(areas, 'season')).toEqual([
      'Selection assessments',
      'Season KPIs',
      'Seasons',
      'Fixtures',
      'Games',
      'Selection rounds and criteria',
      'Awards',
      'Season KPI reviews',
    ]);
    expect(titlesIn(areas, 'reports')).toEqual(['Reports', 'Registers']);
    expect(titlesIn(areas, 'setup')).toEqual([
      'Club features',
      'Club options',
      'Club brand',
      'Calendars',
      'Chat groups',
      'Absence reasons',
      'Record keeping',
      'Club password',
    ]);
  });

  it('no two things in an area share a name', () => {
    for (const area of clubAreas({ cards: [...ADMIN_CARDS, 'reports', 'sessionPlans'], links: menu() })) {
      const titles = area.entries.map((e) => e.title);
      // Reports is a card for the committee and a link for admins: never both.
      const own = area.name === 'reports' ? titles.filter((t) => t !== 'Reports') : titles;
      expect(new Set(own).size).toBe(own.length);
    }
  });

  it('whatever the switches and cards, everything given is in one area, once, and nothing else is', () => {
    fc.assert(
      fc.property(
        fc.record(Object.fromEntries(KEYS.map((k) => [k, fc.boolean()])) as Record<
          FeatureKey,
          fc.Arbitrary<boolean>
        >),
        fc.boolean(),
        fc.subarray(CLUB_CARD_NAMES),
        fc.boolean(),
        (features, squads, cards, admin) => {
          const links = admin ? menu(features as Features, squads) : [];
          const given: HomeCard[] = admin ? [...cards, 'administration'] : cards;
          const areas = clubAreas({ cards: given, links });
          const expected = [...cards, ...links.map((l) => String(l.href))];
          expect(keysOf(areas).sort()).toEqual([...expected].sort());
          // No area is empty, and the rows hold everything too.
          expect(areas.every((area) => area.entries.length > 0)).toBe(true);
          const inRows = clubRows(areas).flatMap((row) =>
            row.area ? row.area.entries.map((e) => e.key) : [row.entry.key],
          );
          expect(inRows.sort()).toEqual([...expected].sort());
        },
      ),
    );
  });

  it('a link no area names goes to the end of Club setup, so it can’t go missing', () => {
    const extra = { ...menu()[0], title: 'Something new', href: '/admin/something-new' as never };
    const areas = clubAreas({ cards: [], links: [...menu(), extra] });
    expect(titlesIn(areas, 'setup')?.at(-1)).toBe('Something new');
  });

  it('the Administration card on its own adds nothing: the links are the menu', () => {
    expect(clubAreas({ cards: ['administration'], links: [] })).toEqual([]);
  });

  it('a club without squads calls them Teams', () => {
    const areas = clubAreas({ cards: [], links: menu(allFeatures(true), false) });
    expect(titlesIn(areas, 'people')).toContain('Teams');
    expect(areas.find((a) => a.name === 'people')?.entries.map((e) => e.short)).toContain('teams');
  });
});

describe('what an area says', () => {
  it('lists what is inside, as one sentence', () => {
    const areas = clubAreas({ cards: ADMIN_CARDS, links: menu() });
    expect(areas.find((a) => a.name === 'reports')?.summary).toBe('Reports, registers');
  });

  it(`names the first ${SUMMARY_NAMES} things and counts the rest, so a row stays short`, () => {
    const areas = clubAreas({ cards: ADMIN_CARDS, links: menu() });
    expect(areas.find((a) => a.name === 'people')?.summary).toBe(
      'Members, check-ins, attendance and 5 more',
    );
    expect(areas.find((a) => a.name === 'safety')?.summary).toBe(
      'Concerns, safeguarding contacts, code of conduct and 2 more',
    );
    expect(areas.find((a) => a.name === 'setup')?.summary).toBe(
      'Features, options, brand and 5 more',
    );
    const committee = clubAreas({ cards: ['attendance', 'checkIns', 'injuries', 'surveys'], links: [] });
    expect(committee[0].summary).toBe('Check-ins, attendance, injuries and 1 more');
    // Three fit as they are.
    const three = clubAreas({ cards: ['attendance', 'checkIns', 'injuries'], links: [] });
    expect(three[0].summary).toBe('Check-ins, attendance, injuries');
  });

  it('with nothing waiting, has no count and nothing to say about it', () => {
    const areas = clubAreas({
      cards: ADMIN_CARDS,
      links: menu(),
      waiting: { '/admin': { count: 0, text: 'No requests waiting' } },
    });
    expect(areas.every((area) => area.waiting === 0)).toBe(true);
    // Closed, an area with nothing waiting shows nothing under its row.
    expect(areas.every((area) => shownIn(area, false).length === 0)).toBe(true);
    expect(clubWaitingTotal(areas)).toBe(0);
  });

  it('counts the work waiting in it, and says what it is', () => {
    const areas = clubAreas({
      cards: ADMIN_CARDS,
      links: menu(),
      waiting: {
        '/admin': { count: 2, text: '2 requests waiting for approval' },
        injuries: { count: 1, text: '1 injury waiting for you' },
        concerns: { count: 3, text: '3 new concerns to look at' },
      },
    });
    const people = areas.find((a) => a.name === 'people')!;
    expect(people.waiting).toBe(3);
    // Closed, it shows just what is waiting; open, everything.
    expect(shownIn(people, false).map((e) => e.title)).toEqual(['Members', 'Injuries']);
    expect(shownIn(people, true)).toEqual(people.entries);
    expect(people.entries.find((e) => e.key === '/admin')).toMatchObject({
      waiting: 2,
      waitingText: '2 requests waiting for approval',
    });
    const safety = areas.find((a) => a.name === 'safety')!;
    expect(safety.waiting).toBe(3);
    expect(shownIn(safety, false).map((e) => e.title)).toEqual(['Concerns']);
    expect(areas.find((a) => a.name === 'setup')).toMatchObject({ waiting: 0 });
    expect(clubWaitingTotal(areas)).toBe(6);
  });

  it('work behind something the member isn’t given counts for nothing', () => {
    // A committee member has no Members link, so requests to join aren't theirs.
    const areas = clubAreas({
      cards: ['checkIns', 'attendance', 'reports'],
      links: [],
      waiting: { '/admin': { count: 4, text: '4 requests waiting for approval' } },
    });
    expect(clubWaitingTotal(areas)).toBe(0);
  });
});

describe('the rows of the Club tab', () => {
  const rowsOf = (cards: HomeCard[], links = [] as ReturnType<typeof menu>) =>
    clubRows(clubAreas({ cards, links })).map((row) =>
      row.area ? `area:${row.area.title}` : row.entry.title,
    );

  it(`with ${FLAT_LIMIT} things or fewer, lists them as they are`, () => {
    expect(rowsOf(['checkIns', 'attendance', 'injuries', 'reports', 'integrity'])).toEqual([
      'Check-ins',
      'Attendance',
      'Injuries',
      'Integrity training',
      'Reports',
    ]);
  });

  it('with more, an area is a row, and an area holding one thing is that thing', () => {
    expect(
      rowsOf(['checkIns', 'attendance', 'injuries', 'reports', 'surveys', 'integrity']),
    ).toEqual(['area:People', 'Integrity training', 'Reports']);
    expect(
      rowsOf(['checkIns', 'attendance', 'injuries', 'reports', 'registers', 'surveys', 'integrity']),
    ).toEqual(['area:People', 'Integrity training', 'area:Reports and registers']);
  });

  it('an admin has the five areas', () => {
    expect(rowsOf([...ADMIN_CARDS], menu())).toEqual([
      'area:People',
      'area:Safety and conduct',
      'area:Season',
      'area:Reports and registers',
      'area:Club setup',
    ]);
  });

  it('nothing given, nothing shown', () => {
    expect(rowsOf([])).toEqual([]);
  });
});

describe('searching the Club tab', () => {
  const admin = clubAreas({ cards: ADMIN_CARDS, links: menu() });
  const committee = clubAreas({ cards: ['checkIns', 'attendance', 'reports'], links: [] });
  const found = (areas: ClubArea[], query: string) => searchClub(areas, query).map((e) => e.title);

  it.each([
    ['time zone', ['Club options']],
    ['TIME  Zone', ['Club options']],
    ['password', ['Club password']],
    ['logo', ['Club brand']],
    ['retention', ['Record keeping']],
    ['pilot', ['Club features']],
    ['playhq', ['Fixtures']],
    ['qr', ['Invite members']],
    ['escalation', ['Safeguarding']],
    ['child safety officer', ['Safeguarding']],
    ['criteria', ['Selection rounds and criteria']],
    ['conflicts', ['Registers']],
  ])('“%s” finds %j', (query, titles) => {
    expect(found(admin, query)).toEqual(titles);
  });

  it('puts what is named for the search ahead of what only holds it', () => {
    expect(found(admin, 'attendance')).toEqual(['Attendance', 'Reports']);
    expect(found(admin, 'integrity')).toEqual([
      'Integrity training',
      'Integrity training courses',
      'Reports',
    ]);
  });

  it('matches from the start of a word, not the middle of one', () => {
    // Not Injuries (medical), Safeguarding (escalation) or Reports (medical details).
    expect(found(admin, 'cal')).toEqual(['Calendars']);
    expect(found(admin, 'port')).toEqual([]);
    expect(found(admin, 'check ins')).toEqual(['Check-ins']);
    expect(found(admin, 'check-ins')).toEqual(['Check-ins']);
  });

  it('needs every word typed', () => {
    expect(found(admin, 'club password')).toEqual(['Club password']);
    expect(found(admin, 'password colours')).toEqual([]);
  });

  it('finds nothing for nothing', () => {
    expect(found(admin, '')).toEqual([]);
    expect(found(admin, '   ')).toEqual([]);
    expect(found(admin, 'zzzz')).toEqual([]);
  });

  it('only looks through what the member was given', () => {
    expect(found(committee, 'password')).toEqual([]);
    expect(found(committee, 'members')).toEqual([]);
    expect(found(committee, 'attendance')).toEqual(['Attendance', 'Reports']);
    fc.assert(
      fc.property(fc.string(), (query) => {
        const keys = keysOf(committee);
        expect(searchClub(committee, query).every((e) => keys.includes(e.key))).toBe(true);
      }),
    );
  });
});

describe('searching for a member', () => {
  const members = [
    { id: '1', full_name: 'Jordan Coach', preferred_name: null, email: 'jordan@example.com' },
    { id: '2', full_name: 'Alex Jordan', preferred_name: 'AJ', email: 'alex@example.com' },
    { id: '3', full_name: 'Sam Parent', email: 'sam@example.com', playhq_email: 'sp@example.org' },
    { id: '4', full_name: null, email: 'new.person@example.com' },
  ];
  const found = (query: string) => searchMembers(members, query).map((m) => m.id);

  it('finds by name, preferred name, sign-in email or PlayHQ email', () => {
    expect(found('sam')).toEqual(['3']);
    expect(found('aj')).toEqual(['2']);
    expect(found('new.person')).toEqual(['4']);
    expect(found('example.org')).toEqual(['3']);
  });

  it('puts names that start with what was typed first', () => {
    expect(found('jordan')).toEqual(['1', '2']);
  });

  it('needs every word, in any order and any case', () => {
    expect(found('JORDAN alex')).toEqual(['2']);
    expect(found('jordan sam')).toEqual([]);
  });

  it('waits for two letters', () => {
    expect(found('')).toEqual([]);
    expect(found('j')).toEqual([]);
    expect(found(' j ')).toEqual([]);
    expect(found('jo')).toEqual(['1', '2']);
  });
});
