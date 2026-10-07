import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatSentAt } from '@/lib/format';
import { audienceLabel, MESSAGE_COLUMNS } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { Message, MessageReceipt } from '@/lib/types';

export default function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, isAdmin } = useAuth();
  const [message, setMessage] = useState<Message | null | undefined>(undefined);
  const [receipts, setReceipts] = useState<MessageReceipt[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    const loaded = (data as Message | null) ?? null;
    setMessage(loaded);
    if (!loaded) return;
    // Opening a message marks it read. Does nothing for its sender.
    supabase.rpc('mark_message_read', { p_message_id: id }).then(() => {});
    if (loaded.sender_id === session?.user.id || isAdmin) {
      const { data: rows } = await supabase.rpc('message_receipts', { p_message_id: id });
      setReceipts((rows as MessageReceipt[] | null) ?? []);
    }
  }, [id, session, isAdmin]);

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

  if (message === undefined) return null;
  if (message === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This message isn’t available.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{message.sender_name ?? 'Club'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          To {audienceLabel(message.audience, message.audience_role, message.audience_label)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateTime(new Date(message.created_at))}
        </ThemedText>
      </View>

      <Card>
        <ThemedText selectable>{message.body}</ThemedText>
      </Card>

      {receipts ? <Receipts receipts={receipts} /> : null}
    </Screen>
  );
}

function Receipts({ receipts }: { receipts: MessageReceipt[] }) {
  const theme = useTheme();
  const readCount = receipts.filter((r) => r.read_at).length;
  return (
    <View style={styles.receipts}>
      <ThemedText type="smallBold">
        Read by {readCount} of {receipts.length}
      </ThemedText>
      {receipts.map((receipt) => (
        <View key={receipt.profile_id} style={styles.receipt}>
          <ThemedText type="small" style={styles.grow} numberOfLines={1}>
            {receipt.full_name ?? 'Unnamed member'}
          </ThemedText>
          {receipt.read_at ? (
            <ThemedText type="small" style={{ color: theme.tint }}>
              ✓ Read {formatSentAt(new Date(receipt.read_at))}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Not read yet
            </ThemedText>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  receipts: {
    gap: Spacing.two,
  },
  receipt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  grow: {
    flex: 1,
  },
});
