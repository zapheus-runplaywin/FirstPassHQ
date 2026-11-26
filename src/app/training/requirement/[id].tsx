import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString, shareCsv, toCsv } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  REQUIREMENT_COLUMNS,
  trainingStatusLabels,
  type TrainingMember,
  type TrainingRequirement,
  type TrainingStatus,
} from '@/lib/training';
import { useAuth } from '@/lib/auth';

type Filter = 'all' | 'outstanding' | 'submitted' | 'approved';

const filterOptions: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'outstanding', label: 'Still to do' },
  { value: 'submitted', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
];

function matches(filter: Filter, status: TrainingStatus) {
  if (filter === 'all') return true;
  if (filter === 'outstanding') return status === 'to_do' || status === 'sent_back';
  return status === filter;
}

/** Everyone who must complete a piece of training, and where they are up to. */
export default function TrainingRequirementScreen() {
  const theme = useTheme();
  const { isAdmin } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [requirement, setRequirement] = useState<TrainingRequirement | null>(null);
  const [members, setMembers] = useState<TrainingMember[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data }, list] = await Promise.all([
      supabase.from('training_requirements').select(REQUIREMENT_COLUMNS).eq('id', id).single(),
      supabase.rpc('training_requirement_members', { p_requirement_id: id }),
    ]);
    setRequirement((data as TrainingRequirement | null) ?? null);
    setMembers((list.data as TrainingMember[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function exportCsv() {
    if (!requirement || !members) return;
    setError(null);
    try {
      await shareCsv(
        `${requirement.name.replace(/[^\w\- ]+/g, '')} ${requirement.season}.csv`,
        toCsv([
          ['Name', 'Status', 'Completed on', 'Checked by', 'Checked on'],
          ...members.map((m) => [
            m.full_name,
            trainingStatusLabels[m.status].replace('✓ ', ''),
            m.completed_on,
            m.reviewed_by_name,
            m.reviewed_at?.slice(0, 10) ?? null,
          ]),
        ]),
      );
    } catch {
      setError('The list couldn’t be exported. Try again.');
    }
  }

  if (!requirement || !members) return <Screen>{null}</Screen>;
  const shown = members.filter((m) => matches(filter, m.status));
  const done = members.filter((m) => m.status === 'approved').length;

  return (
    <Screen>
      <Stack.Screen options={{ title: requirement.name }} />
      <Card>
        <ThemedText type="smallBold">{requirement.name}</ThemedText>
        {requirement.details ? <ThemedText type="small">{requirement.details}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary">
          Due {formatDateString(requirement.due_on)} · {done} of {members.length} approved
        </ThemedText>
        <View style={styles.links}>
          {isAdmin ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                router.push({ pathname: '/admin/training/edit', params: { id: requirement.id } })
              }>
              <ThemedText type="small" style={{ color: theme.tint }}>
                Change
              </ThemedText>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={exportCsv}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Export CSV
            </ThemedText>
          </Pressable>
        </View>
        <ErrorText>{error}</ErrorText>
      </Card>

      <ChipGroup options={filterOptions} selected={[filter]} onToggle={setFilter} />

      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody here.
        </ThemedText>
      ) : (
        <Card style={styles.list}>
          {shown.map((m, index) => (
            <View
              key={m.profile_id}
              style={[
                styles.row,
                index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
              ]}>
              <View style={styles.flex}>
                <ThemedText type="small">{m.full_name ?? 'Member'}</ThemedText>
                {m.status === 'sent_back' && m.review_note ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Sent back: {m.review_note}
                  </ThemedText>
                ) : m.completed_on ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Completed {formatDateString(m.completed_on)}
                  </ThemedText>
                ) : null}
              </View>
              {m.document_path && m.status !== 'sent_back' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${m.full_name ?? 'Member'}’s certificate`}
                  hitSlop={8}
                  onPress={() =>
                    router.push({
                      pathname: '/training/document',
                      params: { path: m.document_path!, name: m.document_name ?? 'Certificate' },
                    })
                  }>
                  <ThemedText type="small">📎</ThemedText>
                </Pressable>
              ) : null}
              <ThemedText
                type="small"
                themeColor={m.status === 'approved' ? 'text' : 'textSecondary'}>
                {m.status === 'submitted' ? 'Waiting' : trainingStatusLabels[m.status]}
              </ThemedText>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  list: {
    padding: 0,
    gap: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  flex: {
    flex: 1,
  },
});
