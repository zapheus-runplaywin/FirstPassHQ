/**
 * The point a page opened from a to-do scrolls to (src/components/focus-anchor.tsx):
 * just above the part the to-do is about, following it while content loads
 * above it, then leaving the scrolling to the person.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { Text } from 'react-native';

import { FocusAnchor } from '@/components/focus-anchor';

const mockScrollToY = jest.fn();
jest.mock('@/components/screen', () => ({ useScrollToY: () => mockScrollToY }));
jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);

beforeEach(() => {
  mockScrollToY.mockClear();
  jest.useFakeTimers({ now: new Date('2026-10-18T02:00:00Z') });
});
afterEach(() => jest.useRealTimers());

const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 300, height: 0 } } });

describe('FocusAnchor', () => {
  it('shows nothing when the page wasn’t opened for this part', async () => {
    await render(<FocusAnchor active={false} />);
    expect(screen.queryByTestId('focus-anchor')).toBeNull();
  });

  it('shows what it holds, such as what to do, where it scrolls to', async () => {
    await render(
      <FocusAnchor active>
        <Text>To do</Text>
      </FocusAnchor>,
    );
    expect(screen.getByTestId('focus-anchor')).toContainElement(screen.getByText('To do'));
  });

  it('scrolls to just above itself when it appears', async () => {
    await render(<FocusAnchor active />);
    await fireEvent(screen.getByTestId('focus-anchor'), 'layout', layout(900));
    expect(mockScrollToY).toHaveBeenCalledTimes(1);
    expect(mockScrollToY.mock.calls[0][0]).toBeLessThan(900);
    expect(mockScrollToY.mock.calls[0][0]).toBeGreaterThan(850);
  });

  it('follows while content loads above it, then stops', async () => {
    await render(<FocusAnchor active />);
    const anchor = screen.getByTestId('focus-anchor');
    await fireEvent(anchor, 'layout', layout(500));
    jest.advanceTimersByTime(1000);
    await fireEvent(anchor, 'layout', layout(800));
    expect(mockScrollToY).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1000);
    await fireEvent(anchor, 'layout', layout(1200));
    expect(mockScrollToY).toHaveBeenCalledTimes(2);
  });
});
