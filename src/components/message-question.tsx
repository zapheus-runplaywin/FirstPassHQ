import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SurveyBars } from '@/components/survey-bars';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatSentAt } from '@/lib/format';
import { answerLine, groupAnswers, type MessageQuestion } from '@/lib/message-questions';
import { supabase } from '@/lib/supabase';

/**
 * A message's question: answer buttons for the member (and for each of their
 * children under 18), their answer once given, the totals when they may see
 * them, and names for whoever sent it, its coaches and managers, and admins.
 */
export function MessageQuestionCard({ messageId }: { messageId: string }) {
  const theme = useTheme();
  const [question, setQuestion] = useState<MessageQuestion | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('message_question', { p_message_id: messageId });
    setQuestion((data as MessageQuestion | null) ?? null);
  }, [messageId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function answer(choice: number, childId: string | null) {
    setBusy(childId ?? 'me');
    setError(null);
    const { error: answerError } = await supabase.rpc('answer_message_question', {
      p_message_id: messageId,
      p_answer: choice,
      p_for_child: childId,
    });
    setBusy(null);
    if (answerError) setError(answerError.message);
    await load();
  }

  async function close() {
    setBusy('close');
    setError(null);
    const { error: closeError } = await supabase.rpc('close_message_question', {
      p_message_id: messageId,
    });
    setBusy(null);
    if (closeError) setError(closeError.message);
    await load();
  }

  if (!question) return null;
  const { options } = question;
  const answered = question.totals?.reduce((a, b) => a + b, 0) ?? 0;

  return (
    // A bordered box rather than a Card, so the answer chips (which use the
    // card colour) stand out.
    <View style={[styles.card, { borderColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold">
        {question.closed ? 'Question (closed)' : 'Question'}
      </ThemedText>

      {question.can_answer_myself ? (
        question.my_answer !== null ? (
          <ThemedText type="small">
            Your answer:{' '}
            {answerLine(
              options,
              question.my_answer,
              question.my_answer_by_name,
              question.my_answer_by_parent,
            )}
          </ThemedText>
        ) : question.closed ? (
          <ThemedText type="small" themeColor="textSecondary">
            You didn’t answer before it closed.
          </ThemedText>
        ) : (
          <Choices
            label="Your answer"
            options={options}
            busy={busy === 'me'}
            onChoose={(choice) => answer(choice, null)}
          />
        )
      ) : null}

      {question.children.map((child) =>
        child.answer !== null ? (
          <View key={child.id} style={styles.child}>
            <ThemedText type="small">
              {child.name}:{' '}
              {answerLine(options, child.answer, child.answered_by_name, child.answered_by_parent)}
            </ThemedText>
            {child.answered_at ? (
              <ThemedText type="small" themeColor="textSecondary">
                Answered {formatSentAt(new Date(child.answered_at))}
              </ThemedText>
            ) : null}
          </View>
        ) : question.closed ? (
          <ThemedText key={child.id} type="small" themeColor="textSecondary">
            {child.name} didn’t answer before it closed.
          </ThemedText>
        ) : (
          <Choices
            key={child.id}
            label={`Answer for ${child.name}`}
            options={options}
            busy={busy === child.id}
            onChoose={(choice) => answer(choice, child.id)}
          />
        ),
      )}

      {question.totals ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            {question.answers ? `${answered} answered` : 'Totals for everyone it went to'}
          </ThemedText>
          <SurveyBars
            question={{ kind: 'choice', options, rating_max: null, counts: question.totals, answered }}
          />
        </View>
      ) : null}

      {question.answers ? <Names question={question} /> : null}

      <ThemedText type="small" themeColor="textSecondary">
        One answer each, which can’t be changed. Parents and guardians can answer for their child.
        Only whoever sent it, the squad or team’s coaches and managers, and admins see names.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      {question.can_close ? (
        <Button title="Close question" variant="secondary" busy={busy === 'close'} onPress={close} />
      ) : null}
    </View>
  );
}

function Choices({
  label,
  options,
  busy,
  onChoose,
}: {
  label: string;
  options: string[];
  busy: boolean;
  onChoose: (choice: number) => void;
}) {
  return (
    <ChipGroup
      label={busy ? `${label} (saving…)` : label}
      options={options.map((o, i) => ({ value: String(i), label: o }))}
      selected={[]}
      onToggle={(value) => {
        if (!busy) onChoose(Number(value));
      }}
    />
  );
}

function Names({ question }: { question: MessageQuestion }) {
  return (
    <View style={styles.section}>
      {groupAnswers(question).map((group) => (
        <View key={group.index} style={styles.group}>
          <ThemedText type="smallBold">
            {group.option} ({group.people.length}){group.followUp ? ': follow up' : ''}
          </ThemedText>
          {group.people.map((person) => (
            <ThemedText key={person.profile_id} type="small">
              {person.name}
              {person.answered_by_parent && person.answered_by_name
                ? ` (answered by ${person.answered_by_name})`
                : ''}
            </ThemedText>
          ))}
        </View>
      ))}
      {question.not_answered?.length ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Not answered yet ({question.not_answered.length})</ThemedText>
          {question.not_answered.map((name, i) => (
            <ThemedText key={`${name}-${i}`} type="small" themeColor="textSecondary">
              {name}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  section: {
    gap: Spacing.two,
  },
  group: {
    gap: Spacing.half,
  },
  child: {
    gap: Spacing.half,
  },
});
