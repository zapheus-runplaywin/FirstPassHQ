/**
 * Where each thing lives once someone is in (src/lib/home-layout.ts): the hubs
 * a member's jobs give them, the tabs in the bar, and the place of every card
 * that used to be on the one Home screen. The rule that matters most: a card
 * the member is shown always has somewhere they can reach, whatever mix of
 * jobs they hold, so nothing they could open before can go missing.
 */
import * as fc from 'fast-check';

import {
  cardsIn,
  defaultHub,
  HOME_CARDS,
  HUBS,
  HUB_TITLES,
  hubsFor,
  placesFor,
  tabsFor,
  type HomeCard,
  type HubName,
  type Jobs,
  type Place,
  type PlacementFacts,
} from '@/lib/home-layout';
import type { KpiRelation } from '@/lib/kpis';

fc.configureGlobal({ seed: 20261125, numRuns: 2000 });

const NOBODY: Jobs = { athlete: false, staff: false, guardian: false, clubOfficer: false };

function facts(extra: Partial<PlacementFacts> = {}): PlacementFacts {
  return {
    ...NOBODY,
    canSendSurveys: false,
    hasSurveys: false,
    hasOwnTraining: false,
    kpiRelations: [],
    ...extra,
  };
}

const ATHLETE = facts({ athlete: true });
const COACH = facts({ staff: true, canSendSurveys: true });
const GUARDIAN = facts({ guardian: true });
const COMMITTEE = facts({ clubOfficer: true, canSendSurveys: true });
const GUEST = facts();

describe('hubsFor', () => {
  it.each<[string, Partial<Jobs>, HubName[]]>([
    ['an athlete', { athlete: true }, ['team']],
    ['a coach, manager or physio', { staff: true }, ['team']],
    ['a parent or guardian', { guardian: true }, ['family']],
    ['the committee or an admin', { clubOfficer: true }, ['club']],
    ['a coach who is a parent', { staff: true, guardian: true }, ['team', 'family']],
    ['an admin who coaches', { staff: true, clubOfficer: true }, ['team', 'club']],
    ['an athlete who coaches', { athlete: true, staff: true }, ['team']],
    ['someone with every job', { athlete: true, staff: true, guardian: true, clubOfficer: true }, ['team', 'family', 'club']],
    ['a guest, or someone whose roles are all paused', {}, []],
  ])('%s has %j', (_who, jobs, hubs) => {
    expect(hubsFor({ ...NOBODY, ...jobs })).toEqual(hubs);
  });

  it('names every hub', () => {
    expect(HUBS.map((hub) => HUB_TITLES[hub])).toEqual(['Team', 'Family', 'Club']);
  });
});

describe('defaultHub', () => {
  it.each<[string, HubName[], string | null, HubName | null]>([
    ['an admin who coaches starts on Club', ['team', 'club'], 'admin', 'club'],
    ['a committee member who coaches starts on Club', ['team', 'club'], 'committee', 'club'],
    ['a coach who is on the committee starts on Team', ['team', 'club'], 'coach', 'team'],
    ['a parent who coaches starts on Family', ['team', 'family'], 'guardian', 'family'],
    ['a coach who is a parent starts on Team', ['team', 'family'], 'coach', 'team'],
    ['an athlete starts on Team', ['team'], 'athlete', 'team'],
    ['a main role with no hub of its own takes the first they have', ['family', 'club'], 'coach', 'family'],
    ['an admin whose admin role is paused takes the first they have', ['team'], 'admin', 'team'],
    ['no role recorded takes the first they have', ['family'], null, 'family'],
    ['no hubs, no hub', [], 'guest', null],
  ])('%s', (_what, hubs, role, hub) => {
    expect(defaultHub(hubs, role)).toBe(hub);
  });
});

describe('tabsFor', () => {
  it('everything on: Today, Calendar, Messages, the hub, Me', () => {
    expect(tabsFor({ single: false, calendar: true, messages: true, hub: 'team' })).toEqual([
      'index',
      'calendar',
      'messages',
      'team',
      'me',
    ]);
  });

  it('a guest: no messages and no hub', () => {
    expect(tabsFor({ single: false, calendar: true, messages: false, hub: null })).toEqual([
      'index',
      'calendar',
      'me',
    ]);
  });

  it('the calendar switched off drops its tab only', () => {
    expect(tabsFor({ single: false, calendar: false, messages: true, hub: 'club' })).toEqual([
      'index',
      'messages',
      'club',
      'me',
    ]);
  });

  it('someone with one job to do has their one screen and nothing else, whatever is on', () => {
    expect(tabsFor({ single: true, calendar: true, messages: true, hub: 'team' })).toEqual(['index']);
  });

  it('always starts with Today and, with the tabs, ends with Me', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom<HubName | null>(null, ...HUBS),
        (calendar, messages, hub) => {
          const tabs = tabsFor({ single: false, calendar, messages, hub });
          expect(tabs[0]).toBe('index');
          expect(tabs.at(-1)).toBe('me');
          expect(new Set(tabs).size).toBe(tabs.length);
          expect(tabs.length).toBeLessThanOrEqual(5);
        },
      ),
    );
  });
});

