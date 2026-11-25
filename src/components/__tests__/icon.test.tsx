/**
 * The app's icons (src/components/icon.tsx): every icon the app names has a
 * glyph in the font that ships with it, so none can show as an empty box, and
 * screen readers skip them (the words beside an icon say what it is).
 */
import { render, screen } from '@testing-library/react-native';

import { Icon, ICON_FONT_FAMILY, ICON_NAMES, iconFonts } from '@/components/icon';

/** As much of a file's bytes as reading a font's tables needs. */
type Bytes = {
  length: number;
  readUInt16BE(at: number): number;
  readInt16BE(at: number): number;
  readUInt32BE(at: number): number;
  toString(encoding: string, start?: number, end?: number): string;
};

const { readFileSync } = jest.requireActual('fs') as { readFileSync(path: string): Bytes };

jest.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ text: '#111111' }) }));

/** The characters a TrueType font has glyphs for, read from its cmap table. */
function charactersIn(font: Bytes): Set<number> {
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
  }
  if (cmap < 0) throw new Error('The font has no cmap table');
  const found = new Set<number>();
  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const at = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(at);
    if (format === 4) {
      const segments = font.readUInt16BE(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const offsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = font.readUInt16BE(ends + s * 2);
        const start = font.readUInt16BE(starts + s * 2);
        const delta = font.readInt16BE(deltas + s * 2);
        const offset = font.readUInt16BE(offsets + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph =
            offset === 0
              ? (c + delta) & 0xffff
              : font.readUInt16BE(offsets + s * 2 + offset + (c - start) * 2);
          if (glyph !== 0) found.add(c);
        }
      }
    } else if (format === 12) {
      const groups = font.readUInt32BE(at + 12);
      for (let g = 0; g < groups; g++) {
        const group = at + 16 + g * 12;
        const start = font.readUInt32BE(group);
        const end = font.readUInt32BE(group + 4);
        for (let c = start; c <= end; c++) found.add(c);
      }
    }
  }
  return found;
}

const FONTS = `${process.cwd()}/assets/fonts`;
const FONT = `${FONTS}/Feather.ttf`;

describe('Icon', () => {
  it('ships the font it draws with, under the name the styles use', () => {
    expect(Object.keys(iconFonts)).toEqual([ICON_FONT_FAMILY]);
    expect(readFileSync(FONT).length).toBeGreaterThan(10000);
    expect(readFileSync(`${FONTS}/Feather-LICENSE.txt`).toString('utf8')).toMatch(/MIT/);
  });

  it('has a glyph in the font for every icon the app names', async () => {
    const characters = charactersIn(readFileSync(FONT));
    expect(characters.size).toBeGreaterThan(200);
    const missing: string[] = [];
    for (const name of ICON_NAMES) {
      const { unmount } = await render(<Icon name={name} />);
      const glyph = screen.getByText(/./, { includeHiddenElements: true });
      const character = String(glyph.props.children).codePointAt(0)!;
      if (!characters.has(character)) missing.push(name);
      await unmount();
    }
    expect(missing).toEqual([]);
  });

  it('gives every icon its own glyph', async () => {
    const seen = new Map<string, string>();
    for (const name of ICON_NAMES) {
      const { unmount } = await render(<Icon name={name} />);
      const character = String(screen.getByText(/./, { includeHiddenElements: true }).props.children);
      expect(seen.get(character)).toBeUndefined();
      seen.set(character, name);
      await unmount();
    }
    expect(seen.size).toBe(ICON_NAMES.length);
  });

  it('is hidden from screen readers, and never grows with the text size', async () => {
    await render(<Icon name="shield" />);
    expect(screen.queryByText(/./)).toBeNull();
    const glyph = screen.getByText(/./, { includeHiddenElements: true });
    expect(glyph.props.accessible).toBe(false);
    expect(glyph.props.importantForAccessibility).toBe('no');
    expect(glyph.props.allowFontScaling).toBe(false);
  });

  it('draws in the text colour unless given one, at the size asked for', async () => {
    await render(<Icon name="home" />);
    const style = (node: { props: Record<string, unknown> }) =>
      Object.assign({}, ...[node.props.style].flat(Infinity)) as Record<string, unknown>;
    expect(style(screen.getByText(/./, { includeHiddenElements: true }))).toMatchObject({
      color: '#111111',
      fontSize: 20,
      width: 20,
      fontFamily: ICON_FONT_FAMILY,
    });
    await render(<Icon name="home" size={32} color="#FF0000" />);
    expect(style(screen.getByText(/./, { includeHiddenElements: true }))).toMatchObject({
      color: '#FF0000',
      fontSize: 32,
      height: 32,
    });
  });
});
