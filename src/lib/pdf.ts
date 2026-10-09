/**
 * A small PDF writer for admin reports: a title, summary figures and tables
 * that run over as many pages as they need. It is plain JavaScript using the
 * PDF built-in Helvetica fonts, so it needs no native module and ships in an
 * over-the-air update.
 */

export type ReportColumn = {
  label: string;
  /** Share of the table's width, relative to the other columns. Default 1. */
  width?: number;
};

export type ReportRow = {
  /** One value per column. A value can hold line breaks. */
  cells: string[];
  /** Something needs attention, so the row is shown in red. */
  flag?: boolean;
};

export type ReportSection = {
  title: string;
  note?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Shown instead of the table when it has no rows. */
  empty?: string;
};

export type Report = {
  title: string;
  /** Such as the period, season or groups the report covers. */
  subtitle?: string;
  stats?: { label: string; value: string | number }[];
  sections: ReportSection[];
  /** A closing note, such as how a figure was worked out. */
  footnote?: string;
  /** Wide tables print across the page. */
  landscape?: boolean;
};

// Helvetica and Helvetica-Bold character widths (1/1000 em) for WinAnsi codes 32–255.
// prettier-ignore
const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
// prettier-ignore
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

/** Characters outside Latin-1 that WinAnsi still has. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '™': 0x99, 'Š': 0x8a, 'š': 0x9a, 'Ž': 0x8e, 'ž': 0x9e,
  'Œ': 0x8c, 'œ': 0x9c, 'Ÿ': 0x9f, '‹': 0x8b, '›': 0x9b, '·': 0xb7,
};

/** Text as WinAnsi codes. Anything the fonts can't show becomes "?". */
function encode(text: string): number[] {
  const codes: number[] = [];
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 63;
    if (WIN_ANSI[char] !== undefined) codes.push(WIN_ANSI[char]);
    else if (char === '✓' || char === '✔') continue;
    else if (char === '\t') codes.push(32);
    else if ((code >= 32 && code < 127) || (code >= 160 && code <= 255)) codes.push(code);
    else codes.push(63);
  }
  return codes;
}

function textWidth(text: string, size: number, bold = false) {
  const widths = bold ? BOLD : REGULAR;
  return encode(text).reduce((sum, code) => sum + (widths[code - 32] ?? 556), 0) * (size / 1000);
}

/** A PDF string literal, kept to plain ASCII. */
function pdfString(text: string) {
  return `(${encode(text)
    .map((code) => {
      if (code === 40 || code === 41 || code === 92) return `\\${String.fromCharCode(code)}`;
      if (code > 126) return `\\${code.toString(8).padStart(3, '0')}`;
      return String.fromCharCode(code);
    })
    .join('')})`;
}

/** Splits text into lines that fit a width, breaking long words if they must. */
export function wrapText(text: string, width: number, size: number, bold = false) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (textWidth(rest, size, bold) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, bold) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

type Colour = [number, number, number];

const INK: Colour = [0.1, 0.1, 0.1];
const GREY: Colour = [0.4, 0.4, 0.4];
const RULE: Colour = [0.82, 0.82, 0.82];
const SHADE: Colour = [0.93, 0.93, 0.93];
const RED: Colour = [0.7, 0.05, 0.1];

const MARGIN = 40;
const FOOTER = 28;
const CELL_PAD = 4;
const BODY = 8.5;
const LINE = 11;

