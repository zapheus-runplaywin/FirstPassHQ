/**
 * What each kind of member is offered on a session ("A session's page" in
 * section 3 of docs/user-guide.md): Can't make it, Take attendance, the
 * session plan and Check-ins. These are shortcuts to screens with their own
 * rules, so each is checked both ways: offered to the people who use that
 * screen for this squad or team, and not to anyone else.
 */
import { setClubTimeZone } from '@/lib/club-time';
import { sessionActions, type SessionEvent, type SessionFacts } from '@/lib/session';

// 18 October 2026, 10:00 in Perth.
const NOW = new Date('2026-10-18T02:00:00Z');

beforeEach(() => setClubTimeZone('Australia/Perth'));

const SQUAD = 'squad-1';
const OTHER = 'squad-2';

/** Training for the squad, later today. */
const TRAINING: SessionEvent = {
  id: 'ev-1',
  title: 'Tuesday training',
  start: new Date('2026-10-18T09:00:00Z'),
  end: new Date('2026-10-18T10:30:00Z'),
  clubWide: false,
  teamIds: [SQUAD],
};
const CLUB_EVENT: SessionEvent = { ...TRAINING, id: 'ev-2', title: 'Club day', clubWide: true, teamIds: [] };

const NOBODY: SessionFacts = {
  now: NOW,
  userId: 'me',
  features: { attendance: true, sessionPlans: true, checkIns: true },
  memberships: [],
  isAthlete: false,
  children: [],
  canTakeAttendance: false,
  ledTeamIds: [],
  leadsEveryTeam: false,
  plans: [],
  planTeamIds: [],
  plansForEveryTeam: false,
  checkIns: [],
};

const in_ = (role: SessionFacts['memberships'][number]['role'], teamId = SQUAD) => [{ teamId, role }];

/** Each kind of member, as the app would describe them. */
const MEMBERS: Record<string, SessionFacts> = {
  athlete: { ...NOBODY, isAthlete: true, memberships: in_('athlete') },
  athleteElsewhere: { ...NOBODY, isAthlete: true, memberships: in_('athlete', OTHER) },
  guardian: {
    ...NOBODY,
    memberships: in_('guardian'),
    children: [{ id: 'child-1', name: 'Riley' }],
  },
  guardianElsewhere: {
    ...NOBODY,
    memberships: in_('guardian', OTHER),
    children: [{ id: 'child-1', name: 'Riley' }],
  },
  coach: {
    ...NOBODY,
    memberships: in_('coach'),
    canTakeAttendance: true,
    ledTeamIds: [SQUAD],
    planTeamIds: [SQUAD],
    checkIns: [{ team_id: SQUAD, athlete_count: 12, checked_in_count: 9, flagged_count: 2 }],
  },
  coachElsewhere: {
    ...NOBODY,
    memberships: in_('coach', OTHER),
    canTakeAttendance: true,
    ledTeamIds: [OTHER],
    planTeamIds: [OTHER],
    checkIns: [{ team_id: OTHER, athlete_count: 8, checked_in_count: 8, flagged_count: 0 }],
  },
  manager: { ...NOBODY, memberships: in_('manager'), canTakeAttendance: true, ledTeamIds: [SQUAD] },
  physio: { ...NOBODY, memberships: in_('physio') },
  committee: { ...NOBODY, canTakeAttendance: true },
  admin: { ...NOBODY, canTakeAttendance: true, leadsEveryTeam: true, plansForEveryTeam: true },
  guest: NOBODY,
};

const kinds = (event: SessionEvent, facts: SessionFacts) => sessionActions(event, facts).map((a) => a.kind);

describe('a squad’s session, for each kind of member', () => {
  it.each([
    ['athlete', ['absence']],
    ['athleteElsewhere', []],
    ['guardian', ['absence']],
    ['guardianElsewhere', []],
    ['coach', ['attendance', 'addPlan', 'checkIns']],
    ['coachElsewhere', []],
    ['manager', ['attendance']],
    ['physio', []],
    ['committee', []],
    ['admin', ['attendance', 'addPlan']],
    ['guest', []],
  ])('%s is offered %j', (who, expected) => {
    expect(kinds(TRAINING, MEMBERS[who])).toEqual(expected);
  });
});

