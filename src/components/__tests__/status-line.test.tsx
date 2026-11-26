/**
 * A line of status anywhere in the app (src/components/status-line.tsx). What
 * needs the member is bold in the text colour with a mark, done is green with
 * a tick, and neither is ever the club's colour, which is kept for links and
 * buttons.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StatusLine } from '@/components/status-line';
import { BrandFonts } from '@/constants/theme';

const THEME = {
  text: '#FFFFFF',
  textSecondary: '#AAAAAA',
  background: '#000000',
  backgroundElement: '#1C1C1C',
  backgroundSelected: '#2E2E2E',
  tint: '#FFCD00',
  accent: '#FFCD00',
  onAccent: '#000000',
  attention: '#FFFFFF',
  positive: '#5BD68A',
};

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => THEME }));

const styleOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);
/** The mark beside a line: the icon drawn before its words. */
const markOf = (testID: string) => {
  const [mark] = screen.getByTestId(testID).children as unknown as { props: { style: object } }[];
  return StyleSheet.flatten(mark.props.style) as { color: string };
};

describe('a line of status', () => {
  it('that needs the member has a mark in the text colour, and bold words', async () => {
    await render(<StatusLine text="Stood down since 3 October" tone="attention" />);
    expect(styleOf('Stood down since 3 October')).toMatchObject({
      color: THEME.attention,
      fontFamily: BrandFonts.bold,
    });
    expect(markOf('status-attention').color).toBe(THEME.attention);
    expect(screen.queryByTestId('status-done')).toBeNull();
  });

  it('that is done has a green tick and green words', async () => {
    await render(<StatusLine text="Complete" tone="done" />);
    expect(styleOf('Complete').color).toBe(THEME.positive);
    expect(markOf('status-done').color).toBe(THEME.positive);
    expect(screen.queryByTestId('status-attention')).toBeNull();
  });

  it('that is quiet has no mark at all', async () => {
    await render(<StatusLine text="Check current" />);
    expect(styleOf('Check current').color).toBe(THEME.textSecondary);
    expect(screen.queryByTestId('status-attention')).toBeNull();
    expect(screen.queryByTestId('status-done')).toBeNull();
  });

  it.each(['quiet', 'attention', 'done'] as const)('is never the club’s colour when %s', async (tone) => {
    await render(<StatusLine text="A line" tone={tone} bold />);
    expect(styleOf('A line').color).not.toBe(THEME.tint);
  });

  it.each(['quiet', 'done'] as const)('can be bold as a heading when %s', async (tone) => {
    await render(<StatusLine text="Cleared to play" tone={tone} bold />);
    expect(styleOf('Cleared to play').fontFamily).toBe(BrandFonts.bold);
  });

  it('fills the line so long words wrap under themselves, not under the mark', async () => {
    await render(<StatusLine text="Locked: no verified parent is linked" tone="attention" />);
    expect(styleOf('Locked: no verified parent is linked')).toMatchObject({ flex: 1, minWidth: 0 });
  });

  it('is only as wide as its words at the end of a row', async () => {
    await render(<StatusLine text="2 flagged" tone="attention" inline />);
    expect(styleOf('2 flagged').flex).toBeUndefined();
  });

  it('takes the place it is given in a row', async () => {
    await render(<StatusLine text="Cleared to play" tone="done" style={{ flex: 1 }} />);
    expect(StyleSheet.flatten(screen.getByTestId('status-done').props.style)).toMatchObject({
      flex: 1,
      flexDirection: 'row',
    });
  });
});