function hexColour(hex: string): Colour {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function num(n: number) {
  return Number(n.toFixed(2)).toString();
}

/** Lays out pages top-down; y is measured from the top of the page. */
class Pages {
  readonly width: number;
  readonly height: number;
  readonly pages: string[][] = [];
  y = MARGIN;

  constructor(landscape: boolean) {
    this.width = landscape ? 841.89 : 595.28;
    this.height = landscape ? 595.28 : 841.89;
    this.addPage();
  }

  get contentWidth() {
    return this.width - MARGIN * 2;
  }

  get bottom() {
    return this.height - MARGIN - FOOTER;
  }

  addPage() {
    this.pages.push([]);
    this.y = MARGIN;
  }

  /** Starts a new page unless this much room is left. */
  ensure(height: number) {
    if (this.y + height > this.bottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  private get ops() {
    return this.pages[this.pages.length - 1];
  }

  text(
    x: number,
    top: number,
    text: string,
    { size = BODY, bold = false, colour = INK }: { size?: number; bold?: boolean; colour?: Colour } = {},
    page = this.ops,
  ) {
    // Baseline sits about 80% of the font size below the top of the line.
    const baseline = this.height - top - size * 0.8;
    page.push(
      `BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${colour.map(num).join(' ')} rg ${num(x)} ${num(baseline)} Td ${pdfString(text)} Tj ET`,
    );
  }

  rect(x: number, top: number, width: number, height: number, colour: Colour) {
    this.ops.push(
      `${colour.map(num).join(' ')} rg ${num(x)} ${num(this.height - top - height)} ${num(width)} ${num(height)} re f`,
    );
  }

  line(x1: number, top: number, x2: number, colour = RULE, page = this.ops) {
    const y = num(this.height - top);
    page.push(`${colour.map(num).join(' ')} RG 0.5 w ${num(x1)} ${y} m ${num(x2)} ${y} l S`);
  }

  /** Wrapped text across the content width; returns its height. */
  paragraph(text: string, options: { size?: number; bold?: boolean; colour?: Colour } = {}) {
    const size = options.size ?? BODY;
    const lineHeight = size * 1.3;
    for (const line of wrapText(text, this.contentWidth, size, options.bold)) {
      this.ensure(lineHeight);
      this.text(MARGIN, this.y, line, options);
      this.y += lineHeight;
    }
  }
}

function drawStats(pages: Pages, stats: NonNullable<Report['stats']>) {
  const perRow = Math.min(stats.length, pages.width > 600 ? 6 : 5);
  const gap = 8;
  const boxWidth = (pages.contentWidth - gap * (perRow - 1)) / perRow;
  const boxHeight = 40;
  for (let i = 0; i < stats.length; i += perRow) {
    pages.ensure(boxHeight + gap);
    stats.slice(i, i + perRow).forEach((stat, j) => {
      const x = MARGIN + j * (boxWidth + gap);
      pages.rect(x, pages.y, boxWidth, boxHeight, SHADE);
      pages.text(x + 8, pages.y + 6, String(stat.value), { size: 14, bold: true });
      const label = wrapText(stat.label, boxWidth - 16, 7.5)[0] ?? '';
      pages.text(x + 8, pages.y + 26, label, { size: 7.5, colour: GREY });
    });
    pages.y += boxHeight + gap;
  }
  pages.y += 6;
}

function drawSection(pages: Pages, section: ReportSection) {
  const totalWeight = section.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
  const widths = section.columns.map((c) => ((c.width ?? 1) / totalWeight) * pages.contentWidth);
  const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const cellWidth = (i: number) => widths[i] - CELL_PAD * 2;

  const headerLines = section.columns.map((c, i) => wrapText(c.label, cellWidth(i), BODY, true));
  const headerHeight = Math.max(...headerLines.map((l) => l.length)) * LINE + CELL_PAD * 2;

  function title(continued: boolean) {
    pages.text(MARGIN, pages.y, continued ? `${section.title} (continued)` : section.title, {
      size: 12,
      bold: true,
    });
    pages.y += 18;
  }

  function header() {
    pages.rect(MARGIN, pages.y, pages.contentWidth, headerHeight, SHADE);
    headerLines.forEach((lines, i) =>
      lines.forEach((line, n) =>
        pages.text(xs[i] + CELL_PAD, pages.y + CELL_PAD + n * LINE, line, { bold: true }),
      ),
    );
    pages.y += headerHeight;
  }

  const rows = section.rows.map((row) => {
    const lines = section.columns.map((_, i) => wrapText(row.cells[i] ?? '', cellWidth(i), BODY));
    return { row, lines, height: Math.max(...lines.map((l) => l.length)) * LINE + CELL_PAD * 2 };
  });

  // Keep the title with the header and first row.
  pages.ensure(18 + headerHeight + (rows[0]?.height ?? LINE * 2) + 20);
  title(false);
  if (section.note) {
    pages.paragraph(section.note, { colour: GREY });
    pages.y += 4;
  }
  if (rows.length === 0) {
    pages.paragraph(section.empty ?? 'Nothing to show.', { colour: GREY });
    pages.y += 16;
    return;
  }
  header();
  for (const { row, lines, height } of rows) {
    if (pages.ensure(height)) {
      title(true);
      header();
    }
    const colour = row.flag ? RED : INK;
    lines.forEach((cell, i) =>
      cell.forEach((line, n) =>
        pages.text(xs[i] + CELL_PAD, pages.y + CELL_PAD + n * LINE, line, {
          colour,
          bold: i === 0 && !!row.flag,
        }),
      ),
    );
    pages.y += height;
    pages.line(MARGIN, pages.y, MARGIN + pages.contentWidth);
  }
  pages.y += 18;
}

/** Turns a report into the bytes of a PDF file. */
export function reportPdf(
  report: Report,
  { clubName, accent, generatedAt = new Date() }: { clubName: string; accent?: string; generatedAt?: Date },
): Uint8Array {
  const pages = new Pages(!!report.landscape);
  const generated = generatedAt.toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  if (accent) pages.rect(MARGIN, pages.y, 48, 4, hexColour(accent));
  pages.y += 12;
  pages.text(MARGIN, pages.y, clubName, { size: 10, colour: GREY });
  pages.y += 16;
  pages.paragraph(report.title, { size: 20, bold: true });
  pages.y += 4;
  if (report.subtitle) pages.paragraph(report.subtitle, { size: 10, colour: GREY });
  pages.paragraph(`Made ${generated}`, { size: 10, colour: GREY });
  pages.y += 14;

  if (report.stats?.length) drawStats(pages, report.stats);
  for (const section of report.sections) drawSection(pages, section);
  if (report.footnote) pages.paragraph(report.footnote, { colour: GREY });

  // Footers, now the page count is known.
  const footerTop = pages.height - MARGIN - 10;
  pages.pages.forEach((ops, i) => {
    pages.line(MARGIN, footerTop - 6, MARGIN + pages.contentWidth, RULE, ops);
    pages.text(MARGIN, footerTop, `${clubName} · ${report.title}`, { size: 7.5, colour: GREY }, ops);
    const pageLabel = `Page ${i + 1} of ${pages.pages.length}`;
    pages.text(
      pages.width - MARGIN - textWidth(pageLabel, 7.5),
      footerTop,
      pageLabel,
      { size: 7.5, colour: GREY },
      ops,
    );
  });

  return assemble(pages, `${clubName} · ${report.title}`, generatedAt);
}

/** Writes the PDF objects, cross-reference table and trailer. */
function assemble(pages: Pages, title: string, date: Date): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);

  const catalog = add('');
  const pageTree = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  const info = add(`<< /Title ${pdfString(title)} /Producer (FirstPass) /CreationDate (${stamp}) >>`);

  const kids = pages.pages.map((ops) => {
    const stream = ops.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${num(pages.width)} ${num(pages.height)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  // Everything is ASCII, so string lengths are byte offsets.
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}
