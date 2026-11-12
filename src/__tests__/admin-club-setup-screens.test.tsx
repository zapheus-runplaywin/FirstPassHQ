/**
 * Three admin set-up screens: Club captains (src/app/admin/captains.tsx),
 * Invite members (admin/invite.tsx) and Club password
 * (admin/club-password.tsx).
 *
 * The rules (section 10 of the user guide): club captains are chosen per
 * season from that season's athletes, with athletes under 18 marked; the
 * invite carries the club code and link but never the password; the club
 * password can't be shown once saved, only replaced or removed, and needs at
 * least 6 characters. Only admins reach these screens (the route tests cover
 * that).
 */
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { screen } from 'expo-router/testing-library';

import ClubCaptainsScreen from '@/app/admin/captains';
import ClubPasswordScreen from '@/app/admin/club-password';
import InviteScreen from '@/app/admin/invite';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

import { fieldFor, isChosen, press, rpcsNamed, spyOnBack, typeInto } from './helpers/admin-screens';
import { openScreen, resetClub, settle, TEST_CLUB, type BackendOptions } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/lib/club-choice', () => jest.requireActual('./helpers/harness').clubChoiceModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@/lib/push', () => ({
  usePushNotifications: jest.fn(),
  useTodoNotifications: jest.fn(() => ({ on: true, permission: 'granted', save: jest.fn() })),
  openNotificationSettings: jest.fn(),
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
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

let back: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  (supabase.rpc as jest.Mock).mockClear();
  back = spyOnBack();
});

afterEach(() => back.mockRestore());

// ---------------------------------------------------------------------------
// Club captains

function squad(id: string, season: number): Team {
  return { id, name: `Squad ${season}`, sort_order: 1, kind: 'squad', season, squad_id: null, selections_completed_at: null };
}

const CHOICES_2026 = [
  { profile_id: 'a1', full_name: 'Ava Adult', is_captain: true, is_minor: false },
  { profile_id: 'a2', full_name: 'Kit Kid', is_captain: false, is_minor: true },
  { profile_id: 'a3', full_name: null, is_captain: false, is_minor: false },
];
const CHOICES_2027 = [{ profile_id: 'b1', full_name: 'Bo Next', is_captain: false, is_minor: false }];

async function openCaptains(seasons: number[], rpcErrors: BackendOptions['rpcErrors'] = {}) {
  await openScreen('admin', { 'admin/captains': ClubCaptainsScreen }, '/admin/captains', {
    teams: seasons.map((s) => squad(`squad-${s}`, s)),
  }, {
    rpcHandlers: {
      club_captain_choices: (args) => (args.p_season === 2027 ? CHOICES_2027 : args.p_season === 2026 ? CHOICES_2026 : []),
    },
    rpcErrors,
  });
}

