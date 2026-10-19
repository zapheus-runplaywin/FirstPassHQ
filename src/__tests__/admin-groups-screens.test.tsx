/**
 * The admin's squad and team screens: Squads and teams
 * (src/app/admin/squads.tsx, with its Rename, Remove and Bring back controls
 * from src/components/group-actions.tsx), naming a team
 * (admin/team/[id].tsx), placing returning members (admin/place/[id].tsx)
 * and Seasons (admin/seasons.tsx).
 *
 * The rules are in section 10 of the user guide ("Squads, teams and
 * selections", "Seasons"): removing a squad archives it with its teams and
 * keeps every record, a team is named from a squad of the same season,
 * starting a season moves nobody, and archiving deletes nothing. Each test
 * checks the exact write sent and what the screen says when it's refused.
 * Only admins reach these screens (the route tests cover that).
 */
import { fireEvent, screen } from 'expo-router/testing-library';
import { router } from 'expo-router';

import PlaceMembersScreen from '@/app/admin/place/[id]';
import SeasonsScreen from '@/app/admin/seasons';
import SquadsScreen from '@/app/admin/squads';
import NameTeamScreen from '@/app/admin/team/[id]';
import { supabase } from '@/lib/supabase';
import type { RosterEntry, Team } from '@/lib/types';

import {
  inSection,
  isChosen,
  optionsUnder,
  press,
  pressInSection,
  recordWrites,
  refuseTableWrites,
  rpcsNamed,
  spyOnBack,
  typeInto,
  type TableWrite,
} from './helpers/admin-screens';
import { openScreen, resetClub, setClubFeatures, settle, type BackendOptions } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  useAdminPushNotifications: jest.fn(),
  unregisterForPush: jest.fn(async () => {}),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));

// Every wait in this file is on the screen settling (untilQuiet) or on fake
// timers, never on the clock. A test's wall time only grows when the machine
// is busy, so allow for that instead of failing at Jest's default 5 seconds.
jest.setTimeout(20_000);

let back: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  back = spyOnBack();
});

afterEach(() => back.mockRestore());

function group(id: string, name: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    name,
    sort_order: 1,
    kind: 'squad',
    season: 2026,
    squad_id: null,
    selections_completed_at: null,
    ...extra,
  };
}

const SQUAD = group('squad-open', 'Open Squad');
const TEAM_A = group('team-open-a', 'Open A', { kind: 'team', squad_id: SQUAD.id });
const EMPTY_SQUAD = group('squad-17u', '17 & Under Squad', { sort_order: 2 });

