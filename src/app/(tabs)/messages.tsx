import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import MessageScreen from '@/app/messages/[id]';
import { FormSection } from '@/components/form-section';
import { TabHeader } from '@/components/home/tab-header';
import { Icon, type IconName } from '@/components/icon';
import { ListDetail, useListDetail } from '@/components/list-detail';
import {
  COMPOSE_BUTTON_ROOM,
  ComposeButton,
  CountBadge,
  EmptyState,
  FilterChip,
  ListHeading,
  Monogram,
  ReadBar,
  SearchField,
  Segments,
} from '@/components/messages/parts';
import { Screen } from '@/components/screen';
import { SwipeRow } from '@/components/swipe-row';
import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, PressableCard } from '@/components/ui';
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
import { useReloadUnread } from '@/lib/home';
import {
  daySections,
  filterInbox,
  guardianCopyShort,
  type InboxFilter,
  matchesSearch,
  MESSAGES_PAGE,
  needsAnswer,
  sentSearchTexts,
} from '@/lib/message-list';
import { questionTag, questionTagTone } from '@/lib/message-questions';
import {
  audienceLabel,
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
import type { InboxMessage, MessageAudience, SentMessage } from '@/lib/types';

/**
 * Messages, laid out as a mail app: Inbox, Sent, Archived and Groups across
 * the top with their unread counts, a search box, quick filters for what is
 * unread or still to answer, messages under day headings, and New message
 * floating at the foot for those who can send.
 *
 * It is still one way. Nobody gets a reply box, a way to message one person,
 * or a picture: the circle beside a sender holds their initials and opens
 * nothing (AGENTS.md, "No social media features for children"). Search and
 * the filters only sift the messages already on the member's phone.
 */
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
  // What is typed in the search box. It starts again in each box.
  const [query, setQuery] = useState('');
  // How many messages each list has asked for, and whether there are older ones.
  const [inboxLimit, setInboxLimit] = useState(MESSAGES_PAGE);
  const [archivedLimit, setArchivedLimit] = useState(MESSAGES_PAGE);
  const [older, setOlder] = useState({ inbox: false, archived: false });
  // The message just archived, so it can be put back straight away.
  const [justArchived, setJustArchived] = useState<string | null>(null);
  const userId = session?.user.id;
  // The Messages tab's count, which a message read beside the list changes.
  const reloadUnread = useReloadUnread();

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
      copies().is('archived_at', null).order('created_at', { ascending: false }).limit(inboxLimit),
      copies()
        .not('archived_at', 'is', null)
        .order('created_at', { ascending: false })
        .limit(archivedLimit),
      canSend ? supabase.rpc('my_sent_messages') : Promise.resolve({ data: [] }),
      groupsOn ? supabase.rpc('my_chat_groups') : Promise.resolve({ data: [] }),
    ]);
    const rows = (data: unknown) => (data as InboxMessage[] | null) ?? [];
    // A message the member can no longer read (for example a club message to a
    // physio after the club setting was turned off) comes back without its body.
    const readable = (data: unknown) => rows(data).filter((r) => r.message);
    setInbox(readable(inboxResult.data).filter((r) => !isArchived(r)));
    setArchived(readable(archivedResult.data).filter(isArchived));
    // A full page means there may be older messages still to ask for.
    setOlder({
      inbox: rows(inboxResult.data).length >= inboxLimit,
      archived: rows(archivedResult.data).length >= archivedLimit,
    });
    setSent((sentResult.data as SentMessage[] | null) ?? []);
    setGroups((groupsResult.data as ChatGroup[] | null) ?? []);
  }, [userId, canSend, groupsOn, inboxLimit, archivedLimit]);

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
    reloadUnread();
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
    reloadUnread();
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

  // On a tablet a message opens beside the list; otherwise on its own screen.
  // Chat groups always open on their own screen.
  const detail = useListDetail<{ id: string }>((params) =>
    router.push({ pathname: '/messages/[id]', params }),
  );
  const chosenId = detail.chosen?.id ?? null;
  const openMessage = (id: string) => detail.open({ id });
  const composing = canSend && box !== 'groups';

  const list = (
    <Screen
      tab
      gap={Spacing.three}
      header={<TabHeader title="Messages" />}
      refreshing={refreshing}
      onRefresh={onRefresh}
      floating={
        // Not over Groups: a group has its own box to write in, and New message
        // goes to a squad, a role or the club, not to a group.
        composing ? (
          <ComposeButton title="New message" onPress={() => router.push('/messages/new')} />
        ) : undefined
      }>
      <Segments
        options={messageBoxes(
          canSend,
          groupsOn,
          groupsUnread(groups ?? []),
          (inbox ?? []).filter(isUnread).length,
        )}
        selected={box}
        onSelect={(next) => {
          setBox(next);
          setQuery('');
          setJustArchived(null);
        }}
      />

      {justArchived && box === 'inbox' ? (
        <View style={[styles.undo, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="archive" size={16} color={theme.textSecondary} />
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
        <Inbox
          messages={inbox}
          query={query}
          onQuery={setQuery}
          onMarkAllRead={markAllRead}
          onArchive={archive}
          hasOlder={older.inbox}
          onOlder={() => setInboxLimit((limit) => limit + MESSAGES_PAGE)}
          chosenId={chosenId}
          onOpen={openMessage}
        />
      ) : box === 'archived' ? (
        <Archived
          messages={archived}
          query={query}
          onQuery={setQuery}
          onMoveToInbox={moveToInbox}
          hasOlder={older.archived}
          onOlder={() => setArchivedLimit((limit) => limit + MESSAGES_PAGE)}
          chosenId={chosenId}
          onOpen={openMessage}
        />
      ) : box === 'groups' && groupsOn ? (
        <Groups groups={groups} canSetUp={isAdmin} query={query} onQuery={setQuery} />
      ) : (
        <Sent
          messages={sent}
          query={query}
          onQuery={setQuery}
          chosenId={chosenId}
          onOpen={openMessage}
        />
      )}
      {/* Room for New message to float over, so it never covers the last row. */}
      {composing ? <View style={styles.composeRoom} /> : null}
    </Screen>
  );
  return (
    <ListDetail
      tab
      chosen={detail.chosen}
      detail={<MessageScreen />}
      title="Message"
      hint="Choose a message to read it here."
      onLeave={() => {
        detail.close();
        load();
        reloadUnread();
      }}
      onChanged={() => {
        load();
        reloadUnread();
      }}>
      {list}
    </ListDetail>
  );
}

/** How a list of messages opens one: `chosenId` is the message open beside the list, if one is. */
type Opening = { chosenId: string | null; onOpen: (messageId: string) => void };

/** The search box over a list, and what is typed in it. */
type Searching = { query: string; onQuery: (text: string) => void };

/** Older messages than the ones loaded, and how to ask for them. */
type Paging = { hasOlder: boolean; onOlder: () => void };

/** What a search that finds nothing says, with a way back to the whole list. */
function NothingFound({ query, onQuery }: Searching) {
  return (
    <EmptyState
      icon="search"
      title="Nothing found"
      text={`Nothing here matches “${query.trim()}”. Search looks at who sent a message, who it went to and what it says.`}>
      <Button title="Clear search" variant="secondary" onPress={() => onQuery('')} />
    </EmptyState>
  );
}

function OlderMessages({ hasOlder, onOlder }: Paging) {
  if (!hasOlder) return null;
  return <Button title="Show older messages" variant="secondary" onPress={onOlder} />;
}

/** A quiet line at the foot of a list, such as how to archive by swiping. */
function FootNote({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.footNote}>
      {children}
    </ThemedText>
  );
}

