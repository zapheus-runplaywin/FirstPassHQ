/**
 * The Team tab's rules (src/lib/team-hub.ts): which readiness tile comes
 * first for a coach, a physio and a manager, the attendance figure, and what
 * a squad or team's list of people says beside an athlete with an injury.
 * From "Team" in section 3 of docs/user-guide.md.
 */
import {
  absencesLabel,
  attendanceRate,
  groupChipLabel,
  myPlaceLabel,
  injuredCountLabel,
  READINESS_CARDS,
  readinessTiles,
  rosterCountLabel,
  rosterStatuses,
  seesRosterStatus,
  splitRoster,
  staffKind,
} from '@/lib/team-hub';
import type { HomeCard } from '@/lib/home-layout';
import type { InjuryStatus, RosterEntry, TeamRole } from '@/lib/types';

const member = (team_role: TeamRole) => ({ team_role });

describe('staffKind', () => {
  it.each([
    [['coach'], [], 'coach'],
    [['physio'], [], 'physio'],
    [['manager'], [], 'manager'],
    // By a place in a squad or team, whatever their club role.
    [['athlete'], [member('coach')], 'coach'],
    [['guardian'], [member('manager')], 'manager'],
    [['committee'], [member('physio')], 'physio'],
    // Coaching comes first, then physio, then managing.
    [['manager'], [member('coach')], 'coach'],
    [['manager', 'physio'], [], 'physio'],
    [['physio'], [member('manager'), member('coach')], 'coach'],
  ] as const)('%j with places %j is a %s', (roles, memberships, kind) => {
    expect(staffKind([...roles], [...memberships])).toBe(kind);
  });

  it.each([
    [['athlete'], [member('athlete')]],
    [['guardian'], []],
    [['admin', 'committee'], []],
    [[], []],
  ] as const)('%j with places %j looks after no squad or team', (roles, memberships) => {
    expect(staffKind([...roles], [...memberships])).toBeNull();
  });
});

describe('readinessTiles', () => {
  const all: HomeCard[] = ['injuries', 'surveys', 'attendance', 'groups', 'checkIns'];

  it('a coach has check-ins, then attendance, then injuries', () => {
    expect(readinessTiles(all, 'coach')).toEqual(['checkIns', 'attendance', 'injuries']);
  });

  it('a physio starts with injuries', () => {
    expect(readinessTiles(all, 'physio')).toEqual(['injuries', 'checkIns', 'attendance']);
  });

  it('a manager starts with attendance', () => {
    expect(readinessTiles(all, 'manager')).toEqual(['attendance', 'injuries', 'checkIns']);
  });

  it('only ever holds cards the member already has', () => {
    expect(readinessTiles(['attendance', 'injuries', 'groups'], 'manager')).toEqual([
      'attendance',
      'injuries',
    ]);
    expect(readinessTiles(['groups', 'sessionPlans'], 'coach')).toEqual([]);
    expect(readinessTiles([], null)).toEqual([]);
  });

  it('never makes a tile of anything but check-ins, attendance and injuries', () => {
    const everything: HomeCard[] = ['concerns', 'reports', 'administration', 'kpis', 'surveys', ...all];
    for (const kind of ['coach', 'physio', 'manager', null] as const) {
      expect([...readinessTiles(everything, kind)].sort()).toEqual([...READINESS_CARDS].sort());
    }
  });
});

describe('attendanceRate', () => {
  it('is everyone present over everyone marked, as a whole per cent', () => {
    expect(
      attendanceRate([
        { session_count: 8, present_count: 7 },
        { session_count: 8, present_count: 8 },
        { session_count: 1, present_count: 0 },
      ]),
    ).toBe('88%');
  });

  it('is nothing with no sessions, or before the answer arrives', () => {
    expect(attendanceRate([])).toBeNull();
    expect(attendanceRate([{ session_count: 0, present_count: 0 }])).toBeNull();
    expect(attendanceRate(null)).toBeNull();
  });
});

describe('absencesLabel', () => {
  it('counts one or several', () => {
    expect(absencesLabel(1)).toBe('1 new or changed absence');
    expect(absencesLabel(3)).toBe('3 new or changed absences');
  });
});

describe('seesRosterStatus', () => {
  it.each<[TeamRole | undefined, boolean]>([
    ['coach', true],
    ['physio', true],
    // Managers log injuries and don't see them.
    ['manager', false],
    ['athlete', false],
    ['guardian', false],
    [undefined, false],
  ])('someone in the group as %s: %s', (role, sees) => {
    expect(seesRosterStatus(role)).toBe(sees);
  });
});

const injury = (id: string, athlete_id: string, status: InjuryStatus, waiting_for_me = false) => ({
  id,
  athlete_id,
  status,
  waiting_for_me,
});

