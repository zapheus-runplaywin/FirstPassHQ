/**
 * Signing out of one club on this device (signOutOfClub in src/lib/supabase.ts),
 * used when a club is removed from Find your club ("Belonging to more than one
 * club" in section 2 of docs/user-guide.md).
 *
 * Each club keeps its own saved sign-in, so removing one must sign out of
 * that club only, on this device only, and never disturb the club in use.
 */
jest.unmock('@/lib/supabase');
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@/lib/crypto-polyfill', () => ({}));
jest.mock('@/lib/secure-session-store', () => ({
  SecureSessionStore: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type FakeClient = {
  url: string;
  auth: {
    signOut: jest.Mock;
    stopAutoRefresh: jest.Mock;
    startAutoRefresh: jest.Mock;
  };
};
const made: FakeClient[] = [];
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((url: string) => {
    const client = {
      url,
      auth: {
        signOut: jest.fn(async () => ({ error: null })),
        stopAutoRefresh: jest.fn(),
        startAutoRefresh: jest.fn(),
      },
    };
    made.push(client);
    return client;
  }),
}));

// eslint-disable-next-line import/first
import { connectToClub, signOutOfClub } from '@/lib/supabase';

const THUNDER = {
  code: 'THUNDER',
  name: 'West Coast Thunder',
  supabaseUrl: 'https://t.test',
  anonKey: 't',
};
const STORM = {
  code: 'STORM',
  name: 'Sample Storm',
  supabaseUrl: 'https://s.test',
  anonKey: 's',
};

beforeEach(() => {
  made.length = 0;
});

it('signs out of a club not in use on this device only, and drops its client', async () => {
  connectToClub(THUNDER);
  const thunder = made[0];
  await signOutOfClub(STORM);
  const storm = made.find((c) => c.url === 'https://s.test')!;
  expect(storm.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(storm.auth.stopAutoRefresh).toHaveBeenCalled();
  expect(thunder.auth.signOut).not.toHaveBeenCalled();
  // A later visit to the removed club starts with a fresh client.
  await signOutOfClub(STORM);
  expect(made.filter((c) => c.url === 'https://s.test')).toHaveLength(2);
});

it('signs out of the club in use with the client it already has, and keeps it', async () => {
  const club = { ...STORM, code: 'INUSE', supabaseUrl: 'https://in-use.test' };
  connectToClub(club);
  expect(made).toHaveLength(1);
  await signOutOfClub(club);
  await signOutOfClub(club);
  expect(made).toHaveLength(1);
  expect(made[0].auth.signOut).toHaveBeenCalledTimes(2);
  expect(made[0].auth.stopAutoRefresh).not.toHaveBeenCalled();
});

it('still finishes when the server can’t be reached', async () => {
  const signOut = jest.fn(async () => {
    throw new Error('offline');
  });
  const { createClient } = jest.requireMock('@supabase/supabase-js') as {
    createClient: jest.Mock;
  };
  createClient.mockImplementationOnce((url: string) => {
    const client = {
      url,
      auth: {
        signOut,
        stopAutoRefresh: jest.fn(),
        startAutoRefresh: jest.fn(),
      },
    };
    made.push(client);
    return client;
  });
  await expect(signOutOfClub({ ...STORM, code: 'OFFLINE' })).resolves.toBeUndefined();
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
});
