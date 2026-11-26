/**
 * A list with its chosen item beside it (src/components/list-detail.tsx): on
 * a window wide enough for both the item opens beside the list, told which
 * item through the pane and not the address; on anything narrower the list is
 * alone and an item opens its own screen. The lists that use it are tested
 * with their own screens (the "on a tablet" tests in src/__tests__).
 */
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';

import { Columns } from '@/components/columns';
import {
  LIST_WIDTH,
  ListDetail,
  ScreenTitle,
  SPLIT_MIN_WIDTH,
  useBesideList,
  useLeaveScreen,
  useListChanged,
  useListDetail,
  useScreenParams,
  useSplitLayout,
} from '@/components/list-detail';
import { PressableCard } from '@/components/ui';
import { COLUMNS_MIN_WIDTH } from '@/hooks/use-layout';

jest.mock('@/global.css', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club-choice', () =>
  jest.requireActual('../../__tests__/helpers/harness').clubChoiceModuleMock(),
);
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);

const PHONE = 430;
const IPAD_UPRIGHT = 820;
const IPAD_SIDEWAYS = 1180;
const BIG_IPAD_SIDEWAYS = 1376;

function setWindowWidth(width: number) {
  const size = { width, height: width > 1000 ? 820 : 1180, scale: 2, fontScale: 1 };
  Dimensions.set({ window: size, screen: size });
}

/** What the list was told, and how often the item's screen loaded. */
const told = { left: 0, changed: 0, loads: 0 };

/** The item's own screen: the same component on its route and beside the list. */
function Item() {
  const { id } = useScreenParams<{ id: string }>();
  const leave = useLeaveScreen('/');
  const changed = useListChanged();
  const beside = useBesideList();
  const splits = useSplitLayout();
  const [typed, setTyped] = useState('nothing typed');
  // Loads, and tells the list, the way a message marks itself read.
  useEffect(() => {
    told.loads += 1;
    changed();
  }, [id, changed]);
  return (
    <View>
      <ScreenTitle title={`Item ${id}`} />
      <Text>{`Showing ${id}`}</Text>
      <Text>{beside ? 'beside its list' : 'on its own screen'}</Text>
      <Text>{splits ? 'would split' : 'would not split'}</Text>
      <Text>{typed}</Text>
      <Pressable onPress={() => setTyped('typed something')}>
        <Text>Type</Text>
      </Pressable>
      <Pressable onPress={changed}>
        <Text>Save and stay</Text>
      </Pressable>
      <Pressable onPress={leave}>
        <Text>Save and leave</Text>
      </Pressable>
      <Columns first={<Text>Item first</Text>} second={<Text>Item second</Text>} />
    </View>
  );
}

function List() {
  const [reloads, setReloads] = useState(0);
  const detail = useListDetail<{ id: string }>((params) =>
    router.push({ pathname: '/thing/[id]', params }),
  );
  return (
    <ListDetail
      chosen={detail.chosen}
      detail={<Item />}
      title="Item"
      hint="Choose an item."
      onLeave={() => {
        told.left += 1;
        detail.close();
        setReloads((n) => n + 1);
      }}
      onChanged={() => {
        told.changed += 1;
        setReloads((n) => n + 1);
      }}>
      <View>
        <Text>{`Loaded ${reloads + 1} times`}</Text>
        {['a', 'b'].map((id) => (
          <Pressable key={id} onPress={() => detail.open({ id })}>
            <Text>{`Open ${id}`}</Text>
          </Pressable>
        ))}
        <Columns first={<Text>List first</Text>} second={<Text>List second</Text>} />
      </View>
    </ListDetail>
  );
}

let push: jest.SpyInstance | undefined;

async function open(url = '/') {
  const spy = jest.spyOn(router, 'push').mockImplementation(() => {});
  push = spy;
  await renderRouter({ index: List, 'thing/[id]': Item }, { initialUrl: url });
  // The router binds its methods when a screen first renders.
  Object.assign(router, { push: spy });
  await act(async () => {});
  return spy;
}

beforeEach(() => {
  told.left = 0;
  told.changed = 0;
  told.loads = 0;
});
afterEach(() => {
  push?.mockRestore();
  push = undefined;
  setWindowWidth(PHONE);
});

const pane = (id: 'list-pane' | 'detail-pane') => within(screen.getByTestId(id));

it('splits from the width where columns sit side by side', () => {
  expect(SPLIT_MIN_WIDTH).toBe(COLUMNS_MIN_WIDTH);
  expect(LIST_WIDTH).toBeLessThan(SPLIT_MIN_WIDTH / 2);
});