describe('club captains', () => {
  it('starts from this season’s captains, marks children, and saves the ones chosen', async () => {
    await openCaptains([2026]);
    expect(rpcsNamed('club_captain_choices')).toEqual([['club_captain_choices', { p_season: 2026 }]]);
    expect(screen.queryByText('Season')).toBeNull();
    expect(screen.getByText('Club captains for 2026–27')).toBeTruthy();
    expect(isChosen(screen.getByText('Ava Adult'))).toBe(true);
    expect(isChosen(screen.getByText('Kit Kid (under 18)'))).toBe(false);
    expect(screen.getByText('Unnamed member')).toBeTruthy();
    expect(screen.getByText('1 club captain chosen.')).toBeTruthy();

    await press('Kit Kid (under 18)');
    expect(screen.getByText('2 club captains chosen.')).toBeTruthy();
    await press('Ava Adult');
    await press('Save club captains');
    expect(rpcsNamed('admin_set_club_captains')).toEqual([
      ['admin_set_club_captains', { p_season: 2026, p_profile_ids: ['a2'] }],
    ]);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('can save with no club captains', async () => {
    await openCaptains([2026]);
    await press('Ava Adult');
    expect(screen.getByText('No club captains chosen.')).toBeTruthy();
    await press('Save club captains');
    expect(rpcsNamed('admin_set_club_captains')[0][1]).toEqual({ p_season: 2026, p_profile_ids: [] });
  });

  it('picks the newest season first while last season still runs, and switches between them', async () => {
    await openCaptains([2026, 2027]);
    expect(screen.getByText('Season')).toBeTruthy();
    expect(screen.getByText('Club captains for 2027–28')).toBeTruthy();
    expect(screen.getByText('Bo Next')).toBeTruthy();
    expect(screen.queryByText('Ava Adult')).toBeNull();

    await press('2026–27');
    expect(screen.getByText('Ava Adult')).toBeTruthy();
    expect(screen.queryByText('Bo Next')).toBeNull();
    await press('Save club captains');
    expect(rpcsNamed('admin_set_club_captains')[0][1]).toEqual({ p_season: 2026, p_profile_ids: ['a1'] });
  });

  it('says when the season has no athletes', async () => {
    await openCaptains([2025]);
    expect(screen.getByText('No athletes are in this season’s squads yet.')).toBeTruthy();
  });

  it('shows a refused save and stays', async () => {
    await openCaptains([2026], { admin_set_club_captains: 'Only athletes in this season can be club captains' });
    await press('Save club captains');
    expect(screen.getByText('Only athletes in this season can be club captains')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('saves nothing for a club with no squads or teams', async () => {
    await openCaptains([]);
    expect(rpcsNamed('club_captain_choices')).toEqual([]);
    await press('Save club captains');
    expect(rpcsNamed('admin_set_club_captains')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invite members

describe('inviting members', () => {
  const LINK = `firstpasshq://club/${TEST_CLUB.code}`;

  async function openInvite() {
    await openScreen('admin', { 'admin/invite': InviteScreen }, '/admin/invite');
  }

  it('shows the club’s code, join link and QR code', async () => {
    await openInvite();
    expect(screen.getByText(TEST_CLUB.code)).toBeTruthy();
    expect(screen.getByText(LINK)).toBeTruthy();
    expect(screen.getByLabelText('QR code for Sample Club')).toBeTruthy();
    expect(screen.getByText(/They still ask to join, with the club password if there is\s+one, and an admin approves them\./)).toBeTruthy();
  });

  it('shares the link and code, and never the club password', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await openInvite();
    await press('Share invite');
    expect(share).toHaveBeenCalledWith({
      message: `Join Sample Club on FirstPass HQ. Install the FirstPass HQ app, then open ${LINK} or enter the club code ${TEST_CLUB.code}.`,
    });
    expect(rpcsNamed('join_password_required')).toEqual([]);
    share.mockRestore();
  });

  it('copies just the link, and says so', async () => {
    await openInvite();
    await press('Copy link');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
    expect(screen.getByText('Link copied')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Club password

async function openPassword(isSet: boolean, rpcErrors: BackendOptions['rpcErrors'] = {}) {
  let set = isSet;
  await openScreen('admin', { 'admin/club-password': ClubPasswordScreen }, '/admin/club-password', {}, {
    rpcHandlers: {
      join_password_required: () => set,
      admin_set_join_password: (args) => {
        set = args.p_password !== '';
        return null;
      },
    },
    rpcErrors,
  });
}

describe('the club password', () => {
  it('says anyone can ask to join when none is set, and offers no Remove', async () => {
    await openPassword(false);
    expect(screen.getByText('No club password is set, so anyone who signs in can ask to join.')).toBeTruthy();
    expect(screen.getByText('Club password')).toBeTruthy();
    expect(screen.queryByText('Remove password')).toBeNull();
  });

  it('never shows a password that is set, only lets it be replaced', async () => {
    await openPassword(true);
    expect(screen.getByText(/^A club password is set\. .*For security it can’t be shown/)).toBeTruthy();
    expect(fieldFor('New club password').props.value).toBe('');
  });

  it('needs at least 6 characters', async () => {
    await openPassword(false);
    await typeInto('Club password', '  abc12  ');
    await press('Save password');
    expect(screen.getByText('Use at least 6 characters.')).toBeTruthy();
    expect(rpcsNamed('admin_set_join_password')).toEqual([]);
  });

  it('saves a new password, clears the field and says to share it', async () => {
    await openPassword(false);
    await typeInto('Club password', 'thunder26');
    await press('Save password');
    expect(rpcsNamed('admin_set_join_password')).toEqual([
      ['admin_set_join_password', { p_password: 'thunder26' }],
    ]);
    expect(screen.getByText('Saved. Share the new password with people joining.')).toBeTruthy();
    expect(fieldFor('New club password').props.value).toBe('');
    expect(screen.getByText('Remove password')).toBeTruthy();
  });

  it('removes the password', async () => {
    await openPassword(true);
    await press('Remove password');
    expect(rpcsNamed('admin_set_join_password')).toEqual([['admin_set_join_password', { p_password: '' }]]);
    await settle();
    expect(screen.getByText('Password removed.')).toBeTruthy();
    expect(screen.getByText('No club password is set, so anyone who signs in can ask to join.')).toBeTruthy();
    expect(screen.queryByText('Remove password')).toBeNull();
  });

  it('shows a refused save and keeps what was typed', async () => {
    await openPassword(false, { admin_set_join_password: 'Only admins can set the club password' });
    await typeInto('Club password', 'thunder26');
    await press('Save password');
    expect(screen.getByText('Only admins can set the club password')).toBeTruthy();
    expect(fieldFor('Club password').props.value).toBe('thunder26');
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});