function Inbox({
  messages,
  query,
  onQuery,
  onMarkAllRead,
  onArchive,
  hasOlder,
  onOlder,
  chosenId,
  onOpen,
}: {
  messages: InboxMessage[] | null;
  onMarkAllRead: () => void;
  onArchive: (messageId: string) => void;
} & Opening &
  Searching &
  Paging) {
  const theme = useTheme();
  const [chosenFilter, setFilter] = useState<InboxFilter>('all');
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        title="Your inbox is empty"
        text="Messages from your coaches, managers, captains and the club arrive here. Ones you archive are in Archived."
      />
    );
  }
  const unreadCount = messages.filter(isUnread).length;
  const toAnswerCount = messages.filter(needsAnswer).length;
  // A filter with nothing left to show (the last unread message was read) lets go.
  const filter: InboxFilter =
    (chosenFilter === 'unread' && unreadCount === 0) ||
    (chosenFilter === 'toAnswer' && toAnswerCount === 0)
      ? 'all'
      : chosenFilter;
  const toggle = (next: InboxFilter) => setFilter(filter === next ? 'all' : next);
  const shown = filterInbox(messages, filter, query);
  return (
    <View style={styles.list}>
      <SearchField label="Search messages" value={query} onChangeText={onQuery} />
      <View style={styles.row}>
        <View style={styles.filters}>
          {unreadCount === 0 && toAnswerCount === 0 ? (
            <StatusLine text="All read" tone="done" inline />
          ) : null}
          {unreadCount > 0 ? (
            <FilterChip
              label={`${unreadCount} unread`}
              selected={filter === 'unread'}
              onPress={() => toggle('unread')}
              hint="Shows only unread messages"
            />
          ) : null}
          {toAnswerCount > 0 ? (
            <FilterChip
              label={`${toAnswerCount} to answer`}
              selected={filter === 'toAnswer'}
              onPress={() => toggle('toAnswer')}
              hint="Shows only messages with a question you haven’t answered"
            />
          ) : null}
        </View>
        {unreadCount > 0 ? (
          <Pressable accessibilityRole="button" onPress={onMarkAllRead} hitSlop={8}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Mark all read
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {shown.length === 0 ? (
        <NothingFound query={query} onQuery={onQuery} />
      ) : (
        daySections(shown, (copy) => copy.message.created_at).map((section) => (
          <View key={section.title} style={styles.list}>
            {section.title ? <ListHeading>{section.title}</ListHeading> : null}
            {section.items.map((copy) => (
              <SwipeRow
                key={copy.message.id}
                actionLabel="Archive"
                onSwipe={() => onArchive(copy.message.id)}>
                <MessageCard
                  copy={copy}
                  actions={[{ label: 'Archive', onPress: () => onArchive(copy.message.id) }]}
                  chosenId={chosenId}
                  onOpen={onOpen}
                />
              </SwipeRow>
            ))}
          </View>
        ))
      )}
      <OlderMessages hasOlder={hasOlder} onOlder={onOlder} />
      <FootNote>Swipe a message to the left to archive it.</FootNote>
    </View>
  );
}

function Archived({
  messages,
  query,
  onQuery,
  onMoveToInbox,
  hasOlder,
  onOlder,
  chosenId,
  onOpen,
}: {
  messages: InboxMessage[] | null;
  onMoveToInbox: (messageId: string) => void;
} & Opening &
  Searching &
  Paging) {
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="archive"
        title="Nothing archived"
        text="Swipe a message to the left in your inbox to archive it. Archiving tidies it away; nothing is deleted."
      />
    );
  }
  const shown = filterInbox(messages, 'all', query);
  return (
    <View style={styles.list}>
      <SearchField label="Search archived messages" value={query} onChangeText={onQuery} />
      {shown.length === 0 ? (
        <NothingFound query={query} onQuery={onQuery} />
      ) : (
        shown.map((copy) => (
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
              chosenId={chosenId}
              onOpen={onOpen}
            />
          </SwipeRow>
        ))
      )}
      <OlderMessages hasOlder={hasOlder} onOlder={onOlder} />
      <FootNote>Swipe left to move a message back to your inbox.</FootNote>
    </View>
  );
}

