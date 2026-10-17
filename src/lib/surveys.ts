import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { parseDateString, toDateString } from '@/lib/injuries';
import { pluralRoleLabels } from '@/lib/labels';
import { hasRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

export type SurveyIdentity = 'anonymous' | 'named' | 'optional';
export type SurveyAudience = 'club' | 'role' | 'group';
export type SurveyQuestionKind = 'choice' | 'multi_choice' | 'rating' | 'text';

export const identityLabels: Record<SurveyIdentity, string> = {
  anonymous: 'Anonymous',
  named: 'Named',
  optional: 'Name optional',
};

export const identityDetails: Record<SurveyIdentity, string> = {
  anonymous:
    'Nobody can see who gave which answers, not even admins. Results show once it closes and at least 3 people have answered.',
  named: 'Every answer shows the member’s name. You can see who hasn’t answered yet.',
  optional:
    'Each member chooses whether to give their name. Results show once it closes and at least 3 people have answered.',
};

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
  responded: boolean;
  is_open: boolean;
};

/** A survey in the committee and admins' list. */
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
  for_child_names: string[] | null;
  can_answer: boolean;
  responded: boolean;
  questions: SurveyQuestion[];
  /** The member's own named answers, or null. Anonymous answers are never returned. */
  my_answers: SurveyAnswer[] | null;
  /** A parent or guardian's children's named answers. */
  children: { name: string; responded: boolean; answers: SurveyAnswer[] }[];
};

export type SurveyResults = {
  sent_to: number;
  answered: number;
  /** True while an anonymous or optional survey is open or has too few answers. */
  hidden: boolean;
  closed: boolean;
  min_responses: number;
  questions: (Omit<SurveyQuestion, 'required'> & {
    answered: number;
    counts: number[] | null;
    average: number | null;
    texts: { text: string; name: string | null }[] | null;
  })[];
  respondents: { name: string; submitted_at: string | null; answers: SurveyAnswer[] }[];
  waiting: string[];
};

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

/** The committee and admins make surveys and read results. The database checks this too. */
export function useCanManageSurveys() {
  const { isAdmin, profile } = useAuth();
  if (profile?.status !== 'approved') return false;
  return isAdmin || hasRole(profile, 'committee');
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

/** Such as "Copy for Jordan" or "Copy for Jordan and Sam". */
export function childCopyLabel(names: string[]) {
  const joined =
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