describe('a club-wide session, for each kind of member', () => {
  it.each([
    ['athlete', ['absence']],
    ['athleteElsewhere', ['absence']],
    ['guardian', ['absence']],
    ['guardianElsewhere', ['absence']],
    // Whole-club attendance, as the take-attendance screen offers them.
    ['coach', ['attendance']],
    ['manager', ['attendance']],
    ['committee', ['attendance']],
    ['admin', ['attendance']],
    ['physio', []],
    ['guest', []],
  ])('%s is offered %j', (who, expected) => {
    expect(kinds(CLUB_EVENT, MEMBERS[who])).toEqual(expected);
  });

  it('a calendar shown to every athlete, by their role, counts the same way', () => {
    const camp: SessionEvent = { ...TRAINING, teamIds: [], forAthletes: true };
    expect(kinds(camp, MEMBERS.athleteElsewhere)).toEqual(['absence']);
    expect(kinds(camp, MEMBERS.guardianElsewhere)).toEqual(['absence']);
    expect(kinds(camp, MEMBERS.manager)).toEqual(['attendance']);
    expect(kinds(camp, MEMBERS.committee)).toEqual(['attendance']);
    expect(kinds(camp, MEMBERS.physio)).toEqual([]);
  });

  it('a squad’s calendar that is also shown to every athlete is for every athlete', () => {
    const open: SessionEvent = { ...TRAINING, forAthletes: true };
    expect(kinds(open, MEMBERS.athleteElsewhere)).toEqual(['absence']);
    // Its own coach still takes the squad's register, not the whole club's.
    expect(sessionActions(open, MEMBERS.coach)[0].href).toEqual({
      pathname: '/attendance/new',
      params: { team: SQUAD, event: 'ev-1' },
    });
  });
});

// A committee meeting, a physios' roster, a safeguarding officers' calendar:
// shown by role or post, with no squad or team and not to athletes. It isn't
// a session athletes attend, so nobody is offered anything about it.
describe('a calendar shown only to other roles or a post', () => {
  const MEETING: SessionEvent = { ...TRAINING, id: 'ev-3', title: 'Committee meeting', teamIds: [] };

  it.each(Object.keys(MEMBERS))('%s is offered nothing', (who) => {
    expect(kinds(MEETING, MEMBERS[who])).toEqual([]);
    expect(kinds({ ...MEETING, teamIds: undefined, forAthletes: false }, MEMBERS[who])).toEqual([]);
  });

  it('not even an athlete who is on the committee, or a parent who is', () => {
    expect(kinds(MEETING, { ...MEMBERS.athlete, canTakeAttendance: true })).toEqual([]);
    expect(kinds(MEETING, { ...MEMBERS.guardian, canTakeAttendance: true })).toEqual([]);
  });
});

