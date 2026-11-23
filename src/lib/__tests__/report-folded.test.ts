/**
 * A folded report section's one line (the Selection audit report on screen):
 * how many lines it has and how many are flagged, or what it says when empty.
 */
import { foldedLine } from '@/lib/pdf';

const section = (rows: { cells: string[]; flag?: boolean }[], empty?: string) => ({
  title: 'The panel',
  columns: [{ label: 'Who' }],
  rows,
  empty,
});

describe('a folded section’s line', () => {
  it('counts one line in the singular', () => {
    expect(foldedLine(section([{ cells: ['a'] }]))).toBe('1 line');
  });

  it('counts the lines, and says nothing of flags when there are none', () => {
    expect(foldedLine(section([{ cells: ['a'] }, { cells: ['b'], flag: false }]))).toBe('2 lines');
  });

  it('says how many lines are flagged', () => {
    expect(foldedLine(section([{ cells: ['a'], flag: true }, { cells: ['b'] }, { cells: ['c'], flag: true }]))).toBe(
      '3 lines · 2 to look at',
    );
  });

  it('gives the section’s own words when it is empty, or a plain line', () => {
    expect(foldedLine(section([], 'No dates were set for this round.'))).toBe('No dates were set for this round.');
    expect(foldedLine(section([]))).toBe('Nothing to show.');
  });
});
