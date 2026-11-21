/**
 * A member sends in their own Working With Children Check (src/app/wwcc.tsx),
 * from "Sending in your own check" in section 6 of docs/user-guide.md. The
 * card counts for nothing until an admin accepts it, so the screen only sends
 * it; who may send one is the database's rule too (supabase/tests/wwcc-self-submit.sql).
 */
import { router } from 'expo-router';
import { fireEvent, screen } from 'expo-router/testing-library';

import SendWwccScreen from '@/app/wwcc';
import type { MyWwccSubmission } from '@/lib/types';

import { argsOf, clearCalls, field, rpcNames, type } from './helpers/forms';
import {
  openScreen,
  personas,
  resetClub,
  settle,
  type BackendOptions,
  type Persona,
  type PersonaName,
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

let back: jest.SpyInstance;
beforeEach(() => {
  resetClub();
  clearCalls();
  back = jest.spyOn(router, 'back').mockImplementation(() => {});
});
afterEach(() => back.mockRestore());

const sent = (extra: Partial<MyWwccSubmission> = {}): MyWwccSubmission => ({
  id: 'sub-1',
  card_number: 'WWC1234567',
  expires_on: '2029-10-01',
  card_name: 'Casey Coach',
  submitted_at: '2026-10-17T00:00:00Z',
  status: 'waiting',
  decided_at: null,
  return_note: null,
  ...extra,
});

async function open(who: PersonaName | Persona, options: BackendOptions = {}) {
  await openScreen(who, { wwcc: SendWwccScreen }, '/wwcc', {}, options);
}

describe('sending in your own check', () => {
  it('a paused coach sends the card number, expiry and name, then goes back', async () => {
    await open('coachExpiredCheck');
    clearCalls();
    await type('Card number', 'wwc7654321');
    await type('Expires', '01/10/2029');
    await type('Name on the card', 'Sam Coach');
    await fireEvent.press(screen.getByText('Send to a club admin'));
    await settle();
    expect(argsOf('submit_my_wwcc')).toEqual([
      { p_card_number: 'wwc7654321', p_expires_on: '2029-10-01', p_card_name: 'Sam Coach' },
    ]);
    // Their roles reload, so the home screen shows the card waiting.
    expect(rpcNames()).toContain('my_wwcc_submission');
  });

  it('fills in their name as the name on the card', async () => {
    await open('coachExpiredCheck');
    expect(field('Name on the card').props.value).toBe(personas.coachExpiredCheck.profile!.full_name);
  });

  it('asks for a card number and a real expiry before sending', async () => {
    await open('coachExpiredCheck');
    clearCalls();
    await fireEvent.press(screen.getByText('Send to a club admin'));
    expect(screen.getByText('Enter the card number.')).toBeTruthy();
    await type('Card number', 'WWC1');
    await type('Expires', '31/02/2029');
    await fireEvent.press(screen.getByText('Send to a club admin'));
    expect(screen.getByText('Enter the expiry date on the card as DD/MM/YYYY.')).toBeTruthy();
    expect(argsOf('submit_my_wwcc')).toEqual([]);
  });

  it('shows the database’s reason when it refuses, and stays put', async () => {
    await open('coachExpiredCheck', {
      rpcErrors: { submit_my_wwcc: 'That card has expired. Renew it, then send the new card' },
    });
    await type('Card number', 'WWC1');
    await type('Expires', '01/01/2026');
    await fireEvent.press(screen.getByText('Send to a club admin'));
    await settle();
    expect(screen.getByText('That card has expired. Renew it, then send the new card')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('shows a card waiting, filled in to correct', async () => {
    await open('coachExpiredCheck', { rpcs: { my_wwcc_submission: sent() } });
    expect(screen.getByText(/^You sent in your card WWC1234567, expiring 01\/10\/2029\./)).toBeTruthy();
    expect(field('Card number').props.value).toBe('WWC1234567');
    expect(field('Expires').props.value).toBe('01/10/2029');
    expect(screen.getByText('Send the corrected card')).toBeTruthy();
  });

  it('shows the note on a card an admin sent back', async () => {
    await open('coachExpiredCheck', {
      rpcs: {
        my_wwcc_submission: sent({
          status: 'returned',
          decided_at: '2026-10-18T00:00:00Z',
          return_note: 'The expiry is different',
        }),
      },
    });
    expect(
      screen.getByText(
        'A club admin sent back your card WWC1234567, expiring 01/10/2029. Their note: “The expiry is different” Check the details and send it again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Send to a club admin')).toBeTruthy();
  });

  it('keeps the exemption and application routes in view', async () => {
    await open('coachExpiredCheck');
    expect(screen.getByText(/ask a club admin whether you can be exempted, with the reason\.$/)).toBeTruthy();
  });

  it.each<[PersonaName, string]>([
    ['stoodDownCoach', 'A club admin has paused your roles. Talk to a club admin about it.'],
    ['athlete', 'Your roles at the club don’t need a Working With Children Check.'],
    ['guardian', 'Your roles at the club don’t need a Working With Children Check.'],
    ['committeeExempt', 'Your roles at the club don’t need a Working With Children Check.'],
  ])('%s cannot send a card', async (who, message) => {
    await open(who);
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText('Send to a club admin')).toBeNull();
  });

  it('a guest can send one, told it’s optional and never that a role waits on it (21 November 2026)', async () => {
    await open('guest');
    expect(screen.getByText(/^Guests don’t need a Working With Children Check\. If you have one/)).toBeTruthy();
    expect(screen.queryByText(/paused role/)).toBeNull();
    expect(screen.queryByText(/ask a club admin whether you can be exempted/)).toBeNull();
    clearCalls();
    await type('Card number', 'WWC0009');
    await type('Expires', '01/10/2029');
    await fireEvent.press(screen.getByText('Send to a club admin'));
    await settle();
    expect(argsOf('submit_my_wwcc')).toEqual([
      { p_card_number: 'WWC0009', p_expires_on: '2029-10-01', p_card_name: personas.guest.profile!.full_name },
    ]);
  });

  it('a committee member past the checks date can send one', async () => {
    await open('committeePastChecksDate');
    expect(screen.getByText('Send to a club admin')).toBeTruthy();
  });
});
