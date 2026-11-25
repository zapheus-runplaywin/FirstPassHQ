/**
 * The version and build in small print (src/components/app-version.tsx), on
 * the opening screen and at the foot of Find your club, sign-in and Me.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AppVersion } from '@/components/app-version';
import { appVersionLines } from '@/lib/app-version';

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
jest.mock('@/lib/app-version', () => ({ appVersionLines: jest.fn() }));

const lines = jest.mocked(appVersionLines);

beforeEach(() => {
  lines.mockReturnValue(['Version 1.0.0 (23) · Build 714', 'Update 1a2b3c4d · 20 Nov 2026']);
});

describe('AppVersion', () => {
  it('shows each line in small print', async () => {
    await render(<AppVersion />);
    const first = screen.getByText('Version 1.0.0 (23) · Build 714');
    expect(screen.getByText('Update 1a2b3c4d · 20 Nov 2026')).toBeTruthy();
    expect(StyleSheet.flatten(first.props.style).fontSize).toBe(11);
  });

  it('reads as one label to a screen reader', async () => {
    await render(<AppVersion />);
    expect(screen.getByTestId('app-version').props.accessibilityLabel).toBe(
      'Version 1.0.0 (23) · Build 714. Update 1a2b3c4d · 20 Nov 2026',
    );
  });

  it('takes a colour for the navy opening screen', async () => {
    await render(<AppVersion color="#CBD5E1" />);
    const first = screen.getByText('Version 1.0.0 (23) · Build 714');
    expect(StyleSheet.flatten(first.props.style).color).toBe('#CBD5E1');
  });

  it('shows nothing when nothing is known', async () => {
    lines.mockReturnValue([]);
    await render(<AppVersion />);
    expect(screen.queryByTestId('app-version')).toBeNull();
  });
});
