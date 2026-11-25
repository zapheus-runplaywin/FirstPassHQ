/**
 * Status never relies on the club's colour (HQ redesign, item 6): what needs
 * a member is in the text colour, and "done" is a green that reads on a panel
 * in any club's colours, or the text colour where no green would.
 */
import * as fc from 'fast-check';

import { contrastRatio, makeColors, StatusGreens } from '@/constants/theme';

jest.mock('@/global.css', () => ({}));
jest.mock('@/constants/club', () =>
  jest.requireActual('../../__tests__/helpers/harness').constantsClubMock(),
);

const hex = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map((rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase());

/** Any club's colours that Club settings would accept: text that reads on the background. */
const club = fc
  .record({ background: hex, text: hex, hero: hex })
  .filter(({ background, text }) => contrastRatio(text, background) >= 4.5);

describe('what needs a member', () => {
  it('is the text colour, whatever the club’s hero colour', () => {
    fc.assert(
      fc.property(club, (colours) => {
        const palette = makeColors(colours);
        expect(palette.attention).toBe(colours.text);
      }),
    );
  });

  it('on a gold club is white, not gold', () => {
    const thunder = makeColors({ background: '#000000', text: '#FFFFFF', hero: '#FFCD00' });
    expect(thunder.attention).toBe('#FFFFFF');
    expect(thunder.attention).not.toBe(thunder.tint);
  });
});

describe('done', () => {
  it('is the light green on a dark club and the dark green on a light one', () => {
    expect(makeColors({ background: '#000000', text: '#FFFFFF', hero: '#FFCD00' }).positive).toBe(StatusGreens[1]);
    expect(makeColors({ background: '#FFFFFF', text: '#111111', hero: '#0055AA' }).positive).toBe(StatusGreens[0]);
  });

  it('is never the club’s hero colour, even a green one', () => {
    const green = makeColors({ background: '#FFFFFF', text: '#111111', hero: '#00AA44' });
    expect(green.positive).toBe(StatusGreens[0]);
  });

  it('reads on a panel in any club’s colours', () => {
    fc.assert(
      fc.property(club, (colours) => {
        const palette = makeColors(colours);
        const onPanel = contrastRatio(palette.positive, palette.backgroundElement);
        // Either a green that passes AA as text, or the club's own text colour.
        expect(
          palette.positive === colours.text ||
            (StatusGreens.includes(palette.positive as (typeof StatusGreens)[number]) && onPanel >= 4.5),
        ).toBe(true);
      }),
    );
  });

  it('falls back to the text colour on a mid-tone club where no green reads', () => {
    const grey = makeColors({ background: '#777777', text: '#000000', hero: '#FFCD00' });
    expect(grey.positive).toBe('#000000');
  });
});
