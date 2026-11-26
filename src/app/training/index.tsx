import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString } from '@/lib/injuries';
import {
  dueLabel,
  isOutstanding,
  trainingStatusLabels,
  useCanCheckTraining,
  useMyTraining,
  useTrainingToReview,
  type MyTraining,
} from '@/lib/training';

/**
 * The member's integrity training, and their children's, with where each is up
 * to. Committee members and admins also check certificates from here.
 */
export default function TrainingScreen() {
  const { myTraining, reloadMyTraining } = useMyTraining();
  const { toReview, reloadToReview } = useTrainingToReview();
  const canCheck = useCanCheckTraining();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([reloadMyTraining(), reloadToReview()]);
    setRefreshing(false);
  }

  if (myTraining === null) return <Screen>{null}</Screen>;

  // One section per person: the member first, then the athletes they look after.
  const people: { id: string; name: string; isMe: boolean; rows: MyTraining[] }[] = [];
  for (const row of myTraining) {
    let person = people.find((p) => p.id === row.profile_id);
    if (!person) {
      person = { id: row.profile_id, name: row.profile_name ?? 'Athlete', isMe: row.is_me, rows: [] };
      people.push(person);
    }
    person.rows.push(row);
  }
  const toCheck = (toReview ?? []).filter((c) => c.can_review).length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canCheck ? (
        <View style={styles.section}>
          <PressableCard onPress={() => router.push('/training/review')}>
            <ThemedText type="smallBold">Check certificates</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {toCheck === 0
                ? 'Nothing waiting for you'
                : `${toCheck} ${toCheck === 1 ? 'certificate' : 'certificates'} waiting for you`}
            </ThemedText>
          </PressableCard>
          <PressableCard onPress={() => router.push('/training/progress')}>
            <ThemedText type="smallBold">Everyone’s progress</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Who has completed each course and who hasn’t
            </ThemedText>
          </PressableCard>
        </View>
      ) : null}

      {people.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You have no integrity training to complete.
        </ThemedText>
      ) : (
        people.map((person) => {
          const left = person.rows.filter(isOutstanding);
          return (
            <View key={person.id} style={styles.section}>
              <ThemedText type="smallBold">
                {person.isMe ? 'Your training' : `${person.name}’s training`}
              </ThemedText>
              {person.rows.map((row) => (
                <TrainingCard key={row.requirement_id} row={row} />
              ))}
              {left.length > 0 ? (
                <Button
                  title="Add a certificate"
                  onPress={() =>
                    router.push({ pathname: '/training/submit', params: { profile: person.id } })
                  }
                />
              ) : null}
            </View>
          );
        })
      )}

      <ThemedText type="small" themeColor="textSecondary">
        Do each course on the provider’s website, then upload the certificate here. A committee
        member or admin checks it and marks the training complete.
      </ThemedText>
    </Screen>
  );
}

function TrainingCard({ row }: { row: MyTraining }) {
  const theme = useTheme();
  const status =
    trainingStatusLabels[row.status] +
    (row.completed_on && row.status !== 'sent_back'
      ? ` · completed ${formatDateString(row.completed_on)}`
      : '');

  return (
    <Card>
      <ThemedText type="smallBold">{row.name}</ThemedText>
      {row.details ? <ThemedText type="small">{row.details}</ThemedText> : null}
      <ThemedText type="small" themeColor="textSecondary">
        {dueLabel(row.due_on)}
      </ThemedText>
      {row.status === 'approved' ? (
        // Its label carries its own tick.
        <ThemedText type="small">{status}</ThemedText>
      ) : (
        <StatusLine text={status} tone={row.status === 'sent_back' ? 'attention' : 'quiet'} />
      )}
      {row.status === 'sent_back' && row.review_note ? (
        <ThemedText type="small">
          {row.reviewed_by_name ?? 'The committee'}: “{row.review_note}”
        </ThemedText>
      ) : null}
      <View style={styles.links}>
        {row.course_url ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL(row.course_url!)}
            hitSlop={8}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Open the course
            </ThemedText>
          </Pressable>
        ) : null}
        {row.document_path && row.status !== 'sent_back' ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() =>
              router.push({
                pathname: '/training/document',
                params: { path: row.document_path!, name: row.document_name ?? 'Certificate' },
              })
            }>
            <ThemedText type="small" style={{ color: theme.tint }}>
              View certificate
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
});
