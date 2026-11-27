import type { CalendarAudience } from '@/constants/calendar-colors';
import type { AppRole, GroupKind } from '@/lib/types';

/**
 * Who sees a calendar, as an admin picks it in Admin > Calendars and as
 * `public.calendar_audiences` stores it. A member sees the calendar when they
 * match any part of it; admins see every calendar. Same rules as
 * `public.admin_save_calendar` and `public.can_see_calendar`.
 */
export type CalendarShownTo = {
  /** Every approved member (not temporary helpers or Studio). Stands alone. */
  everyone: boolean;
  roles: CalendarRole[];
  posts: CalendarPost[];
  teamIds: string[];
};

/** The roles a calendar can be shown to, in the order the admin sees them. */
export const calendarRoles = [
  'committee',
  'coach',
  'manager',
  'physio',
  'statistician',
  'athlete',
  'guardian',
  'guest',
] as const satisfies readonly AppRole[];
export type CalendarRole = (typeof calendarRoles)[number];

export const calendarRoleLabels: Record<CalendarRole, string> = {
  committee: 'Committee',
  coach: 'Coaches',
  manager: 'Managers',
  physio: 'Physios',
  statistician: 'Statisticians',
  athlete: 'Athletes',
  guardian: 'Parents and guardians',
  guest: 'Guests',
};

/** The safeguarding posts a calendar can be shown to. */
export const calendarPosts = ['child_safety_officer', 'complaints_manager', 'wwc_officer'] as const;
export type CalendarPost = (typeof calendarPosts)[number];

export const calendarPostLabels: Record<CalendarPost, string> = {
  child_safety_officer: 'Child Safety Officers',
  complaints_manager: 'Complaints Managers',
  wwc_officer: 'WWC Registration Officers',
};

/** A row of `calendar_audiences`, with its squad or team when it has one. */
export type AudienceRow = {
  kind: 'everyone' | 'role' | 'team' | 'post';
  role: string | null;
  post: string | null;
  team_id: string | null;
};

export const nobody: CalendarShownTo = { everyone: false, roles: [], posts: [], teamIds: [] };

/** Reads the stored rows into the admin's choice. Unknown values are left out. */
export function shownToFromRows(rows: AudienceRow[] | null | undefined): CalendarShownTo {
  const result: CalendarShownTo = { everyone: false, roles: [], posts: [], teamIds: [] };
  for (const row of rows ?? []) {
    if (row.kind === 'everyone') result.everyone = true;
    else if (row.kind === 'role' && isOneOf(calendarRoles, row.role)) {
      if (!result.roles.includes(row.role)) result.roles.push(row.role);
    } else if (row.kind === 'post' && isOneOf(calendarPosts, row.post)) {
      if (!result.posts.includes(row.post)) result.posts.push(row.post);
    } else if (row.kind === 'team' && row.team_id && !result.teamIds.includes(row.team_id)) {
      result.teamIds.push(row.team_id);
    }
  }
  return result;
}

/** Whether anyone but admins would see it. A calendar must be shown to someone. */
export function isShownToSomeone(shownTo: CalendarShownTo) {
  return (
    shownTo.everyone ||
    shownTo.roles.length > 0 ||
    shownTo.posts.length > 0 ||
    shownTo.teamIds.length > 0
  );
}

/** Adds the value if missing, removes it if there. */
export function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * "Shown to …" on a calendar's card: everyone, or the roles, posts and
 * squads and teams in the order the admin picks them, or admins only.
 */
export function shownToLabel(
  shownTo: CalendarShownTo,
  teams: { id: string; name: string }[],
): string {
  if (shownTo.everyone) return 'Everyone in the club';
  const parts = [
    ...calendarRoles.filter((r) => shownTo.roles.includes(r)).map((r) => calendarRoleLabels[r]),
    ...calendarPosts.filter((p) => shownTo.posts.includes(p)).map((p) => calendarPostLabels[p]),
    ...teams.filter((t) => shownTo.teamIds.includes(t.id)).map((t) => t.name),
  ];
  // A squad or team from a season no longer listed still counts.
  const unlisted = shownTo.teamIds.filter((id) => !teams.some((t) => t.id === id)).length;
  if (unlisted > 0) parts.push(unlisted === 1 ? '1 earlier squad or team' : `${unlisted} earlier squads or teams`);
  return parts.length > 0 ? joinWithAnd(parts) : 'Admins only (choose who sees it)';
}

/**
 * Which default colour a calendar takes until an admin picks one: the club's
 * for everyone, the committee's when shown only to the committee, a squad's
 * or team's when shown only to squads or only to teams, otherwise the club's.
 */
export function colourAudience(
  shownTo: CalendarShownTo,
  teams: { id: string; kind: GroupKind }[],
): CalendarAudience {
  if (shownTo.everyone) return 'club';
  const onlyTeams = shownTo.roles.length === 0 && shownTo.posts.length === 0;
  if (onlyTeams && shownTo.teamIds.length > 0) {
    const kinds = new Set(shownTo.teamIds.map((id) => teams.find((t) => t.id === id)?.kind ?? 'squad'));
    if (kinds.size === 1) return [...kinds][0];
  }
  if (
    shownTo.teamIds.length === 0 &&
    shownTo.posts.length === 0 &&
    shownTo.roles.length === 1 &&
    shownTo.roles[0] === 'committee'
  ) {
    return 'committee';
  }
  return 'club';
}

/**
 * Whether a calendar is for squads and teams alone, with no roles or posts:
 * a squad's or team's own calendar. With no colour picked it shows in that
 * squad's or team's colour and keeps no colour of its own, the same rule as
 * `public.reserved_calendar_colours`.
 */
export function isForGroupsOnly(shownTo: CalendarShownTo) {
  return (
    !shownTo.everyone &&
    shownTo.roles.length === 0 &&
    shownTo.posts.length === 0 &&
    shownTo.teamIds.length > 0
  );
}

/** The arguments `public.admin_save_calendar` takes for who sees it. */
export function saveArgs(shownTo: CalendarShownTo) {
  return {
    p_everyone: shownTo.everyone,
    p_roles: shownTo.everyone ? [] : shownTo.roles,
    p_team_ids: shownTo.everyone ? [] : shownTo.teamIds,
    p_posts: shownTo.everyone ? [] : shownTo.posts,
  };
}

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

function joinWithAnd(parts: string[]) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
