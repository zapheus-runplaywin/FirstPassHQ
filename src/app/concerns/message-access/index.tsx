import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateString } from '@/lib/injuries';
import {
  type MessageAccessRequest,
  requestedPostLabel,
  requestStatusLine,
  splitRequests,
} from '@/lib/message-access';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

/**
 * Every request to read a member's messages that the signed-in member can
 * see: their own, and for admins and the safeguarding officers every request
 * that isn't about them. Kept for good, so a later audit can follow each one.
 */
export default function MessageAccessScreen() {
  const [requests, setRequests] = useState<MessageAccessRequest[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('message_access_requests');
    setRequests((data as MessageAccessRequest[] | null) ?? []);
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

  if (requests === null) return <Screen>{null}</Screen>;
  const { waiting, answered } = splitRequests(requests);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        The Child Safety Officer and the Complaints Manager ask here to read a member’s messages for
        a concern. An admin who isn’t involved approves or refuses each one, and nobody sees a
        request about themselves. Requests and who read what are kept for good.
      </ThemedText>
      <Section title="Waiting for an answer" requests={waiting} empty="Nothing waiting." />
      <Section title="Answered" requests={answered} empty="None answered yet." />
    </Screen>
  );
}

function Section({
  title,
  requests,
  empty,
}: {
  title: string;
  requests: MessageAccessRequest[];
  empty: string;
}) {
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {requests.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        requests.map((r) => (
          <PressableCard
            key={r.id}
            onPress={() =>
              router.push({
                pathname: '/concerns/message-access/[id]',
                params: { id: r.id },
              })
            }>
            <ThemedText type="smallBold">
              {r.reference} · concern {r.concern_reference}
            </ThemedText>
            <ThemedText type="small">
              {r.subject_name}’s messages, {formatDateString(r.from_date)} to{' '}
              {formatDateString(r.to_date)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Asked by {r.requested_by_name} ({requestedPostLabel(r)}){' '}
              {localDay(r.created_at)}
            </ThemedText>
            <ThemedText type="small" themeColor={r.can_decide ? 'tint' : 'textSecondary'}>
              {r.can_decide ? 'For you to answer' : requestStatusLine(r)}
            </ThemedText>
          </PressableCard>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
