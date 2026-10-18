import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { parseDateString, toDateString } from '@/lib/injuries';
import { pluralRoleLabels } from '@/lib/labels';
import { useCaptainedGroupIds } from '@/lib/messages';
import { hasRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

export type SurveyIdentity = 'anonymous' | 'named' | 'optional';
export type SurveyAudience = 'club' | 'role' | 'group';
export type SurveyQuestionKind = 'choice' | 'multi_choice' | 'rating' | 'text';
/** Who a survey was sent as: the committee or an admin, a coach or manager, or a captain. */
export type SurveySentAs = 'committee' | 'leader' | 'captain';

/** Captains' polls have up to this many questions, each with choices to pick from. */
export const CAPTAIN_MAX_QUESTIONS = 5;

export const identityLabels: Record<SurveyIdentity, string> = {
  anonymous: 'Anonymous',
  named: 'Named',
  optional: 'Name optional',
};

export const identityDetails: Record<SurveyIdentity, string> = {
  anonymous:
    'Nobody can see who gave which answers, not even admins. Results show once it closes, or once everyone has answered, with at least 3 answers.',
  named:
    'Every answer shows the member’s name. You can see who hasn’t answered yet. Good for a quick poll.',
  optional:
    'Each member chooses whether to give their name. Results show once it closes, or once everyone has answered, with at least 3 answers.',
};

/** Club surveys with names can show results once this share has answered. */
export const RESULTS_AT_PERCENTS = [20, 50, 80] as const;

/**
 * What a survey's results are waiting for: an anonymous or optional survey
 * to close (or everyone to answer), at least 3 answers, everyone to answer,
 * or a club survey's percentage target.
 */
export type SurveyWait = 'closing' | 'min' | 'everyone' | 'percent';

export const questionKindLabels: Record<SurveyQuestionKind, string> = {
  choice: 'One choice',
  multi_choice: 'Several choices',
  rating: 'Rating',
  text: 'Written answer',
};

/** Results of anonymous and optional surveys show once this many have answered. */
export const MIN_RESPONSES = 3;

/** A survey sent to the signed-in member, or a parent or guardian's copy. */
export type MySurvey = {
  id: string;
  title: string;
  identity: SurveyIdentity;
  opens_at: string;
  closes_at: string;
  created_by_name: string | null;
  /** For a parent or guardian's copy: the children it was sent to. */
  for_child_names: string[] | null;
  /** A parent or guardian's copy of a poll their child sent. */
  from_child: boolean;
  responded: boolean;
  is_open: boolean;
  /** Everyone it went to must answer. */
  everyone_answers: boolean;
};

/** A survey whose results the member can read. */
export type ManagedSurvey = {
  id: string;
  title: string;
  identity: SurveyIdentity;
  audience: SurveyAudience;
  audience_role: AppRole | null;
  audience_label: string | null;
  opens_at: string;
  closes_at: string;
  created_by: string | null;
  created_by_name: string | null;
  sent_as: SurveySentAs;
  share_with_committee: boolean;
  share_with_admins: boolean;
  sent_to: number;
  answered: number;
  status: 'scheduled' | 'open' | 'closed';
};

export type SurveyQuestion = {
  id: string;
  kind: SurveyQuestionKind;
  prompt: string;
  options: string[] | null;
  rating_max: number | null;
  required: boolean;
};

export type SurveyAnswer = {
  question_id: string;
  choices: number[] | null;
  rating: number | null;
  text: string | null;
};

export type SurveyDetail = {
  id: string;
  title: string;
  intro: string | null;
  identity: SurveyIdentity;
  audience: SurveyAudience;
  audience_role: AppRole | null;
  audience_label: string | null;
  opens_at: string;
  closes_at: string;
  created_by: string | null;
  created_by_name: string | null;
  is_open: boolean;
  /** Not open yet: only the committee and admins see it. */
  is_scheduled: boolean;
  is_recipient: boolean;
  sent_as: SurveySentAs;
  /** A coach or manager let the committee and admins see it too. */
  share_with_committee: boolean;
  /** Admins see a coach or manager's survey: always unless it's a quick poll. */
  share_with_admins: boolean;
  /** Everyone it went to must answer, and results wait until they have. */
  everyone_answers: boolean;
  /** A club survey with names shows results once this share has answered. */
  results_at_percent: number | null;
  /** The squad or team it went to sees the counts and averages. */
  results_to_group: boolean;
  /** Whoever sent it; the committee and admins for theirs and shared ones; coaches and managers for captains' polls. */
  can_see_results: boolean;
  /** Whoever sent it, an admin who can see it, or the group's coaches and managers for a captain's poll, while it's open. */
  can_close: boolean;
  for_child_names: string[] | null;
  /** A parent or guardian's copy of a poll their child sent. */
  from_child: boolean;
  can_answer: boolean;
  responded: boolean;
  questions: SurveyQuestion[];
  /** The member's own named answers, or null. Anonymous answers are never returned. */
  my_answers: SurveyAnswer[] | null;
  /** A parent or guardian's children's named answers. */
  children: { name: string; responded: boolean; answers: SurveyAnswer[] }[];
};

/** A survey's title, who it went to and when. */
export type SurveySummary = {
  id: string;
  title: string;
  identity: SurveyIdentity;
  audience: SurveyAudience;
  audience_role: AppRole | null;
  audience_label: string | null;
  opens_at: string;
  closes_at: string;
  created_by_name: string | null;
  sent_as: SurveySentAs;
  everyone_answers: boolean;
  results_at_percent: number | null;
  results_to_group: boolean;
};

export type SurveyResults = {
  survey: SurveySummary;
  /** Can download the PDF summary and the spreadsheet (not captains). */
  can_export: boolean;
  sent_to: number;
  answered: number;
  /** True while results wait for something (see wait). */
  hidden: boolean;
  wait: SurveyWait | null;
  closed: boolean;
  /** Can close it now and see the results with the answers so far. */
  can_close: boolean;
  min_responses: number;
  questions: (Omit<SurveyQuestion, 'required'> & {
    answered: number;
    counts: number[] | null;
    average: number | null;
    texts: { text: string; name: string | null }[] | null;
  })[];
  respondents: {
    name: string;
    submitted_at: string | null;
    answers: SurveyAnswer[];
  }[];
  waiting: string[];
};

/** Counts and averages shared with the squad or team, from `survey_group_results`. */
export type SurveyGroupResults = {
  sent_to: number;
  answered: number;
  wait: SurveyWait | null;
  closed: boolean;
  questions: (Omit<SurveyQuestion, 'required'> & {
    answered: number;
    counts: number[] | null;
    average: number | null;
  })[];
};

/** Why results aren't showing yet, in words. */
export function surveyWaitText(
  wait: SurveyWait,
  survey: Pick<SurveySummary, 'identity' | 'everyone_answers' | 'results_at_percent'>,
) {
  switch (wait) {
    case 'closing':
      return 'Results show once the survey closes, or once everyone has answered, so nobody can work out who answered from how the results change.';
    case 'min':
      return `Results show once at least ${MIN_RESPONSES} people have answered${
        survey.identity === 'named' ? '' : ', so nobody can be picked out'
      }.`;
    case 'everyone':
      return 'Everyone must answer, so results show once everyone has answered or the survey closes.';
    case 'percent':
      return `Results show once ${survey.results_at_percent}% have answered, or the survey closes.`;
  }
}

/** Such as "4 of 12 answered (33%)". */
export function answeredText(answered: number, sentTo: number) {
  const percent = sentTo > 0 ? Math.round((answered / sentTo) * 100) : 0;
  return `${answered} of ${sentTo} answered (${percent}%)`;
}

/** Who a survey went to, such as "Everyone in the club" or "Open Squad". */
export function surveyAudienceLabel(
  audience: SurveyAudience,
  role: AppRole | null,
  label: string | null,
) {
  if (audience === 'club') return 'Everyone in the club';
  if (audience === 'role') return role ? `All ${pluralRoleLabels[role].toLowerCase()}` : 'A role';
  return label ?? 'A squad or team';
}

/** The day a survey closes, as a "2026-10-17" date: the last day it's open. */
export function closingDay(closesAt: string) {
  return toDateString(new Date(new Date(closesAt).getTime() - 1));
}

/** The day a survey opens, as a "2026-10-17" date. */
export function openingDay(opensAt: string) {
  return toDateString(new Date(opensAt));
}

/** The start of a day on this phone, as a time the database stores. */
export function startOfDayIso(day: string) {
  return parseDateString(day).toISOString();
}

/** The end of a day on this phone (midnight after it), as a time the database stores. */
export function endOfDayIso(day: string) {
  const date = parseDateString(day);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/**
 * The committee and admins send surveys to anyone and read the results of
 * the committee's surveys and the ones coaches and managers share with them.
 * The database checks this too.
 */
export function useCanManageSurveys() {
  const { isAdmin, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return isAdmin || hasRole(profile, 'committee');
}

/**
 * Coaches and managers also send surveys, to the squads and teams they coach
 * or manage, and captains send polls to the one they captain. Each reads
 * their own surveys' results.
 */
export function useCanSendSurveys() {
  const { memberships, profile } = useAuth();
  const canManage = useCanManageSurveys();
  const captained = useCaptainedPollGroupIds();
  if (profile?.status !== 'approved') return false;
  return (
    canManage ||
    captained.size > 0 ||
    memberships.some((m) => m.team_role === 'coach' || m.team_role === 'manager')
  );
}

/** Groups the member captains, when the club lets captains send polls. */
export function useCaptainedPollGroupIds() {
  const { features } = useClub();
  const captained = useCaptainedGroupIds();
  return features.captainPolls ? captained : new Set<string>();
}

/** Who sees a survey's answers, in words for the people answering it. */
export function surveyAnswersSeenBy(
  survey: Pick<SurveyDetail, 'sent_as' | 'share_with_committee' | 'share_with_admins'>,
) {
  if (survey.sent_as === 'committee') return 'whoever sent it, the committee and admins';
  if (survey.sent_as === 'captain') return 'whoever sent it and the group’s coaches and managers';
  if (survey.share_with_committee) return 'whoever sent it, the committee and admins';
  return survey.share_with_admins ? 'whoever sent it and admins' : 'whoever sent it';
}

/** Coaches' and managers' quick polls can stay in the team: up to this many questions, with choices or ratings. */
export const TEAM_POLL_MAX_QUESTIONS = 5;

/** Whether a coach or manager's survey is a quick poll that can stay in the team. */
export function isTeamPoll(questions: { kind: SurveyQuestionKind }[]) {
  return (
    questions.length <= TEAM_POLL_MAX_QUESTIONS && questions.every((q) => q.kind !== 'text')
  );
}

/** Surveys sent to the member that have opened, refreshed when the screen is shown. */
export function useMySurveys() {
  const { profile } = useAuth();
  const { features } = useClub();
  const [surveys, setSurveys] = useState<MySurvey[]>([]);
  const enabled = profile?.status === 'approved' && features.surveys;

  const load = useCallback(async () => {
    if (!enabled) {
      setSurveys([]);
      return;
    }
    const { data } = await supabase.rpc('my_surveys');
    setSurveys((data as MySurvey[] | null) ?? []);
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { mySurveys: surveys, reloadMySurveys: load };
}

/** Open surveys the member still has to answer themselves. */
export function surveysToAnswer(surveys: MySurvey[]) {
  return surveys.filter((s) => s.is_open && !s.responded && !s.for_child_names);
}

/** Such as "Sent to Jordan and Sam. Your copy shows what they’re asked." */
export function childCopyLabel(names: string[], fromChild = false) {
  const joined =
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  if (fromChild) return `Copied to you because ${joined} sent it. Your copy shows what they asked.`;
  return `Sent to ${joined}. Your copy shows what they’re asked.`;
}

/** One answer in words, such as "4 out of 5" or "Tuesday, Thursday". */
export function answerText(
  q: { kind: string; options: string[] | null; rating_max: number | null },
  a: SurveyAnswer,
) {
  if (q.kind === 'rating') return `${a.rating} out of ${q.rating_max}`;
  if (q.kind === 'text') return a.text ?? '';
  return (a.choices ?? []).map((c) => q.options?.[c] ?? '').join(', ');
}
