import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/check-ins';
import { formatDateString } from '@/lib/injuries';
import { reviewState, type RegisterPolicy } from '@/lib/registers';
import { supabase } from '@/lib/supabase';

const STATE_LABELS = {
  overdue: 'Overdue for review',
  due: 'Review due within 30 days',
  later: 'Next review',
} as const;

/**
 * The policy register: each policy's owner, version, link and review date,
 * soonest review first. Admins add and change policies; the owner (or an
 * admin) records a review.
 */
export default function PoliciesScreen() {
  const { isAdmin, profile } = useAuth();
  const [policies, setPolicies] = useState<RegisterPolicy[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('policy_register_list');
    setPolicies((data as RegisterPolicy[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (policies === null) return <Screen>{null}</Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Each policy has an owner who reviews it. They get a to-do 30 days before its review date.
      </ThemedText>
      {isAdmin ? <Button title="Add a policy" onPress={() => router.push('/registers/policy')} /> : null}

      {policies.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {isAdmin
            ? 'No policies yet. Add the club’s policies, such as its code of conduct, child safeguarding and privacy policies.'
            : 'No policies yet. Admins add them.'}
        </ThemedText>
      ) : null}

      {policies.map((p) => {
        const state = reviewState(p.review_on, today());
        const canReview = isAdmin || (p.owner_id !== null && p.owner_id === profile?.id);
        return (
          <Card key={p.id} style={styles.card}>
            <ThemedText type="smallBold">
              {p.title}
              {p.version ? ` · version ${p.version}` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor={state === 'later' ? 'textSecondary' : undefined}>
              {STATE_LABELS[state]}: {formatDateString(p.review_on)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Owner: {p.owner_name ?? 'nobody yet'}
            </ThemedText>
            {p.last_reviewed_at ? (
              <ThemedText type="small" themeColor="textSecondary">
                Last reviewed {formatDateString(p.last_reviewed_at.slice(0, 10))}
                {p.last_reviewed_by_name ? ` by ${p.last_reviewed_by_name}` : ''}
              </ThemedText>
            ) : null}
            {p.notes ? <ThemedText type="small">{p.notes}</ThemedText> : null}
            <View style={styles.actions}>
              {p.link ? (
                <Button title="Open" variant="secondary" onPress={() => Linking.openURL(p.link!)} />
              ) : null}
              {canReview ? (
                <Button
                  title="Record a review"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/registers/review', params: { id: p.id } })}
                />
              ) : null}
              {isAdmin ? (
                <Button
                  title="Change"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/registers/policy', params: { id: p.id } })}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
});
