/**
 * Reads back the files the app writes, so tests can check what a PDF or
 * spreadsheet actually holds rather than the data it was made from.
 *
 * - `readPdf` checks the file's structure (header, objects, cross-reference
 *   offsets, stream lengths, page tree) and returns each page's text runs with
 *   their font, size, colour and position.
 * - `unzip` reads a zip file, checking every entry's CRC with Node's zlib.
 * - `readWorkbook` reads an .xlsx made by `workbookXlsx` into sheets of cells.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks its
 * own decoders at the bottom, and only when Jest runs it directly.
 */

// The project has no Node type definitions, so just what's used here.
const zlib = jest.requireActual('zlib') as { crc32(data: Uint8Array): number };

// ---------------------------------------------------------------------------
// PDF

/** Characters outside Latin-1 that WinAnsi has, by code (the reverse of pdf.ts). */
const WIN_ANSI_CHARS: Record<number, string> = {
  0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x99: '™', 0x8a: 'Š', 0x9a: 'š', 0x8e: 'Ž', 0x9e: 'ž',
  0x8c: 'Œ', 0x9c: 'œ', 0x9f: 'Ÿ', 0x8b: '‹', 0x9b: '›',
};

export type PdfText = {
  text: string;
  /** F1 is Helvetica, F2 Helvetica-Bold. */
  bold: boolean;
  size: number;
  colour: [number, number, number];
  x: number;
  /** The baseline, from the bottom of the page as PDF measures it. */
  y: number;
};

export type PdfPage = {
  width: number;
  height: number;
  texts: PdfText[];
  /** Every text run on the page, top to bottom, one per line. */
  lines: string[];
  /** The raw content stream. */
  stream: string;
};

export type PdfFile = {
  raw: string;
  pages: PdfPage[];
  info: { title: string; producer: string; creationDate: string };
  /** All the text, page after page, one run per line. */
  text: string;
};

/** A PDF string literal's contents, back to text. */
function unescapePdfString(body: string) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = body[i + 1];
    if (/[0-7]/.test(next)) {
      const code = parseInt(body.slice(i + 1, i + 4), 8);
      out += WIN_ANSI_CHARS[code] ?? String.fromCharCode(code);
      i += 3;
    } else {
      out += next;
      i += 1;
    }
  }
  return out;
}

const TEXT_OP =
  /^BT \/(F[12]) ([\d.]+) Tf ([\d.]+) ([\d.]+) ([\d.]+) rg (-?[\d.]+) (-?[\d.]+) Td \((.*)\) Tj ET$/;

/** Every byte of the file must be 7-bit ASCII, as pdf.ts promises. */
function asciiOf(bytes: Uint8Array) {
  let raw = '';
  for (const byte of bytes) {
    if (byte > 127) throw new Error(`PDF has a byte over 127 at ${raw.length}`);
    raw += String.fromCharCode(byte);
  }
  return raw;
}