function MessageCard({
  copy,
  actions,
  chosenId,
  onOpen,
}: {
  copy: InboxMessage;
  actions: { label: string; onPress: () => void }[];
} & Opening) {
  const theme = useTheme();
  const { message, read_at, unread, for_children, for_child_names, answer } = copy;
  const isNew = isUnread({ read_at, unread });
  const copyLine = guardianCopyShort(message.sender_id, for_children, for_child_names);
  return (
    <PressableCard
      onPress={() => onOpen(message.id)}
      actions={actions}
      selected={chosenId === null ? undefined : message.id === chosenId}>
      <View style={styles.cardRow}>
        {/* A message with no sender is from the club itself. */}
        <Monogram name={message.sender_name} icon={message.sender_name ? undefined : 'home'} />
        <View style={styles.cardText}>
          <View style={styles.row}>
            {isNew ? (
              <View
                style={[styles.unreadDot, { backgroundColor: theme.accent }]}
                accessibilityLabel="Unread"
              />
            ) : null}
            {/* Unread reads in bold; once read, the sender steps back. */}
            <ThemedText type={isNew ? 'smallBold' : 'small'} style={styles.grow} numberOfLines={1}>
              {message.sender_name ?? 'Club'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatSentAt(new Date(message.created_at))}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            To {audienceLabel(message.audience, message.audience_role, message.audience_label)}
          </ThemedText>
          {copyLine ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {copyLine}
            </ThemedText>
          ) : null}
          <ThemedText
            type="small"
            numberOfLines={2}
            themeColor={message.removed_at || !isNew ? 'textSecondary' : undefined}>
            {message.removed_at ? `Hidden by ${message.removed_by_name ?? 'a coach'}: ` : ''}
            {message.body}
          </ThemedText>
          {message.answer_options ? (
            <StatusLine
              text={questionTag(for_children, answer ?? null)}
              tone={questionTagTone(for_children, answer ?? null)}
            />
          ) : null}
        </View>
      </View>
    </PressableCard>
  );
}