describe('placesFor', () => {
  it.each<[HomeCard, string, PlacementFacts, Place[]]>([
    ['verification', 'a parent', GUARDIAN, ['today']],
    ['concerns', 'an admin', COMMITTEE, ['today', 'club']],
    ['concerns', 'a coach who is the Child Safety Officer', COACH, ['today']],
    ['dailyCheckIn', 'an athlete', ATHLETE, ['me']],
    ['myAttendance', 'an athlete', ATHLETE, ['me']],
    ['awards', 'an athlete', ATHLETE, ['me']],
    ['awards', 'a coach', COACH, ['me']],
    ['checkIns', 'a coach', COACH, ['team']],
    ['checkIns', 'the committee', COMMITTEE, ['club']],
    ['checkIns', 'an admin who coaches', { ...COACH, clubOfficer: true }, ['team', 'club']],
    ['attendance', 'a coach', COACH, ['team']],
    ['attendance', 'the committee', COMMITTEE, ['club']],
    ['injuries', 'an athlete', ATHLETE, ['me']],
    ['injuries', 'a parent', GUARDIAN, ['family']],
    ['injuries', 'a coach', COACH, ['team']],
    ['injuries', 'the committee', COMMITTEE, ['club']],
    ['injuries', 'an athlete who coaches and is a parent', { ...COACH, athlete: true, guardian: true }, ['me', 'family', 'team']],
    ['sessionPlans', 'an athlete', ATHLETE, ['team']],
    ['sessionPlans', 'a coach', COACH, ['team']],
    ['sessionPlans', 'a parent', GUARDIAN, ['family']],
    ['sessionPlans', 'a coach who is a parent: once, with their squads', { ...COACH, guardian: true }, ['team']],
    ['sessionPlans', 'the committee', COMMITTEE, ['club']],
    ['reports', 'the committee', COMMITTEE, ['club']],
    ['administration', 'an admin', COMMITTEE, ['club']],
    ['registers', 'the committee', COMMITTEE, ['club']],
    ['surveys', 'an athlete with one to answer', { ...ATHLETE, hasSurveys: true }, ['me']],
    ['surveys', 'a captain who can send them', { ...ATHLETE, canSendSurveys: true }, ['team']],
    ['surveys', 'a coach', COACH, ['team']],
    ['surveys', 'a coach with one to answer', { ...COACH, hasSurveys: true }, ['me', 'team']],
    ['surveys', 'the committee', COMMITTEE, ['club']],
    ['surveys', 'a parent with one to answer', { ...GUARDIAN, hasSurveys: true }, ['me']],
    ['integrity', 'a coach with training to do', { ...COACH, hasOwnTraining: true }, ['me']],
    ['integrity', 'the committee', COMMITTEE, ['club']],
    ['integrity', 'an admin with training to do', { ...COMMITTEE, hasOwnTraining: true }, ['me', 'club']],
    ['kpis', 'an athlete with their own', { ...ATHLETE, kpiRelations: ['self'] }, ['me']],
    ['kpis', 'a parent', { ...GUARDIAN, kpiRelations: ['guardian'] }, ['family']],
    ['kpis', 'a coach who sets them', { ...COACH, kpiRelations: ['setter'] }, ['team']],
    ['kpis', 'an admin who sees everyone’s', { ...COMMITTEE, kpiRelations: ['viewer'] }, ['club']],
    ['kpis', 'a coach with their own, who sets others’', { ...COACH, kpiRelations: ['self', 'setter'] }, ['me', 'team']],
    ['selectionAssessments', 'a coach on a panel', COACH, ['today', 'team']],
    ['selectionAssessments', 'an admin on a panel', COMMITTEE, ['today', 'club']],
    ['selectionAssessments', 'an admin who coaches: once, with their squads', { ...COACH, clubOfficer: true }, ['today', 'team']],
    ['selectionAssessments', 'a guest selector, who has no hub', GUEST, ['today']],
    ['selection', 'an athlete', ATHLETE, ['today', 'me']],
    ['selection', 'a parent', GUARDIAN, ['today', 'family']],
    ['guardianOf', 'a parent', GUARDIAN, ['family']],
    ['children', 'a parent', GUARDIAN, ['family']],
    ['groups', 'an athlete', ATHLETE, ['team']],
    ['groups', 'a coach', COACH, ['team']],
    ['groups', 'a parent', GUARDIAN, ['family']],
    ['groups', 'a coach who is a parent: once, in Team', { ...COACH, guardian: true }, ['team']],
  ])('%s for %s', (card, _who, who, places) => {
    expect(placesFor(card, who)).toEqual(places);
  });

  // The old Home showed these to people the hubs have no place for. They land in Me.
  it.each<[HomeCard, string, PlacementFacts]>([
    ['groups', 'a guest, or someone whose roles are paused', GUEST],
    ['groups', 'a committee member', COMMITTEE],
    ['injuries', 'a guest whose club lets them log injuries', GUEST],
    ['checkIns', 'a guest', GUEST],
    ['attendance', 'a guest', GUEST],
    ['sessionPlans', 'a guest shown a shared plan', GUEST],
    ['surveys', 'someone who can send but has no hub', { ...GUEST, canSendSurveys: true }],
    ['integrity', 'a guest with nothing of their own', GUEST],
    ['kpis', 'someone whose only KPIs are for a child they are no longer a guardian of', { ...ATHLETE, kpiRelations: ['guardian'] }],
    ['reports', 'someone with no Club hub', COACH],
    ['guardianOf', 'someone with no Family hub', COACH],
  ])('%s falls back to Me for %s', (card, _who, who) => {
    expect(placesFor(card, who)).toEqual(['me']);
  });

  const anyFacts: fc.Arbitrary<PlacementFacts> = fc.record({
    athlete: fc.boolean(),
    staff: fc.boolean(),
    guardian: fc.boolean(),
    clubOfficer: fc.boolean(),
    canSendSurveys: fc.boolean(),
    hasSurveys: fc.boolean(),
    hasOwnTraining: fc.boolean(),
    kpiRelations: fc.uniqueArray(fc.constantFrom<KpiRelation>('self', 'guardian', 'setter', 'viewer')),
  });

  it('every card has a place the member can reach, whatever mix of jobs they hold', () => {
    fc.assert(
      fc.property(anyFacts, fc.constantFrom(...HOME_CARDS), (who, card) => {
        const places = placesFor(card, who);
        expect(places.length).toBeGreaterThan(0);
        expect(new Set(places).size).toBe(places.length);
        const reachable: Place[] = ['today', 'me', ...hubsFor(who)];
        for (const place of places) expect(reachable).toContain(place);
      }),
    );
  });

  it('nothing is only ever on Today unless it is a job for today', () => {
    // Today's cards come and go with the work; everything lasting has a home in a hub or Me.
    const TODAY_ONLY: HomeCard[] = ['verification', 'concerns', 'selectionAssessments'];
    fc.assert(
      fc.property(anyFacts, fc.constantFrom(...HOME_CARDS), (who, card) => {
        const places = placesFor(card, who);
        if (places.every((place) => place === 'today')) expect(TODAY_ONLY).toContain(card);
      }),
    );
  });
});