/** Reads a PDF written by `reportPdf`, throwing if its structure is broken. */
export function readPdf(bytes: Uint8Array): PdfFile {
  const raw = asciiOf(bytes);
  if (!raw.startsWith('%PDF-1.4\n')) throw new Error('No PDF header');
  if (!raw.endsWith('%%EOF\n')) throw new Error('No end-of-file marker');

  // Objects, by number.
  const objects = new Map<number, string>();
  for (const m of raw.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) {
    objects.set(Number(m[1]), m[2]);
  }

  // The cross-reference table must point at each object.
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(raw)?.[1]);
  if (!raw.startsWith('xref\n', startxref)) throw new Error('startxref is wrong');
  const xref = /^xref\n0 (\d+)\n0000000000 65535 f \n/.exec(raw.slice(startxref));
  if (!xref) throw new Error('Bad cross-reference table');
  const size = Number(xref[1]);
  if (size !== objects.size + 1) throw new Error(`xref lists ${size - 1} of ${objects.size} objects`);
  const entries = raw.slice(startxref + xref[0].length).split('\n').slice(0, size - 1);
  entries.forEach((entry, i) => {
    const m = /^(\d{10}) 00000 n $/.exec(entry);
    if (!m) throw new Error(`Bad xref entry ${i + 1}: ${entry}`);
    if (!raw.startsWith(`${i + 1} 0 obj\n`, Number(m[1]))) {
      throw new Error(`xref offset for object ${i + 1} is wrong`);
    }
  });
  const trailer = /trailer\n<< \/Size (\d+) \/Root (\d+) 0 R \/Info (\d+) 0 R >>/.exec(raw);
  if (!trailer || Number(trailer[1]) !== size) throw new Error('Bad trailer');

  const catalog = objects.get(Number(trailer[2])) ?? '';
  const treeRef = /\/Type \/Catalog \/Pages (\d+) 0 R/.exec(catalog);
  if (!treeRef) throw new Error('No page tree');
  const tree = objects.get(Number(treeRef[1])) ?? '';
  const kids = /\/Kids \[([^\]]*)\] \/Count (\d+)/.exec(tree);
  if (!kids) throw new Error('Bad page tree');
  const kidRefs = [...kids[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  if (kidRefs.length !== Number(kids[2])) throw new Error('Page count does not match the kids');

  const fonts = [...objects.values()].filter((o) => o.includes('/Type /Font'));
  if (!fonts.some((f) => f.includes('/BaseFont /Helvetica /Encoding /WinAnsiEncoding'))) {
    throw new Error('No Helvetica font');
  }

  const pages = kidRefs.map((ref): PdfPage => {
    const page = objects.get(ref) ?? '';
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(page);
    const contentRef = /\/Contents (\d+) 0 R/.exec(page);
    if (!box || !contentRef || !page.includes(`/Parent ${treeRef[1]} 0 R`)) {
      throw new Error(`Bad page object ${ref}`);
    }
    const content = objects.get(Number(contentRef[1])) ?? '';
    const m = /^<< \/Length (\d+) >>\nstream\n([\s\S]*)\nendstream$/.exec(content);
    if (!m || m[2].length !== Number(m[1])) throw new Error(`Stream length is wrong on page ${ref}`);
    const stream = m[2];
    const texts: PdfText[] = [];
    for (const op of stream.split('\n')) {
      if (!op.startsWith('BT')) continue;
      const t = TEXT_OP.exec(op);
      if (!t) throw new Error(`Unreadable text operation: ${op}`);
      texts.push({
        text: unescapePdfString(t[8]),
        bold: t[1] === 'F2',
        size: Number(t[2]),
        colour: [Number(t[3]), Number(t[4]), Number(t[5])],
        x: Number(t[6]),
        y: Number(t[7]),
      });
    }
    const ordered = [...texts].sort((a, b) => b.y - a.y || a.x - b.x);
    return {
      width: Number(box[1]),
      height: Number(box[2]),
      texts,
      lines: ordered.map((t) => t.text),
      stream,
    };
  });

  const infoObject = objects.get(Number(trailer[3])) ?? '';
  const info = /^<< \/Title \((.*)\) \/Producer \((.*)\) \/CreationDate \((.*)\) >>$/.exec(infoObject);
  if (!info) throw new Error('Bad info dictionary');

  return {
    raw,
    pages,
    info: { title: unescapePdfString(info[1]), producer: info[2], creationDate: info[3] },
    text: pages.map((p) => p.lines.join('\n')).join('\n'),
  };
}

/** The text runs on a page in the order they were drawn. */
export function drawnText(page: PdfPage) {
  return page.texts.map((t) => t.text);
}

// ---------------------------------------------------------------------------
// Zip and xlsx

const decoder = new TextDecoder('utf-8', { fatal: true });

/** Reads a zip's entries (stored or not), checking each CRC. Names in order. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('No end of central directory');
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 8, true) !== count) throw new Error('Entry counts differ');
  const centralSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (at + centralSize !== end) throw new Error('Central directory size is wrong');

  const files = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error(`Bad central entry ${i}`);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;

    if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`Bad local header for ${name}`);
    const localName = decoder.decode(
      bytes.subarray(local + 30, local + 30 + view.getUint16(local + 26, true)),
    );
    if (localName !== name) throw new Error(`Local name ${localName} differs from ${name}`);
    if (view.getUint32(local + 14, true) !== crc) throw new Error(`Local CRC differs for ${name}`);
    if (method !== 0 || compressed !== size) throw new Error(`${name} is compressed`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (zlib.crc32(data) >>> 0 !== crc) throw new Error(`CRC is wrong for ${name}`);
    files.set(name, data);
  }
  return files;
}

export type WorkbookCell = string | number | null;

export type WorkbookSheet = {
  name: string;
  rows: WorkbookCell[][];
  /** The style index of each cell that has one, by reference such as "A1". */
  styles: Record<string, number>;
  /** Column widths, in order. */
  widths: number[];
  /** The raw sheet XML. */
  xml: string;
};

