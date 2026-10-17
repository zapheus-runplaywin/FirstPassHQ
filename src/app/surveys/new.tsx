import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { toDateString } from '@/lib/injuries';
import { pluralRoleLabels } from '@/lib/labels';
import { useLedGroups } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import {
  CAPTAIN_MAX_QUESTIONS,
  isTeamPoll,
  TEAM_POLL_MAX_QUESTIONS,
  endOfDayIso,
  identityDetails,
  identityLabels,
  MIN_RESPONSES,
  questionKindLabels,
  RESULTS_AT_PERCENTS,
  startOfDayIso,
  useCanManageSurveys,
  useCaptainedPollGroupIds,
  type SurveyAudience,
  type SurveyIdentity,
  type SurveyQuestionKind,
} from '@/lib/surveys';
import type { AppRole } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

/** Roles a survey can go to, in the order they're shown. */
const surveyRoles: AppRole[] = [
  'athlete',
  'guardian',
  'coach',
  'manager',
  'committee',
  'physio',
  'admin',
];

type DraftQuestion = {
  key: number;
  kind: SurveyQuestionKind;
  prompt: string;
  options: string[];
  ratingMax: '5' | '10';
  required: boolean;
};

let nextKey = 1;
function newQuestion(kind: SurveyQuestionKind = 'choice'): DraftQuestion {
  return {
    key: nextKey++,
    kind,
    prompt: '',
    options: ['', ''],
    ratingMax: '5',
    required: true,
  };
}

