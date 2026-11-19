/**
 * The traffic lights on the home screen's Concerns card
 * (src/components/concern-lights.tsx), from "Concerns" in section 3 and
 * section 12 of docs/user-guide.md: counts only, in fixed colours.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ConcernLights, concernLightsLabel, LightColours } from '@/components/concern-lights';

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

const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);

describe('ConcernLights', () => {
  it('shows each count in its own colour: red new, orange in progress, green closed', async () => {
    await render(<ConcernLights counts={{ new: 1, inProgress: 4, closedRecently: 2 }} />);
    expect(style('concern-light-red').backgroundColor).toBe(LightColours.red.fill);
    expect(style('concern-light-orange').backgroundColor).toBe(LightColours.orange.fill);
    expect(style('concern-light-green').backgroundColor).toBe(LightColours.green.fill);
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('dims a light with nothing in it, and only that one', async () => {
    await render(<ConcernLights counts={{ new: 0, inProgress: 3, closedRecently: 0 }} />);
    expect(style('concern-light-red').opacity).toBe(0.35);
    expect(style('concern-light-orange').opacity).toBeUndefined();
    expect(style('concern-light-green').opacity).toBe(0.35);
  });

  it('reads the counts out in words', () => {
    expect(concernLightsLabel({ new: 1, inProgress: 0, closedRecently: 5 })).toBe(
      '1 new, 0 in progress, 5 closed in the last 4 weeks',
    );
  });
});
