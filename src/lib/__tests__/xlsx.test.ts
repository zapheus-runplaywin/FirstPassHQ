/**
 * The Excel writer behind survey exports (src/lib/xlsx.ts). Each test unzips
 * the bytes with the reader in src/__tests__/helpers/documents.ts, which checks
 * every entry's CRC with Node's zlib, and reads back the cells a committee
 * member would see in Excel.
 */
import { workbookXlsx, type Sheet } from '@/lib/xlsx';

import { readWorkbook } from '../../__tests__/helpers/documents';

const read = (sheets: Sheet[]) => readWorkbook(workbookXlsx(sheets));

describe('workbookXlsx', () => {
  it('is a zip of the spreadsheet parts, each stored with a correct CRC', () => {
    const { files, contentTypes, rels } = read([
      { name: 'Summary', rows: [['a']] },
      { name: 'All answers', rows: [['b']] },
    ]);
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(contentTypes).toContain('PartName="/xl/worksheets/sheet1.xml"');
    expect(contentTypes).toContain('PartName="/xl/worksheets/sheet2.xml"');
    expect(contentTypes).not.toContain('sheet3.xml');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    const root = new TextDecoder().decode(files.get('_rels/.rels'));
    expect(root).toContain('Target="xl/workbook.xml"');
  });

  it('keeps the tabs in order with their rows', () => {
    const { sheets } = read([
      { name: 'Summary', rows: [['Survey', 'Count'], ['Sent to', 10]] },
      { name: 'Q1 How was training?', rows: [['Rating'], [5], [4]] },
    ]);
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Q1 How was training']);
    expect(sheets[0].rows).toEqual([['Survey', 'Count'], ['Sent to', 10]]);
    expect(sheets[1].rows).toEqual([['Rating'], [5], [4]]);
  });

  it('makes the first row bold and the others wrap at the top of the cell', () => {
    const { sheets, files } = read([{ name: 'S', rows: [['Name', 'Votes'], ['Alex', 3]] }]);
    expect(sheets[0].styles).toEqual({ A1: 1, B1: 1, A2: 2, B2: 2 });
    const styles = new TextDecoder().decode(files.get('xl/styles.xml'));
    expect(styles).toContain('<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>');
    expect(styles).toContain('<font><b/>');
    expect(styles).toContain('<alignment vertical="top" wrapText="1"/>');
  });

  it('freezes the heading row', () => {
    const [sheet] = read([{ name: 'S', rows: [['Name']] }]).sheets;
    expect(sheet.xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  });

  it('stores numbers as numbers and text as text', () => {
    const [sheet] = read([{ name: 'S', rows: [['n'], [0], [3.75], [-2], ['12']] }]).sheets;
    expect(sheet.rows.slice(1)).toEqual([[0], [3.75], [-2], ['12']]);
    expect(sheet.xml).toContain('<c r="A2" s="2"><v>0</v></c>');
    expect(sheet.xml).toContain('<c r="A5" s="2" t="inlineStr"><is><t xml:space="preserve">12</t></is></c>');
  });

  it('writes a number that isn’t finite as text, never as a broken value', () => {
    const [sheet] = read([{ name: 'S', rows: [['n'], [NaN], [Infinity]] }]).sheets;
    expect(sheet.rows.slice(1)).toEqual([['NaN'], ['Infinity']]);
  });

  it('leaves out empty cells but keeps the cells after them in their columns', () => {
    const [sheet] = read([{ name: 'S', rows: [['a', null, 'c'], ['', 'b', null, 4]] }]).sheets;
    expect(sheet.rows).toEqual([['a', null, 'c'], [null, 'b', null, 4]]);
    expect(sheet.xml).not.toContain('r="B1"');
    expect(sheet.xml).not.toContain('r="A2"');
  });

  it('never turns text into a formula', () => {
    const [sheet] = read([{ name: 'S', rows: [['Answer'], ['=SUM(A1:A9)'], ['+61 400 000 000'], ['@cmd']] }]).sheets;
    expect(sheet.rows.slice(1)).toEqual([['=SUM(A1:A9)'], ['+61 400 000 000'], ['@cmd']]);
    expect(sheet.xml).not.toContain('<f>');
  });

  it('escapes XML characters in cells, so a typed answer can’t break the file', () => {
    const text = 'Tom & Jerry <b>"loud"</b> it’s';
    const [sheet] = read([{ name: 'S', rows: [['Answer'], [text]] }]).sheets;
    expect(sheet.rows[1]).toEqual([text]);
    expect(sheet.xml).toContain('Tom &amp; Jerry &lt;b&gt;&quot;loud&quot;&lt;/b&gt;');
  });

  it('keeps line breaks and tabs, and drops control characters XML can’t hold', () => {
    const [sheet] = read([{ name: 'S', rows: [['Answer'], ['line one\nline two\ttab\u0000\u0007\u001f!']] }]).sheets;
    expect(sheet.rows[1]).toEqual(['line one\nline two\ttab!']);
  });

  it('keeps accents, other scripts and emoji as UTF-8', () => {
    const text = 'Zoë 日本 😀 – “quoted”';
    const [sheet] = read([{ name: 'Zoë', rows: [[text]] }]).sheets;
    expect(sheet.rows[0]).toEqual([text]);
    expect(sheet.name).toBe('Zoë');
  });

  it('names columns past Z as Excel does', () => {
    const row = Array.from({ length: 28 }, (_, i) => i + 1);
    const [sheet] = read([{ name: 'S', rows: [row] }]).sheets;
    expect(sheet.xml).toContain('<c r="Z1" s="1"><v>26</v></c>');
    expect(sheet.xml).toContain('<c r="AA1" s="1"><v>27</v></c>');
    expect(sheet.xml).toContain('<c r="AB1" s="1"><v>28</v></c>');
    expect(sheet.rows[0]).toEqual(row);
  });

  it('sets each column’s width, 18 characters unless given', () => {
    const [sheet] = read([{ name: 'S', rows: [['a', 'b', 'c']], widths: [30, 12] }]).sheets;
    expect(sheet.widths).toEqual([30, 12, 18]);
    // A sheet with no rows still has one column.
    expect(read([{ name: 'Empty', rows: [] }]).sheets[0].widths).toEqual([18]);
  });

  describe('tab names', () => {
    const names = (list: string[]) => read(list.map((name) => ({ name, rows: [['x']] }))).sheets.map((s) => s.name);

    it('are at most 31 characters', () => {
      const [name] = names(['Q12 Which training days suit you best this season?']);
      expect(name).toBe('Q12 Which training days suit yo');
      expect(name.length).toBe(31);
    });

    it('replace the characters Excel doesn’t allow and tidy the spaces', () => {
      expect(names(['Q1 [Yes/No]: Why? * \\ end'])).toEqual(['Q1 Yes No Why end']);
    });

    it('are never blank', () => {
      expect(names(['', '???'])).toEqual(['Sheet', 'Sheet 2']);
    });

    it('are made unique, ignoring case, and stay within 31 characters', () => {
      expect(names(['Answers', 'answers', 'ANSWERS'])).toEqual(['Answers', 'answers 2', 'ANSWERS 3']);
      const long = 'A question that is far too long for a tab';
      const [first, second] = names([long, long]);
      expect(first).toBe('A question that is far too long');
      expect(second).toBe('A question that is far too lo 2');
      expect(second.length).toBeLessThanOrEqual(31);
    });

    it('escape XML characters in the workbook', () => {
      const { sheets, workbook } = read([{ name: 'Tom & Jerry <"x">', rows: [['x']] }]);
      expect(sheets[0].name).toBe('Tom & Jerry <"x">');
      expect(workbook).toContain('name="Tom &amp; Jerry &lt;&quot;x&quot;&gt;"');
    });
  });
});