/** Answers the teams table: current groups, removed ones, or one by id. */
function teamsTable(current: Team[], removed: Team[] = [], log: TableWrite[] = []) {
  return recordWrites('teams', log, (q) => {
    if (q.eq('archived') === false) return current;
    if (q.eq('archived') === true) return removed;
    const id = q.eq('id');
    if (id !== undefined) return [...current, ...removed].filter((t) => t.id === id);
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Squads and teams

async function openSquads({
  current = [SQUAD, TEAM_A, EMPTY_SQUAD] as Team[],
  removed = [] as Team[],
  template = 'ammna_state_teams' as string | null,
  log = [] as TableWrite[],
  rpcErrors = {} as BackendOptions['rpcErrors'],
} = {}) {
  await openScreen('admin', { 'admin/squads': SquadsScreen }, '/admin/squads', {}, {
    tableHandlers: { teams: teamsTable(current, removed, log) },
    rpcs: { club_team_template: template },
    rpcErrors,
  });
}

/** The values a write's builder call was given, such as insert's row. */
const argsOf = (w: TableWrite, method: string) => w.calls.find((c) => c.method === method)?.args;

describe('Squads and teams, for a club with squads', () => {
  it('lists each squad with its teams and where its squad phase is up to', async () => {
    await openSquads();
    expect(screen.getByText(/^Your club uses squads\./)).toBeTruthy();
    expect(screen.getAllByText('Open Squad')[0]).toBeTruthy();
    expect(screen.getAllByText('2026–27 squad · see everyone in it')).toHaveLength(2);
    expect(screen.getByText('Team · choose who is selected')).toBeTruthy();
    expect(screen.getByText('Squad phase in progress. Coaches look after everyone in the squad.')).toBeTruthy();
    expect(screen.getByText('Name the teams from this squad to finish the squad phase.')).toBeTruthy();
    // Only the squad with a team can be marked complete.
    expect(screen.getAllByText('Mark squad phase complete')).toHaveLength(1);
    expect(screen.queryByText('Choose a starting setup')).toBeNull();
  });

  it('opens a squad’s members and a team to name', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    await openSquads();
    // The squad's card comes before the Named from squad choice.
    fireEvent.press(screen.getAllByText('Open Squad')[0]);
    expect(push).toHaveBeenLastCalledWith({ pathname: '/team/[id]', params: { id: SQUAD.id } });
    fireEvent.press(screen.getByText('Open A'));
    expect(push).toHaveBeenLastCalledWith({ pathname: '/admin/team/[id]', params: { id: TEAM_A.id } });
    push.mockRestore();
  });

  it('needs a name, then a squad, before adding a team named from it', async () => {
    const log: TableWrite[] = [];
    await openSquads({ log });
    await press('Add team');
    expect(screen.getByText('Please enter a name.')).toBeTruthy();
    await typeInto('Name', '  Open B  ');
    await press('Add team');
    expect(screen.getByText('Choose the squad the team is named from.')).toBeTruthy();
    expect(log).toEqual([]);

    await pressInSection('Named from squad', 'Open Squad');
    await press('Add team');
    expect(log).toHaveLength(1);
    expect(argsOf(log[0], 'insert')).toEqual([
      { name: 'Open B', kind: 'team', squad_id: SQUAD.id, season: 2026, sort_order: 2 },
    ]);
    expect(screen.queryByText('Choose the squad the team is named from.')).toBeNull();
  });

  it('adds a squad to the newest season, after the other squads', async () => {
    const log: TableWrite[] = [];
    await openSquads({ log });
    await press('Squad');
    expect(screen.queryByText('Named from squad')).toBeNull();
    await typeInto('Name', '20 & Under Squad');
    await press('Add squad');
    expect(argsOf(log[0], 'insert')).toEqual([
      { name: '20 & Under Squad', kind: 'squad', season: 2026, sort_order: 3 },
    ]);
  });

  it('says when the name is already taken this season', async () => {
    await openSquads();
    refuseTableWrites('teams', { message: 'duplicate key value', code: '23505' });
    await press('Squad');
    await typeInto('Name', 'Open Squad');
    await press('Add squad');
    expect(screen.getByText('There is already a squad or team with that name this season.')).toBeTruthy();
  });

  it('shows any other refusal as the database gives it', async () => {
    await openSquads();
    refuseTableWrites('teams', { message: 'Only admins can add squads' });
    await press('Squad');
    await typeInto('Name', 'New Squad');
    await press('Add squad');
    expect(screen.getByText('Only admins can add squads')).toBeTruthy();
  });

  it('marks a squad phase complete after asking, and can undo it', async () => {
    await openSquads();
    await press('Mark squad phase complete');
    expect(screen.getByText('Mark the squad phase complete for Open Squad?')).toBeTruthy();
    await press('Cancel');
    expect(rpcsNamed('set_selections_complete')).toEqual([]);
    await press('Mark squad phase complete');
    await press('Mark complete');
    expect(rpcsNamed('set_selections_complete')).toEqual([
      ['set_selections_complete', { p_squad_id: SQUAD.id, p_complete: true }],
    ]);
  });

  it('undoes a completed squad phase', async () => {
    await openSquads({
      current: [{ ...SQUAD, selections_completed_at: '2026-09-01T00:00:00Z' }, TEAM_A],
    });
    expect(screen.getByText(/^Squad phase complete since .*\. Coaches look after their team’s athletes\.$/)).toBeTruthy();
    await press('Undo');
    expect(rpcsNamed('set_selections_complete')).toEqual([
      ['set_selections_complete', { p_squad_id: SQUAD.id, p_complete: false }],
    ]);
  });

  it('shows a refused squad phase change', async () => {
    await openSquads({ rpcErrors: { set_selections_complete: 'Name a team first' } });
    await press('Mark squad phase complete');
    await press('Mark complete');
    expect(screen.getByText('Name a team first')).toBeTruthy();
  });

  it('puts a team that has no squad into a squad of the same season', async () => {
    const ownTeam = group('team-own', 'Opens Team', { kind: 'team', sort_order: 3 });
    const lastSeason = group('squad-old', 'Old Squad', { season: 2025 });
    await openSquads({ current: [SQUAD, ownTeam, lastSeason] });
    await press('Put in a squad');
    expect(optionsUnder('Put Opens Team in')).toEqual(['Open Squad']);
    await press('Put in squad');
    expect(screen.getByText('Choose a squad.')).toBeTruthy();
    expect(rpcsNamed('admin_put_team_in_squad')).toEqual([]);
    await pressInSection('Put Opens Team in', 'Open Squad');
    await press('Put in squad');
    expect(rpcsNamed('admin_put_team_in_squad')).toEqual([
      ['admin_put_team_in_squad', { p_team_id: ownTeam.id, p_squad_id: SQUAD.id }],
    ]);
  });
});

describe('renaming and removing a squad or team', () => {
  it('renames a squad, needing a name', async () => {
    const log: TableWrite[] = [];
    await openSquads({ current: [SQUAD], log });
    await press('Rename');
    await typeInto('Squad name', '   ');
    await press('Save name');
    expect(screen.getByText('Please enter a name.')).toBeTruthy();
    expect(log).toEqual([]);
    await typeInto('Squad name', ' Mixed Open Squad ');
    await press('Save name');
    expect(log).toEqual([
      {
        table: 'teams',
        calls: [
          { method: 'update', args: [{ name: 'Mixed Open Squad' }] },
          { method: 'eq', args: ['id', SQUAD.id] },
        ],
      },
    ]);
    expect(screen.queryByText('Save name')).toBeNull();
  });

  it('says when the new name is already taken', async () => {
    await openSquads({ current: [SQUAD] });
    refuseTableWrites('teams', { message: 'duplicate', code: '23505' });
    await press('Rename');
    await typeInto('Squad name', 'Open A');
    await press('Save name');
    expect(screen.getByText('There is already a squad or team with that name this season.')).toBeTruthy();
    expect(screen.getByText('Save name')).toBeTruthy();
  });

  it('removes a squad with its teams after asking, archiving rather than deleting', async () => {
    const log: TableWrite[] = [];
    await openSquads({ current: [SQUAD], log });
    await press('Remove');
    expect(screen.getByText('Remove Open Squad from this season?')).toBeTruthy();
    expect(screen.getByText(/^It and its teams leave this season’s lists/)).toBeTruthy();
    await press('Cancel');
    expect(log).toEqual([]);
    await press('Remove');
    await pressInSection('Remove Open Squad from this season?', 'Remove');
    expect(log).toEqual([
      {
        table: 'teams',
        calls: [
          { method: 'update', args: [{ archived: true }] },
          { method: 'or', args: [`id.eq.${SQUAD.id},squad_id.eq.${SQUAD.id}`] },
        ],
      },
    ]);
    expect(log[0].calls.map((c) => c.method)).not.toContain('delete');
  });

  it('removes only the team when it’s a team', async () => {
    const log: TableWrite[] = [];
    const ownTeam = group('team-own', 'Opens Team', { kind: 'team' });
    await openSquads({ current: [ownTeam], log });
    await press('Remove');
    expect(screen.getByText(/^It leaves this season’s lists/)).toBeTruthy();
    await pressInSection('Remove Opens Team from this season?', 'Remove');
    expect(log[0].calls).toContainEqual({ method: 'or', args: [`id.eq.${ownTeam.id},squad_id.eq.${ownTeam.id}`] });
  });

  it('shows a refused removal and keeps asking', async () => {
    await openSquads({ current: [SQUAD] });
    refuseTableWrites('teams', { message: 'Only admins can remove squads' });
    await press('Remove');
    await pressInSection('Remove Open Squad from this season?', 'Remove');
    expect(screen.getByText('Only admins can remove squads')).toBeTruthy();
    expect(screen.getByText('Remove Open Squad from this season?')).toBeTruthy();
  });

  it.each<[string, Team, string]>([
    ['a squad with its teams', group('old-squad', 'Old Squad'), 'id.eq.old-squad,squad_id.eq.old-squad'],
    [
      'a team with its squad',
      group('old-team', 'Old Team', { kind: 'team', squad_id: SQUAD.id }),
      `id.eq.old-team,id.eq.${SQUAD.id}`,
    ],
    ['a team on its own', group('lone-team', 'Lone Team', { kind: 'team' }), 'id.eq.lone-team'],
  ])('brings back %s', async (_l, removed, filter) => {
    const log: TableWrite[] = [];
    await openSquads({ current: [SQUAD], removed: [removed], log });
    expect(screen.getByText('Removed this season')).toBeTruthy();
    expect(screen.getByText(`${removed.name} · ${removed.kind}`)).toBeTruthy();
    await press('Bring back');
    expect(log).toEqual([
      {
        table: 'teams',
        calls: [
          { method: 'update', args: [{ archived: false }] },
          { method: 'or', args: [filter] },
        ],
      },
    ]);
  });

  it('shows a refused bring-back', async () => {
    await openSquads({ current: [SQUAD], removed: [group('old-squad', 'Old Squad')] });
    refuseTableWrites('teams', { message: 'That season is archived' });
    await press('Bring back');
    expect(screen.getByText('That season is archived')).toBeTruthy();
  });
});

describe('a club’s starting setup', () => {
  it('asks a new club to choose a setup, and applies the one chosen', async () => {
    await openSquads({ current: [], template: null });
    expect(screen.getByText('Choose a starting setup')).toBeTruthy();
    expect(screen.getByText('Mixed Open Squad, Open Squad, 20 & Under Squad, 17 & Under Squad, Lightning Academy')).toBeTruthy();
    // Nothing to add to until a setup is chosen, and no way out of choosing.
    expect(screen.queryByText('Add a squad or team')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
    await press('Use WA Netball League');
    expect(rpcsNamed('admin_apply_team_template')).toEqual([
      ['admin_apply_team_template', { p_template: 'wanl' }],
    ]);
    expect(screen.queryByText('Choose a starting setup')).toBeNull();
  });

  it('shows a refused setup and keeps asking', async () => {
    await openSquads({
      current: [],
      template: null,
      rpcErrors: { admin_apply_team_template: 'The club already has squads' },
    });
    await press('Start blank');
    expect(screen.getByText('The club already has squads')).toBeTruthy();
    expect(screen.getByText('Choose a starting setup')).toBeTruthy();
  });

  it('lets a club that started blank pick a setup until it adds a group', async () => {
    await openSquads({ current: [], template: 'blank' });
    expect(screen.getByText('No squads or teams yet. Add your first squad below.')).toBeTruthy();
    expect(screen.getByText('Add a squad or team')).toBeTruthy();
    await press('Use a starting setup instead');
    expect(screen.getByText('Choose a starting setup')).toBeTruthy();
    await press('Cancel');
    expect(screen.queryByText('Choose a starting setup')).toBeNull();
  });

  it('never offers a setup to a club that has squads', async () => {
    await openSquads({ template: null });
    expect(screen.queryByText('Choose a starting setup')).toBeNull();
    expect(screen.queryByText('Use a starting setup instead')).toBeNull();
  });
});

describe('Teams, for a club without squads', () => {
  const OWN = group('team-opens', 'Opens Team', { kind: 'team' });

  it('adds a team straight away, with no squad to choose', async () => {
    setClubFeatures({ squads: false });
    const log: TableWrite[] = [];
    await openSquads({ current: [OWN], log });
    expect(screen.getByText(/^Your club doesn’t use squads/)).toBeTruthy();
    expect(screen.getByText('2026–27 team · choose who is in it')).toBeTruthy();
    expect(screen.queryByText('Squad')).toBeNull();
    expect(screen.queryByText('Put in a squad')).toBeNull();
    expect(screen.queryByText(/squad phase/)).toBeNull();
    expect(screen.queryByText('End squads now instead')).toBeNull();
    await typeInto('Name', 'Futures Team');
    await press('Add team');
    expect(argsOf(log[0], 'insert')).toEqual([{ name: 'Futures Team', kind: 'team', season: 2026, sort_order: 2 }]);
  });

  it('ends squads left from before they were switched off, after asking', async () => {
    setClubFeatures({ squads: false });
    await openSquads({ current: [SQUAD, TEAM_A, OWN] });
    expect(screen.getByText(/Squads from before squads were switched off keep working until their season ends/)).toBeTruthy();
    await press('End squads now instead');
    expect(screen.getByText('Are you sure you want to end squads now?')).toBeTruthy();
    await press('Cancel');
    expect(rpcsNamed('admin_end_squads_now')).toEqual([]);
    await press('End squads now instead');
    await press('Yes, end squads now');
    expect(rpcsNamed('admin_end_squads_now')).toEqual([['admin_end_squads_now', undefined]]);
    expect(screen.queryByText('Are you sure you want to end squads now?')).toBeNull();
  });

  it('shows a refused end to squads', async () => {
    setClubFeatures({ squads: false });
    await openSquads({ current: [SQUAD, OWN], rpcErrors: { admin_end_squads_now: 'Turn squads off first' } });
    await press('End squads now instead');
    await press('Yes, end squads now');
    expect(screen.getByText('Turn squads off first')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Naming a team

function entry(profile_id: string, full_name: string, team_role: RosterEntry['team_role'], extra: Partial<RosterEntry> = {}): RosterEntry {
  return { profile_id, full_name, team_role, coach_title: null, selection: null, ...extra };
}

const SQUAD_ROSTER = [
  entry('a1', 'Ava Athlete', 'athlete'),
  entry('a2', 'Ben Athlete', 'athlete'),
  entry('c1', 'Cam Coach', 'coach', { coach_title: 'assistant_coach' }),
  entry('m1', 'Mo Manager', 'manager'),
];

async function openTeam(
  teamId: string,
  { rosters = {} as Record<string, RosterEntry[]>, people = [] as unknown[], rpcErrors = {} as BackendOptions['rpcErrors'] } = {},
) {
  await openScreen('admin', { 'admin/team/[id]': NameTeamScreen }, `/admin/team/${teamId}`, {}, {
    tableHandlers: {
      teams: teamsTable([SQUAD, TEAM_A, group('team-own', 'Opens Team', { kind: 'team' })]),
      profiles: (q) => (q.eq('status') === 'approved' ? people : undefined),
    },
    rpcHandlers: { team_roster: (args) => rosters[args.p_team_id as string] ?? [] },
    rpcErrors,
  });
}

describe('naming a team from its squad', () => {
  const rosters = {
    [SQUAD.id]: SQUAD_ROSTER,
    [TEAM_A.id]: [entry('a1', 'Ava Athlete', 'athlete', { selection: 'training_partner' })],
  };

  it('starts from who is in the team, and saves the people picked with their roles', async () => {
    await openTeam(TEAM_A.id, { rosters });
    expect(screen.getByText('0 final team · 1 training partners')).toBeTruthy();
    expect(screen.getByText('Choosing from the Open Squad. People not selected stay in the squad.')).toBeTruthy();
    expect(isChosen(inSection('Ava Athlete · Athlete', 'Training partner'))).toBe(true);
    expect(isChosen(inSection('Ben Athlete · Athlete', 'Not selected'))).toBe(true);

    await pressInSection('Ben Athlete · Athlete', 'Final team');
    await pressInSection('Mo Manager · Manager', 'In this team');
    expect(screen.getByText('1 final team · 1 training partners')).toBeTruthy();
    await press('Save team');
    expect(rpcsNamed('admin_set_team_members')).toEqual([
      [
        'admin_set_team_members',
        {
          p_team_id: TEAM_A.id,
          p_members: [
            { profile_id: 'a1', team_role: 'athlete', selection: 'training_partner', coach_title: null },
            { profile_id: 'a2', team_role: 'athlete', selection: 'touring', coach_title: null },
            { profile_id: 'm1', team_role: 'manager', selection: null, coach_title: null },
          ],
        },
      ],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('brings a coach’s title from the squad, and saves the one chosen', async () => {
    await openTeam(TEAM_A.id, { rosters });
    expect(screen.queryByText('Cam Coach: head or assistant coach')).toBeNull();
    await pressInSection('Cam Coach · Assistant Coach', 'In this team');
    expect(isChosen(inSection('Cam Coach: head or assistant coach', 'Assistant Coach'))).toBe(true);
    await pressInSection('Cam Coach: head or assistant coach', 'Head Coach');
    await press('Save team');
    expect(rpcsNamed('admin_set_team_members')[0][1]!.p_members).toContainEqual({
      profile_id: 'c1',
      team_role: 'coach',
      selection: null,
      coach_title: 'head_coach',
    });
  });

  it('leaves out everyone not selected', async () => {
    await openTeam(TEAM_A.id, { rosters });
    await pressInSection('Ava Athlete · Athlete', 'Not selected');
    await press('Save team');
    expect(rpcsNamed('admin_set_team_members')[0][1]!.p_members).toEqual([]);
  });

  it('shows a refused save and stays', async () => {
    await openTeam(TEAM_A.id, { rosters, rpcErrors: { admin_set_team_members: 'Only admins can name teams' } });
    await press('Save team');
    expect(screen.getByText('Only admins can name teams')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('says when nobody is in the squad yet', async () => {
    await openTeam(TEAM_A.id);
    expect(screen.getByText('No one is in the squad yet. Add members to the squad from Members first.')).toBeTruthy();
  });

  it.each([
    ['a squad', SQUAD.id],
    ['a group that doesn’t exist', 'nothing'],
  ])('refuses to name %s as a team', async (_l, id) => {
    await openTeam(id, { rosters });
    expect(screen.getByText('Team not found.')).toBeTruthy();
    expect(screen.queryByText('Save team')).toBeNull();
    expect(rpcsNamed('team_roster')).toEqual([]);
  });
});

describe('choosing who is in a team without a squad', () => {
  it('lists approved athletes first, then coaches and managers, by the role they’re in the team as', async () => {
    await openTeam('team-own', {
      rosters: { 'team-own': [entry('ac', 'Alex Both', 'coach', { coach_title: 'assistant_coach' })] },
      people: [
        { id: 'mg', full_name: 'Mia Manager', email: null, role: 'manager', extra_roles: [] },
        { id: 'ac', full_name: 'Alex Both', email: null, role: 'athlete', extra_roles: ['coach'] },
        { id: 'at', full_name: null, email: 'nameless@example.test', role: 'athlete', extra_roles: [] },
      ],
    });
    expect(
      screen.getByText('Choosing from everyone approved as an athlete, coach or manager. Add guardians from their member page.'),
    ).toBeTruthy();
    const labels = screen
      .UNSAFE_root.findAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string')
      .map((n) => n.props.children as string)
      .filter((t) => / · /.test(t));
    expect(labels).toEqual([
      'nameless@example.test · Athlete',
      'Alex Both · Assistant Coach',
      'Mia Manager · Manager',
    ]);
    expect(isChosen(inSection('Alex Both · Assistant Coach', 'In this team'))).toBe(true);
    await press('Save team');
    expect(rpcsNamed('admin_set_team_members')[0][1]).toEqual({
      p_team_id: 'team-own',
      p_members: [{ profile_id: 'ac', team_role: 'coach', selection: null, coach_title: 'assistant_coach' }],
    });
  });

  it('says when nobody is approved yet', async () => {
    await openTeam('team-own');
    expect(
      screen.getByText('No athletes, coaches or managers are approved yet. Approve them from Members first.'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Placing returning members

const NEW_SQUAD = group('squad-open-27', 'Open Squad', { season: 2027 });

const RETURNING = [
  { profile_id: 'r1', full_name: 'Remy Return', role: 'athlete', last_squad_id: 'old-1', last_squad_name: 'Mixed Open Squad' },
  { profile_id: 'r2', full_name: 'Rae Return', role: 'coach', last_squad_id: 'old-2', last_squad_name: 'Open Squad' },
  { profile_id: 'r3', full_name: null, role: 'athlete', last_squad_id: 'old-2', last_squad_name: 'Open Squad' },
];

async function openPlace(members: unknown[] = RETURNING, rpcErrors: BackendOptions['rpcErrors'] = {}) {
  await openScreen('admin', { 'admin/place/[id]': PlaceMembersScreen }, `/admin/place/${NEW_SQUAD.id}`, {}, {
    tableHandlers: { teams: teamsTable([NEW_SQUAD, SQUAD]) },
    rpcs: { returning_members: members },
    rpcErrors,
  });
}

describe('placing returning members', () => {
  it('lists last season’s members by squad, the same-named squad first', async () => {
    await openPlace();
    expect(screen.getByText(/^Pick who is coming back for Open Squad in 2027–28\./)).toBeTruthy();
    const headings = screen.getAllByText(/^From last season’s /).map((n) => n.props.children);
    expect(headings).toEqual([
      ['From last season’s ', 'Open Squad'],
      ['From last season’s ', 'Mixed Open Squad'],
    ]);
    expect(screen.getByText('Unnamed member')).toBeTruthy();
    expect(rpcsNamed('returning_members')).toEqual([['returning_members', { p_squad_id: NEW_SQUAD.id }]]);
    // Nothing picked, nothing to add.
    expect(screen.getByText('Pick who is coming back')).toBeTruthy();
    await press('Pick who is coming back');
    expect(rpcsNamed('admin_place_members')).toEqual([]);
  });

  it('places the members picked, one by one or a whole squad at once', async () => {
    await openPlace();
    fireEvent.press(screen.getAllByText('Pick all')[0]);
    await press('Remy Return');
    expect(screen.getAllByText('Clear')).toHaveLength(2);
    await press('Add 3 to Open Squad');
    expect(rpcsNamed('admin_place_members')).toEqual([
      ['admin_place_members', { p_squad_id: NEW_SQUAD.id, p_profile_ids: ['r2', 'r3', 'r1'] }],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('clears a squad picked by mistake', async () => {
    await openPlace();
    fireEvent.press(screen.getAllByText('Pick all')[0]);
    await press('Clear');
    expect(screen.getByText('Pick who is coming back')).toBeTruthy();
    await press('Remy Return');
    await press('Remy Return');
    expect(screen.getByText('Pick who is coming back')).toBeTruthy();
  });

  it('shows a refused placement and stays', async () => {
    await openPlace(RETURNING, { admin_place_members: 'They are already in a squad this season' });
    await press('Remy Return');
    await press('Add 1 to Open Squad');
    expect(screen.getByText('They are already in a squad this season')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('says when everyone has been placed', async () => {
    await openPlace([]);
    expect(screen.getByText('Everyone from last season has been placed.')).toBeTruthy();
    expect(screen.queryByText('Pick who is coming back')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Seasons

type SeasonRow = { season: number; archived: boolean; squad_count: number; team_count: number };

async function openSeasons(seasons: SeasonRow[], current: Team[] = [], rpcErrors: BackendOptions['rpcErrors'] = {}) {
  await openScreen('admin', { 'admin/seasons': SeasonsScreen }, '/admin/seasons', {}, {
    tableHandlers: { teams: teamsTable(current) },
    rpcs: { season_list: seasons },
    rpcErrors,
  });
}

const S2026: SeasonRow = { season: 2026, archived: false, squad_count: 2, team_count: 1 };
const S2025: SeasonRow = { season: 2025, archived: false, squad_count: 1, team_count: 0 };
const S2024: SeasonRow = { season: 2024, archived: true, squad_count: 1, team_count: 1 };

describe('Seasons', () => {
  it('starts the next season after asking, moving nobody', async () => {
    await openSeasons([S2026]);
    expect(screen.getByText(['2026–27', ' · current'].join(''))).toBeTruthy();
    expect(screen.getByText('2 squads · 1 team')).toBeTruthy();
    await press('Start the 2027–28 season');
    expect(screen.getByText('Start the 2027–28 season?')).toBeTruthy();
    expect(screen.getByText(/Nobody is moved: place returning members in each\s+squad next\./)).toBeTruthy();
    await press('Cancel');
    expect(rpcsNamed('admin_start_season')).toEqual([]);
    await press('Start the 2027–28 season');
    await press('Start 2027–28');
    expect(rpcsNamed('admin_start_season')).toEqual([['admin_start_season', { p_season: 2027 }]]);
    // The list is loaded again.
    expect(rpcsNamed('season_list').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a refused start and keeps asking', async () => {
    await openSeasons([S2026], [], { admin_start_season: 'Archive last season first' });
    await press('Start the 2027–28 season');
    await press('Start 2027–28');
    expect(screen.getByText('Archive last season first')).toBeTruthy();
    expect(screen.getByText('Start the 2027–28 season?')).toBeTruthy();
  });

  it('runs one season alongside the next, with no third, and archives the older one after asking', async () => {
    await openSeasons([S2026, S2025]);
    expect(screen.queryByText(/^Start the \d{4}/)).toBeNull();
    expect(screen.getByText('2025–26 · still running')).toBeTruthy();
    expect(screen.queryByText('Archive 2026–27')).toBeNull();
    await press('Archive 2025–26');
    expect(screen.getByText('Archive 2025–26?')).toBeTruthy();
    expect(screen.getByText(/Attendance, injuries and check-ins are kept/)).toBeTruthy();
    fireEvent.press(screen.getAllByText('Archive 2025–26').at(-1)!);
    await settle();
    expect(screen.queryByText('Archive 2025–26?')).toBeNull();
    expect(rpcsNamed('admin_set_season_archived')).toEqual([
      ['admin_set_season_archived', { p_season: 2025, p_archived: true }],
    ]);
  });

  it('brings back an archived season', async () => {
    await openSeasons([S2026, S2024]);
    expect(screen.getByText('2024–25 · archived')).toBeTruthy();
    await press('Bring back 2024–25');
    expect(rpcsNamed('admin_set_season_archived')).toEqual([
      ['admin_set_season_archived', { p_season: 2024, p_archived: false }],
    ]);
  });

  it('shows a refused bring-back under the list', async () => {
    await openSeasons([S2026, S2024], [], { admin_set_season_archived: 'Only one earlier season can run' });
    await press('Bring back 2024–25');
    expect(screen.getByText('Only one earlier season can run')).toBeTruthy();
  });

  it('offers to place returning members in each new squad while last season is still there', async () => {
    const push = jest.spyOn(router, 'push').mockImplementation(() => {});
    const NEW_TEAM = group('team-27', 'Open A', { season: 2027, kind: 'team', squad_id: NEW_SQUAD.id });
    await openSeasons(
      [{ ...S2026, season: 2027 }, S2026],
      [NEW_SQUAD, NEW_TEAM, SQUAD],
    );
    // Squads only: teams are named from them later.
    expect(screen.getAllByText('Place returning members')).toHaveLength(1);
    fireEvent.press(screen.getByText('Place returning members'));
    expect(push).toHaveBeenCalledWith({ pathname: '/admin/place/[id]', params: { id: NEW_SQUAD.id } });
    push.mockRestore();
  });

  it('counts only teams for a club without squads', async () => {
    setClubFeatures({ squads: false });
    await openSeasons([{ season: 2026, archived: false, squad_count: 0, team_count: 4 }]);
    expect(screen.getByText('4 teams')).toBeTruthy();
    expect(screen.getByText(/place returning members in its teams\./)).toBeTruthy();
  });
});
