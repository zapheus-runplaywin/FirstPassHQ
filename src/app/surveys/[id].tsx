import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { SurveyBars } from '@/components/survey-bars';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  answeredText,
  answerText,
  childCopyLabel,
  closingDay,
  identityLabels,
  openingDay,
  surveyAnswersSeenBy,
  surveyAudienceLabel,
  surveyWaitText,
  type SurveyAnswer,
  type SurveyDetail,
  type SurveyGroupResults,
  type SurveyQuestion,
} from '@/lib/surveys';

type Draft = Record<string, { choices?: number[]; rating?: number; text?: string }>;

export default function SurveyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [groupResults, setGroupResults] = useState<SurveyGroupResults | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [giveName, setGiveName] = useState(false);
  // A child who doesn't use the app, whose copy this parent is answering.
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = !!profile && isMinor(profile.date_of_birth, profile.under_17);

  const load = useCallback(async () => {
    const { data, error: fetchError } = await supabase.rpc('survey_detail', {
      p_survey_id: id,
    });
    if (fetchError) return setLoadError(fetchError.message);
    const detail = data as SurveyDetail;
    setSurvey(detail);
    // The squad or team's totals, when whoever sent it shared them.
    if (detail.results_to_group && detail.is_recipient && !detail.is_scheduled) {
      const { data: shared } = await supabase.rpc('survey_group_results', { p_survey_id: id });
      setGroupResults((shared as SurveyGroupResults | null) ?? null);
    } else {
      setGroupResults(null);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loadError) {
    return (
      <Screen>
        <ErrorText>{loadError}</ErrorText>
      </Screen>
    );
  }
  if (!survey) return <Screen>{null}</Screen>;

  const hasText = survey.questions.some((q) => q.kind === 'text');
  // Children who don't use the app, whose copy this parent can answer.
  const answerForChildren = survey.answer_for ?? [];
  const answeringFor = answerForChildren.find((c) => c.id === answerFor) ?? null;
  const answering = survey.can_answer || !!answeringFor;

  async function submit() {
    if (!survey) return;
    const child = answerFor;
    for (const q of survey.questions) {
      const a = draft[q.id];
      const answered = !!a && (!!a.choices?.length || !!a.rating || !!a.text?.trim());
      if (q.required && !answered) return setError(`Answer “${q.prompt}”.`);
    }
    setSending(true);
    setError(null);
    const answers = {
      p_survey_id: survey.id,
      p_answers: Object.entries(draft).map(([questionId, a]) => ({
        question_id: questionId,
        choices: a.choices ?? null,
        rating: a.rating ?? null,
        text: a.text ?? null,
      })),
      p_give_name: survey.identity === 'optional' && giveName,
    };
    const { error: sendError } = child
      ? await supabase.rpc('submit_survey_response_for_child', { ...answers, p_child_id: child })
      : await supabase.rpc('submit_survey_response', answers);
    setSending(false);
    if (sendError) return setError(sendError.message);
    setAnswerFor(null);
    setDraft({});
    load();
  }

  async function closeNow() {
    setClosing(true);
    const { error: closeError } = await supabase.rpc('set_survey_closing', {
      p_survey_id: id,
      p_closes_at: new Date().toISOString(),
    });
    setClosing(false);
    if (closeError) return setError(closeError.message);
    load();
  }

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">{survey.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {identityLabels[survey.identity]} · From {survey.created_by_name ?? 'the club'} · To{' '}
          {surveyAudienceLabel(survey.audience, survey.audience_role, survey.audience_label)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {survey.is_scheduled
            ? `Opens ${formatDateString(openingDay(survey.opens_at))}`
            : survey.is_open
              ? `Open until ${formatDateString(closingDay(survey.closes_at))}`
              : `Closed ${formatDateString(closingDay(survey.closes_at))}`}
        </ThemedText>
      </View>
      {survey.intro ? <ThemedText>{survey.intro}</ThemedText> : null}
      {survey.everyone_answers && survey.is_open ? (
        <ThemedText type="smallBold">Everyone must answer this one.</ThemedText>
      ) : null}

      {survey.for_child_names ? (
        <Card>
          <ThemedText type="small">
            {childCopyLabel(survey.for_child_names, survey.from_child)}
          </ThemedText>
          {!survey.from_child ? (
            <ThemedText type="small" themeColor="textSecondary">
              {survey.identity === 'anonymous'
                ? 'Answers are anonymous, so nobody can see your child’s answers, including you.'
                : 'You can read your child’s answers here once they’ve answered.'}
            </ThemedText>
          ) : null}
          {answerForChildren.map((c) =>
            answerFor === c.id ? null : (
              <View key={c.id} style={styles.list}>
                <ThemedText type="small">
                  {c.name} doesn’t use the app, so you can answer for them. Their answers are
                  marked as answered by you.
                </ThemedText>
                <Button
                  title={`Answer for ${c.name}`}
                  variant="secondary"
                  onPress={() => {
                    setAnswerFor(c.id);
                    setDraft({});
                    setError(null);
                  }}
                />
              </View>
            ),
          )}
        </Card>
      ) : survey.can_answer ? (
        <IdentityNotice survey={survey} />
      ) : null}

      {answering ? (
        <>
          {answeringFor ? (
            <ThemedText type="smallBold">Answering for {answeringFor.name}</ThemedText>
          ) : null}
          {survey.questions.map((q, i) => (
            <QuestionInput
              key={q.id}
              number={i + 1}
              question={q}
              value={draft[q.id]}
              onChange={(value) => setDraft((d) => ({ ...d, [q.id]: value }))}
            />
          ))}
          {survey.identity === 'optional' ? (
            <ChipGroup
              label={answeringFor ? `${answeringFor.name}’s name` : 'Your name'}
              options={[
                { value: 'no', label: answeringFor ? 'Don’t give their name' : 'Don’t give my name' },
                { value: 'yes', label: answeringFor ? 'Give their name' : 'Give my name' },
              ]}
              selected={[giveName ? 'yes' : 'no']}
              onToggle={(value) => setGiveName(value === 'yes')}
            />
          ) : null}
          {minor && !answeringFor && survey.identity !== 'named' && hasText ? (
            <Card>
              <ThemedText type="small">
                Because you might not give your name, nobody can reply to what you write here. If
                something is worrying you, tell a coach or parent, or use Raise a concern at the
                top of Today.
              </ThemedText>
            </Card>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            You can’t change your answers once they’re sent.
          </ThemedText>
          <ErrorText>{error}</ErrorText>
          <Button
            title={answeringFor ? `Send ${answeringFor.name}’s answers` : 'Send answers'}
            onPress={submit}
            busy={sending}
          />
          {answeringFor ? (
            <Button title="Cancel" variant="secondary" onPress={() => setAnswerFor(null)} />
          ) : null}
        </>
      ) : (
        <>
          {survey.responded ? (
            <Card>
              <ThemedText type="smallBold">✓ Thanks, your answers are in</ThemedText>
              {!survey.my_answers ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Your answers aren’t linked to you, so they can’t be shown here.
                </ThemedText>
              ) : null}
            </Card>
          ) : null}
          {survey.children.map((child) => (
            <Card key={child.name}>
              <ThemedText type="smallBold">{child.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {child.answers.length > 0
                  ? 'Their answers:'
                  : child.responded
                    ? 'Answered without giving their name, so their answers can’t be shown.'
                    : 'Hasn’t answered yet.'}
              </ThemedText>
              {child.answers.length > 0 ? (
                <Questions questions={survey.questions} answers={child.answers} />
              ) : null}
            </Card>
          ))}
          {survey.children.some((c) => c.answers.length > 0) ? null : (
            <Questions questions={survey.questions} answers={survey.my_answers} />
          )}
        </>
      )}

      {groupResults ? <TeamResults survey={survey} results={groupResults} /> : null}

      {survey.can_see_results ? (
        <View style={styles.actions}>
          <Button
            title="See results"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/surveys/results',
                params: { id: survey.id },
              })
            }
          />
          {survey.can_close ? (
            <ConfirmDelete
              title="Close it now"
              warning="Nobody else can answer once it’s closed."
              confirmTitle="Close the survey"
              onConfirm={closeNow}
              busy={closing}
            />
          ) : null}
          {!answering ? <ErrorText>{error}</ErrorText> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function IdentityNotice({ survey }: { survey: SurveyDetail }) {
  const seenBy = surveyAnswersSeenBy(survey);
  const text =
    survey.identity === 'anonymous'
      ? 'This survey is anonymous. Nobody, including whoever sent it, can see who gave which answers.'
      : survey.identity === 'named'
        ? `Your name goes with your answers. Only ${seenBy} see them.`
        : `You choose whether to give your name. Only ${seenBy} see answers.`;
  return (
    <Card>
      <ThemedText type="small">{text}</ThemedText>
      {survey.results_to_group ? (
        <ThemedText type="small" themeColor="textSecondary">
          Everyone it went to sees the totals, never who picked what.
        </ThemedText>
      ) : null}
    </Card>
  );
}

/** The totals whoever sent it shared with the squad or team. No names or written answers. */
function TeamResults({ survey, results }: { survey: SurveyDetail; results: SurveyGroupResults }) {
  return (
    <View style={styles.list}>
      <ThemedText type="smallBold">Results for the team</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {answeredText(results.answered, results.sent_to)}
      </ThemedText>
      {results.wait ? (
        <Card>
          <ThemedText type="small">{surveyWaitText(results.wait, survey)}</ThemedText>
        </Card>
      ) : (
        results.questions.map((q, i) => (
          <Card key={q.id} style={styles.list}>
            <ThemedText type="smallBold">
              {i + 1}. {q.prompt}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {q.answered} answered
              {q.kind === 'rating' && q.average !== null
                ? ` · Average ${q.average} out of ${q.rating_max}`
                : ''}
            </ThemedText>
            <SurveyBars question={q} />
          </Card>
        ))
      )}
    </View>
  );
}

function QuestionInput({
  number,
  question: q,
  value,
  onChange,
}: {
  number: number;
  question: SurveyQuestion;
  value: Draft[string] | undefined;
  onChange: (value: Draft[string]) => void;
}) {
  const label = `${number}. ${q.prompt}${q.required ? '' : ' (optional)'}`;
  if (q.kind === 'text') {
    return (
      <TextField
        label={label}
        value={value?.text ?? ''}
        onChangeText={(text) => onChange({ text })}
        placeholder="Write your answer"
        multiline
        maxLength={2000}
      />
    );
  }
  if (q.kind === 'rating') {
    const max = q.rating_max ?? 5;
    return (
      <View style={styles.field}>
        <ChipGroup
          label={label}
          options={Array.from({ length: max }, (_, i) => ({
            value: String(i + 1),
            label: String(i + 1),
          }))}
          selected={value?.rating ? [String(value.rating)] : []}
          onToggle={(rating) => onChange({ rating: Number(rating) })}
        />
        <ThemedText type="small" themeColor="textSecondary">
          1 is lowest, {max} is highest
        </ThemedText>
      </View>
    );
  }
  const chosen = value?.choices ?? [];
  return (
    <View style={styles.field}>
      <ChipGroup
        label={label}
        options={(q.options ?? []).map((o, i) => ({
          value: String(i),
          label: o,
        }))}
        selected={chosen.map(String)}
        onToggle={(picked) => {
          const n = Number(picked);
          if (q.kind === 'choice') return onChange({ choices: [n] });
          onChange({
            choices: chosen.includes(n) ? chosen.filter((c) => c !== n) : [...chosen, n].sort(),
          });
        }}
      />
      {q.kind === 'multi_choice' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Choose as many as you like
        </ThemedText>
      ) : null}
    </View>
  );
}

/** The questions, read only, with answers when there are some to show. */
function Questions({
  questions,
  answers,
}: {
  questions: SurveyQuestion[];
  answers?: SurveyAnswer[] | null;
}) {
  return (
    <View style={styles.list}>
      {questions.map((q, i) => {
        const answer = answers?.find((a) => a.question_id === q.id);
        return (
          <Card key={q.id}>
            <ThemedText type="smallBold">
              {i + 1}. {q.prompt}
            </ThemedText>
            {answers ? (
              <ThemedText type="small">{answer ? answerText(q, answer) : 'Skipped'}</ThemedText>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {q.kind === 'rating'
                  ? `Rating from 1 to ${q.rating_max}`
                  : q.kind === 'text'
                    ? 'Written answer'
                    : (q.options ?? []).join(' · ')}
              </ThemedText>
            )}
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  field: {
    gap: Spacing.one,
  },
  list: {
    gap: Spacing.two,
  },
  actions: {
    gap: Spacing.three,
  },
});