describe('Can’t make it', () => {
  it('opens the absence form for the athlete, on the session’s day', () => {
    expect(sessionActions(TRAINING, MEMBERS.athlete)).toEqual([
      {
        key: 'absence:me',
        kind: 'absence',
        icon: 'x',
        title: 'Can’t make it',
        detail: 'Tell your coaches you’ll be away',
        href: { pathname: '/attendance/absence', params: { id: 'me', day: '2026-10-18' } },
      },
    ]);
  });

  it('uses the club’s day, not the phone’s or UTC’s', () => {
    // 6:30 am on 20 October in Perth is still 19 October in UTC.
    const early = { ...TRAINING, start: new Date('2026-10-19T22:30:00Z'), end: new Date('2026-10-19T23:30:00Z') };
    const [action] = sessionActions(early, MEMBERS.athlete);
    expect(action.href).toMatchObject({ params: { day: '2026-10-20' } });
  });

  it('gives a parent one for each child, by name', () => {
    const facts = {
      ...MEMBERS.guardian,
      children: [
        { id: 'child-1', name: 'Riley' },
        { id: 'child-2', name: 'Jesse' },
      ],
    };
    expect(sessionActions(TRAINING, facts).map((a) => [a.title, a.href])).toEqual([
      ['Riley can’t make it', { pathname: '/attendance/absence', params: { id: 'child-1', name: 'Riley', day: '2026-10-18' } }],
      ['Jesse can’t make it', { pathname: '/attendance/absence', params: { id: 'child-2', name: 'Jesse', day: '2026-10-18' } }],
    ]);
  });

  it('gives a parent who also plays their own first, then their child’s', () => {
    const facts = { ...MEMBERS.guardian, isAthlete: true, memberships: [...in_('athlete'), ...in_('guardian')] };
    expect(sessionActions(TRAINING, facts).map((a) => a.title)).toEqual(['Can’t make it', 'Riley can’t make it']);
  });

  it('isn’t offered to a parent with no child linked', () => {
    expect(kinds(TRAINING, { ...MEMBERS.guardian, children: [] })).toEqual([]);
  });

  it('goes once the session is over', () => {
    const after = new Date('2026-10-18T10:30:00Z');
    expect(kinds(TRAINING, { ...MEMBERS.athlete, now: after })).toEqual([]);
    expect(kinds(TRAINING, { ...MEMBERS.athlete, now: new Date(after.getTime() - 1) })).toEqual(['absence']);
  });

  it('isn’t offered while the club has Attendance switched off', () => {
    const off = { ...NOBODY.features, attendance: false };
    expect(kinds(TRAINING, { ...MEMBERS.athlete, features: off })).toEqual([]);
    expect(kinds(TRAINING, { ...MEMBERS.guardian, features: off })).toEqual([]);
  });
});

describe('Take attendance', () => {
  const at = (iso: string) => ({ ...TRAINING, start: new Date(iso), end: new Date(new Date(iso).getTime() + 5400000) });

  it('opens the register with the squad and the session chosen', () => {
    const [action] = sessionActions(TRAINING, MEMBERS.manager);
    expect(action).toMatchObject({
      title: 'Take attendance',
      href: { pathname: '/attendance/new', params: { team: SQUAD, event: 'ev-1' } },
    });
  });

  it('opens whole-club attendance for a club-wide session', () => {
    const [action] = sessionActions(CLUB_EVENT, MEMBERS.committee);
    expect(action.href).toEqual({ pathname: '/attendance/new', params: { team: 'club', event: 'ev-2' } });
  });

  it('picks the squad they lead when a calendar is for several', () => {
    const [action] = sessionActions({ ...TRAINING, teamIds: [OTHER, SQUAD] }, MEMBERS.manager);
    expect(action.href).toMatchObject({ params: { team: SQUAD } });
  });

  it.each([
    ['tomorrow', '2026-10-19T09:00:00Z', false],
    ['earlier today', '2026-10-17T23:00:00Z', true],
    ['7 days ago', '2026-10-11T09:00:00Z', true],
    ['8 days ago', '2026-10-10T09:00:00Z', false],
  ])('for a session %s: %s', (_when, iso, offered) => {
    expect(kinds(at(iso), MEMBERS.manager).includes('attendance')).toBe(offered);
  });

  it('isn’t offered while the club has Attendance switched off', () => {
    const off = { ...NOBODY.features, attendance: false };
    expect(kinds(TRAINING, { ...MEMBERS.manager, features: off })).toEqual([]);
  });

  it('isn’t offered to someone whose role can’t take attendance, whatever squads they list', () => {
    expect(kinds(TRAINING, { ...MEMBERS.manager, canTakeAttendance: false })).toEqual([]);
  });
});

