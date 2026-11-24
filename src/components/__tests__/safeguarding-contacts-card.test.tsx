/**
 * The safeguarding contacts card (src/components/safeguarding.tsx) shows the
 * governing body's number spaced for reading, whichever way it was saved, and
 * dials it with the digits only (25 November 2026).
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { SafeguardingContactsCard } from '@/components/safeguarding';
import type { SafeguardingContacts } from '@/lib/types';

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

let mockContacts: Partial<SafeguardingContacts> | null = null;
jest.mock('@/lib/concerns', () => ({
  ...jest.requireActual('@/lib/concerns'),
  useSafeguardingContacts: () => mockContacts,
}));

async function showWith(phone: string) {
  mockContacts = { governing_body_name: 'State Netball', governing_body_phone: phone, governing_body_url: null, policy_url: null };
  await render(<SafeguardingContactsCard />);
}

describe('SafeguardingContactsCard', () => {
  it.each([
    ['0891234567', '(08) 9123 4567', 'tel:0891234567'],
    ['08 9000 0000', '(08) 9000 0000', 'tel:0890000000'],
    ['0412345678', '0412 345 678', 'tel:0412345678'],
    ['1800955900', '1800 955 900', 'tel:1800955900'],
    ['131234', '13 12 34', 'tel:131234'],
    ['+61891234567', '+61 8 9123 4567', 'tel:+61891234567'],
    ['+442079460958', '+44 20 7946 0958', 'tel:+442079460958'],
    ['+64211234567', '+64 21 123 4567', 'tel:+64211234567'],
    ['+14155552671', '+1 415 555 2671', 'tel:+14155552671'],
  ])('shows %s as %s and dials %s', async (saved, shown, dialled) => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await showWith(saved);
    await fireEvent.press(screen.getByText(shown));
    expect(open).toHaveBeenCalledWith(dialled);
    open.mockRestore();
  });

  it('shows something saved before numbers were checked as it is', async () => {
    await showWith('old@example.com');
    expect(screen.getByText('old@example.com')).toBeTruthy();
  });

  it('leaves the national helplines as they publish them', async () => {
    await showWith('1800955900');
    expect(screen.getByText('1800 55 1800')).toBeTruthy();
    expect(screen.getByText('000')).toBeTruthy();
  });
});
