/**
 * What a member can do about one session on the calendar: say they (or their
 * child) can't make it, take attendance, open or add its session plan, and
 * see how the squad is feeling. Shown on the event's page and under Next up
 * on Today.
 *
 * These are shortcuts, not permissions. Each opens a screen that already
 * exists, behind its own route guard, and the database decides what that
 * screen may read and save. So this only offers a shortcut to someone who
 * could already get there another way.
 */
import type { Href } from 'expo-router';

import type { IconName } from '@/components/icon';
import type { CalendarEvent } from '@/lib/calendar';
import { clubDay, clubToday } from '@/lib/club-time';
import type { TeamRole } from '@/lib/types';

/** How long after a session attendance can still be taken from its page. */
export const ATTENDANCE_DAYS_AFTER = 7;

export type SessionEvent = Pick<
  CalendarEvent,
  'id' | 'title' | 'start' | 'end' | 'clubWide' | 'teamIds' | 'forAthletes' | 'cancelled' | 'pending'
>;

export type SessionFacts = {
  now: Date;
  /** The member's own id. */
  userId: string | undefined;
  features: { attendance: boolean; sessionPlans: boolean; checkIns: boolean };
  /** The squads and teams the member is in, and as what. */
  memberships: { teamId: string; role: TeamRole }[];
  /** Holds the athlete role or plays in a squad or team: may report their own absence. */
  isAthlete: boolean;
  /** The children a parent or guardian may report an absence for. */
  children: { id: string; name: string }[];
  /** May take attendance at all (coaches, managers, the committee and admins). */
  canTakeAttendance: boolean;
  /** The squads and teams they coach or manage, so take attendance for. */
  ledTeamIds: string[];
  /** Admins take attendance for every squad and team. */
  leadsEveryTeam: boolean;
  /** Session plans they can read, their own and those shared with them. */
  plans: { id: string; title: string; team_id: string | null; session_on: string }[];
  /** The squads and teams they coach, so can add a session plan for. */
  planTeamIds: string[];
  /** Admins can add a session plan for every squad and team. */
  plansForEveryTeam: boolean;
  /** Today's check-ins for the squads and teams they coach. */
  checkIns: { team_id: string; athlete_count: number; checked_in_count: number; flagged_count: number }[];
};

export type SessionAction = {
  key: string;
  kind: 'absence' | 'attendance' | 'plan' | 'addPlan' | 'checkIns';
  icon: IconName;
  title: string;
  detail: string;
  href: Href;
};

function addDays(day: string, days: number) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The shortcuts for one session, in a fixed order: absences first (the most
 * common thing anyone does about a session), then attendance, the plan, and
 * check-ins.
 */
export function sessionActions(event: SessionEvent, facts: SessionFacts): SessionAction[] {
  // A cancelled session isn't on: nobody is away from it and no register is taken.
  // Nor is a suggestion an admin hasn't accepted.
  if (event.cancelled || event.pending) return [];
  const teamIds = event.teamIds ?? [];
  const day = clubDay(event.start);
  const today = clubToday(facts.now);
  const over = event.end.getTime() <= facts.now.getTime();
  // A session on a calendar shown to the whole club, or to every athlete, is
  // one any athlete may be at. A calendar shown only to other roles or to a
  // safeguarding post (a committee meeting, say) isn't a session athletes
  // attend, so nothing about absences or attendance is offered on it.
  const forEveryone = event.clubWide || event.forAthletes === true;
  const mine = facts.memberships.filter((m) => teamIds.includes(m.teamId));
  const actions: SessionAction[] = [];

  // Can't make it: an athlete for themselves, a parent for each child, until
  // the session is over. The dates come from the session.
  if (facts.features.attendance && !over) {
    const plays = forEveryone ? facts.isAthlete : mine.some((m) => m.role === 'athlete');
    if (plays && facts.userId) {
      actions.push({
        key: `absence:${facts.userId}`,
        kind: 'absence',
        icon: 'x',
        title: 'Can’t make it',
        detail: 'Tell your coaches you’ll be away',
        href: { pathname: '/attendance/absence', params: { id: facts.userId, day } },
      });
    }
    // A parent follows their children into squads and teams, so being in the
    // session's squad or team means one of their children is. A parent who
    // also coaches it has one place there, as its coach, so any place counts.
    if (forEveryone || mine.length > 0) {
      for (const child of facts.children) {
        actions.push({
          key: `absence:${child.id}`,
          kind: 'absence',
          icon: 'x',
          title: `${child.name} can’t make it`,
          detail: 'Tell their coaches they’ll be away',
          href: {
            pathname: '/attendance/absence',
            params: { id: child.id, name: child.name, day },
          },
        });
      }
    }
  }

  // Take attendance: on the day, and for a week after for a register taken late.
  if (
    facts.features.attendance &&
    facts.canTakeAttendance &&
    day <= today &&
    day >= addDays(today, -ATTENDANCE_DAYS_AFTER)
  ) {
    const led = teamIds.find((id) => facts.leadsEveryTeam || facts.ledTeamIds.includes(id));
    const team = led ?? (forEveryone ? 'club' : null);
    if (team) {
      actions.push({
        key: 'attendance',
        kind: 'attendance',
        icon: 'clipboard',
        title: 'Take attendance',
        detail: 'Athletes reported away start as Absent',
        href: { pathname: '/attendance/new', params: { team, event: event.id } },
      });
    }
  }

  // The session's plan: one written for this squad or team on this day.
  if (facts.features.sessionPlans) {
    const plans = facts.plans.filter(
      (p) => p.session_on === day && p.team_id !== null && teamIds.includes(p.team_id),
    );
    for (const plan of plans) {
      actions.push({
        key: `plan:${plan.id}`,
        kind: 'plan',
        icon: 'file-text',
        title: 'Session plan',
        detail: plan.title,
        href: { pathname: '/session-plans/[id]', params: { id: plan.id } },
      });
    }
    const planTeam = teamIds.find((id) => facts.plansForEveryTeam || facts.planTeamIds.includes(id));
    if (plans.length === 0 && planTeam) {
      actions.push({
        key: 'addPlan',
        kind: 'addPlan',
        icon: 'plus',
        title: 'Add a session plan',
        detail: 'The time and place are filled in from this session',
        href: { pathname: '/session-plans/edit', params: { team: planTeam, event: event.id } },
      });
    }
  }

  // How the squad is feeling: for its coaches, on the day.
  if (facts.features.checkIns && day === today) {
    const row = facts.checkIns.find((c) => teamIds.includes(c.team_id));
    if (row) {
      const parts = [`${row.checked_in_count} of ${row.athlete_count} checked in today`];
      if (row.flagged_count > 0) parts.push(`${row.flagged_count} flagged`);
      actions.push({
        key: 'checkIns',
        kind: 'checkIns',
        icon: 'activity',
        title: 'Check-ins',
        detail: parts.join(' · '),
        href: { pathname: '/check-ins', params: { team: row.team_id } },
      });
    }
  }

  return actions;
}
