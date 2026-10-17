import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  answerText,
  childCopyLabel,
  closingDay,
  identityLabels,
  openingDay,
  surveyAudienceLabel,
  type SurveyAnswer,
  type SurveyDetail,
  type SurveyQuestion,
} from '@/lib/surveys';

type Draft = Record<string, { choices?: number[]; rating?: number; text?: string }>;

export default function SurveyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [giveName, setGiveName] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minor = !!profile && isMinor(profile.date_of_birth, profile.under_17);

  const load = useCallback(async () => {
    const { data, error: fetchError } = await supabase.rpc('survey_detail', { p_survey_id: id });
    if (fetchError) setLoadError(fetchError.message);
    else setSurvey(data as SurveyDetail);
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

  async function submit() {
    if (!survey) return;
    for (const q of survey.questions) {
      const a = draft[q.id];
      const answered = !!a && (!!a.choices?.length || !!a.rating || !!a.text?.trim());
      if (q.required && !answered) return setError(`Answer “${q.prompt}”.`);
    }
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.rpc('submit_survey_response', {
      p_survey_id: survey.id,
      p_answers: Object.entries(draft).map(([questionId, a]) => ({
        question_id: questionId,
        choices: a.choices ?? null,
        rating: a.rating ?? null,
        text: a.text ?? null,
      })),
      p_give_name: survey.identity === 'optional' && giveName,
    });
    setSending(false);
    if (sendError) return setError(sendError.message);
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

      {survey.for_child_names ? (
        <Card>
          <ThemedText type="small">{childCopyLabel(survey.for_child_names)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {survey.identity === 'anonymous'
              ? 'Answers are anonymous, so nobody can see your child’s answers, including you.'
              : 'You can read your child’s answers here once they’ve answered.'}
          </ThemedText>
        </Card>
      ) : survey.can_answer ? (
        <IdentityNotice survey={survey} />
      ) : null}

      {survey.can_answer ? (
        <>
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
              label="Your name"
              options={[
                { value: 'no', label: 'Don’t give my name' },
                { value: 'yes', label: 'Give my name' },
              ]}
              selected={[giveName ? 'yes' : 'no']}
              onToggle={(value) => setGiveName(value === 'yes')}
            />
          ) : null}
          {minor && survey.identity !== 'named' && hasText ? (
            <Card>
              <ThemedText type="small">
                Because you might not give your name, nobody can reply to what you write here. If
                something is worrying you, tell a coach or parent, or use Raise a concern on the
                home screen.
              </ThemedText>
            </Card>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            You can’t change your answers once they’re sent.
          </ThemedText>
          <ErrorText>{error}</ErrorText>
          <Button title="Send answers" onPress={submit} busy={sending} />
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

      {survey.can_see_results ? (
        <View style={styles.actions}>
          <Button
            title="See results"
            variant="secondary"
            onPress={() => router.push({ pathname: '/surveys/results', params: { id: survey.id } })}
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
          {!survey.can_answer ? <ErrorText>{error}</ErrorText> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function IdentityNotice({ survey }: { survey: SurveyDetail }) {
  const text =
    survey.identity === 'anonymous'
      ? 'This survey is anonymous. Nobody, including the committee and admins, can see who gave which answers.'
      : survey.identity === 'named'
        ? 'Your name goes with your answers. Only whoever sent it, the committee and admins see them.'
        : 'You choose whether to give your name. Only whoever sent it, the committee and admins see answers.';
  return (
    <Card>
      <ThemedText type="small">{text}</ThemedText>
    </Card>
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
          options={Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
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
        options={(q.options ?? []).map((o, i) => ({ value: String(i), label: o }))}
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