/** The icon beside a message the member sent, for who it went to. */
function audienceIcon(audience: MessageAudience): IconName {
  return audience === 'club' ? 'home' : audience === 'role' ? 'user-check' : 'users';
}

function Sent({
  messages,
  query,
  onQuery,
  chosenId,
  onOpen,
}: { messages: SentMessage[] | null } & Opening & Searching) {
  if (messages === null) return null;
  if (messages.length === 0) {
    return (
      <EmptyState
        icon="send"
        title="Nothing sent yet"
        text="Messages you send show here, with how many people have read each one."
      />
    );
  }
  const shown = messages.filter((message) => matchesSearch(sentSearchTexts(message), query));
  return (
    <View style={styles.list}>
      <SearchField label="Search sent messages" value={query} onChangeText={onQuery} />
      {shown.length === 0 ? <NothingFound query={query} onQuery={onQuery} /> : null}
      {shown.map((message) => {
        const allRead = message.recipient_count > 0 && message.read_count >= message.recipient_count;
        return (
          <PressableCard
            key={message.id}
            onPress={() => onOpen(message.id)}
            selected={chosenId === null ? undefined : message.id === chosenId}>
            <View style={styles.cardRow}>
              <Monogram icon={audienceIcon(message.audience)} />
              <View style={styles.cardText}>
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
                <View style={styles.readLine}>
                  <ReadBar read={message.read_count} of={message.recipient_count} />
                  <StatusLine
                    text={`Read by ${message.read_count} of ${message.recipient_count}`}
                    tone={allRead ? 'done' : 'quiet'}
                  />
                </View>
              </View>
            </View>
          </PressableCard>
        );
      })}
    </View>
  );
}

function Groups({
  groups,
  canSetUp,
  query,
  onQuery,
}: { groups: ChatGroup[] | null; canSetUp: boolean } & Searching) {
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
      <EmptyState
        icon="users"
        title="You’re not in any chat groups yet"
        text="Each squad’s and team’s coaches, managers, captains and physios get groups of their own, and admins can set up others.">
        {setUp}
      </EmptyState>
    );
  }
  const matching = groups.filter((group) =>
    matchesSearch([group.name, group.last_post, group.last_sender], query),
  );
  const { shown, hidden } = splitHidden(matching);
  return (
    <View style={styles.list}>
      {setUp}
      <SearchField label="Search groups" value={query} onChangeText={onQuery} />
      {matching.length === 0 ? (
        <NothingFound query={query} onQuery={onQuery} />
      ) : shown.length === 0 && !query.trim() ? (
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
  const isNew = group.unread_count > 0;
  return (
    <PressableCard
      onPress={() =>
        router.push({
          pathname: '/messages/group/[id]',
          params: { id: group.id },
        })
      }>
      <View style={styles.cardRow}>
        <Monogram icon="users" />
        <View style={styles.cardText}>
          <View style={styles.row}>
            <ThemedText type={isNew ? 'smallBold' : 'small'} style={styles.grow} numberOfLines={1}>
              {group.name}
            </ThemedText>
            {group.last_post_at ? (
              <ThemedText type="small" themeColor="textSecondary">
                {formatSentAt(new Date(group.last_post_at))}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.row}>
            <ThemedText
              type="small"
              themeColor={isNew ? undefined : 'textSecondary'}
              numberOfLines={2}
              style={styles.grow}>
              {lastPostLine(group)}
            </ThemedText>
            <CountBadge count={group.unread_count} label={`${group.unread_count} unread`} />
          </View>
          {group.can_post ? null : (
            <View style={styles.tag}>
              <Icon name="lock" size={12} />
              <ThemedText type="small" themeColor="textSecondary">
                Read only
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </PressableCard>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  filters: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 32,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  readLine: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
  footNote: {
    textAlign: 'center',
    paddingTop: Spacing.two,
  },
  composeRoom: {
    height: COMPOSE_BUTTON_ROOM - Spacing.three,
  },
});
