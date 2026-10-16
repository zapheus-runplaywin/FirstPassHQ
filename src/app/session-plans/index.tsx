import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatDateString } from '@/lib/injuries';
import {
  formatTimes,
  type SessionPlanRow,
  useSessionPlanSummary,
} from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';

type Tab = 'mine' | 'shared';

/**
 * Session plans: the coach's own plans, and plans other coaches have shared
 * with them. Athletes and parents only have the shared list.
 */
export default function SessionPlansScreen() {
  const { session } = useAuth();
  const { canAdd, newShared, reloadSummary } = useSessionPlanSummary();
  const [tab, setTab] = useState<Tab | null>(null);
  const [mine, setMine] = useState<SessionPlanRow[] | null>(null);
  const [shared, setShared] = useState<SessionPlanRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const [own, others] = await Promise.all([
      supabase
        .from('session_plans')
        .select(
          'id, team_id, team_name, title, session_on, starts_at, ends_at, author_name, author_position, session_plan_files (count)',
        )
        .eq('author_id', userId)
        .order('session_on', { ascending: false })
        .order('starts_at', { ascending: false, nullsFirst: false })
        .limit(500),
      supabase.rpc('shared_session_plans'),
    ]);
    setMine(
      (
        (own.data as (SessionPlanRow & { session_plan_files: { count: number }[] })[] | null) ??
        []
      ).map(({ session_plan_files, ...row }) => ({
        ...row,
        file_count: session_plan_files[0]?.count ?? 0,
      })),
    );
    setShared((others.data as SessionPlanRow[] | null) ?? []);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), reloadSummary()]);
    setRefreshing(false);
  }

  // Coaches start on their own plans; everyone else only has shared plans.
  const showTabs = canAdd || (mine?.length ?? 0) > 0;
  const current: Tab = showTabs ? (tab ?? 'mine') : 'shared';
  const rows = current === 'mine' ? mine : shared;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canAdd ? (
        <Button title="Add a session plan" onPress={() => router.push('/session-plans/edit')} />
      ) : null}

      {showTabs ? (
        <ChipGroup
          options={[
            { value: 'mine' as Tab, label: 'My plans' },
            {
              value: 'shared' as Tab,
              label: newShared > 0 ? `Shared with me (${newShared} new)` : 'Shared with me',
            },
          ]}
          selected={[current]}
          onToggle={setTab}
        />
      ) : null}

      {rows === null ? null : rows.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {current === 'mine'
            ? 'You haven’t added any session plans yet. Add one before or after a session.'
            : 'No session plans have been shared with you yet.'}
        </ThemedText>
      ) : (
        rows.map((plan) => <PlanCard key={plan.id} plan={plan} showAuthor={current === 'shared'} />)
      )}
    </Screen>
  );
}

function PlanCard({ plan, showAuthor }: { plan: SessionPlanRow; showAuthor: boolean }) {
  const theme = useTheme();
  const times = formatTimes(plan.starts_at, plan.ends_at);
  const byLine = [
    showAuthor ? `${plan.author_name}, ${plan.author_position.toLowerCase()}` : '',
    plan.file_count > 0 ? `${plan.file_count} ${plan.file_count === 1 ? 'file' : 'files'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <PressableCard
      onPress={() => router.push({ pathname: '/session-plans/[id]', params: { id: plan.id } })}>
      <View style={styles.titleRow}>
        <ThemedText type="smallBold" style={styles.grow} numberOfLines={2}>
          {plan.title}
        </ThemedText>
        {plan.is_new ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
              New
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDateString(plan.session_on)}
        {times ? ` · ${times}` : ''} · {plan.team_name}
      </ThemedText>
      {byLine ? (
        <ThemedText type="small" themeColor="textSecondary">
          {byLine}
        </ThemedText>
      ) : null}
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
  },
});