describe('rosterStatuses', () => {
  it('says Injured, or that clearance was asked for, and which injury to open', () => {
    const statuses = rosterStatuses([
      injury('i1', 'a1', 'injured'),
      injury('i2', 'a2', 'clearance_requested'),
      injury('i3', 'a3', 'coach_endorsed'),
    ]);
    expect(statuses.get('a1')).toEqual({ label: 'Injured', injuryId: 'i1' });
    expect(statuses.get('a2')).toEqual({ label: 'Clearance asked for', injuryId: 'i2' });
    expect(statuses.get('a3')).toEqual({ label: 'Clearance asked for', injuryId: 'i3' });
  });

  it('puts a clearance waiting on the member first', () => {
    const statuses = rosterStatuses([
      injury('i1', 'a1', 'injured'),
      injury('i2', 'a1', 'clearance_requested', true),
    ]);
    expect(statuses.get('a1')).toEqual({ label: 'Clearance to review', injuryId: 'i2' });
  });

  it('with two injuries, shows the one still injured before one waiting on someone else', () => {
    const statuses = rosterStatuses([
      injury('i1', 'a1', 'coach_endorsed'),
      injury('i2', 'a1', 'injured'),
    ]);
    expect(statuses.get('a1')).toEqual({ label: 'Injured', injuryId: 'i2' });
  });

  it('says nothing for a cleared injury, or for an athlete with none', () => {
    const statuses = rosterStatuses([injury('i1', 'a1', 'cleared')]);
    expect(statuses.size).toBe(0);
    expect(rosterStatuses([]).get('a1')).toBeUndefined();
  });
});

const person = (profile_id: string, team_role: TeamRole): RosterEntry => ({
  profile_id,
  full_name: profile_id,
  team_role,
  coach_title: null,
  selection: null,
});

describe('a squad or team’s people', () => {
  const roster = [
    person('c1', 'coach'),
    person('m1', 'manager'),
    person('p1', 'physio'),
    person('a1', 'athlete'),
    person('a2', 'athlete'),
  ];

  it('athletes, then coaches, managers and physios', () => {
    const { athletes, staff } = splitRoster(roster);
    expect(athletes.map((m) => m.profile_id)).toEqual(['a1', 'a2']);
    expect(staff.map((m) => m.profile_id)).toEqual(['c1', 'm1', 'p1']);
  });

  it('counts them', () => {
    expect(rosterCountLabel(roster)).toBe('2 athletes · 3 staff');
    expect(rosterCountLabel([person('a1', 'athlete')])).toBe('1 athlete');
    expect(rosterCountLabel([person('c1', 'coach')])).toBe('1 staff');
    expect(rosterCountLabel([])).toBe('');
  });

  it('counts the athletes shown with an injury, and never the staff', () => {
    const statuses = rosterStatuses([
      injury('i1', 'a1', 'injured'),
      // A coach's own injury isn't part of the team's readiness.
      injury('i2', 'c1', 'injured'),
      // Someone in another of the member's teams.
      injury('i3', 'elsewhere', 'injured'),
    ]);
    expect(injuredCountLabel(roster, statuses)).toBe('1 with a current injury');
    expect(injuredCountLabel(roster, new Map())).toBeNull();
  });
});

describe('the switch between a member’s squads and teams', () => {
  const team = (name: string, kind: 'squad' | 'team') => ({ team: { name, kind } });

  it('says which is the squad and which the team when the member is in both', () => {
    const groups = [team('20 & Under', 'team'), team('20 & Under', 'squad')];
    expect(groups.map((g) => groupChipLabel(g.team, groups))).toEqual([
      '20 & Under · Team',
      '20 & Under · Squad',
    ]);
  });

  it('leaves alone a name that already says it', () => {
    const groups = [team('Mixed Open', 'team'), team('Mixed Open Squad', 'squad'), team('Opens Team', 'team')];
    expect(groups.map((g) => groupChipLabel(g.team, groups))).toEqual([
      'Mixed Open · Team',
      'Mixed Open Squad',
      'Opens Team',
    ]);
    // "Teamwork" doesn't say it is a team.
    const others = [team('Teamwork', 'team'), team('Open', 'squad')];
    expect(groupChipLabel(others[0].team, others)).toBe('Teamwork · Team');
  });

  it('uses plain names when they are all teams, or all squads', () => {
    const teams = [team('Open A', 'team'), team('Open Mixed', 'team')];
    expect(teams.map((g) => groupChipLabel(g.team, teams))).toEqual(['Open A', 'Open Mixed']);
    const squads = [team('Open', 'squad')];
    expect(groupChipLabel(squads[0].team, squads)).toBe('Open');
  });
});

describe('the member’s own place in the chosen squad or team', () => {
  it.each<[string, Parameters<typeof myPlaceLabel>[0], string]>([
    ['a head coach of a team', { team: { kind: 'team' }, team_role: 'coach', coach_title: 'head_coach', selection: null }, 'Team · Head Coach'],
    ['an assistant coach of a squad', { team: { kind: 'squad' }, team_role: 'coach', coach_title: 'assistant_coach', selection: null }, 'Squad · Assistant Coach'],
    ['a final team athlete', { team: { kind: 'team' }, team_role: 'athlete', coach_title: null, selection: 'touring' }, 'Team · Final team athlete'],
    ['a manager of a squad', { team: { kind: 'squad' }, team_role: 'manager', coach_title: null, selection: null }, 'Squad · Manager'],
  ])('%s', (_l, membership, label) => {
    expect(myPlaceLabel(membership)).toBe(label);
  });
});
