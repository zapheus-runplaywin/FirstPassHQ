import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { RaiseConcernLink } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { MessageQuestionCard } from '@/components/message-question';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatSentAt } from '@/lib/format';
import {
  audienceLabel,
  guardianCopyLabel,
  MESSAGE_COLUMNS,
  RECIPIENT_COLUMNS,
} from '@/lib/messages';
import { shownBody } from '@/lib/inbox';
import { supabase } from '@/lib/supabase';
import type { InboxMessage, Message, MessageReceipt } from '@/lib/types';

export default function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [message, setMessage] = useState<Message | null | undefined>(undefined);
  const [receipts, setReceipts] = useState<MessageReceipt[] | null>(null);
  const [copy, setCopy] = useState<Omit<InboxMessage, 'message'> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [moving, setMoving] = useState(false);
  // The "opened" mark, so "Mark as unread" can't land before it.
  const markedRead = useRef<PromiseLike<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    const [{ data }, own] = await Promise.all([
      supabase.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle(),
      supabase
        .from('message_recipients')
        .select(RECIPIENT_COLUMNS)
        .eq('message_id', id)
        .eq('profile_id', session?.user.id ?? '')
        .maybeSingle(),
    ]);
    const loaded = (data as Message | null) ?? null;
    setMessage(loaded);
    setCopy((own.data as Omit<InboxMessage, 'message'> | null) ?? null);
    if (!loaded) return;
    // Opening a message marks it read. Does nothing for its sender.
    markedRead.current = supabase.rpc('mark_message_read', { p_message_id: id }).then(() => {});
    // Read receipts are for the sender only.
    if (loaded.sender_id === session?.user.id) {
      const { data: rows } = await supabase.rpc('message_receipts', { p_message_id: id });
      setReceipts((rows as MessageReceipt[] | null) ?? []);
    }
  }, [id, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Puts the message back as unread in the member's own inbox, for later. The
  // sender's receipt still shows it was read.
  async function markUnread() {
    setMarkingUnread(true);
    await markedRead.current;
    await supabase.rpc('mark_message_unread', { p_message_id: id });
    setMarkingUnread(false);
    if (router.canGoBack()) router.back();
    else router.replace('/messages');
  }

  // Archives the member's own copy, or moves it back to the inbox. Nothing is
  // deleted, and nobody else's copy changes.
  async function toggleArchived() {
    if (!copy) return;
    setMoving(true);
    await markedRead.current;
    await supabase.rpc(copy.archived_at ? 'move_message_to_inbox' : 'archive_message', {
      p_message_id: id,
    });
    setMoving(false);
    if (router.canGoBack()) router.back();
    else router.replace('/messages');
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (message === undefined) return null;
  const copyLabel = copy
    ? guardianCopyLabel(message?.sender_id ?? null, copy.for_children, copy.for_child_names)
    : null;
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
        {copyLabel ? (
          <ThemedText type="small" themeColor="textSecondary">
            {copyLabel}
          </ThemedText>
        ) : null}
      </View>

      <Card>
        <ThemedText selectable themeColor={message.removed_at ? 'textSecondary' : undefined}>
          {shownBody(message)}
        </ThemedText>
      </Card>

      {message.answer_options ? <MessageQuestionCard messageId={message.id} /> : null}

      {/* A post in one of the member's chat groups is read in its group. */}
      {copy && !copy.chat_group_id ? (
        <View style={styles.buttons}>
          <Button
            title={copy.archived_at ? 'Move to inbox' : 'Archive'}
            variant="secondary"
            busy={moving}
            onPress={toggleArchived}
          />
          <Button title="Mark as unread" variant="secondary" busy={markingUnread} onPress={markUnread} />
        </View>
      ) : null}

      {receipts ? <Receipts receipts={receipts} /> : null}
      <RaiseConcernLink
        context={`Message from ${message.sender_name ?? 'the club'}, ${formatDateTime(new Date(message.created_at))}`}
        label="Report this message"
        messageId={message.id}
      />
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
  buttons: {
    gap: Spacing.two,
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
