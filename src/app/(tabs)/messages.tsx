import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormSection } from '@/components/form-section';
import { TabHeader } from '@/components/home/tab-header';
import { Screen } from '@/components/screen';
import { SwipeRow } from '@/components/swipe-row';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  type ChatGroup,
  groupsUnread,
  lastPostLine,
  splitHidden,
  useChatGroupsOn,
} from '@/lib/chat-groups';
import { formatSentAt } from '@/lib/format';
import { questionTag } from '@/lib/message-questions';
import {
  audienceLabel,
  guardianCopyLabel,
  MESSAGE_COLUMNS,
  RECIPIENT_COLUMNS,
  useCanSendMessages,
} from '@/lib/messages';
import {
  archivedCopy,
  isArchived,
  isUnread,
  markedAllRead,
  type MessageBox,
  messageBoxes,
  moveBetween,
  movedToInbox,
} from '@/lib/inbox';
import { supabase } from '@/lib/supabase';
import { hasRole } from '@/lib/roles';
import type { InboxMessage, SentMessage } from '@/lib/types';

export default function MessagesScreen() {
  const { session, profile } = useAuth();
  // Admins set up groups from the Club tab (Club setup); the Groups tab offers it too.
  const isAdmin = !!profile && hasRole(profile, 'admin');
  const canSend = useCanSendMessages();
  const groupsOn = useChatGroupsOn();
  const theme = useTheme();
  const [box, setBox] = useState<MessageBox>('inbox');
  const [groups, setGroups] = useState<ChatGroup[] | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[] | null>(null);
  const [archived, setArchived] = useState<InboxMessage[] | null>(null);
  const [sent, setSent] = useState<SentMessage[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The message just archived, so it can be put back straight away.
  const [justArchived, setJustArchived] = useState<string | null>(null);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    // Posts in the member's own chat groups show in Groups, not here. A
    // parent's copy of a post to their child does show here.
    const copies = () =>
      supabase
        .from('message_recipients')
        .select(`${RECIPIENT_COLUMNS}, message:messages (${MESSAGE_COLUMNS})`)
        .eq('profile_id', userId)
        .is('chat_group_id', null);
    const [inboxResult, archivedResult, sentResult, groupsResult] = await Promise.all([
      copies().is('archived_at', null).order('created_at', { ascending: false }).limit(100),
      copies().not('archived_at', 'is', null).order('created_at', { ascending: false }).limit(100),
      canSend ? supabase.rpc('my_sent_messages') : Promise.resolve({ data: [] }),
      groupsOn ? supabase.rpc('my_chat_groups') : Promise.resolve({ data: [] }),
    ]);
    // A message the member can no longer read (for example a club message to a
    // physio after the club setting was turned off) comes back without its body.
    const readable = (data: unknown) =>
      ((data as InboxMessage[] | null) ?? []).filter((r) => r.message);
    setInbox(readable(inboxResult.data).filter((r) => !isArchived(r)));
    setArchived(readable(archivedResult.data).filter(isArchived));
    setSent((sentResult.data as SentMessage[] | null) ?? []);
    setGroups((groupsResult.data as ChatGroup[] | null) ?? []);
  }, [userId, canSend, groupsOn]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Clears the unread dots in the member's own inbox. Senders' read receipts
  // don't change: these messages weren't opened.
  async function markAllRead() {
    setInbox((rows) => (rows ? markedAllRead(rows) : rows));
    await supabase.rpc('mark_all_messages_read');
    await load();
  }

  // Moves the member's own copy to Archived. Nothing is deleted, and nobody
  // else's copy changes.
  async function archive(messageId: string) {
    if (!inbox || !archived) return;
    const moved = moveBetween(inbox, archived, messageId, (c) => archivedCopy(c));
    setInbox(moved.from);
    setArchived(moved.to);
    setJustArchived(messageId);
    await supabase.rpc('archive_message', { p_message_id: messageId });
  }

  async function moveToInbox(messageId: string) {
    if (!inbox || !archived) return;
    const moved = moveBetween(archived, inbox, messageId, movedToInbox);
    setArchived(moved.from);
    setInbox(moved.to);
    setJustArchived(null);
    await supabase.rpc('move_message_to_inbox', { p_message_id: messageId });
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen
      tab
      header={<TabHeader title="Messages" />}
      refreshing={refreshing}
      onRefresh={onRefresh}>
      <View style={styles.actions}>
        {canSend ? (
          <Button title="New message" onPress={() => router.push('/messages/new')} />
        ) : null}
        <ChipGroup
          oneLine
          options={messageBoxes(canSend, groupsOn, groupsUnread(groups ?? []))}
          selected={[box]}
          onToggle={(next) => {
            setBox(next);
            setJustArchived(null);
          }}
        />
      </View>

      {justArchived && box === 'inbox' ? (
        <View style={[styles.undo, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" style={styles.grow}>
            Moved to Archived
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => moveToInbox(justArchived)}
            hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Undo
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {box === 'inbox' ? (
        <Inbox messages={inbox} onMarkAllRead={markAllRead} onArchive={archive} />
      ) : box === 'archived' ? (
        <Archived messages={archived} onMoveToInbox={moveToInbox} />
      ) : box === 'groups' && groupsOn ? (
        <Groups groups={groups} canSetUp={isAdmin} />
      ) : (
        <Sent messages={sent} />
      )}
    </Screen>
  );
}

function Inbox({
  messages,
  onMarkAllRead,
  onArchive,
}: {
  messages: InboxMessage[] | null;
  onMarkAllRead: () => void;
  onArchive: (messageId: string) => void;
}) {
  const theme = useTheme();
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No messages in your inbox. Messages from your coaches, managers, captains and the club will
        show here, and ones you archive are in Archived.
      </ThemedText>
    );
  }
  const unreadCount = messages.filter(isUnread).length;
  return (
    <View style={styles.list}>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          {unreadCount === 0 ? 'All read' : `${unreadCount} unread`}
        </ThemedText>
        {unreadCount > 0 ? (
          <Pressable accessibilityRole="button" onPress={onMarkAllRead} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Mark all read
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Swipe a message to the left to archive it.
      </ThemedText>
      {messages.map((copy) => (
        <SwipeRow
          key={copy.message.id}
          actionLabel="Archive"
          onSwipe={() => onArchive(copy.message.id)}>
          <MessageCard
            copy={copy}
            actions={[{ label: 'Archive', onPress: () => onArchive(copy.message.id) }]}
          />
        </SwipeRow>
      ))}
    </View>
  );
}

function Archived({
  messages,
  onMoveToInbox,
}: {
  messages: InboxMessage[] | null;
  onMoveToInbox: (messageId: string) => void;
}) {
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Nothing archived. Swipe a message to the left in your inbox to archive it.
      </ThemedText>
    );
  }
  return (
    <View style={styles.list}>
      <ThemedText type="small" themeColor="textSecondary">
        Swipe left to move a message back to your inbox.
      </ThemedText>
      {messages.map((copy) => (
        <SwipeRow
          key={copy.message.id}
          actionLabel="Move to inbox"
          onSwipe={() => onMoveToInbox(copy.message.id)}>
          <MessageCard
            copy={copy}
            actions={[
              {
                label: 'Move to inbox',
                onPress: () => onMoveToInbox(copy.message.id),
              },
            ]}
          />
        </SwipeRow>
      ))}
    </View>
  );
}

function MessageCard({
  copy,
  actions,
}: {
  copy: InboxMessage;
  actions: { label: string; onPress: () => void }[];
}) {
  const theme = useTheme();
  const { message, read_at, unread, for_children, for_child_names, answer } = copy;
  return (
    <PressableCard onPress={() => openMessage(message.id)} actions={actions}>
      <View style={styles.row}>
        {!isUnread({ read_at, unread }) ? null : (
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
      <GuardianCopy label={guardianCopyLabel(message.sender_id, for_children, for_child_names)} />
      <ThemedText
        type="small"
        numberOfLines={2}
        themeColor={message.removed_at ? 'textSecondary' : undefined}>
        {message.removed_at ? `Hidden by ${message.removed_by_name ?? 'a coach'}: ` : ''}
        {message.body}
      </ThemedText>
      {message.answer_options ? (
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          {questionTag(for_children, answer ?? null)}
        </ThemedText>
      ) : null}
    </PressableCard>
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

function Groups({ groups, canSetUp }: { groups: ChatGroup[] | null; canSetUp: boolean }) {
  if (groups === null) return null;
  const setUp = canSetUp ? (
    <Button
      title="New group"
      variant="secondary"
      onPress={() => router.push('/admin/chat-groups/edit')}
    />
  ) : null;
  if (groups.length === 0) {
    return (
      <View style={styles.list}>
        {setUp}
        <ThemedText type="small" themeColor="textSecondary">
          You’re not in any chat groups yet. Each squad’s and team’s coaches, managers, captains and
          physios get groups of their own, and admins can set up others.
        </ThemedText>
      </View>
    );
  }
  const { shown, hidden } = splitHidden(groups);
  return (
    <View style={styles.list}>
      {setUp}
      {shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You’ve hidden all your groups. They’re under Hidden groups.
        </ThemedText>
      ) : (
        shown.map((group) => <GroupCard key={group.id} group={group} />)
      )}
      {hidden.length > 0 ? (
        <FormSection
          title="Hidden groups"
          summary={`${hidden.length} hidden. Posts still reach you, marked read.`}>
          {hidden.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </FormSection>
      ) : null}
    </View>
  );
}

function GroupCard({ group }: { group: ChatGroup }) {
  const theme = useTheme();
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/messages/group/[id]',
          params: { id: group.id },
        })
      }>
      <View style={styles.row}>
        {group.unread_count > 0 ? (
          <View
            style={[styles.unreadDot, { backgroundColor: theme.accent }]}
            accessibilityLabel={`${group.unread_count} unread`}
          />
        ) : null}
        <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
          {group.name}
        </ThemedText>
        {group.last_post_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            {formatSentAt(new Date(group.last_post_at))}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {lastPostLine(group)}
      </ThemedText>
      {group.unread_count > 0 || !group.can_post ? (
        <ThemedText type="small" themeColor="textSecondary">
          {[
            group.unread_count > 0 ? `${group.unread_count} unread` : null,
            group.can_post ? null : 'Read only',
          ]
            .filter(Boolean)
            .join(' · ')}
        </ThemedText>
      ) : null}
    </PressableCard>
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
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
