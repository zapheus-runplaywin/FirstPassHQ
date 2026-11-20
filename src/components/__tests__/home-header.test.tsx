/**
 * The top of the home screen (src/components/home-header.tsx): a greeting
 * smaller than a page title, the roles held, and a larger club logo.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HOME_LOGO_SIZE, HomeHeader } from '@/components/home-header';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('../../__tests__/helpers/harness').clubChoiceModuleMock(),
);
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const LOGO = { uri: 'https://example.supabase.co/logo.png' };

describe('HomeHeader', () => {
  it('greets the member by name, as the screen heading', async () => {
    await render(<HomeHeader name="Avery Admin" logo={LOGO} clubName="Perth Pumpkins" />);
    const greeting = screen.getByText('Hi Avery Admin');
    expect(greeting.props.accessibilityRole).toBe('header');
  });

  it('keeps the greeting smaller than a page subtitle, and to two lines at most', async () => {
    await render(
      <HomeHeader
        name="Alexandra Constantinopoulos-Fitzgerald"
        logo={LOGO}
        clubName="Perth Pumpkins"
      />,
    );
    const greeting = screen.getByText('Hi Alexandra Constantinopoulos-Fitzgerald');
    const style = StyleSheet.flatten(greeting.props.style);
    expect(style.fontSize).toBe(22);
    expect(style.fontSize).toBeLessThan(32);
    expect(greeting.props.numberOfLines).toBe(2);
    expect(greeting.props.adjustsFontSizeToFit).toBe(true);
  });

  it('shows the roles held beneath the greeting when given', async () => {
    await render(
      <HomeHeader name="Kim" roles="Committee · President" logo={LOGO} clubName="Thunder" />,
    );
    expect(screen.getByText('Committee · President')).toBeTruthy();
  });

  it('shows titles held on their own line beneath the roles', async () => {
    await render(
      <HomeHeader
        name="Sam Stats"
        roles="Statistician"
        titles="Child Safety Officer · WWC Registration Officer"
        logo={LOGO}
        clubName="Thunder"
      />,
    );
    expect(screen.getByText('Statistician')).toBeTruthy();
    expect(screen.getByTestId('home-titles')).toHaveTextContent(
      'Child Safety Officer · WWC Registration Officer',
    );
  });

  it('shows no titles line when none are held', async () => {
    await render(<HomeHeader name="Sam" roles="Statistician" titles="" logo={LOGO} clubName="Thunder" />);
    expect(screen.queryByTestId('home-titles')).toBeNull();
  });

  it('shows no roles line for someone not yet approved', async () => {
    await render(<HomeHeader name="Sam" logo={LOGO} clubName="Thunder" />);
    expect(screen.queryByText(/Committee|Admin|Coach/)).toBeNull();
  });

  it('shows the club logo larger than before, named for screen readers', async () => {
    await render(<HomeHeader name="Avery" logo={LOGO} clubName="West Coast Thunder" />);
    const logo = screen.getByTestId('home-club-logo');
    expect(HOME_LOGO_SIZE).toBeGreaterThan(112);
    expect(StyleSheet.flatten(logo.props.style)).toMatchObject({
      width: HOME_LOGO_SIZE,
      height: HOME_LOGO_SIZE,
    });
    expect(screen.getByLabelText('West Coast Thunder')).toBeTruthy();
  });
});
