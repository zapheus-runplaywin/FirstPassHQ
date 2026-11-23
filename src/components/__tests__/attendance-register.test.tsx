/**
 * The attendance register (src/components/attendance-register.tsx) on a
 * tablet: athletes sit two or three a row so a whole squad fits on the screen,
 * and marking someone works the same as on a phone. From "Take attendance" in
 * section 4 of docs/user-guide.md.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AttendanceRegister } from '@/components/attendance-register';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark } from '@/lib/types';

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

// a3 is run by a parent and never signs in.
const query = {
  select: () => query,
  eq: () => query,
  in: () => query,
  then: (resolve: (r: { data: { id: string }[] }) => void) => resolve({ data: [{ id: 'a3' }] }),
};
beforeEach(() => {
  jest.mocked(supabase.from).mockImplementation(() => query as never);
});

const REGISTER: AttendanceMark[] = [
  { profile_id: 'a1', full_name: 'Alice Athlete', present: true },
  { profile_id: 'a2', full_name: 'Bea Athlete', present: false },
  { profile_id: 'a3', full_name: 'Cal Athlete', present: null },
  { profile_id: 'a4', full_name: 'Dee Athlete', present: null },
  { profile_id: 'a5', full_name: null, present: null },
];

async function layOut(width: number) {
  const grid = screen.getByTestId(/^card-grid-/);
  await fireEvent(grid, 'layout', { nativeEvent: { layout: { width, height: 600, x: 0, y: 0 } } });
}

const names = (node: ReturnType<typeof screen.getByTestId>) =>
  within(node)
    .queryAllByText(/athlete/i)
    .map((t) => t.props.children);

it('lists one athlete a row on a phone', async () => {
  await render(<AttendanceRegister register={REGISTER} onChange={jest.fn()} />);
  await layOut(382);
  expect(screen.getByTestId('card-grid-1')).toBeTruthy();
  expect(screen.getByText('1 of 5 present · 3 not marked')).toBeTruthy();
});

it('puts two athletes a row on an upright tablet, in the register’s order', async () => {
  await render(<AttendanceRegister register={REGISTER} onChange={jest.fn()} />);
  await layOut(752);
  const rows = screen.getByTestId('card-grid-2').children as ReturnType<typeof screen.getByTestId>[];
  expect(rows).toHaveLength(3);
  expect(names(rows[0])).toEqual(['Alice Athlete', 'Bea Athlete']);
  expect(names(rows[1])).toEqual([expect.stringMatching(/^Cal Athlete/), 'Dee Athlete']);
  expect(names(rows[2])).toEqual(['Unnamed athlete']);
});

it('marks an athlete present or absent from the grid', async () => {
  const onChange = jest.fn();
  await render(<AttendanceRegister register={REGISTER} onChange={onChange} />);
  await layOut(1192);
  expect(screen.getByTestId('card-grid-3')).toBeTruthy();
  const present = screen.getAllByRole('radio', { name: 'Present' });
  const absent = screen.getAllByRole('radio', { name: 'Absent' });
  expect(present).toHaveLength(5);
  await fireEvent.press(present[3]);
  expect(onChange).toHaveBeenLastCalledWith('a4', true);
  await fireEvent.press(absent[0]);
  expect(onChange).toHaveBeenLastCalledWith('a1', false);
  expect(present[0].props.accessibilityState).toEqual({ selected: true });
});

it('makes every athlete in a row the same height on a tablet only', async () => {
  await render(
    <AttendanceRegister
      register={REGISTER.slice(0, 2)}
      onChange={jest.fn()}
      away={{ a2: 'Away: school camp, back Friday' }}
    />,
  );
  // The athlete's line: the nearest box round their name with the line's height.
  const rowOf = () => {
    let node = screen.getByText('Alice Athlete');
    while (StyleSheet.flatten(node.props.style)?.minHeight !== 56) node = node.parent!;
    return node;
  };
  const grows = () => StyleSheet.flatten(rowOf().props.style).flexGrow;
  await layOut(382);
  expect(grows()).toBeUndefined();
  await layOut(752);
  expect(grows()).toBe(1);
});

it('read only, shows each athlete’s mark in the grid', async () => {
  await render(<AttendanceRegister register={REGISTER} />);
  await layOut(752);
  expect(screen.queryAllByRole('radio')).toHaveLength(0);
  expect(screen.getByText('Present')).toBeTruthy();
  expect(screen.getByText('Absent')).toBeTruthy();
  expect(screen.getAllByText('Not marked')).toHaveLength(3);
});
