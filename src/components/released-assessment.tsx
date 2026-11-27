import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { releasedHeading, roundTitle, type ReleasedAssessment } from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';

/**
 * An assessment the head coach released, as the athlete and their verified
 * parents read it, and as the head coach previews it. Only what the database
 * (or the preview, by the same rules) put in it. Nothing here can be pressed
 * except folding a group of criteria: no reply, reaction or acknowledgement.
 */
export function ReleasedAssessmentView({ assessment }: { assessment: ReleasedAssessment }) {
  const [open, setOpen] = useState<number | null>(0);
  const parts: [string, string | null][] = [
    ['Strengths', assessment.strengths],
    ['Development priorities', assessment.priorities],
    ['Recommendation', assessment.recommendation],
    ['Comments', assessment.comments],
  ];
  return (
    <View style={styles.view}>
      <ThemedText type="subtitle">{releasedHeading(assessment)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {[roundTitle(assessment), assessment.criteria_set_name]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        From {assessment.from_name}, {formatDateString(assessment.released_on)}
      </ThemedText>
      {parts
        .filter(([, text]) => text)
        .map(([title, text]) => (
          <Card key={title} style={styles.card}>
            <ThemedText type="smallBold">{title}</ThemedText>
            <ThemedText type="small">{text}</ThemedText>
          </Card>
        ))}
      {assessment.groups.map((group, n) => (
        <Card key={group.name} style={styles.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open === n }}
            onPress={() => setOpen(open === n ? null : n)}>
            <ThemedText type="smallBold">
              {group.name} · {group.items.length}
            </ThemedText>
          </Pressable>
          {open === n ? (
            <>
              {group.items.map((item) => (
                <ThemedText key={item.name} type="small">
                  {item.name}: {item.step}
                </ThemedText>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Seen as: {group.scale.join(', ')}
              </ThemedText>
            </>
          ) : null}
        </Card>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        This is the head coach’s summary at the end of the round. There is no score or ranking.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        You can’t reply here. Talk to your coach if you have a question.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  view: { gap: Spacing.two },
  card: { gap: Spacing.one },
});