describe('cardsIn', () => {
  it('gives each place only the cards that are shown, in the order Home had them', () => {
    const shown: HomeCard[] = ['groups', 'surveys', 'injuries', 'attendance', 'checkIns'];
    expect(cardsIn('team', shown, COACH)).toEqual(['checkIns', 'attendance', 'injuries', 'surveys', 'groups']);
    expect(cardsIn('me', shown, COACH)).toEqual([]);
    expect(cardsIn('today', shown, COACH)).toEqual([]);
  });

  it('puts a shown card in exactly the places placesFor names', () => {
    const everyPlace: Place[] = ['today', 'me', ...HUBS];
    fc.assert(
      fc.property(
        fc.record({
          athlete: fc.boolean(),
          staff: fc.boolean(),
          guardian: fc.boolean(),
          clubOfficer: fc.boolean(),
          canSendSurveys: fc.boolean(),
          hasSurveys: fc.boolean(),
          hasOwnTraining: fc.boolean(),
          kpiRelations: fc.uniqueArray(fc.constantFrom<KpiRelation>('self', 'guardian', 'setter', 'viewer')),
        }),
        fc.subarray([...HOME_CARDS]),
        (who, shown) => {
          const placed = everyPlace.flatMap((place) => cardsIn(place, shown, who).map((card) => [card, place] as const));
          // Every shown card is somewhere, and nothing that isn't shown is anywhere.
          expect(new Set(placed.map(([card]) => card))).toEqual(new Set(shown));
          for (const [card, place] of placed) expect(placesFor(card, who)).toContain(place);
        },
      ),
    );
  });
});