function daysFromToday(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

export default function NewSurveyScreen() {
  const theme = useTheme();
  const teams = useTeams();
  // Coaches and managers send to the squads and teams they coach or manage,
  // captains polls to the one they captain; the committee and admins to anyone.
  const canManage = useCanManageSurveys();
  const ledGroups = useLedGroups(teams);
  const captained = useCaptainedPollGroupIds();
  const ledIds = new Set(ledGroups.map((t) => t.id));
  const groups = canManage ? teams : teams.filter((t) => ledIds.has(t.id) || captained.has(t.id));
  const [title, setTitle] = useState('');
  const [intro, setIntro] = useState('');
  const [identity, setIdentity] = useState<SurveyIdentity>('anonymous');
  const [audience, setAudience] = useState<SurveyAudience>(canManage ? 'club' : 'group');
  const [role, setRole] = useState<AppRole | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [opensOn, setOpensOn] = useState<string | null>(toDateString(new Date()));
  const [closesOn, setClosesOn] = useState<string | null>(daysFromToday(14));
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion()]);
  const [share, setShare] = useState<'team' | 'admins' | 'committee'>('team');
  const [everyone, setEveryone] = useState(false);
  // Club surveys with names: show results from 3 answers, a share, or once everyone has answered.
  const [resultsAt, setResultsAt] = useState<'min' | '20' | '50' | '80' | 'all'>('min');
  const [shareResults, setShareResults] = useState(false);
  // Someone who leads one group doesn't need to pick it.
  const selectedTeamId = teamId ?? (!canManage && groups.length === 1 ? groups[0].id : null);
  // A coach or manager's survey stays with the team unless they share it.
  const asLeader = !canManage && !!selectedTeamId && ledIds.has(selectedTeamId);
  // A captain's poll has a few questions with choices to pick from.
  const asCaptain = !canManage && !!selectedTeamId && !asLeader && captained.has(selectedTeamId);
  const kinds: SurveyQuestionKind[] = asCaptain
    ? ['choice', 'multi_choice']
    : ['choice', 'multi_choice', 'rating', 'text'];
  const maxQuestions = asCaptain ? CAPTAIN_MAX_QUESTIONS : 30;
  // Only a quick poll can stay in the team; anything longer, or with a
  // written answer, goes to admins too. The database applies the same rule.
  const teamPoll = isTeamPoll(questions);
  const sharedWith = asLeader ? (share === 'team' && !teamPoll ? 'admins' : share) : null;
  const clubTarget = canManage && identity === 'named';
  const everyoneAnswers = clubTarget ? resultsAt === 'all' : everyone;
  const toGroup = (asLeader || asCaptain) && shareResults;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: number, change: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...change } : q)));
  }

  async function send() {
    if (!title.trim()) return setError('Give the survey a title.');
    if (audience === 'role' && !role) return setError('Choose who to send it to.');
    if (audience === 'group' && !selectedTeamId) return setError('Choose a squad or team.');
    if (!opensOn || !closesOn) return setError('Choose when it opens and closes.');
    if (asCaptain) {
      if (questions.length > maxQuestions) {
        return setError(`Captains’ polls can have up to ${maxQuestions} questions.`);
      }
      if (questions.some((q) => !kinds.includes(q.kind))) {
        return setError('Captains’ polls can only have questions with choices.');
      }
    }
    if (closesOn < opensOn) return setError('Choose a closing day on or after the opening day.');
    for (const [i, q] of questions.entries()) {
      if (!q.prompt.trim()) return setError(`Write question ${i + 1}.`);
      if (
        (q.kind === 'choice' || q.kind === 'multi_choice') &&
        q.options.filter((o) => o.trim()).length < 2
      ) {
        return setError(`Give question ${i + 1} at least two choices.`);
      }
    }
    setSending(true);
    setError(null);
    const today = toDateString(new Date());
    const { data, error: sendError } = await supabase.rpc('create_survey', {
      p_title: title,
      p_intro: intro,
      p_identity: identity,
      p_audience: audience,
      p_role: audience === 'role' ? role : null,
      p_team_id: audience === 'group' ? selectedTeamId : null,
      // Opening today means straight away.
      p_opens_at: opensOn <= today ? null : startOfDayIso(opensOn),
      p_closes_at: endOfDayIso(closesOn),
      p_questions: questions.map((q) => ({
        kind: q.kind,
        prompt: q.prompt,
        options:
          q.kind === 'choice' || q.kind === 'multi_choice'
            ? q.options.filter((o) => o.trim())
            : null,
        rating_max: q.kind === 'rating' ? Number(q.ratingMax) : null,
        required: q.required,
      })),
      p_share_with_committee: sharedWith === 'committee',
      p_share_with_admins: sharedWith === 'admins' || sharedWith === 'committee',
      p_everyone_answers: everyoneAnswers,
      p_results_at_percent:
        clubTarget && resultsAt !== 'min' && resultsAt !== 'all' ? Number(resultsAt) : null,
      p_results_to_group: toGroup,
    });
    setSending(false);
    if (sendError) return setError(sendError.message);
    router.replace({
      pathname: '/surveys/[id]',
      params: { id: data as string },
    });
  }

  return (
    <Screen>
      <TextField
        label="Title"
        placeholder="For example, End of season survey"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
      />
      <TextField
        label="Introduction (optional)"
        value={intro}
        onChangeText={setIntro}
        placeholder="What it’s for and how answers will be used"
        multiline
        maxLength={2000}
      />

      <ChipGroup
        label="Answers"
        options={(['anonymous', 'named', 'optional'] as const).map((value) => ({
          value,
          label: identityLabels[value],
        }))}
        selected={[identity]}
        onToggle={setIdentity}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {identityDetails[identity]} This can’t be changed once it’s sent.
      </ThemedText>

      {canManage ? (
        <ChipGroup
          label="Send to"
          options={[
            { value: 'club', label: 'Everyone' },
            { value: 'role', label: 'A role' },
            { value: 'group', label: 'A squad or team' },
          ]}
          selected={[audience]}
          onToggle={(value) => {
            setAudience(value);
            setError(null);
          }}
        />
      ) : null}
      {audience === 'role' ? (
        <ChipGroup
          label="Role"
          options={surveyRoles.map((r) => ({
            value: r,
            label: pluralRoleLabels[r],
          }))}
          selected={role ? [role] : []}
          onToggle={setRole}
        />
      ) : null}
      {audience === 'group' ? (
        groups.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            You can send surveys to the squads and teams you coach or manage once an admin adds you
            to one.
          </ThemedText>
        ) : (
          <ChipGroup
            label={canManage ? 'Squad or team' : 'Send to'}
            options={groups.map((t) => ({
              value: t.id,
              label: teamLabel(t, teams),
            }))}
            selected={selectedTeamId ? [selectedTeamId] : []}
            onToggle={setTeamId}
          />
        )
      ) : null}
      {asLeader && sharedWith ? (
        <View style={styles.options}>
          <ChipGroup
            label="Who else sees it"
            options={[
              ...(teamPoll ? [{ value: 'team' as const, label: 'Just me' }] : []),
              { value: 'admins' as const, label: 'Admins' },
              { value: 'committee' as const, label: 'Admins and committee' },
            ]}
            selected={[sharedWith]}
            onToggle={setShare}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {teamPoll
              ? `A quick poll (up to ${TEAM_POLL_MAX_QUESTIONS} questions with choices or ratings) can stay in the team. Anything longer, or with a written answer, goes to admins too.`
              : `Admins see surveys with more than ${TEAM_POLL_MAX_QUESTIONS} questions or a written answer, so the club knows what members are asked.`}
          </ThemedText>
        </View>
      ) : null}
      {clubTarget ? (
        <View style={styles.options}>
          <ChipGroup
            label="Results show"
            options={[
              { value: 'min' as const, label: `From ${MIN_RESPONSES} answers` },
              ...RESULTS_AT_PERCENTS.map((n) => ({
                value: String(n) as '20' | '50' | '80',
                label: `${n}% answered`,
              })),
              { value: 'all' as const, label: 'Everyone must answer' },
            ]}
            selected={[resultsAt]}
            onToggle={setResultsAt}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Results also show when it closes. If not everyone answers, you can close it early and
            accept the answers you have.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.options}>
          <ChipGroup
            label="Answering"
            options={[
              { value: 'optional', label: 'Optional' },
              { value: 'everyone', label: 'Everyone must answer' },
            ]}
            selected={[everyone ? 'everyone' : 'optional']}
            onToggle={(value) => setEveryone(value === 'everyone')}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {identity === 'named'
              ? everyone
                ? 'Results show once everyone has answered, or when it closes. You can close it early and accept the answers you have.'
                : `Results show once at least ${MIN_RESPONSES} people have answered.`
              : `Results show once it closes, or once everyone has answered, with at least ${MIN_RESPONSES} answers.`}
          </ThemedText>
        </View>
      )}
      {asLeader || asCaptain ? (
        <View style={styles.options}>
          <ChipGroup
            label="Share results with the squad or team"
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes, the totals' },
            ]}
            selected={[shareResults ? 'yes' : 'no']}
            onToggle={(value) => setShareResults(value === 'yes')}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Everyone it goes to sees how many picked each choice once results show. Never names or
            written answers.
          </ThemedText>
        </View>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Parents and guardians of athletes under 18 get a copy so they can see what their child is
        asked. Only the child answers.
      </ThemedText>

      <DateField
        label="Opens"
        value={opensOn}
        onChange={setOpensOn}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Tomorrow', days: 1 },
          { label: 'In 1 week', days: 7 },
        ]}
      />
      <DateField
        label="Closes at the end of"
        value={closesOn}
        onChange={setClosesOn}
        quickPicks={[
          { label: '1 week', days: 7 },
          { label: '2 weeks', days: 14 },
          { label: '4 weeks', days: 28 },
        ]}
      />

      {questions.map((q, i) => (
        <View key={q.key} style={[styles.question, { borderColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">Question {i + 1}</ThemedText>
          <ChipGroup
            options={kinds.map((value) => ({
              value,
              label: questionKindLabels[value],
            }))}
            selected={[q.kind]}
            onToggle={(kind) => update(q.key, { kind })}
          />
          <TextField
            label="Question"
            placeholder="Write the question"
            value={q.prompt}
            onChangeText={(prompt) => update(q.key, { prompt })}
            maxLength={300}
          />
          {q.kind === 'choice' || q.kind === 'multi_choice' ? (
            <View style={styles.options}>
              {q.options.map((option, n) => (
                <TextField
                  key={n}
                  label={`Choice ${n + 1}`}
                  placeholder="Write a choice"
                  value={option}
                  onChangeText={(text) =>
                    update(q.key, {
                      options: q.options.map((o, m) => (m === n ? text : o)),
                    })
                  }
                  maxLength={100}
                />
              ))}
              {q.options.length < 12 ? (
                <Button
                  title="Add a choice"
                  variant="secondary"
                  onPress={() => update(q.key, { options: [...q.options, ''] })}
                />
              ) : null}
            </View>
          ) : null}
          {q.kind === 'rating' ? (
            <ChipGroup
              label="Scale"
              options={[
                { value: '5', label: '1 to 5' },
                { value: '10', label: '1 to 10' },
              ]}
              selected={[q.ratingMax]}
              onToggle={(ratingMax) => update(q.key, { ratingMax })}
            />
          ) : null}
          <ChipGroup
            options={[
              { value: 'yes', label: 'Must answer' },
              { value: 'no', label: 'Can skip' },
            ]}
            selected={[q.required ? 'yes' : 'no']}
            onToggle={(value) => update(q.key, { required: value === 'yes' })}
          />
          {questions.length > 1 ? (
            <Button
              title="Remove question"
              variant="secondary"
              onPress={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}
            />
          ) : null}
        </View>
      ))}
      {questions.length < maxQuestions ? (
        <Button
          title="Add a question"
          variant="secondary"
          onPress={() => setQuestions((qs) => [...qs, newQuestion()])}
        />
      ) : null}

      <ThemedText type="small" themeColor="textSecondary">
        Questions can’t be changed once it’s sent.{' '}
        {canManage
          ? 'Only you, the committee and admins see results.'
          : asCaptain
            ? 'Only you and the coaches and managers of your squad or team see results.'
            : sharedWith === 'committee'
              ? 'Only you, the committee and admins see results.'
              : sharedWith === 'admins'
                ? 'Only you and admins see results.'
                : 'Only you see results.'}
        {toGroup ? ' The squad or team sees the totals too.' : ''}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title="Send survey" onPress={send} busy={sending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  question: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: 12,
  },
  options: {
    gap: Spacing.two,
  },
});
