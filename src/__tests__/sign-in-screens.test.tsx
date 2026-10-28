/**
 * The screens before anyone is signed in: finding the club by its code
 * (src/app/choose-club.tsx), signing in with Google (sign-in.tsx), and the
 * address the browser returns to (auth-callback.tsx). From "Find your club",
 * "Sign in with Google" and "Belonging to more than one club" in section 2
 * of docs/user-guide.md.
 *
 * The real ClubChoiceProvider runs, so these check which club the app would
 * connect to: an unknown code connects to nothing.
 */
import { Stack } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import AuthCallback from '@/app/auth-callback';
import ChooseClubScreen from '@/app/choose-club';
import SignInScreen from '@/app/sign-in';
import { ClubChoiceProvider, useClubChoice } from '@/lib/club-choice';
import { signInWithGoogle } from '@/lib/sign-in';
import { connectToClub } from '@/lib/supabase';

import { isDisabled, type } from './helpers/forms';
import { settle } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('@/lib/sign-in', () => ({ signInWithGoogle: jest.fn() }));
// This build knows two clubs.
jest.mock('@/constants/clubs', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://thunder.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'thunder-key';
  process.env.EXPO_PUBLIC_CLUB_CODE = 'THUNDER';
  process.env.EXPO_PUBLIC_CLUB_NAME = 'West Coast Thunder';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_CODE = 'STORM';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_NAME = 'Sample Storm';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_URL = 'https://storm.example.test';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY = 'storm-key';
  return jest.requireActual('@/constants/clubs');
});

const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage') as {
  clear(): Promise<void>;
  multiSet(pairs: [string, string][]): Promise<void>;
  getItem(key: string): Promise<string | null>;
};

/** Which club the app is connected to, shown by the test layout. */
function Connected() {
  const { club } = useClubChoice();
  return <Text>{`connected:${club?.code ?? 'none'}`}</Text>;
}

function Layout() {
  return (
    <ClubChoiceProvider>
      <Connected />
      <Stack />
    </ClubChoiceProvider>
  );
}

async function open(url: string, saved: Record<string, string> = {}) {
  await AsyncStorage.clear();
  await AsyncStorage.multiSet(Object.entries(saved));
  (connectToClub as jest.Mock).mockClear();
  await renderRouter(
    {
      _layout: Layout,
      'choose-club': ChooseClubScreen,
      'sign-in': SignInScreen,
      'auth-callback': AuthCallback,
      index: () => <Text>screen:index</Text>,
    },
    { initialUrl: url },
  );
  await settle();
}

const connected = () => screen.getByText(/^connected:/).props.children as string;

describe('finding the club', () => {
  it('shows nothing to continue to until a code is typed', async () => {
    await open('/choose-club');
    expect(screen.getByText('Find your club')).toBeTruthy();
    expect(isDisabled('Continue')).toBe(true);
    expect(screen.queryByText('Your clubs')).toBeNull();
  });

  it('names the club as its code is typed, ignoring case and spaces', async () => {
    await open('/choose-club');
    await type('Club code', 'thun der');
    expect(screen.getByText('West Coast Thunder')).toBeTruthy();
    expect(screen.getByText('Next, sign in with the account you use for this club.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue to West Coast Thunder'));
    await settle();
    expect(connected()).toBe('connected:THUNDER');
    expect(connectToClub).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'THUNDER', supabaseUrl: 'https://thunder.example.test' }),
    );
    expect(await AsyncStorage.getItem('club-code')).toBe('THUNDER');
  });

  it('refuses a code no club has, and connects to nothing', async () => {
    await open('/choose-club');
    await type('Club code', 'NOPE');
    expect(isDisabled('Continue')).toBe(false);
    await fireEvent.press(screen.getByText('Continue'));
    await settle();
    expect(screen.getByText('No club has that code. Check it with your club.')).toBeTruthy();
    expect(connected()).toBe('connected:none');
    expect(connectToClub).not.toHaveBeenCalled();
  });

  it('pressing go on the keyboard does the same', async () => {
    await open('/choose-club');
    await type('Club code', 'WRONG');
    await fireEvent(screen.getByLabelText('Club code'), 'submitEditing');
    await settle();
    expect(screen.getByText('No club has that code. Check it with your club.')).toBeTruthy();
  });

  it('clears the message once the code is changed', async () => {
    await open('/choose-club');
    await type('Club code', 'WRONG');
    await fireEvent.press(screen.getByText('Continue'));
    await settle();
    await type('Club code', 'STO');
    expect(screen.queryByText('No club has that code. Check it with your club.')).toBeNull();
  });

  it('lists the clubs used on this device, and one tap goes back to one', async () => {
    await open('/choose-club', { 'club-codes-used': JSON.stringify(['STORM', 'THUNDER']) });
    expect(screen.getByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('Another club')).toBeTruthy();
    expect(screen.getByText('Sample Storm')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sample Storm'));
    await settle();
    expect(connected()).toBe('connected:STORM');
    expect(connectToClub).toHaveBeenCalledWith(expect.objectContaining({ code: 'STORM' }));
  });
});

