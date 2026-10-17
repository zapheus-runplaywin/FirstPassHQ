import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatSentAt } from '@/lib/format';
import {
  audienceLabel,
  guardianCopyLabel,
  MESSAGE_COLUMNS,
  RECIPIENT_COLUMNS,
  useCanSendMessages,
} from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { InboxMessage, SentMessage } from '@/lib/types';

type Box = 'inbox' | 'sent';

export default function MessagesScreen() {
  const { session } = useAuth();
  const canSend = useCanSendMessages();
  const [box, setBox] = useState<Box>('inbox');
  const [inbox, setInbox] = useState<InboxMessage[] | null>(null);
  const [sent, setSent] = useState<SentMessage[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const [inboxResult, sentResult] = await Promise.all([
      supabase
        .from('message_recipients')
        .select(`${RECIPIENT_COLUMNS}, message:messages (${MESSAGE_COLUMNS})`)
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(100),
      canSend ? supabase.rpc('my_sent_messages') : Promise.resolve({ data: [] }),
    ]);
    setInbox((inboxResult.data as unknown as InboxMessage[] | null) ?? []);
    setSent((sentResult.data as SentMessage[] | null) ?? []);
  }, [userId, canSend]);

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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {canSend ? (
        <View style={styles.actions}>
          <Button title="New message" onPress={() => router.push('/messages/new')} />
          <ChipGroup
            options={[
              { value: 'inbox', label: 'Inbox' },
              { value: 'sent', label: 'Sent' },
            ]}
            selected={[box]}
            onToggle={setBox}
          />
        </View>
      ) : null}

      {box === 'inbox' ? <Inbox messages={inbox} /> : <Sent messages={sent} />}
    </Screen>
  );
}

function Inbox({ messages }: { messages: InboxMessage[] | null }) {
  const theme = useTheme();
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No messages yet. Messages from your coaches, managers, captains and the club will show here.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {messages.map(({ message, read_at, for_children, for_child_names }) => (
        <PressableCard key={message.id} onPress={() => openMessage(message.id)}>
          <View style={styles.row}>
            {read_at ? null : (
              <View
                style={[styles.unreadDot, { backgroundColor: theme.accent }]}
                accessibilityLabel="Unread"
              />
            )}
            <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
              {message.sender_name ?? 'Club'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSentAt(new Date(message.created_at))}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            To {audienceLabel(message.audience, message.audience_role, message.audience_label)}
          </ThemedText>
          <GuardianCopy
            label={guardianCopyLabel(message.sender_id, for_children, for_child_names)}
          />
          <ThemedText type="small" numberOfLines={2}>
            {message.body}
          </ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

function GuardianCopy({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
      {label}
    </ThemedText>
  );
}

function Sent({ messages }: { messages: SentMessage[] | null }) {
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        You haven’t sent any messages yet.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      {messages.map((message) => (
        <PressableCard key={message.id} onPress={() => openMessage(message.id)}>
          <View style={styles.row}>
            <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
              {audienceLabel(message.audience, message.audience_role, message.audience_label)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSentAt(new Date(message.created_at))}
            </ThemedText>
          </View>
          <ThemedText type="small" numberOfLines={2}>
            {message.body}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Read by {message.read_count} of {message.recipient_count}
          </ThemedText>
        </PressableCard>
      ))}
    </View>
  );
}

function openMessage(id: string) {
  router.push({ pathname: '/messages/[id]', params: { id } });
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
