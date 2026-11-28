/**
 * The screens before anyone is signed in: finding the club by its code
 * (src/app/choose-club.tsx), signing in with Google or, on an iPhone, Apple
 * (sign-in.tsx), the demo club's email and password form, and the address the browser returns to (auth-callback.tsx).
 * From "Find your club", "Signing in" and "Belonging to more than one club"
 * in section 2 of docs/user-guide.md.
 *
 * The real ClubChoiceProvider runs, so these check which club the app would
 * connect to: an unknown code connects to nothing.
 */
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet, Text } from 'react-native';

import AuthCallback from '@/app/auth-callback';
import ChooseClubScreen from '@/app/choose-club';
import SignInScreen from '@/app/sign-in';
import { ClubChoiceProvider, useClubChoice } from '@/lib/club-choice';
import { signInToDemoClub } from '@/lib/demo-sign-in';
import { appleSignInAvailable, signInWithApple, signInWithGoogle } from '@/lib/sign-in';
import { connectToClub, signOutOfClub } from '@/lib/supabase';

import { isDisabled, type } from './helpers/forms';
import { pressWithoutWaiting, settle } from './helpers/harness';

jest.mock('@/lib/club', () => jest.requireActual('./helpers/harness').clubModuleMock());
jest.mock('@/constants/club', () => jest.requireActual('./helpers/harness').constantsClubMock());
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/global.css', () => ({}));
jest.mock('@/lib/demo-sign-in', () => ({ signInToDemoClub: jest.fn() }));
jest.mock('@/lib/sign-in', () => ({
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  appleSignInAvailable: jest.fn(async () => false),
}));
// Apple's native button, drawn as a plain button so the tests can press it
// and read the props the screen gives it.
jest.mock('expo-apple-authentication', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  const seen: Record<string, unknown>[] = [];
  return {
    seen,
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress(): void; testID?: string }) => {
      seen.push(props);
      return (
      <Pressable accessibilityRole="button" onPress={props.onPress} testID={props.testID}>
        <Text>Continue with Apple</Text>
      </Pressable>
      );
    },
  };
});
// This build knows two clubs, and was given the demo club's variables.
jest.mock('@/constants/clubs', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://thunder.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'thunder-key';
  process.env.EXPO_PUBLIC_CLUB_CODE = 'THUNDER';
  process.env.EXPO_PUBLIC_CLUB_NAME = 'West Coast Thunder';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_CODE = 'STORM';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_NAME = 'Sample Storm';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_URL = 'https://storm.example.test';
  process.env.EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY = 'storm-key';
  process.env.EXPO_PUBLIC_DEMO_CLUB_URL = 'https://test-project.example.test';
  process.env.EXPO_PUBLIC_DEMO_CLUB_ANON_KEY = 'test-project-key';
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

/** The rows under Your clubs that can be swiped to show Remove. */
const clubSwipeRows = () =>
  screen.container.queryAll((n) => n.props.accessibilityActions?.[0]?.name === 'swipeAction');

const connected = () => screen.getByText(/^connected:/).props.children as string;

describe('finding the club', () => {
  it('shows nothing to continue to until a code is typed', async () => {
    await open('/choose-club');
    expect(screen.getByText('Find your club')).toBeTruthy();
    expect(isDisabled('Continue')).toBe(true);
    expect(screen.queryByText('Your clubs')).toBeNull();
  });

  it('shows the app’s version and build at the foot, so a tester can say which copy they have', async () => {
    await open('/choose-club');
    expect(screen.getByTestId('app-version')).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
    // No "Powered by" footer: only the FirstPass mark at the top, before a club is chosen.
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.getByLabelText('FirstPass')).toBeTruthy();
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

  it('tells the member a club can be swiped off the list', async () => {
    await open('/choose-club', {
      'club-codes-used': JSON.stringify(['STORM', 'THUNDER']),
    });
    expect(screen.getByText('Swipe left on a club to remove it.')).toBeTruthy();
    // Each club offers Remove behind it, and to screen readers on the card itself.
    expect(clubSwipeRows().map((r) => r.props.accessibilityActions[0].label)).toEqual([
      'Remove',
      'Remove',
    ]);
    expect(screen.getByRole('button', { name: /Sample Storm/ }).props.accessibilityActions).toEqual(
      [{ name: 'Remove', label: 'Remove' }],
    );
  });

  it('a swiped club is removed from this device, signed out, and can be added back by its code', async () => {
    (signOutOfClub as jest.Mock).mockClear();
    await open('/choose-club', {
      'club-codes-used': JSON.stringify(['STORM', 'THUNDER']),
    });
    await fireEvent(clubSwipeRows()[0], 'accessibilityAction', {
      nativeEvent: { actionName: 'swipeAction' },
    });
    await settle();
    expect(screen.queryByText('Sample Storm')).toBeNull();
    expect(screen.getByText('West Coast Thunder')).toBeTruthy();
    expect(
      screen.getByText(
        'Removed Sample Storm and signed out of it on this device. Enter its code to add it again.',
      ),
    ).toBeTruthy();
    expect(signOutOfClub).toHaveBeenCalledWith(expect.objectContaining({ code: 'STORM' }));
    // Removing doesn't open or connect to any club.
    expect(connected()).toBe('connected:none');
    expect(connectToClub).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('club-codes-used'))!)).toEqual(['THUNDER']);

    await type('Club code', 'storm');
    await fireEvent.press(screen.getByText('Continue to Sample Storm'));
    await settle();
    expect(connected()).toBe('connected:STORM');
    expect(JSON.parse((await AsyncStorage.getItem('club-codes-used'))!)).toEqual([
      'STORM',
      'THUNDER',
    ]);
  });

  it('a screen reader removes a club from the card’s actions, and the list goes once it’s empty', async () => {
    await open('/choose-club', {
      'club-codes-used': JSON.stringify(['THUNDER']),
    });
    await fireEvent(
      screen.getByRole('button', { name: /West Coast Thunder/ }),
      'accessibilityAction',
      {
        nativeEvent: { actionName: 'Remove' },
      },
    );
    await settle();
    expect(screen.queryByText('Your clubs')).toBeNull();
    expect(screen.queryByText('Swipe left on a club to remove it.')).toBeNull();
    expect(screen.getByText(/^Removed West Coast Thunder/)).toBeTruthy();
    expect(connected()).toBe('connected:none');
  });

  it('shows each club’s saved logo, and initials for a club with none saved here', async () => {
    await open('/choose-club', {
      'club-codes-used': JSON.stringify(['STORM', 'THUNDER']),
      'club-profile:STORM': JSON.stringify({ club_name: 'Sample Storm', logo_path: 'logo-7.png' }),
    });
    await settle();
    const logos = screen.getAllByTestId('club-logo');
    expect(logos).toHaveLength(1);
    expect(logos[0].props.source).toEqual([
      { uri: 'https://storm.example.test/storage/v1/object/public/club-branding/logo-7.png' },
    ]);
    // Initials are hidden from screen readers: the card already reads the name.
    const hidden = { includeHiddenElements: true };
    expect(screen.getAllByTestId('club-initials', hidden)).toHaveLength(1);
    expect(screen.getByText('WCT', hidden)).toBeTruthy();
    expect(screen.queryByText('WCT')).toBeNull();
  });

  it('falls back to initials when a saved logo can’t load, such as offline', async () => {
    await open('/choose-club', {
      'club-codes-used': JSON.stringify(['STORM']),
      'club-profile:STORM': JSON.stringify({ club_name: 'Sample Storm', logo_path: 'logo-7.png' }),
    });
    await settle();
    await act(async () =>
      screen.getByTestId('club-logo').props.onError({ nativeEvent: { error: 'offline' } }),
    );
    expect(screen.queryByTestId('club-logo')).toBeNull();
    expect(screen.getByText('SS', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('signing in', () => {
  const google = signInWithGoogle as jest.Mock;
  beforeEach(() => google.mockReset());

  it('names the club and offers Google, and no Apple button where Apple isn’t offered', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    expect(screen.getByText('Sign in / Register')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.queryByText('Continue with Apple')).toBeNull();
    expect(screen.getByText(/^Not West Coast Thunder\?/)).toBeTruthy();
  });

  it('shows the app’s version and build at the foot, and no FirstPass logo', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    expect(screen.queryByLabelText('Powered by FirstPass HQ')).toBeNull();
    expect(screen.queryByText('Powered by')).toBeNull();
    expect(screen.getByTestId('app-version')).toBeTruthy();
    expect(screen.getByText(/^Version /)).toBeTruthy();
  });

  it('styles Google’s button like Apple’s: white, Google’s outline, the G logo and the same size', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    const button = screen.getByTestId('google-sign-in');
    expect(button.props.accessibilityLabel).toBe('Continue with Google');
    // Same height and corners as Apple's button; Google's light-theme colours.
    const box = StyleSheet.flatten(button.props.style) as Record<string, unknown>;
    expect(box).toMatchObject({
      height: 52,
      borderRadius: 12,
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: '#747775',
    });
    // Google's full-colour G, beside the words, never tinted.
    const logo = screen.getByTestId('google-logo');
    const logoStyle = StyleSheet.flatten(logo.props.style) as Record<string, unknown>;
    expect(logoStyle).toMatchObject({ width: 18, height: 18 });
    expect(logoStyle.tintColor).toBeUndefined();
    expect(logo.props.tintColor).toBeUndefined();
    // Apple's button letters at about 19 points; Google's dark text colour.
    const words = StyleSheet.flatten(screen.getByText('Continue with Google').props.style);
    expect(words).toMatchObject({ color: '#1F1F1F', fontSize: 20, fontWeight: '500' });
  });

  it('starts Google sign-in once, however often it’s tapped while busy', async () => {
    let finish: () => void = () => {};
    google.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await open('/sign-in', { 'club-code': 'THUNDER' });
    const pressing = await pressWithoutWaiting(screen.getByText('Continue with Google'));
    await settle();
    // A spinner replaces the words, and the button is disabled.
    expect(screen.queryByText('Continue with Google')).toBeNull();
    const button = screen.getAllByRole('button')[0];
    expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBe(true);
    await fireEvent.press(button);
    await settle();
    await act(async () => {
      finish();
      await pressing.done;
    });
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

describe('signing in with Apple on an iPhone', () => {
  const available = appleSignInAvailable as jest.Mock;
  const apple = signInWithApple as jest.Mock;
  const google = signInWithGoogle as jest.Mock;
  beforeEach(() => {
    available.mockReset().mockResolvedValue(true);
    apple.mockReset().mockResolvedValue(undefined);
    google.mockReset();
  });
  afterAll(() => available.mockReset().mockResolvedValue(false));

  it('shows Apple’s button above Google’s', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    const buttons = screen.getAllByRole('button').map((b) => b.props.testID ?? null);
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(buttons[0]).toBe('apple-sign-in');
  });

  it('uses Apple’s own white “Continue with Apple” button, styled only by its props', async () => {
    const { seen } = jest.requireMock('expo-apple-authentication') as { seen: Record<string, unknown>[] };
    await open('/sign-in', { 'club-code': 'THUNDER' });
    const props = seen[seen.length - 1];
    expect(props).toMatchObject({ buttonType: 1, buttonStyle: 0, cornerRadius: 12 });
    // Colour and corners from style break Apple's rules; the size must be set.
    const style = StyleSheet.flatten(props.style as object) as Record<string, unknown>;
    expect(style).toEqual({ height: 52, width: '100%' });
  });

  it('signs in with Apple, not Google, when it is tapped', async () => {
    await open('/sign-in', { 'club-code': 'THUNDER' });
    await fireEvent.press(screen.getByText('Continue with Apple'));
    await settle();
    expect(apple).toHaveBeenCalledTimes(1);
    expect(google).not.toHaveBeenCalled();
  });

  it('shows why Apple sign-in failed, and lets them try again', async () => {
    apple.mockRejectedValueOnce(new Error('Apple didn’t return a sign-in. Please try again.'));
    await open('/sign-in', { 'club-code': 'THUNDER' });
    await fireEvent.press(screen.getByText('Continue with Apple'));
    await settle();
    expect(screen.getByText('Apple didn’t return a sign-in. Please try again.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue with Apple'));
    await settle();
    expect(screen.queryByText('Apple didn’t return a sign-in. Please try again.')).toBeNull();
    expect(apple).toHaveBeenCalledTimes(2);
  });

  it('starts nothing else while Apple sign-in is still going, and keeps Google’s words', async () => {
    let finish: () => void = () => {};
    apple.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await open('/sign-in', { 'club-code': 'THUNDER' });
    const pressing = await pressWithoutWaiting(screen.getByText('Continue with Apple'));
    await settle();
    // Google's button shows no spinner for Apple's sign-in, but is disabled.
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue with Apple'));
    await fireEvent.press(screen.getByText('Continue with Google'));
    await settle();
    await act(async () => {
      finish();
      await pressing.done;
    });
    await settle();
    expect(apple).toHaveBeenCalledTimes(1);
    expect(google).not.toHaveBeenCalled();
  });
});

/** Types into one of the demo form's fields, found by its label. */
async function enter(label: string, value: string) {
  await fireEvent.changeText(screen.getByLabelText(label), value);
}

describe('the demo club', () => {
  const demo = signInToDemoClub as jest.Mock;
  const google = signInWithGoogle as jest.Mock;
  const available = appleSignInAvailable as jest.Mock;
  beforeEach(() => {
    demo.mockReset().mockResolvedValue(undefined);
    google.mockReset();
  });
  afterEach(() => available.mockReset().mockResolvedValue(false));

  it('is found by the code DEMO and connects to the test project', async () => {
    await open('/choose-club');
    await type('Club code', 'demo');
    expect(screen.getByText('Perth Pumpkins')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continue to Perth Pumpkins'));
    await settle();
    expect(connected()).toBe('connected:DEMO');
    expect(connectToClub).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DEMO', supabaseUrl: 'https://test-project.example.test' }),
    );
  });

  it('shows an email and password form saying it holds sample people only', async () => {
    await open('/sign-in', { 'club-code': 'DEMO' });
    expect(screen.getByText('Demo club. Sample people only.')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByText(/^Not Perth Pumpkins\?/)).toBeTruthy();
  });

  it('shows no Google or Apple button, even where Apple is offered', async () => {
    available.mockResolvedValue(true);
    await open('/sign-in', { 'club-code': 'DEMO' });
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(screen.queryByText('Continue with Apple')).toBeNull();
  });

  it.each(['THUNDER', 'STORM'])('a real club (%s) never shows the password form', async (code) => {
    available.mockResolvedValue(true);
    await open('/sign-in', { 'club-code': code });
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByText('Demo club. Sample people only.')).toBeNull();
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.getByText('Continue with Apple')).toBeTruthy();
  });

  it('signs in to the demo club with what was typed', async () => {
    await open('/sign-in', { 'club-code': 'DEMO' });
    await enter('Email', 'coach@demo.firstpass.example');
    await enter('Password', 'the-shared-password');
    await fireEvent.press(screen.getByText('Sign in'));
    await settle();
    expect(demo).toHaveBeenCalledTimes(1);
    expect(demo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'DEMO', demo: true }),
      'coach@demo.firstpass.example',
      'the-shared-password',
    );
    expect(google).not.toHaveBeenCalled();
  });

  it('pressing go on the password does the same', async () => {
    await open('/sign-in', { 'club-code': 'DEMO' });
    await enter('Email', 'guest@demo.firstpass.example');
    await enter('Password', 'pw');
    await fireEvent(screen.getByLabelText('Password'), 'submitEditing');
    await settle();
    expect(demo).toHaveBeenCalledWith(expect.anything(), 'guest@demo.firstpass.example', 'pw');
  });

  it('a wrong password shows the plain message, and they can try again', async () => {
    demo.mockRejectedValueOnce(new Error('That email and password don’t match a demo account.'));
    await open('/sign-in', { 'club-code': 'DEMO' });
    await enter('Email', 'coach@demo.firstpass.example');
    await enter('Password', 'wrong');
    await fireEvent.press(screen.getByText('Sign in'));
    await settle();
    expect(screen.getByText('That email and password don’t match a demo account.')).toBeTruthy();
    await enter('Password', 'right');
    await fireEvent.press(screen.getByText('Sign in'));
    await settle();
    expect(screen.queryByText('That email and password don’t match a demo account.')).toBeNull();
    expect(demo).toHaveBeenCalledTimes(2);
  });

  it('signs in once, however often it’s tapped while busy', async () => {
    let finish: () => void = () => {};
    demo.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    await open('/sign-in', { 'club-code': 'DEMO' });
    const pressing = await pressWithoutWaiting(screen.getByText('Sign in'));
    await settle();
    expect(screen.queryByText('Sign in')).toBeNull();
    const button = screen.getAllByRole('button')[0];
    await fireEvent.press(button);
    await settle();
    await act(async () => {
      finish();
      await pressing.done;
    });
    await settle();
    expect(demo).toHaveBeenCalledTimes(1);
  });
});

describe('returning from the sign-in browser', () => {
  it('goes straight to Home', async () => {
    await open('/auth-callback', { 'club-code': 'THUNDER' });
    expect(screen.getByText('screen:index')).toBeTruthy();
    expect(screen).toHavePathname('/');
  });
});