describe('signing in', () => {
  const google = signInWithGoogle as jest.Mock;
  beforeEach(() => google.mockReset());

  it('names the club and offers Google, the only way in', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    expect(screen.getByText('Sign in / Register')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText(/^Not West Coast Thunder\?/)).toBeTruthy();
  });

  it('starts Google sign-in once, however often it’s tapped while busy', async () => {
    let finish: () => void = () => {};
    google.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await open('/sign-in', { 'club-code': 'THUNDER' });
    await fireEvent.press(screen.getByText('Continue with Google'));
    await settle();
    // A spinner replaces the words, and the button is disabled.
    expect(screen.queryByText('Continue with Google')).toBeNull();
    const button = screen.getAllByRole('button')[0];
    expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBe(true);
    await fireEvent.press(button);
    await settle();
    finish();
    await settle();
    expect(google).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Continue with Google')).toBeTruthy();
  });

  it('shows why sign-in failed, and lets them try again', async () => {
    google.mockRejectedValueOnce(new Error('The user denied access'));
    await open('/sign-in', { 'club-code': 'THUNDER' });
    await fireEvent.press(screen.getByText('Continue with Google'));
    await settle();
    expect(screen.getByText('The user denied access')).toBeTruthy();
    google.mockResolvedValueOnce(undefined);
    await fireEvent.press(screen.getByText('Continue with Google'));
    await settle();
    expect(screen.queryByText('The user denied access')).toBeNull();
    expect(google).toHaveBeenCalledTimes(2);
  });

  it('gives a plain message for a failure that isn’t an error', async () => {
    google.mockRejectedValueOnce('closed');
    await open('/sign-in', { 'club-code': 'THUNDER' });
    await fireEvent.press(screen.getByText('Continue with Google'));
    await settle();
    expect(screen.getByText('Sign-in failed. Please try again.')).toBeTruthy();
  });

  it('Change club forgets the club, but keeps it in the list', async () => {
    await open('/sign-in', {
      'club-code': 'THUNDER',
      'club-codes-used': JSON.stringify(['THUNDER']),
    });
    expect(connected()).toBe('connected:THUNDER');
    await fireEvent.press(screen.getByText('Change club'));
    await settle();
    expect(connected()).toBe('connected:none');
    expect(await AsyncStorage.getItem('club-code')).toBeNull();
    expect(await AsyncStorage.getItem('club-codes-used')).toBe(JSON.stringify(['THUNDER']));
  });
});

describe('returning from the sign-in browser', () => {
  it('goes straight to Home', async () => {
    await open('/auth-callback', { 'club-code': 'THUNDER' });
    expect(screen.getByText('screen:index')).toBeTruthy();
    expect(screen).toHavePathname('/');
  });
});