describe('the session plan', () => {
  const PLAN = { id: 'plan-1', title: 'Defence under pressure', team_id: SQUAD, session_on: '2026-10-18' };

  it('opens the plan written for this squad on this day', () => {
    const actions = sessionActions(TRAINING, { ...MEMBERS.athlete, plans: [PLAN] });
    expect(actions.find((a) => a.kind === 'plan')).toMatchObject({
      title: 'Session plan',
      detail: 'Defence under pressure',
      href: { pathname: '/session-plans/[id]', params: { id: 'plan-1' } },
    });
  });

  it('ignores plans for another day or another squad', () => {
    const plans = [
      { ...PLAN, id: 'p2', session_on: '2026-10-19' },
      { ...PLAN, id: 'p3', team_id: OTHER },
      { ...PLAN, id: 'p4', team_id: null },
    ];
    expect(kinds(TRAINING, { ...MEMBERS.athlete, plans })).toEqual(['absence']);
  });

  it('offers a coach Add a session plan only until there is one', () => {
    expect(kinds(TRAINING, MEMBERS.coach)).toContain('addPlan');
    const withPlan = kinds(TRAINING, { ...MEMBERS.coach, plans: [PLAN] });
    expect(withPlan).toContain('plan');
    expect(withPlan).not.toContain('addPlan');
  });

  it('adds a plan with the squad and the session filled in', () => {
    const add = sessionActions(TRAINING, MEMBERS.coach).find((a) => a.kind === 'addPlan');
    expect(add?.href).toEqual({ pathname: '/session-plans/edit', params: { team: SQUAD, event: 'ev-1' } });
  });

  it('doesn’t offer Add a session plan to athletes, parents or managers', () => {
    for (const who of ['athlete', 'guardian', 'manager', 'physio', 'committee']) {
      expect(kinds(TRAINING, MEMBERS[who])).not.toContain('addPlan');
    }
  });

  it('shows nothing of plans while Session plans is switched off', () => {
    const off = { ...NOBODY.features, sessionPlans: false };
    const actions = kinds(TRAINING, { ...MEMBERS.coach, plans: [PLAN], features: off });
    expect(actions).toEqual(['attendance', 'checkIns']);
  });
});

describe('Check-ins', () => {
  it('tells the squad’s coach how many have checked in, and opens that squad', () => {
    const action = sessionActions(TRAINING, MEMBERS.coach).find((a) => a.kind === 'checkIns');
    expect(action).toMatchObject({
      detail: '9 of 12 checked in today · 2 flagged',
      href: { pathname: '/check-ins', params: { team: SQUAD } },
    });
  });

  it('leaves out flagged when nobody is', () => {
    const facts = { ...MEMBERS.coach, checkIns: [{ team_id: SQUAD, athlete_count: 12, checked_in_count: 12, flagged_count: 0 }] };
    expect(sessionActions(TRAINING, facts).find((a) => a.kind === 'checkIns')?.detail).toBe('12 of 12 checked in today');
  });

  it('is for today’s sessions only: the numbers are today’s', () => {
    const tomorrow = { ...TRAINING, start: new Date('2026-10-19T09:00:00Z'), end: new Date('2026-10-19T10:30:00Z') };
    expect(kinds(tomorrow, MEMBERS.coach)).not.toContain('checkIns');
  });

  it('isn’t offered while Daily check-ins is switched off', () => {
    const off = { ...NOBODY.features, checkIns: false };
    expect(kinds(TRAINING, { ...MEMBERS.coach, features: off })).not.toContain('checkIns');
  });

  it('isn’t offered to anyone the database gave no check-ins for this squad', () => {
    for (const who of ['manager', 'athlete', 'guardian', 'admin', 'committee', 'physio', 'coachElsewhere']) {
      expect(kinds(TRAINING, MEMBERS[who])).not.toContain('checkIns');
    }
  });
});

describe('a cancelled session', () => {
  it('offers nobody anything: it isn’t on, so nobody is away from it and no register is taken', () => {
    for (const who of Object.keys(MEMBERS)) {
      expect(kinds({ ...TRAINING, cancelled: true }, MEMBERS[who])).toEqual([]);
    }
  });

  it('offers the usual shortcuts again once it’s back on', () => {
    expect(kinds({ ...TRAINING, cancelled: false }, MEMBERS.athlete)).toEqual(kinds(TRAINING, MEMBERS.athlete));
    expect(kinds(TRAINING, MEMBERS.athlete).length).toBeGreaterThan(0);
  });
});
