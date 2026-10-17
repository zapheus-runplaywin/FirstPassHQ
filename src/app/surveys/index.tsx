import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  closingDay,
  openingDay,
  identityLabels,
  surveyAudienceLabel,
  useCanManageSurveys,
  useCanSendSurveys,
  useMySurveys,
  type ManagedSurvey,
  type MySurvey,
} from '@/lib/surveys';

type Tab = 'mine' | 'all';

export default function SurveysScreen() {
  const canManage = useCanManageSurveys();
  // Coaches, managers and captains send surveys to their own groups and see
  // only those, and captains' polls in groups they coach or manage.
  const canSend = useCanSendSurveys();
  const { mySurveys, reloadMySurveys } = useMySurveys();
  const [managed, setManaged] = useState<ManagedSurvey[] | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [refreshing, setRefreshing] = useState(false);
  // Committee members and admins rarely get surveys themselves, so they start on the club's.
  const shown: Tab = canSend && mySurveys.length === 0 && tab === 'mine' ? 'all' : tab;

  const loadManaged = useCallback(async () => {
    if (!canSend) return;
    const { data } = await supabase.rpc('manage_surveys');
    setManaged((data as ManagedSurvey[] | null) ?? []);
  }, [canSend]);

  useFocusEffect(
    useCallback(() => {
      loadManaged();
    }, [loadManaged]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([reloadMySurveys(), loadManaged()]);
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canSend ? (
        <View style={styles.actions}>
          <Button title="New survey" onPress={() => router.push('/surveys/new')} />
          <ChipGroup
            options={[
              { value: 'mine', label: 'Sent to me' },
              { value: 'all', label: canManage ? 'Club surveys' : 'My groups' },
            ]}
            selected={[shown]}
            onToggle={setTab}
          />
        </View>
      ) : null}

      {shown === 'mine' ? <MyList surveys={mySurveys} /> : <ManagedList surveys={managed} />}
    </Screen>
  );
}

function MyList({ surveys }: { surveys: MySurvey[] }) {
  if (surveys.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No surveys yet. Surveys and polls sent to you will show here.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {surveys.map((s) => (
        <PressableCard
          key={s.id}
          onPress={() => router.push({ pathname: '/surveys/[id]', params: { id: s.id } })}>
          <ThemedText type="smallBold">{s.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {identityLabels[s.identity]} · {statusLabel(s.is_open, s.closes_at)}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor={s.responded || !s.is_open ? 'textSecondary' : 'accent'}>
            {s.from_child
              ? `Sent by ${s.for_child_names?.join(' and ')}`
              : s.for_child_names
                ? `For ${s.for_child_names.join(' and ')} to answer`
                : s.responded
                  ? '✓ You’ve answered'
                  : s.is_open
                    ? 'Not answered yet'
                    : 'You didn’t answer'}
          </ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

function ManagedList({ surveys }: { surveys: ManagedSurvey[] | null }) {
  if (surveys === null) return null;
  if (surveys.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No surveys yet. Tap New survey to send the first one.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {surveys.map((s) => {
        return (
          <PressableCard
            key={s.id}
            onPress={() => router.push({ pathname: '/surveys/[id]', params: { id: s.id } })}>
            <ThemedText type="smallBold">{s.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {identityLabels[s.identity]} · To{' '}
              {surveyAudienceLabel(s.audience, s.audience_role, s.audience_label)}
              {s.sent_as === 'committee' ? '' : ` · From ${s.created_by_name ?? 'a member'}`}
              {s.share_with_committee ? ' · Shared with the committee' : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {s.status === 'scheduled'
                ? `Opens ${formatDateString(openingDay(s.opens_at))}`
                : statusLabel(s.status === 'open', s.closes_at)}{' '}
              · {s.answered} of {s.sent_to} answered
            </ThemedText>
          </PressableCard>
        );
      })}
    </View>
  );
}

function statusLabel(open: boolean, closesAt: string) {
  const day = formatDateString(closingDay(closesAt));
  return open ? `Open until ${day}` : `Closed ${day}`;
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
});