describe.each([
  ['a phone', PHONE],
  ['an iPad upright', IPAD_UPRIGHT],
  ['a window just too narrow', SPLIT_MIN_WIDTH - 1],
])('on %s', (_label, width) => {
  beforeEach(() => setWindowWidth(width));

  it('shows the list alone', async () => {
    await open();
    expect(screen.queryByTestId('list-detail')).toBeNull();
    expect(screen.queryByText('Choose an item.')).toBeNull();
    expect(screen.getByText('Open a')).toBeTruthy();
  });

  it('opens an item on its own screen', async () => {
    const pushed = await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pushed).toHaveBeenCalledWith({ pathname: '/thing/[id]', params: { id: 'a' } });
    expect(screen.queryByText('Showing a')).toBeNull();
  });
});

describe.each([
  ['an iPad on its side', IPAD_SIDEWAYS],
  ['a window just wide enough', SPLIT_MIN_WIDTH],
])('on %s', (_label, width) => {
  beforeEach(() => setWindowWidth(width));

  it('shows the list with room beside it, and nothing open until an item is chosen', async () => {
    await open();
    expect(pane('list-pane').getByText('Open a')).toBeTruthy();
    expect(pane('detail-pane').getByText('Choose an item.')).toBeTruthy();
    expect(screen.queryByText(/^Showing/)).toBeNull();
    expect(told.loads).toBe(0);
  });

  it('opens the chosen item beside the list, without leaving the list', async () => {
    const pushed = await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pushed).not.toHaveBeenCalled();
    expect(pane('detail-pane').getByText('Showing a')).toBeTruthy();
    expect(pane('detail-pane').getByText('beside its list')).toBeTruthy();
    expect(pane('list-pane').getByText('Open b')).toBeTruthy();
    expect(screen.queryByText('Choose an item.')).toBeNull();
  });

  it('names the item above it, as its own screen’s title would', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pane('detail-pane').getByRole('header').props.children).toBe('Item a');
    expect(screen.getByLabelText('Close Item a')).toBeTruthy();
  });

  it('starts a different item afresh', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    await fireEvent.press(screen.getByText('Type'));
    expect(screen.getByText('typed something')).toBeTruthy();
    await fireEvent.press(screen.getByText('Open b'));
    expect(pane('detail-pane').getByText('Showing b')).toBeTruthy();
    expect(screen.queryByText('Showing a')).toBeNull();
    expect(screen.getByText('nothing typed')).toBeTruthy();
    expect(pane('detail-pane').getByRole('header').props.children).toBe('Item b');
  });

  it('reloads the list when the item changes, and keeps the item open', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    const before = told.changed;
    await fireEvent.press(screen.getByText('Save and stay'));
    expect(told.changed).toBe(before + 1);
    expect(told.left).toBe(0);
    expect(pane('detail-pane').getByText('Showing a')).toBeTruthy();
  });

  it('closes the item and reloads the list when the item is finished with', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    await open();
    Object.assign(router, { back });
    await fireEvent.press(screen.getByText('Open a'));
    await fireEvent.press(screen.getByText('Save and leave'));
    expect(told.left).toBe(1);
    expect(screen.queryByText('Showing a')).toBeNull();
    expect(pane('detail-pane').getByText('Choose an item.')).toBeTruthy();
    // The list is still the screen being looked at.
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('closes the item from the cross above it', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    await fireEvent.press(screen.getByLabelText('Close Item a'));
    expect(told.left).toBe(1);
    expect(screen.queryByText('Showing a')).toBeNull();
    expect(pane('detail-pane').getByText('Choose an item.')).toBeTruthy();
  });

  it('doesn’t go round in circles when an item tells the list as it loads', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    // The item loaded once and told the list once, though the list drew again.
    expect(told.loads).toBe(1);
    expect(told.changed).toBe(1);
    expect(pane('list-pane').getByText('Loaded 2 times')).toBeTruthy();
  });

  it('lays the list out as on a phone, not in columns', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pane('list-pane').queryByTestId('columns')).toBeNull();
    expect(pane('list-pane').getByText('List second')).toBeTruthy();
  });

  it('lays the item out in the room it has, not in columns', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pane('detail-pane').queryByTestId('columns')).toBeNull();
    expect(pane('detail-pane').getByText('Item second')).toBeTruthy();
  });

  it('opens a list’s items on their own screens when that list is itself beside a list', async () => {
    await open();
    await fireEvent.press(screen.getByText('Open a'));
    expect(pane('detail-pane').getByText('would not split')).toBeTruthy();
  });
});