export function unescapeXml(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** "A" -> 0, "AA" -> 26. */
function columnIndex(letters: string) {
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

/** Reads an .xlsx made by `workbookXlsx`. */
export function readWorkbook(bytes: Uint8Array) {
  const files = unzip(bytes);
  const text = (name: string) => {
    const data = files.get(name);
    if (!data) throw new Error(`No ${name} in the workbook`);
    return decoder.decode(data);
  };
  const workbook = text('xl/workbook.xml');
  const names = [...workbook.matchAll(/<sheet name="([^"]*)" sheetId="(\d+)" r:id="rId(\d+)"\/>/g)];
  const rels = text('xl/_rels/workbook.xml.rels');
  const sheets = names.map(([, name, , rid]): WorkbookSheet => {
    const target = new RegExp(`Id="rId${rid}" Type="[^"]*/worksheet" Target="([^"]+)"`).exec(rels);
    if (!target) throw new Error(`No relationship for sheet ${name}`);
    const xml = text(`xl/${target[1]}`);
    const rows: WorkbookCell[][] = [];
    const styles: Record<string, number> = {};
    for (const [, r, body] of xml.matchAll(/<row r="(\d+)">(.*?)<\/row>/gs)) {
      const row: WorkbookCell[] = [];
      for (const cell of body.matchAll(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="(\w+)")?>(.*?)<\/c>/gs)) {
        const [, col, rowNumber, style, type, inner] = cell;
        if (rowNumber !== r) throw new Error(`Cell ${col}${rowNumber} is in row ${r}`);
        const index = columnIndex(col);
        while (row.length < index) row.push(null);
        if (type === 'inlineStr') {
          const t = /^<is><t xml:space="preserve">(.*)<\/t><\/is>$/s.exec(inner);
          if (!t) throw new Error(`Bad inline string in ${col}${r}`);
          row.push(unescapeXml(t[1]));
        } else if (type === undefined) {
          const v = /^<v>(.*)<\/v>$/.exec(inner);
          if (!v) throw new Error(`Bad number in ${col}${r}`);
          row.push(Number(v[1]));
        } else {
          throw new Error(`Unexpected cell type ${type}`);
        }
        if (style !== undefined) styles[`${col}${r}`] = Number(style);
      }
      rows[Number(r) - 1] = row;
    }
    const widths = [...xml.matchAll(/<col min="\d+" max="\d+" width="([\d.]+)" customWidth="1"\/>/g)].map(
      (m) => Number(m[1]),
    );
    return { name: unescapeXml(name), rows: Array.from(rows, (r) => r ?? []), styles, widths, xml };
  });
  return { files, sheets, contentTypes: text('[Content_Types].xml'), workbook, rels };
}

// ---------------------------------------------------------------------------
// The decoders' own checks, run only when Jest runs this file.

if (expect.getState().testPath?.endsWith('/__tests__/helpers/documents.ts')) {
  describe('document readers', () => {
    it('unescape PDF strings, octal codes and WinAnsi punctuation', () => {
      expect(unescapePdfString('a\\(b\\)c\\\\d')).toBe('a(b)c\\d');
      expect(unescapePdfString('caf\\351 \\222 \\267')).toBe('café ’ ·');
    });

    it('refuse a file that is not a PDF', () => {
      expect(() => readPdf(new TextEncoder().encode('hello'))).toThrow('No PDF header');
    });

    it('refuse a zip whose contents have changed', () => {
      const { workbookXlsx } = jest.requireActual('@/lib/xlsx') as typeof import('@/lib/xlsx');
      const bytes = workbookXlsx([{ name: 'A', rows: [['x']] }]);
      expect(() => unzip(bytes)).not.toThrow();
      const broken = bytes.slice();
      // A byte inside the first entry's data.
      broken[60] ^= 1;
      expect(() => unzip(broken)).toThrow(/CRC is wrong|differs/);
    });

    it('read column letters past Z', () => {
      expect(columnIndex('A')).toBe(0);
      expect(columnIndex('Z')).toBe(25);
      expect(columnIndex('AA')).toBe(26);
      expect(columnIndex('AZ')).toBe(51);
    });
  });
}
