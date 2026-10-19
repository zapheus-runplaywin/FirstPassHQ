/**
 * Sending a message (src/app/messages/new.tsx), from "Messages" in section 3,
 * "Sending messages" in section 6, "Captains" in section 4, "Messages to the
 * club" in section 8 and "Messages to the club or a role" in section 10 of
 * docs/user-guide.md.
 *
 * Who a member may send to: admins to everyone, a role, or any squad or
 * team; the committee and club captains to everyone (and any group they
 * lead); coaches and managers to the groups they lead; captains to the group
 * they captain while they play in it. A captain under 18 is told their
 * parents or guardians get a copy. The database (`send_group_message`)
 * checks all of this again.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import NewMessageScreen from '@/app/messages/new';

import { argsOf, clearCalls, isSelected, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  settle,
  TEAM,
  TEAM_B,
  type BackendOptions,
  type Persona,
  type PersonaName,
} from './helpers/harness';

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

type Who = PersonaName | Persona;

let replace: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
});
afterEach(() => replace.mockRestore());

/** Last season's team of the same name, still current while the new season starts. */
const OLD_OPEN_A = { ...TEAM, id: 'team-open-a-2025', season: 2025 };
const TEAMS = [TEAM, TEAM_B, OLD_OPEN_A];

/** An athlete under 18 who captains their team. */
const minorCaptain: Persona = {
  ...personas.minorAthlete,
  captaincies: [{ team_id: TEAM.id, profile_id: 'minor-athlete', captain_role: 'captain' }],
};

/** Captain of a team they no longer play in. */
const formerCaptain: Persona = {
  ...personas.athlete,
  memberships: [],
  captaincies: [{ team_id: TEAM.id, profile_id: 'athlete', captain_role: 'captain' }],
};

/** A committee member who also coaches 17 & Under A. */
const committeeCoach: Persona = {
  ...personas.committee,
  profile: { ...personas.committee.profile!, extra_roles: ['coach'] },
  memberships: [{ ...personas.coach.memberships[0], team: TEAM_B }],
};

async function open(who: Who, options: BackendOptions = {}) {
  await openScreen(who, { 'messages/new': NewMessageScreen }, '/messages/new', { teams: TEAMS }, {
    ...options,
    rpcs: { send_group_message: 'msg-new', ...options.rpcs },
  });
}

async function send(body = 'Training is on at 5pm') {
  if (body) type('Message', body);
  fireEvent.press(screen.getByText('Send'));
  await settle();
}

describe('admins', () => {
  it('send to everyone by default', async () => {
    await open('admin');
    expect(isSelected('Everyone')).toBe(true);
    await send();
    expect(argsOf('send_group_message')).toEqual([
      { p_body: 'Training is on at 5pm', p_audience: 'club', p_role: null, p_team_id: null },
    ]);
    expect(replace).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'msg-new' } });
  });

  it('can send to one role, offered every role a message can go to', async () => {
    await open('admin');
    fireEvent.press(screen.getByText('A role'));
    for (const r of ['Athletes', 'Guardians', 'Coaches', 'Managers', 'Committee', 'Physios', 'Admins']) {
      expect(screen.getByText(r)).toBeTruthy();
    }
    expect(screen.queryByText('Guests')).toBeNull();
    expect(screen.queryByText('Temporary helpers')).toBeNull();
    await send();
    expect(screen.getByText('Choose who to send it to.')).toBeTruthy();
    expect(rpcNames()).not.toContain('send_group_message');
    fireEvent.press(screen.getByText('Guardians'));
    await send('');
    expect(argsOf('send_group_message')).toEqual([
      { p_body: 'Training is on at 5pm', p_audience: 'role', p_role: 'guardian', p_team_id: null },
    ]);
  });

  it('can send to any squad or team, telling same-named ones apart by season', async () => {
    await open('admin');
    fireEvent.press(screen.getByText('A squad or team'));
    expect(screen.getByText('Squad or team')).toBeTruthy();
    expect(screen.getByText('Open A (2026–27)')).toBeTruthy();
    expect(screen.getByText('Open A (2025–26)')).toBeTruthy();
    await send();
    expect(screen.getByText('Choose a squad or team.')).toBeTruthy();
    fireEvent.press(screen.getByText(TEAM_B.name));
    await send('');
    expect(argsOf('send_group_message')).toEqual([
      { p_body: 'Training is on at 5pm', p_audience: 'group', p_role: null, p_team_id: TEAM_B.id },
    ]);
  });

  it('a role picked first isn’t sent when they switch to a group', async () => {
    await open('admin');
    fireEvent.press(screen.getByText('A role'));
    fireEvent.press(screen.getByText('Coaches'));
    fireEvent.press(screen.getByText('A squad or team'));
    fireEvent.press(screen.getByText(TEAM_B.name));
    await send();
    expect(argsOf('send_group_message')[0]).toMatchObject({ p_audience: 'group', p_role: null, p_team_id: TEAM_B.id });
  });
});