it('puts the item in columns on the biggest iPad on its side, where it has the room', async () => {
  setWindowWidth(BIG_IPAD_SIDEWAYS);
  expect(BIG_IPAD_SIDEWAYS - LIST_WIDTH).toBeGreaterThanOrEqual(COLUMNS_MIN_WIDTH);
  await open();
  await fireEvent.press(screen.getByText('Open a'));
  expect(pane('detail-pane').getByTestId('columns')).toBeTruthy();
  expect(pane('list-pane').queryByTestId('columns')).toBeNull();
});

it('goes back to the list alone when the window narrows, and forgets nothing of the list', async () => {
  setWindowWidth(IPAD_SIDEWAYS);
  await open();
  await fireEvent.press(screen.getByText('Open a'));
  await act(async () => setWindowWidth(IPAD_UPRIGHT));
  expect(screen.queryByTestId('list-detail')).toBeNull();
  expect(screen.queryByText('Showing a')).toBeNull();
  expect(screen.getByText('Open a')).toBeTruthy();
});

describe('the item on its own screen', () => {
  beforeEach(() => setWindowWidth(PHONE));

  it('shows the item its address names', async () => {
    await open('/thing/z');
    expect(screen.getByText('Showing z')).toBeTruthy();
    expect(screen.getByText('on its own screen')).toBeTruthy();
    expect(screen.queryByTestId('list-detail')).toBeNull();
  });

  it('tells no list when it changes', async () => {
    await open('/thing/z');
    await fireEvent.press(screen.getByText('Save and stay'));
    expect(told.changed).toBe(0);
    expect(screen.getByText('Showing z')).toBeTruthy();
  });

  it('goes back when finished with', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    const canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    await open('/thing/z');
    Object.assign(router, { back, canGoBack, replace });
    await fireEvent.press(screen.getByText('Save and leave'));
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    [back, canGoBack, replace].forEach((spy) => spy.mockRestore());
  });

  it('goes to its list when opened from a link, with nothing to go back to', async () => {
    const back = jest.spyOn(router, 'back').mockImplementation(() => {});
    const canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(false);
    const replace = jest.spyOn(router, 'replace').mockImplementation(() => {});
    await open('/thing/z');
    Object.assign(router, { back, canGoBack, replace });
    await fireEvent.press(screen.getByText('Save and leave'));
    expect(replace).toHaveBeenCalledWith('/');
    expect(back).not.toHaveBeenCalled();
    [back, canGoBack, replace].forEach((spy) => spy.mockRestore());
  });

  it('on a wide window too, has the whole window to itself', async () => {
    setWindowWidth(IPAD_SIDEWAYS);
    await open('/thing/z');
    expect(screen.getByText('on its own screen')).toBeTruthy();
    expect(screen.getByText('would split')).toBeTruthy();
    expect(screen.getByTestId('columns')).toBeTruthy();
  });
});

describe('a card in a list', () => {
  const Cards = () => (
    <View>
      <PressableCard onPress={() => {}} selected>
        <Text>Open beside the list</Text>
      </PressableCard>
      <PressableCard onPress={() => {}} selected={false}>
        <Text>Another in the list</Text>
      </PressableCard>
      <PressableCard onPress={() => {}}>
        <Text>On a phone</Text>
      </PressableCard>
    </View>
  );

  it('says which one is open beside the list to a screen reader', async () => {
    await renderRouter({ index: Cards }, { initialUrl: '/' });
    const [open_, other, phone] = screen.getAllByRole('button');
    expect(open_.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(other.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    // With nothing beside the list, a card is a plain button.
    expect(phone.props.accessibilityState?.selected).toBeUndefined();
  });

  it('marks the open one with an edge laid over the card, so nothing in it moves', async () => {
    await renderRouter({ index: Cards }, { initialUrl: '/' });
    const [open_, other, phone] = screen.getAllByRole('button');
    const edge = within(open_).getByTestId('chosen-edge');
    expect(StyleSheet.flatten(edge.props.style)).toEqual(
      expect.objectContaining({ position: 'absolute', left: 0, width: 3 }),
    );
    // The same padding, chosen or not.
    const padding = (card: typeof open_) => StyleSheet.flatten(card.props.style).padding;
    expect(padding(open_)).toBe(padding(other));
    expect(within(other).queryByTestId('chosen-edge')).toBeNull();
    expect(within(phone).queryByTestId('chosen-edge')).toBeNull();
  });
});
