/**
 * A card's status line (src/components/home/feature-card.tsx): quiet, needing
 * the member, or done. What needs the member is bold in the text colour with
 * a mark; done is green with a tick; neither is ever the club's colour.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { FeatureCard, StatusLine } from '@/components/home/feature-card';
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
  jest.requireActual('../../../__tests__/helpers/harness').constantsClubMock(),
);
jest.mock('@/hooks/use-theme', () => ({ useTheme: () => THEME }));

const styleOf = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

describe('a status line', () => {
  it('is quiet by default: secondary text and no mark', async () => {
    await render(<StatusLine text="No current injuries" />);
    expect(styleOf('No current injuries').color).toBe(THEME.textSecondary);
    expect(screen.toJSON()).toMatchObject({ type: 'Text' });
  });

  it('that needs the member is bold in the text colour, never the club’s', async () => {
    await render(<StatusLine text="Check-ins: not given" tone="attention" />);
    const style = styleOf('Check-ins: not given');
    expect(style.color).toBe(THEME.text);
    expect(style.color).not.toBe(THEME.tint);
    expect(style.fontFamily).toBe(BrandFonts.bold);
  });

  it('that is done is green', async () => {
    await render(<StatusLine text="Done for today" tone="done" />);
    const style = styleOf('Done for today');
    expect(style.color).toBe(THEME.positive);
    expect(style.fontFamily).toBe(BrandFonts.regular);
  });

  it.each(['attention', 'done'] as const)('has a mark beside it when it is %s', async (tone) => {
    await render(<StatusLine text="A line" tone={tone} />);
    // The mark and the text sit in one row.
    const row = screen.toJSON() as { type: string; children: unknown[] };
    expect(row.type).toBe('View');
    expect(row.children).toHaveLength(2);
  });
});

describe('a feature card', () => {
  it('shows its title, where it’s up to and a count, and opens when pressed', async () => {
    const onPress = jest.fn();
    await render(
      <FeatureCard icon="heart" title="Injuries" detail="1 current injury" detailTone="attention" badge={2} onPress={onPress} />,
    );
    expect(screen.getByText('Injuries')).toBeTruthy();
    expect(styleOf('1 current injury').color).toBe(THEME.text);
    expect(screen.getByText('2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('says done in words: the tick is an icon, not a character in the text', async () => {
    await render(
      <FeatureCard icon="smile" title="Daily check-in" detail="Done for today" detailTone="done" onPress={() => {}} />,
    );
    expect(screen.getByText('Done for today')).toBeTruthy();
    expect(screen.queryByText(/✓/)).toBeNull();
  });

  it('has no count at zero and no detail line when none is given', async () => {
    await render(<FeatureCard icon="heart" title="Registers" onPress={() => {}} />);
    expect(screen.getByText('Registers')).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });
});