describe('the committee and club captains', () => {
  it.each<[string, Who]>([
    ['committee member', 'committee'],
    ['club captain', 'clubCaptain'],
  ])('a %s who leads no group sends to everyone, and is told so', async (_l, who) => {
    await open(who);
    expect(screen.getByText('This goes to everyone in the club.')).toBeTruthy();
    expect(screen.queryByText('A role')).toBeNull();
    await send();
    expect(argsOf('send_group_message')[0]).toMatchObject({ p_audience: 'club', p_team_id: null });
  });

  it('a committee member who coaches may also send to their own group, never a role', async () => {
    await open(committeeCoach);
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.queryByText('A role')).toBeNull();
    fireEvent.press(screen.getByText('A squad or team'));
    expect(screen.queryByText('Open A (2026–27)')).toBeNull();
    // Leading one group, it's chosen for them.
    expect(isSelected(TEAM_B.name)).toBe(true);
    await send();
    expect(argsOf('send_group_message')[0]).toMatchObject({ p_audience: 'group', p_team_id: TEAM_B.id });
  });

  it('a committee member with a paused role can’t message the club', async () => {
    await open('committeeExpiredCheck');
    expect(screen.queryByText('This goes to everyone in the club.')).toBeNull();
    expect(screen.getByText(/once an admin adds you to one\.$/)).toBeTruthy();
    await send();
    expect(screen.getByText('Choose a squad or team.')).toBeTruthy();
    expect(rpcNames()).not.toContain('send_group_message');
  });
});

describe('coaches, managers and captains', () => {
  it.each<[string, Who, string]>([
    ['coach', 'coach', TEAM.id],
    ['manager', 'manager', TEAM.id],
    ['captain', 'captain', TEAM.id],
    ['athlete who coaches another team', 'athleteCoach', TEAM_B.id],
  ])('a %s sends to the one group they lead, already chosen', async (_l, who, teamId) => {
    await open(who);
    expect(screen.queryByText('Everyone')).toBeNull();
    expect(screen.getByText('Send to')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.props.accessibilityState?.selected)).toHaveLength(1);
    await send();
    expect(argsOf('send_group_message')).toEqual([
      { p_body: 'Training is on at 5pm', p_audience: 'group', p_role: null, p_team_id: teamId },
    ]);
  });

  it.each<[string, Who]>([
    ['coach whose check has expired', 'coachExpiredCheck'],
    ['stood-down coach', 'stoodDownCoach'],
    ['captain of a team they no longer play in', formerCaptain],
    ['athlete', 'athlete'],
  ])('a %s has no group to send to', async (_l, who) => {
    await open(who);
    expect(
      screen.getByText('You can message the squads and teams you coach, manage or captain once an admin adds you to one.'),
    ).toBeTruthy();
    await send();
    expect(screen.getByText('Choose a squad or team.')).toBeTruthy();
    expect(rpcNames()).not.toContain('send_group_message');
  });

  it('a captain under 18 is told their parents or guardians get a copy', async () => {
    await open(minorCaptain);
    expect(screen.getByText(/Your parents or guardians get a copy too\.$/)).toBeTruthy();
    await send();
    expect(argsOf('send_group_message')[0]).toMatchObject({ p_team_id: TEAM.id });
  });

  it('an adult captain isn’t', async () => {
    await open('captain');
    expect(screen.getByText('You’ll see who has read it. Club admins can read every message.')).toBeTruthy();
  });
});

describe('writing the message', () => {
  it('needs something written', async () => {
    await open('coach');
    await send('   ');
    expect(screen.getByText('Write a message first.')).toBeTruthy();
    expect(rpcNames()).not.toContain('send_group_message');
  });

  it('counts down the last 200 characters of 4000', async () => {
    await open('coach');
    type('Message', 'x'.repeat(3800));
    expect(screen.queryByText(/characters left$/)).toBeNull();
    type('Message', 'x'.repeat(3801));
    expect(screen.getByText('199 characters left')).toBeTruthy();
  });

  it('shows the database’s refusal and stays', async () => {
    await open('coach', { rpcErrors: { send_group_message: 'You can only message groups you lead.' } });
    await send();
    expect(screen.getByText('You can only message groups you lead.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
