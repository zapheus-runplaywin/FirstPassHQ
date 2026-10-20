/**
 * Asking to join the club (src/app/join.tsx), from "Ask to join the club" in
 * section 2 of docs/user-guide.md.
 *
 * Everyone gives their name and date of birth and picks a role. An athlete
 * under 18 also gives a parent or guardian's email, a guardian gives their
 * PlayHQ email, a temporary helper says what they'll help with, when, and how
 * they're screened, and the club password is asked for only when the club has
 * set one. The database counts wrong passwords, so a refusal comes back as
 * the RPC's message, not an error: the screen shows it and stays put.
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import JoinScreen from '@/app/join';

import { argsOf, clearCalls, field, isSelected, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  setClubFeatures,
  settle,
  TEAM,
  TEAM_B,
  type BackendOptions,
  type Persona,
} from './helpers/harness';

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

const pendingProfile = personas.pending.profile!;
const CARD = 'I have a WA Working With Children Check';

/** Signed in for the first time: nothing asked for yet. */
const newcomer: Persona = {
  ...personas.pending,
  profile: {
    ...pendingProfile,
    requested_role: null,
    join_requested_at: null,
    date_of_birth: null,
  },
};

/** An under-18 athlete who already asked, coming back to change the request. */
const childWhoAsked: Persona = {
  ...personas.pending,
  profile: {
    ...pendingProfile,
    full_name: 'Sample Child',
    playhq_email: 'child@playhq.test',
    requested_role: 'athlete',
    requested_team_id: TEAM.id,
    declared_date_of_birth: '2011-03-02',
    guardian_email: 'parent@example.test',
  },
};

/** Last season's squad, still listed while the new season starts. */
const OLD_SEASON = { ...TEAM, id: 'team-2025', name: 'Open A 2025', season: 2025 };
/** A team inside a squad: members join the squad, not the team. */
const IN_SQUAD = { ...TEAM, id: 'team-in-squad', name: 'Open A Gold', squad_id: TEAM.id };
const TEAMS = [TEAM, TEAM_B, OLD_SEASON, IN_SQUAD];

let back: jest.SpyInstance;

beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});

afterEach(() => back.mockRestore());

async function openJoin(who: Persona = newcomer, options: BackendOptions = {}) {
  await openScreen(who, { join: JoinScreen }, '/join', { teams: TEAMS }, {
    ...options,
    rpcs: { join_password_required: false, submit_join_request: null, ...options.rpcs },
  });
}

async function send() {
  fireEvent.press(screen.getByText('Send request'));
  await settle();
}

function fillBasics(name = 'Sample Newcomer', dob = '05/05/1990') {
  type('Your name', name);
  type('Date of birth', dob);
}

