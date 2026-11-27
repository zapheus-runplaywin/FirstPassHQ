/**
 * The colour each squad and team shows in on the calendar. Nobody picks
 * them: an admin picks colours for the calendars they add, and squads and
 * teams take theirs from the colours no calendar uses, in squad and team
 * order (Matt, 27 November 2026). So a squad is the same colour for every
 * member, whichever calendars they can see themselves.
 *
 * Squads and teams take colours separately, so a squad and a team can share
 * one: teams start as their squad finishes. When there are more squads (or
 * teams) than free colours the colours come round again, and the squad's or
 * team's name on each event tells them apart.
 */
import {
  CalendarColors,
  groupColourOrder,
  type CalendarColor,
} from '@/constants/calendar-colors';
import type { GroupKind } from '@/lib/types';

type Group = { id: string; kind: GroupKind };

/** The colours calendars use, from `public.reserved_calendar_colours`. Unknown names are left out. */
export function reservedColours(names: unknown): CalendarColor[] {
  if (!Array.isArray(names)) return [];
  return names.filter((n): n is CalendarColor => typeof n === 'string' && n in CalendarColors);
}

/**
 * A colour for each squad and team. `groups` are this season's squads and
 * teams in the order the club lists them; `reserved` are the colours
 * calendars use.
 */
export function groupColours(
  groups: Group[],
  reserved: readonly CalendarColor[],
): Map<string, CalendarColor> {
  const free = groupColourOrder.filter((c) => !reserved.includes(c));
  // With every colour taken by a calendar there is nothing left to keep clear of.
  const pool = free.length > 0 ? free : groupColourOrder;
  const colours = new Map<string, CalendarColor>();
  for (const kind of ['squad', 'team'] as const) {
    groups
      .filter((g) => g.kind === kind)
      .forEach((group, i) => colours.set(group.id, pool[i % pool.length]));
  }
  return colours;
}

/** The hex colour for a squad or team, or undefined when it isn't one of this season's. */
export function groupColourHex(colours: Map<string, CalendarColor>, teamId: string | null | undefined) {
  const key = teamId ? colours.get(teamId) : undefined;
  return key ? CalendarColors[key].hex : undefined;
}
