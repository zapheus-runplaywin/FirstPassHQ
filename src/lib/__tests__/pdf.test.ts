/**
 * The PDF writer behind every admin report (src/lib/pdf.ts). Each test reads
 * the bytes back with the decoder in src/__tests__/helpers/documents.ts, so it
 * checks what a committee member would actually see in the file: the text,
 * where it breaks, which rows are red, the page numbers and that the file's
 * structure is sound enough for any PDF reader to open.
 */
import { reportPdf, wrapText, type Report, type ReportSection } from '@/lib/pdf';

import { drawnText, readPdf, type PdfPage } from '../../__tests__/helpers/documents';

const MADE = new Date('2026-10-18T02:00:00Z');
const RED = [0.7, 0.05, 0.1];
const INK = [0.1, 0.1, 0.1];
const GREY = [0.4, 0.4, 0.4];

function pdf(report: Partial<Report> = {}, options: { clubName?: string; accent?: string } = {}) {
  return readPdf(
    reportPdf(
      { title: 'Sample report', sections: [], ...report },
      { clubName: options.clubName ?? 'Sample Club', accent: options.accent, generatedAt: MADE },
    ),
  );
}

const section = (overrides: Partial<ReportSection> = {}): ReportSection => ({
  title: 'Members',
  columns: [{ label: 'Name' }, { label: 'Status' }],
  rows: [],
  ...overrides,
});

const made = `Made ${MADE.toLocaleString('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})}`;

const find = (page: PdfPage, text: string) => page.texts.filter((t) => t.text === text);

describe('wrapText', () => {
  it('keeps short text on one line', () => {
    expect(wrapText('Sample Club', 200, 10)).toEqual(['Sample Club']);
  });

  it('breaks between words to fit the width', () => {
    const lines = wrapText('one two three four five six seven eight nine ten', 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
    for (const line of lines) expect(line).not.toMatch(/^ | $/);
  });

  it('cuts a word longer than the width, losing no characters', () => {
    const word = 'Supercalifragilisticexpialidocious';
    const lines = wrapText(word, 40, 10);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join('')).toBe(word);
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });

  it('keeps the line breaks in a value', () => {
    expect(wrapText('Open A\n17 & Under A', 500, 10)).toEqual(['Open A', '17 & Under A']);
    expect(wrapText('', 100, 10)).toEqual(['']);
  });

  it('measures bold text as wider', () => {
    const text = 'Working With Children Checks';
    // The narrowest width that fits the regular face on one line is too narrow for bold.
    let width = 50;
    while (wrapText(text, width, 10).length > 1) width += 1;
    expect(width).toBeGreaterThan(100);
    expect(wrapText(text, width, 10, true).length).toBeGreaterThan(1);
  });
});

