/**
 * The tablet layout pieces (src/components/columns.tsx): Columns sits side by
 * side only on a wide tablet window, CardGrid puts two or three cards a row
 * once it has the room, and cards in a row share its height.
 */
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Fragment } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';

import { CardGrid, Columns, flattenChildren } from '@/components/columns';
import { Card, PressableCard } from '@/components/ui';

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

function setWindowWidth(width: number) {
  const size = { width, height: 900, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

afterEach(() => setWindowWidth(430));

/** Tells a CardGrid how wide it was laid out, as the device would. */
async function layOut(grid: ReturnType<typeof screen.getByTestId>, width: number) {
  await fireEvent(grid, 'layout', { nativeEvent: { layout: { width, height: 400, x: 0, y: 0 } } });
}

const texts = (node: ReturnType<typeof screen.getByTestId>) =>
  within(node)
    .queryAllByText(/.+/)
    .map((t) => t.props.children);

describe('Columns', () => {
  const both = <Columns first={<Text>To do</Text>} second={<Text>Attendance</Text>} />;

  it('stacks first then second on a phone, with no columns', async () => {
    setWindowWidth(430);
    await render(both);
    expect(screen.queryByTestId('columns')).toBeNull();
    expect(screen.getAllByText(/To do|Attendance/).map((t) => t.props.children)).toEqual([
      'To do',
      'Attendance',
    ]);
  });

  it('stays stacked on an upright iPad, where card grids do the work', async () => {
    setWindowWidth(820);
    await render(both);
    expect(screen.queryByTestId('columns')).toBeNull();
  });

  it('sits side by side on an iPad on its side, first on the left', async () => {
    setWindowWidth(1180);
    await render(
      <Columns first={<Text>To do</Text>} second={<Text>Attendance</Text>} firstFlex={2} secondFlex={3} />,
    );
    const row = screen.getByTestId('columns');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
    const [left, right] = row.children as ReturnType<typeof screen.getByTestId>[];
    expect(texts(left)).toEqual(['To do']);
    expect(texts(right)).toEqual(['Attendance']);
    expect(StyleSheet.flatten(left.props.style).flex).toBe(2);
    expect(StyleSheet.flatten(right.props.style).flex).toBe(3);
  });
});

describe('CardGrid', () => {
  const five = (
    <CardGrid>
      {['A', 'B', 'C', 'D', 'E'].map((n) => (
        <Card key={n}>
          <Text>{n}</Text>
        </Card>
      ))}
    </CardGrid>
  );

  it('is one column until it knows how wide it is', async () => {
    await render(five);
    const grid = screen.getByTestId('card-grid-1');
    expect(texts(grid)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('stays one column at phone width', async () => {
    await render(five);
    await layOut(screen.getByTestId('card-grid-1'), 382);
    expect(screen.getByTestId('card-grid-1')).toBeTruthy();
  });

  it('puts two cards a row on an upright tablet, in reading order', async () => {
    await render(five);
    await layOut(screen.getByTestId('card-grid-1'), 752);
    const grid = screen.getByTestId('card-grid-2');
    const rows = grid.children as ReturnType<typeof screen.getByTestId>[];
    expect(rows.map(texts)).toEqual([['A', 'B'], ['C', 'D'], ['E']]);
    // The last row keeps an empty cell, so E is as wide as the cards above it.
    expect((rows[2].children as unknown[]).length).toBe(2);
  });

  it('puts three cards a row on a wide screen, and goes back to one on a phone', async () => {
    await render(five);
    await layOut(screen.getByTestId('card-grid-1'), 1192);
    expect(screen.getByTestId('card-grid-3')).toBeTruthy();
    await layOut(screen.getByTestId('card-grid-3'), 382);
    expect(screen.getByTestId('card-grid-1')).toBeTruthy();
  });

  it('stretches cards to their row’s height in a grid, and not on a phone', async () => {
    await render(
      <CardGrid>
        <Card testID="plain">
          <Text>Plain</Text>
        </Card>
        <PressableCard onPress={() => {}}>
          <Text>Tap me</Text>
        </PressableCard>
      </CardGrid>,
    );
    const grow = () => [
      StyleSheet.flatten(screen.getByTestId('plain').props.style).flexGrow,
      StyleSheet.flatten(screen.getByRole('button').props.style).flexGrow,
    ];
    expect(grow()).toEqual([undefined, undefined]);
    await layOut(screen.getByTestId('card-grid-1'), 752);
    expect(grow()).toEqual([1, 1]);
  });

  it('keeps a tap on a card in the grid working', async () => {
    const onPress = jest.fn();
    await render(
      <CardGrid>
        <PressableCard onPress={onPress}>
          <Text>Session</Text>
        </PressableCard>
        <Card>
          <Text>Other</Text>
        </Card>
      </CardGrid>,
    );
    await layOut(screen.getByTestId('card-grid-1'), 752);
    await fireEvent.press(screen.getByText('Session'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('leaves out nothing-cards and opens up fragments', async () => {
    const hidden = false;
    await render(
      <CardGrid>
        {hidden ? <Text>Hidden</Text> : null}
        <Text>One</Text>
        <>
          <Text>Two</Text>
          {null}
          <Text>Three</Text>
        </>
        {undefined}
      </CardGrid>,
    );
    await layOut(screen.getByTestId('card-grid-1'), 1192);
    const rows = screen.getByTestId('card-grid-3').children as ReturnType<typeof screen.getByTestId>[];
    expect(rows.map(texts)).toEqual([['One', 'Two', 'Three']]);
    expect(screen.queryByText('Hidden')).toBeNull();
  });
});

describe('flattenChildren', () => {
  it('gives every card from a fragment its own key', () => {
    const items = flattenChildren(
      <>
        <Fragment key="x">
          <Text key="a">A</Text>
        </Fragment>
        <Fragment key="y">
          <Text key="a">B</Text>
        </Fragment>
      </>,
    ) as { key: string }[];
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});