describe('what everyone must give', () => {
  it.each([
    ['no name', '  ', '05/05/1990', null, 'Please enter your name.'],
    ['no date of birth', 'Sample Newcomer', '', 'Athlete', 'Please enter your date of birth as DD/MM/YYYY.'],
    ['a date of birth that isn’t a real day', 'Sample Newcomer', '31/02/2010', 'Athlete', 'Please enter your date of birth as DD/MM/YYYY.'],
    ['a date of birth in the wrong format', 'Sample Newcomer', '2010-03-14', 'Athlete', 'Please enter your date of birth as DD/MM/YYYY.'],
    ['no role', 'Sample Newcomer', '05/05/1990', null, 'Please choose what best describes you.'],
  ])('refuses %s, and sends nothing', async (_l, name, dob, role, message) => {
    await openJoin();
    type('Your name', name);
    type('Date of birth', dob);
    if (role) fireEvent.press(screen.getByText(role));
    await send();
    expect(screen.getByText(message)).toBeTruthy();
    expect(rpcNames()).not.toContain('submit_join_request');
    expect(back).not.toHaveBeenCalled();
  });

  it('offers every role a member can ask for, and never Admin', async () => {
    await openJoin();
    for (const label of [
      'Athlete',
      'Guardian',
      'Coach',
      'Manager',
      'Committee',
      'Physio',
      'Statistician',
      'Guest',
      'Temporary helper',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('sends an adult athlete’s request with their squad and goes back', async () => {
    await openJoin();
    fillBasics();
    type('PlayHQ email', 'me@playhq.test');
    fireEvent.press(screen.getByText('Athlete'));
    fireEvent.press(screen.getByText(TEAM.name));
    await send();
    expect(argsOf('submit_join_request')).toEqual([
      {
        p_full_name: 'Sample Newcomer',
        p_playhq_email: 'me@playhq.test',
        p_requested_role: 'athlete',
        p_requested_team_id: TEAM.id,
        p_join_password: null,
        p_date_of_birth: '1990-05-05',
        // An adult names no parent or guardian.
        p_guardian_email: null,
      },
    ]);
    expect(rpcNames()).not.toContain('set_my_volunteer_details');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('only offers this season’s squads, never last season’s or a team inside a squad', async () => {
    await openJoin();
    fireEvent.press(screen.getByText('Coach'));
    expect(screen.getByText('Squad')).toBeTruthy();
    expect(screen.getByText(TEAM.name)).toBeTruthy();
    expect(screen.getByText(TEAM_B.name)).toBeTruthy();
    expect(screen.queryByText(OLD_SEASON.name)).toBeNull();
    expect(screen.queryByText(IN_SQUAD.name)).toBeNull();
  });

  it('calls it Team in a club without squads', async () => {
    setClubFeatures({ squads: false });
    await openJoin();
    fireEvent.press(screen.getByText('Manager'));
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.queryByText('Squad')).toBeNull();
  });

  it.each(['Committee', 'Statistician', 'Guest'])(
    'asks a %s for no squad, and sends none even if one was picked first',
    async (role) => {
      await openJoin();
      fillBasics();
      fireEvent.press(screen.getByText('Coach'));
      fireEvent.press(screen.getByText(TEAM.name));
      fireEvent.press(screen.getByText(role));
      expect(screen.queryByText(TEAM.name)).toBeNull();
      await send();
      expect(argsOf('submit_join_request')[0]).toMatchObject({ p_requested_team_id: null });
    },
  );

  it('tapping the chosen squad again unpicks it', async () => {
    await openJoin();
    fillBasics();
    fireEvent.press(screen.getByText('Physio'));
    fireEvent.press(screen.getByText(TEAM.name));
    expect(isSelected(TEAM.name)).toBe(true);
    fireEvent.press(screen.getByText(TEAM.name));
    expect(isSelected(TEAM.name)).toBe(false);
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({
      p_requested_role: 'physio',
      p_requested_team_id: null,
    });
  });
});

describe('athletes under 18', () => {
  it('asks for a parent or guardian’s email once the date of birth is under 18', async () => {
    await openJoin();
    fireEvent.press(screen.getByText('Athlete'));
    type('Date of birth', '05/05/1990');
    expect(screen.queryByText('Parent or guardian’s email')).toBeNull();
    type('Date of birth', '02/03/2011');
    expect(screen.getByText('Parent or guardian’s email')).toBeTruthy();
    expect(screen.getByText(/^You’re under 18, so a parent or guardian needs to join/)).toBeTruthy();
  });

  it('turns 18 on their birthday, so needs no guardian that day', async () => {
    await openJoin();
    fireEvent.press(screen.getByText('Athlete'));
    // Today is 18 October 2026.
    type('Date of birth', '18/10/2008');
    expect(screen.queryByText('Parent or guardian’s email')).toBeNull();
    type('Date of birth', '19/10/2008');
    expect(screen.getByText('Parent or guardian’s email')).toBeTruthy();
  });

  it('refuses to send without the parent or guardian’s email', async () => {
    await openJoin();
    fillBasics('Sample Child', '02/03/2011');
    fireEvent.press(screen.getByText('Athlete'));
    type('Parent or guardian’s email', '   ');
    await send();
    expect(screen.getByText('Please enter the email of a parent or guardian.')).toBeTruthy();
    expect(rpcNames()).not.toContain('submit_join_request');
  });

  it('sends the parent or guardian’s email with the request', async () => {
    await openJoin();
    fillBasics('Sample Child', '02/03/2011');
    fireEvent.press(screen.getByText('Athlete'));
    type('Parent or guardian’s email', 'parent@example.test');
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({
      p_requested_role: 'athlete',
      p_date_of_birth: '2011-03-02',
      p_guardian_email: 'parent@example.test',
    });
    expect(back).toHaveBeenCalled();
  });

  it('a child who isn’t an athlete is asked for no guardian’s email, and sends none', async () => {
    await openJoin();
    fillBasics('Sample Child', '02/03/2011');
    fireEvent.press(screen.getByText('Athlete'));
    type('Parent or guardian’s email', 'parent@example.test');
    fireEvent.press(screen.getByText('Guest'));
    expect(screen.queryByText('Parent or guardian’s email')).toBeNull();
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({
      p_requested_role: 'guest',
      p_guardian_email: null,
    });
  });

  it('tells an athlete what the club keeps about under 18s, and only an athlete', async () => {
    await openJoin();
    fireEvent.press(screen.getByText('Coach'));
    expect(screen.queryByText(/^If you’re under 18: the club keeps/)).toBeNull();
    fireEvent.press(screen.getByText('Athlete'));
    expect(
      screen.getByText(/Your coaches see your check-ins and injuries once a parent or guardian agrees\./),
    ).toBeTruthy();
  });
});

describe('parents and guardians', () => {
  it('must give the email they registered their athlete with', async () => {
    await openJoin();
    fillBasics();
    fireEvent.press(screen.getByText('Guardian'));
    expect(screen.getByPlaceholderText('Email used to register with PlayHQ')).toBeTruthy();
    expect(screen.getByText(/^Parents and guardians: enter the email you used/)).toBeTruthy();
    expect(screen.getByText('Your athlete\'s squad')).toBeTruthy();
    await send();
    expect(screen.getByText('Please enter the email you used to register with PlayHQ.')).toBeTruthy();
    expect(rpcNames()).not.toContain('submit_join_request');
  });

  it('sends the guardian’s PlayHQ email and their athlete’s squad', async () => {
    await openJoin();
    fillBasics();
    fireEvent.press(screen.getByText('Guardian'));
    type('PlayHQ email', 'parent@playhq.test');
    fireEvent.press(screen.getByText(TEAM_B.name));
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({
      p_playhq_email: 'parent@playhq.test',
      p_requested_role: 'guardian',
      p_requested_team_id: TEAM_B.id,
      p_guardian_email: null,
    });
  });

  it('other roles may leave the PlayHQ email blank, defaulting to their sign-in email', async () => {
    await openJoin();
    fillBasics();
    fireEvent.press(screen.getByText('Coach'));
    expect(screen.getByPlaceholderText('pending@example.test')).toBeTruthy();
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({ p_playhq_email: '' });
  });
});

describe('the club password', () => {
  it('isn’t asked for when the club has none', async () => {
    await openJoin();
    expect(screen.queryByText('Club password')).toBeNull();
    expect(argsOf('join_password_required')).toHaveLength(1);
  });

  it('is asked for, hidden as it’s typed, when the club has set one', async () => {
    await openJoin(newcomer, { rpcs: { join_password_required: true } });
    expect(screen.getByText('Club password')).toBeTruthy();
    expect(field('Club password').props.secureTextEntry).toBe(true);
  });

  it('must be given before sending', async () => {
    await openJoin(newcomer, { rpcs: { join_password_required: true } });
    fillBasics();
    fireEvent.press(screen.getByText('Guest'));
    await send();
    expect(
      screen.getByText('Please enter the club password. A club admin can give it to you.'),
    ).toBeTruthy();
    expect(rpcNames()).not.toContain('submit_join_request');
  });

  it('goes with the request', async () => {
    await openJoin(newcomer, { rpcs: { join_password_required: true } });
    fillBasics();
    fireEvent.press(screen.getByText('Guest'));
    type('Club password', 'netball42');
    await send();
    expect(argsOf('submit_join_request')[0]).toMatchObject({ p_join_password: 'netball42' });
    expect(back).toHaveBeenCalled();
  });

  it('a wrong password shows the database’s message and stays on the form', async () => {
    const refused = 'That isn’t the club password. 4 tries left before a 15 minute wait.';
    await openJoin(newcomer, {
      rpcs: { join_password_required: true, submit_join_request: refused },
    });
    fillBasics();
    fireEvent.press(screen.getByText('Guest'));
    type('Club password', 'wrong');
    await send();
    expect(screen.getByText(refused)).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
    // The form keeps what they typed, to try again.
    expect(field('Your name').props.value).toBe('Sample Newcomer');
  });

  it('an error from the database shows its message and stays on the form', async () => {
    await openJoin(newcomer, { rpcErrors: { submit_join_request: 'Too many tries. Wait 15 minutes.' } });
    fillBasics();
    fireEvent.press(screen.getByText('Guest'));
    await send();
    expect(screen.getByText('Too many tries. Wait 15 minutes.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('temporary helpers', () => {
  async function asHelper() {
    await openJoin();
    fillBasics();
    fireEvent.press(screen.getByText('Temporary helper'));
  }

  it('explain the app only onboards them, and ask for no squad', async () => {
    await asHelper();
    expect(screen.getByText(/It doesn’t make you a member of the club/)).toBeTruthy();
    expect(screen.queryByText(TEAM.name)).toBeNull();
  });

  it.each([
    [{}, 'Please say what you’ll help with.'],
    [{ task: 'Canteen' }, 'Please enter your first and last day as DD/MM/YYYY.'],
    [{ task: 'Canteen', from: '24/10/2026' }, 'Please enter your first and last day as DD/MM/YYYY.'],
    [{ task: 'Canteen', from: '24/10/2026', until: '32/10/2026' }, 'Please enter your first and last day as DD/MM/YYYY.'],
    [{ task: 'Canteen', from: '24/10/2026', until: '25/10/2026' }, 'Please choose how you’re screened to work with children.'],
    [
      { task: 'Canteen', from: '24/10/2026', until: '25/10/2026', screening: CARD },
      'Please enter your Working With Children Check card number.',
    ],
  ] as [{ task?: string; from?: string; until?: string; screening?: string }, string][])(
    'refuse to send with %p missing: %s',
    async (given, message) => {
      await asHelper();
      if (given.task) type('What you’ll help with', given.task);
      if (given.from) type('First day', given.from);
      if (given.until) type('Last day', given.until);
      if (given.screening) fireEvent.press(screen.getByText(given.screening));
      await send();
      expect(screen.getByText(message)).toBeTruthy();
      expect(rpcNames()).not.toContain('submit_join_request');
      expect(rpcNames()).not.toContain('set_my_volunteer_details');
    },
  );

  it('send the request, then their task, days, screening and card number', async () => {
    await asHelper();
    type('What you’ll help with', 'Bench helper at the State carnival');
    type('First day', '24/10/2026');
    type('Last day', '25/10/2026');
    fireEvent.press(screen.getByText(CARD));
    expect(screen.getByText('A club admin checks your card online before you help.')).toBeTruthy();
    type('Card number', 'WWC1234567');
    await send();
    // The request first, so the details attach to it.
    expect(rpcNames().indexOf('submit_join_request')).toBeLessThan(
      rpcNames().indexOf('set_my_volunteer_details'),
    );
    expect(argsOf('submit_join_request')[0]).toMatchObject({
      p_requested_role: 'volunteer',
      p_requested_team_id: null,
    });
    expect(argsOf('set_my_volunteer_details')).toEqual([
      {
        p_task: 'Bench helper at the State carnival',
        p_from: '2026-10-24',
        p_until: '2026-10-25',
        p_screening: 'card',
        p_card_number: 'WWC1234567',
      },
    ]);
    expect(back).toHaveBeenCalled();
  });

  it('send no card number when they’re screened another way, even one typed first', async () => {
    await asHelper();
    type('What you’ll help with', 'Canteen');
    type('First day', '24/10/2026');
    type('Last day', '24/10/2026');
    fireEvent.press(screen.getByText(CARD));
    type('Card number', 'WWC1234567');
    fireEvent.press(screen.getByText('I’m a parent of an athlete at the club'));
    expect(screen.queryByText('Card number')).toBeNull();
    await send();
    expect(argsOf('set_my_volunteer_details')[0]).toMatchObject({
      p_screening: 'parent',
      p_card_number: null,
    });
  });

  it('a refused request sends no volunteer details', async () => {
    await openJoin(newcomer, { rpcs: { submit_join_request: 'Not accepting helpers today.' } });
    fillBasics();
    fireEvent.press(screen.getByText('Temporary helper'));
    type('What you’ll help with', 'Canteen');
    type('First day', '24/10/2026');
    type('Last day', '24/10/2026');
    fireEvent.press(screen.getByText(CARD));
    type('Card number', 'WWC1');
    await send();
    expect(screen.getByText('Not accepting helpers today.')).toBeTruthy();
    expect(rpcNames()).not.toContain('set_my_volunteer_details');
  });

  it('when the details fail to save, shows why and stays on the form', async () => {
    await openJoin(newcomer, { rpcErrors: { set_my_volunteer_details: 'Last day is before the first.' } });
    fillBasics();
    fireEvent.press(screen.getByText('Temporary helper'));
    type('What you’ll help with', 'Canteen');
    type('First day', '25/10/2026');
    type('Last day', '24/10/2026');
    fireEvent.press(screen.getByText(CARD));
    type('Card number', 'WWC1');
    await send();
    expect(screen.getByText('Last day is before the first.')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});

describe('editing a request', () => {
  it('fills the form with what they sent before', async () => {
    await openJoin(childWhoAsked);
    expect(field('Your name').props.value).toBe('Sample Child');
    expect(field('Date of birth').props.value).toBe('02/03/2011');
    expect(field('PlayHQ email').props.value).toBe('child@playhq.test');
    expect(isSelected('Athlete')).toBe(true);
    expect(isSelected(TEAM.name)).toBe(true);
    expect(field('Parent or guardian’s email').props.value).toBe('parent@example.test');
  });

  it('sends the changed request', async () => {
    await openJoin(childWhoAsked);
    type('Parent or guardian’s email', 'other.parent@example.test');
    await send();
    expect(argsOf('submit_join_request')).toEqual([
      {
        p_full_name: 'Sample Child',
        p_playhq_email: 'child@playhq.test',
        p_requested_role: 'athlete',
        p_requested_team_id: TEAM.id,
        p_join_password: null,
        p_date_of_birth: '2011-03-02',
        p_guardian_email: 'other.parent@example.test',
      },
    ]);
  });
});