describe('reportPdf', () => {
  it('writes a well-formed PDF with its title, maker and date', () => {
    const file = pdf();
    expect(file.pages).toHaveLength(1);
    expect(file.info).toEqual({
      title: 'Sample Club · Sample report',
      producer: 'FirstPass',
      creationDate: 'D:20261018020000Z',
    });
  });

  it('is A4 portrait, or across the page when landscape', () => {
    expect(pdf().pages[0]).toMatchObject({ width: 595.28, height: 841.89 });
    expect(pdf({ landscape: true }).pages[0]).toMatchObject({ width: 841.89, height: 595.28 });
  });

  it('opens with the club, the title, the subtitle and when it was made', () => {
    const [page] = pdf({ subtitle: 'Season 2026–27' }).pages;
    expect(drawnText(page).slice(0, 4)).toEqual(['Sample Club', 'Sample report', 'Season 2026–27', made]);
    expect(find(page, 'Sample report')[0]).toMatchObject({ bold: true, size: 20 });
    expect(find(page, 'Sample Club')[0]).toMatchObject({ size: 10, colour: GREY });
  });

  it('draws the club’s accent bar only when it has an accent colour', () => {
    // #F75C03 is 247, 92, 3.
    expect(pdf({}, { accent: '#F75C03' }).pages[0].stream).toContain('0.97 0.36 0.01 rg 40 797.89 48 4 re f');
    expect(pdf().pages[0].stream).not.toContain('48 4 re f');
  });

  it('shows each figure in bold with its label', () => {
    const [page] = pdf({ stats: [{ label: 'Need a check', value: 12 }, { label: 'Expired', value: '3' }] }).pages;
    expect(find(page, '12')[0]).toMatchObject({ bold: true, size: 14 });
    expect(find(page, 'Need a check')[0]).toMatchObject({ bold: false, size: 7.5, colour: GREY });
    expect(find(page, '3')[0]).toMatchObject({ bold: true, size: 14 });
  });

  it('puts five figures to a row on a portrait page and six across', () => {
    const stats = Array.from({ length: 7 }, (_, i) => ({ label: `Figure ${i + 1}`, value: i + 1 }));
    const rows = (page: PdfPage) =>
      new Set(page.texts.filter((t) => t.text.startsWith('Figure ')).map((t) => t.y)).size;
    expect(rows(pdf({ stats }).pages[0])).toBe(2);
    expect(rows(pdf({ stats: stats.slice(0, 6), landscape: true }).pages[0])).toBe(1);
  });

  it('draws a table with a bold header, its note in grey, and each row', () => {
    const [page] = pdf({
      sections: [
        section({
          note: 'Everyone in the club.',
          rows: [{ cells: ['Alex Sample', 'Current'] }, { cells: ['Sam Sample', 'Expired'], flag: true }],
        }),
      ],
    }).pages;
    expect(find(page, 'Members')[0]).toMatchObject({ bold: true, size: 12 });
    expect(find(page, 'Everyone in the club.')[0]).toMatchObject({ colour: GREY });
    expect(find(page, 'Name')[0]).toMatchObject({ bold: true });
    expect(find(page, 'Status')[0]).toMatchObject({ bold: true });
    // A plain row in ink.
    expect(find(page, 'Alex Sample')[0]).toMatchObject({ bold: false, colour: INK });
    expect(find(page, 'Current')[0]).toMatchObject({ bold: false, colour: INK });
    // A row that needs attention in red, its first cell in bold.
    expect(find(page, 'Sam Sample')[0]).toMatchObject({ bold: true, colour: RED });
    expect(find(page, 'Expired')[0]).toMatchObject({ bold: false, colour: RED });
    // Columns share the width: the second starts half way across.
    expect(find(page, 'Status')[0].x).toBeCloseTo(40 + (595.28 - 80) / 2 + 4, 1);
  });

  it('gives each column its share of the width', () => {
    const [page] = pdf({
      sections: [
        section({
          columns: [{ label: 'Wide', width: 3 }, { label: 'Narrow', width: 1 }],
          rows: [{ cells: ['a', 'b'] }],
        }),
      ],
    }).pages;
    expect(find(page, 'Narrow')[0].x).toBeCloseTo(40 + ((595.28 - 80) * 3) / 4 + 4, 1);
  });

  it('says why a table is empty instead of drawing it', () => {
    const [page] = pdf({
      sections: [section({ title: 'Stand-downs', empty: 'Nobody has been stood down.' }), section({ title: 'Other' })],
    }).pages;
    expect(find(page, 'Nobody has been stood down.')[0]).toMatchObject({ colour: GREY });
    expect(find(page, 'Nothing to show.')).toHaveLength(1);
    expect(find(page, 'Name')).toHaveLength(0);
  });

  it('ends with the footnote', () => {
    const [page] = pdf({ sections: [section()], footnote: 'From the cards admins record.' }).pages;
    expect(find(page, 'From the cards admins record.')[0]).toMatchObject({ colour: GREY });
  });

  it('numbers every page and names the club and report in the footer', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ cells: [`Member ${i + 1}`, 'Current'] }));
    const file = pdf({ sections: [section({ rows })] });
    expect(file.pages.length).toBeGreaterThan(2);
    file.pages.forEach((page, i) => {
      expect(find(page, `Page ${i + 1} of ${file.pages.length}`)).toHaveLength(1);
      expect(find(page, 'Sample Club · Sample report')).toHaveLength(1);
    });
  });

  describe('long tables', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ cells: [`Member ${i + 1}`, `Status ${i + 1}`] }));
    const file = pdf({ sections: [section({ rows })] });

    it('carry every row onto the next page, once each and in order', () => {
      const names = file.pages.flatMap((p) => drawnText(p).filter((t) => /^Member \d+$/.test(t)));
      expect(names).toEqual(rows.map((r) => r.cells[0]));
    });

    it('repeat the title as continued, and the header, on each new page', () => {
      expect(find(file.pages[0], 'Members')).toHaveLength(1);
      for (const page of file.pages.slice(1)) {
        expect(find(page, 'Members (continued)')).toHaveLength(1);
        expect(find(page, 'Name')[0]).toMatchObject({ bold: true });
        expect(find(page, 'Status')[0]).toMatchObject({ bold: true });
      }
    });

    it('never write a row into the footer or off the page', () => {
      for (const page of file.pages) {
        for (const t of page.texts.filter((x) => /^(Member|Status) \d+$/.test(x.text))) {
          // The footer's rule sits 44pt above the bottom; rows stay above the 68pt margin.
          expect(t.y).toBeGreaterThan(68 - 8.5);
          expect(t.y).toBeLessThan(page.height - 40);
        }
      }
    });
  });

  it('starts a table on a new page rather than leave its title alone at the bottom', () => {
    const filler = Array.from({ length: 58 }, (_, i) => ({ cells: [`Row ${i + 1}`, ''] }));
    const file = pdf({
      sections: [section({ title: 'First', rows: filler }), section({ title: 'Second', rows: [{ cells: ['Last row', 'x'] }] })],
    });
    const withSecond = file.pages.find((p) => find(p, 'Second').length > 0)!;
    expect(find(withSecond, 'Last row')).toHaveLength(1);
    expect(find(withSecond, 'Name').length).toBeGreaterThan(0);
  });

  it('wraps a long cell onto several lines inside its column', () => {
    const long =
      'Interim negative notice received; stood down from coaching the Open A squad and the governing body told in writing.';
    const [page] = pdf({ sections: [section({ rows: [{ cells: ['Alex', long] }] })] }).pages;
    const status = find(page, 'Status')[0];
    const lines = page.texts.filter((t) => t.x === status.x && t.y < status.y);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join(' ')).toBe(long);
    // Lines step down by the line height.
    expect(lines[0].y - lines[1].y).toBeCloseTo(11, 5);
  });

  it('keeps line breaks inside a cell, such as one squad per line', () => {
    const [page] = pdf({ sections: [section({ rows: [{ cells: ['Alex', 'Open A\n17 & Under A'] }] })] }).pages;
    expect(find(page, 'Open A')).toHaveLength(1);
    expect(find(page, '17 & Under A')).toHaveLength(1);
  });

  describe('special characters', () => {
    const text = 'O’Brien (coach) \\ “Thunder” – café · 50% & <tag> #1';

    it('escapes brackets and backslashes so the text reads back the same', () => {
      const file = pdf({ title: text, sections: [section({ rows: [{ cells: [text, 'x'] }] })] });
      expect(file.raw).toContain('\\(coach\\) \\\\');
      expect(find(file.pages[0], text)).toHaveLength(2);
      expect(file.info.title).toBe(`Sample Club · ${text}`);
    });

    it('stays plain ASCII, with WinAnsi codes for accents and curly punctuation', () => {
      const file = pdf({ title: 'café ’' });
      // readPdf throws on any byte over 127.
      expect(file.raw).toContain('caf\\351 \\222');
    });

    it('shows ? for characters the fonts can’t draw, drops ticks and turns tabs to spaces', () => {
      const file = pdf({ title: 'Done ✓ ✔ 日本 😀\tend' });
      expect(find(file.pages[0], 'Done   ?? ? end')).toHaveLength(1);
    });

    it('joins accents typed separately into one letter', () => {
      // "e" followed by a combining acute accent.
      const file = pdf({ title: 'Café' });
      expect(find(file.pages[0], 'Café')).toHaveLength(1);
    });
  });

  it('wraps a long title rather than run it off the page', () => {
    const title = 'A very long report title that will not fit on one line of an A4 page at twenty points';
    const [page] = pdf({ title }).pages;
    const lines = page.texts.filter((t) => t.size === 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.text).join(' ')).toBe(title);
  });
});
