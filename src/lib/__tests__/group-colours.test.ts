/**
 * The colours squads and teams show in (src/lib/group-colours.ts): the ones
 * no calendar uses, shared out in squad and team order, so nobody has to
 * pick them and every member sees a squad in the same colour.
 */
import { CalendarColors, calendarColorKeys, groupColourOrder } from '@/constants/calendar-colors';
import { groupColourHex, groupColours, reservedColours } from '@/lib/group-colours';

const squad = (id: string) => ({ id, kind: 'squad' as const });
const team = (id: string) => ({ id, kind: 'team' as const });

describe('the colour list', () => {
  it('has twelve colours, each a different hex', () => {
    expect(calendarColorKeys).toHaveLength(12);
    expect(new Set(calendarColorKeys.map((k) => CalendarColors[k].hex)).size).toBe(12);
  });

  it('shares every colour out to squads and teams, each once', () => {
    expect([...groupColourOrder].sort()).toEqual([...calendarColorKeys].sort());
  });
});

describe('groupColours', () => {
  it('gives squads the free colours in order', () => {
    const colours = groupColours([squad('a'), squad('b'), squad('c')], []);
    expect([...colours.values()]).toEqual(['blue', 'green', 'orange']);
  });

  it('keeps clear of the colours calendars use', () => {
    const colours = groupColours([squad('a'), squad('b'), squad('c')], ['blue', 'orange', 'yellow']);
    expect([...colours.values()]).toEqual(['green', 'violet', 'pink']);
  });

  it('gives a club with yellow and pink calendars and six teams six different colours', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'].map(team);
    const colours = [...groupColours(teams, ['yellow', 'pink']).values()];
    expect(new Set(colours).size).toBe(6);
    expect(colours).not.toContain('yellow');
    expect(colours).not.toContain('pink');
  });

  it('shares colours out to squads and teams separately, so a squad and a team can match', () => {
    const colours = groupColours([squad('s1'), team('t1'), squad('s2'), team('t2')], []);
    expect(colours.get('s1')).toBe('blue');
    expect(colours.get('t1')).toBe('blue');
    expect(colours.get('s2')).toBe('green');
    expect(colours.get('t2')).toBe('green');
  });

  it('comes round again when there are more squads than free colours', () => {
    const squads = Array.from({ length: 14 }, (_, i) => squad(`s${i}`));
    const colours = groupColours(squads, []);
    expect(colours.get('s12')).toBe(colours.get('s0'));
    expect(colours.get('s13')).toBe(colours.get('s1'));
  });

  it('with only two colours free, squads take turns with those two', () => {
    const reserved = groupColourOrder.slice(2);
    const colours = groupColours([squad('a'), squad('b'), squad('c')], reserved);
    expect([...colours.values()]).toEqual(['blue', 'green', 'blue']);
  });

  it('uses the whole list when calendars have taken every colour', () => {
    const colours = groupColours([squad('a'), squad('b')], [...groupColourOrder]);
    expect([...colours.values()]).toEqual(['blue', 'green']);
  });

  it('gives the same squad the same colour whoever asks, from the club’s list alone', () => {
    const groups = [squad('a'), squad('b'), team('c')];
    expect(groupColours(groups, ['teal'])).toEqual(groupColours([...groups], ['teal']));
  });
});

describe('groupColourHex', () => {
  const colours = groupColours([squad('a')], []);

  it('is the squad’s colour as a hex', () => {
    expect(groupColourHex(colours, 'a')).toBe(CalendarColors.blue.hex);
  });

  it('is nothing for a squad from an earlier season, or none', () => {
    expect(groupColourHex(colours, 'gone')).toBeUndefined();
    expect(groupColourHex(colours, null)).toBeUndefined();
    expect(groupColourHex(colours, undefined)).toBeUndefined();
  });
});

describe('reservedColours', () => {
  it('reads the database’s list', () => {
    expect(reservedColours(['yellow', 'teal'])).toEqual(['yellow', 'teal']);
  });

  it('leaves out names this app doesn’t know, from a newer database', () => {
    expect(reservedColours(['yellow', 'brown', 7, null])).toEqual(['yellow']);
  });

  it('is empty when the database gave nothing', () => {
    expect(reservedColours(null)).toEqual([]);
    expect(reservedColours(undefined)).toEqual([]);
    expect(reservedColours('yellow')).toEqual([]);
  });
});
