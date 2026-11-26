import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLeaveScreen, useListChanged, useScreenParams } from '@/components/list-detail';
import { RaiseConcernLink } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDelete, ErrorText } from '@/components/ui';
import { MessageQuestionCard } from '@/components/message-question';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { blockWarning, canOfferBlock } from '@/lib/chat-blocks';
import { useClub } from '@/lib/club';
import { formatDateTime, formatSentAt } from '@/lib/format';
import {
  audienceLabel,
  guardianCopyLabel,
  MESSAGE_COLUMNS,
  RECIPIENT_COLUMNS,
} from '@/lib/messages';
import { hiddenNote } from '@/lib/inbox';
import { supabase } from '@/lib/supabase';
import type { InboxMessage, Message, MessageReceipt } from '@/lib/types';

export default function MessageScreen() {
  const { id } = useScreenParams<{ id: string }>();
  // Back to the list, which then shows the message where it now belongs.
  const leave = useLeaveScreen('/messages');
  const listChanged = useListChanged();
  const { session } = useAuth();
  const [message, setMessage] = useState<Message | null | undefined>(undefined);
  const [receipts, setReceipts] = useState<MessageReceipt[] | null>(null);
  const [copy, setCopy] = useState<Omit<InboxMessage, 'message'> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);
  const [moving, setMoving] = useState(false);
  // Whether the member blocks this post's author in chat groups, once known.
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const { features } = useClub();
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
    const ownCopy = (own.data as Omit<InboxMessage, 'message'> | null) ?? null;
    setMessage(loaded);
    setCopy(ownCopy);
    if (!loaded) return;
    if (
      features.chatGroups &&
      canOfferBlock({
        isChatPost: loaded.audience === 'chat',
        inMyGroup: !!ownCopy?.chat_group_id,
        senderId: loaded.sender_id,
        myId: session?.user.id,
      })
    ) {
      const { data: isBlocked } = await supabase.rpc('chat_member_blocked', {
        p_profile_id: loaded.sender_id,
      });
      setBlocked(!!isBlocked);
    } else {
      setBlocked(null);
    }
    // Opening a message marks it read. Does nothing for its sender.
    // Beside the list, the list then drops the message's unread dot.
    markedRead.current = supabase
      .rpc('mark_message_read', { p_message_id: id })
      .then(() => listChanged());
    // Read receipts are for the sender only.
    if (loaded.sender_id === session?.user.id) {
      const { data: rows } = await supabase.rpc('message_receipts', { p_message_id: id });
      setReceipts((rows as MessageReceipt[] | null) ?? []);
    }
  }, [id, session, features.chatGroups, listChanged]);

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
    leave();
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
    leave();
  }

  // Blocks or unblocks the post's author in the member's chat groups. Admins
  // and the safeguarding officers are told about a block.
  async function setAuthorBlocked(block: boolean) {
    if (!message?.sender_id) return;
    setBlocking(true);
    setBlockError(null);
    const { error } = block
      ? await supabase.rpc('block_chat_member', { p_message_id: message.id })
      : await supabase.rpc('unblock_chat_member', { p_profile_id: message.sender_id });
    setBlocking(false);
    if (error) {
      setBlockError(error.message);
      return;
    }
    setBlocked(block);
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

      <Card style={message.removed_at ? styles.hidden : undefined}>
        <ThemedText selectable themeColor={message.removed_at ? 'textSecondary' : undefined}>
          {message.body}
        </ThemedText>
        {message.removed_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hiddenNote(message)}
          </ThemedText>
        ) : null}
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
          <Button
            title="Mark as unread"
            variant="secondary"
            busy={markingUnread}
            onPress={markUnread}
          />
        </View>
      ) : null}

      {receipts ? <Receipts receipts={receipts} /> : null}
      {blocked !== null ? (
        <View style={styles.buttons}>
          <ErrorText>{blockError}</ErrorText>
          {blocked ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                You’ve blocked {message.sender_name ?? 'this member'}: their posts don’t show in your
                groups.
              </ThemedText>
              <Button
                title={`Unblock ${message.sender_name ?? 'this member'}`}
                variant="secondary"
                busy={blocking}
                onPress={() => setAuthorBlocked(false)}
              />
            </>
          ) : (
            <ConfirmDelete
              title={`Block ${message.sender_name ?? 'this member'}`}
              warning={blockWarning(message.sender_name ?? 'this member')}
              confirmTitle="Block"
              busy={blocking}
              onConfirm={() => setAuthorBlocked(true)}
            />
          )}
        </View>
      ) : null}
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
  hidden: {
    opacity: 0.6,
    gap: Spacing.one,
  },
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
