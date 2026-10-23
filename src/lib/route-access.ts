import { useCanTakeAttendance, useCanViewAttendance } from '@/lib/attendance';
import { useAuth } from '@/lib/auth';
import { useCanSeeCheckIns, useIsCheckInAthlete, useIsCheckInCoach } from '@/lib/check-ins';
import { useIsGoalAthlete, useIsGoalCoach } from '@/lib/goals';
import { useCanLogInjuries, useCanSeeInjuries } from '@/lib/injuries';
import { useKpisOn } from '@/lib/kpis';
import { useCaptainedGroupIds, useCanSendMessages, useGetsMessages } from '@/lib/messages';
import { hasRole, rolesOf } from '@/lib/roles';
import { useCanSendSurveys } from '@/lib/surveys';
import { useCanCheckTraining } from '@/lib/training';
import type { AppRole, TeamRole } from '@/lib/types';

/**
 * Who can open each member screen, for the root layout's `<Stack.Protected>`
 * guards (src/app/_layout.tsx). Defence in depth: the database's row level
 * security already decides what each screen shows, and these keep members
 * off screens that aren't for them, even from a link.
 *
 * Every rule is worked out from the member's usable roles, so a role paused
 * by a lapsed check or a stand-down opens none of its screens, and a member
 * waiting for approval opens none of them. Feature switches are applied
 * separately in the layout. Each rule matches the Home card or link that
 * leads to the screen, and the user guide's role tables.
 */
export function useRouteAccess() {
  const { profile, memberships, isAdmin, isSafeguardingOfficer } = useAuth();
  const approved = profile?.status === 'approved';
  const inGroupAs = (...roles: TeamRole[]) =>
    approved && memberships.some((m) => roles.includes(m.team_role));
  const holds = (...roles: AppRole[]) => approved && hasRole(profile, ...roles);

  const getsMessages = useGetsMessages();
  const canSendMessages = useCanSendMessages();
  const canSendSurveys = useCanSendSurveys();
  const captained = useCaptainedGroupIds();
  const canSeeInjuries = useCanSeeInjuries();
  const canLogInjuries = useCanLogInjuries();
  const canTakeAttendance = useCanTakeAttendance();
  const canViewAttendance = useCanViewAttendance();
  const isCheckInAthlete = useIsCheckInAthlete();
  const isCheckInCoach = useIsCheckInCoach();
  const canSeeCheckIns = useCanSeeCheckIns();
  const isGoalAthlete = useIsGoalAthlete();
  const isGoalCoach = useIsGoalCoach();
  const kpisOn = useKpisOn();
  const canCheckTraining = useCanCheckTraining();

  const isGuardian = holds('guardian');
  const isAthlete = holds('athlete') || inGroupAs('athlete');
  /**
   * Approved, with a role other than guest or temporary helper: the members
   * who get messages and surveys and can be set integrity training.
   */
  const isClubMember = getsMessages;
  // Guests, physios and temporary helpers only look (is_view_only_member), and
  // parents and guardians don't vote: award_voters in the database.
  const roles = approved && profile ? rolesOf(profile) : [];
  const viewOnly = roles.every((r) => r === 'guest' || r === 'physio' || r === 'volunteer');
  const canVote = !viewOnly && roles.some((r) => r !== 'guardian');

  return {
    // Messages: everyone who gets them reads them; coaches, managers, the
    // committee, admins and captains send them.
    readMessages: isClubMember || canSendMessages,
    sendMessages: canSendMessages,

    // Surveys: answered by every member but guests and temporary helpers;
    // sent by the committee, admins, coaches, managers and captains.
    answerSurveys: isClubMember || canSendSurveys,
    sendSurveys: canSendSurveys,
    // Results: whoever sent the survey (a captain keeps their poll's results
    // even once captains' polls are switched off), and the committee and admins.
    surveyResults: canSendSurveys || captained.size > 0,

    // Injuries: athletes, guardians, coaches, physios, the committee and admins
    // see them; managers only log them.
    injuries: canSeeInjuries || canLogInjuries,
    // Athletes report their own, and guardians their child's.
    reportInjury: holds('athlete', 'guardian'),
    // Coaches, managers and physios log one for an athlete when it happens.
    logInjury: canLogInjuries,

    // Attendance: those who take it or see athletes' records.
    attendance: canTakeAttendance || canViewAttendance,
    takeAttendance: canTakeAttendance,
    athleteAttendance: canViewAttendance,
    // An athlete's own sessions and absences, and a guardian's child's.
    familyAttendance: isAthlete || isGuardian,

    // Session plans: added by coaches and admins, read by those they're
    // shared with (coaches, athletes and parents and guardians).
    readSessionPlans: isAdmin || holds('coach', 'athlete', 'guardian') || inGroupAs('coach', 'athlete'),
    addSessionPlans: isAdmin || inGroupAs('coach'),

    // Daily check-ins: athletes do their own; coaches see their athletes', the
    // committee, physios and admins the averages, guardians their child's.
    checkIn: isCheckInAthlete,
    checkIns: canSeeCheckIns,
    athleteCheckIns: isCheckInCoach || isGuardian,

    // Club awards: whoever an award can name as a voter.
    awards: canVote,

    // Game goals: the athlete's own, their coaches and their guardians.
    gameGoals: isGoalAthlete || isGoalCoach || isGuardian,
    athleteGoals: isGoalCoach || isGuardian,
    // Admins read every team's goals and comments (Matt, 20 October).
    teamGoals: isGoalCoach || isAdmin,

    // Season KPIs: the people they're set for (coaches, managers and
    // athletes), athletes' guardians, the committee and admins; set by
    // coaches, the committee and admins.
    kpis:
      kpisOn &&
      (holds('athlete', 'coach', 'manager', 'guardian', 'committee', 'admin') ||
        inGroupAs('athlete', 'coach', 'manager')),
    setKpis: kpisOn && (holds('committee', 'admin') || inGroupAs('coach')),

    // Integrity training: every member it can be set for; the committee and
    // admins check certificates and follow everyone's progress.
    training: isClubMember,
    checkTraining: canCheckTraining,

    // The concerns register: admins, the Child Safety Officer and the
    // Complaints Manager.
    concerns: isAdmin || isSafeguardingOfficer,

    // A child's consents, what's changed around them and who has viewed their
    // records: their parents and guardians, and admins.
    family: isGuardian || isAdmin,

    // Choosing a squad or team's captains: admins and its coaches.
    chooseCaptains: isAdmin || inGroupAs('coach'),
  };
}

export type RouteAccess = ReturnType<typeof useRouteAccess>;
