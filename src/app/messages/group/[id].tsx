import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormSection } from '@/components/form-section';
import { RaiseConcernLink } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { SwipeAction } from '@/components/swipe-action';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, ErrorText } from '@/components/ui';
import { BrandFonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import {
  type ChatGroup,
  type ChatGroupMember,
  type ChatPost,
  hiddenLine,
  mergePosts,
  peopleCount,
  postingNote,
  POSTS_PAGE,
  ALONE_NOTE,
  readOnlyNote,
  UNDER_18_POSTING_NOTE,
} from '@/lib/chat-groups';
import { formatSentAt } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const MAX_LENGTH = 4000;
/** How often an open group looks for new posts. */
const REFRESH_MS = 15000;

/**
 * One chat group, laid out like a messaging app: it opens at the newest post
 * with the box to write in at the foot, and older posts load as the member
 * scrolls up. Only those who can post get the box (adults in it, and
 * under-18s in their own squad's or team's groups while a coach is in them).
 * Opening it marks its posts read. Tapping a post opens it on its own, with
 * its read receipts for its sender and a way to report it. The group's
 * coaches swipe a post to hide it from everyone but its author, the coaches
 * and the author's parents (greyed out for them), or to show it again; its
 * text is kept for safeguarding.
 */
export default function ChatGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { profile } = useAuth();
  const under18 = !!profile && isMinor(profile.date_of_birth, profile.under_17);
  const [group, setGroup] = useState<ChatGroup | null | undefined>(undefined);
  // Newest first: the list is drawn upside down so it starts at the newest.
  const [posts, setPosts] = useState<ChatPost[]>([]);
  const [olderLeft, setOlderLeft] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [members, setMembers] = useState<ChatGroupMember[]>([]);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const listRef = useRef<FlatList<ChatPost>>(null);
  const firstLoad = useRef(true);

  // The group, its members and its latest posts, joined with any older posts
  // already loaded.
  const load = useCallback(async () => {
    const [groupsResult, postsResult, membersResult] = await Promise.all([
      supabase.rpc('my_chat_groups'),
      supabase.rpc('chat_group_posts', { p_group_id: id }),
      // Empty for members under 18, who don't see who else is in a group.
      supabase.rpc('chat_group_members', { p_group_id: id }),
    ]);
    const found = ((groupsResult.data as ChatGroup[] | null) ?? []).find((g) => g.id === id);
    const latest = (postsResult.data as ChatPost[] | null) ?? [];
    setGroup(found ?? null);
    setPosts((shown) => mergePosts(shown, latest));
    if (firstLoad.current) {
      firstLoad.current = false;
      setOlderLeft(latest.length >= POSTS_PAGE);
    }
    setMembers((membersResult.data as ChatGroupMember[] | null) ?? []);
    if (found) await supabase.rpc('mark_chat_group_read', { p_group_id: id });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  async function loadOlder() {
    const oldest = posts[posts.length - 1];
    if (!olderLeft || loadingOlder || !oldest) return;
    setLoadingOlder(true);
    const { data } = await supabase.rpc('chat_group_posts', {
      p_group_id: id,
      p_before: oldest.created_at,
    });
    const page = (data as ChatPost[] | null) ?? [];
    setPosts((shown) => mergePosts(shown, page));
    setOlderLeft(page.length >= POSTS_PAGE);
    setLoadingOlder(false);
  }

  // The box to write in sits on the keyboard.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboardHeight(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  async function post() {
    if (!body.trim()) {
      setError('Write a message first.');
      return;
    }
    setPosting(true);
    setError(null);
    const { error: postError } = await supabase.rpc('post_to_chat_group', {
      p_group_id: id,
      p_body: body,
    });
    setPosting(false);
    if (postError) {
      setError(postError.message);
      return;
    }
    setBody('');
    await load();
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

  async function setPostHidden(messageId: string, hide: boolean) {
    const { error: hideError } = await supabase.rpc(hide ? 'remove_chat_post' : 'show_chat_post', {
      p_message_id: messageId,
    });
    if (hideError) {
      setError(hideError.message);
      return;
    }
    await load();
  }

  async function toggleHidden() {
    if (!group) return;
    setHiding(true);
    await supabase.rpc('set_chat_group_hidden', {
      p_group_id: id,
      p_hidden: !group.hidden,
    });
    setHiding(false);
    if (!group.hidden) {
      if (router.canGoBack()) router.back();
      else router.replace('/messages');
      return;
    }
    await load();
  }

  if (group === undefined) return null;
  if (group === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This group isn’t available.
        </ThemedText>
      </Screen>
    );
  }

  const note = readOnlyNote(group.read_only_reason);
  // A group an admin set up shows before anyone else is in it; posting waits
  // until someone is.
  const alone = group.member_count < 2;
  const canPost = group.can_post && !alone;

  function renderPost({ item: p }: { item: ChatPost }) {
    // A post a coach hid: only its author, the group's coaches and the
    // author's parents still get it, greyed out.
    const hidden = !!p.removed_by_name;
    const row = (swiped?: () => boolean) => (
      <View style={[styles.postRow, p.mine ? styles.mineRow : undefined]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (swiped?.()) return;
            router.push({ pathname: '/messages/[id]', params: { id: p.id } });
          }}
          style={({ pressed }) => [
            styles.bubble,
            hidden ? styles.hidden : undefined,
            {
              backgroundColor: pressed
                ? theme.backgroundSelected
                : p.mine
                  ? theme.backgroundSelected
                  : theme.backgroundElement,
            },
          ]}>
          {p.mine ? null : (
            <ThemedText
              type="smallBold"
              style={hidden ? undefined : { color: theme.tint }}
              themeColor={hidden ? 'textSecondary' : undefined}
              numberOfLines={1}>
              {p.sender_name}
            </ThemedText>
          )}
          <ThemedText
            type="small"
            themeColor={hidden || p.body_removed ? 'textSecondary' : undefined}
            style={p.body_removed ? styles.italic : undefined}
            selectable>
            {p.body}
          </ThemedText>
          {hidden ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={[styles.meta, styles.italic]}>
              {hiddenLine(p.removed_by_name)}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
            {formatSentAt(new Date(p.created_at))}
            {p.mine && p.recipient_count
              ? ` · Read by ${p.read_count ?? 0} of ${p.recipient_count}`
              : ''}
          </ThemedText>
        </Pressable>
      </View>
    );
    // The group's coaches swipe a post to hide it, or a hidden one to show it again.
    return group?.can_remove ? (
      <SwipeAction label={hidden ? 'Show' : 'Hide'} onAction={() => setPostHidden(p.id, !hidden)}>
        {(swiped) => row(swiped)}
      </SwipeAction>
    ) : (
      row()
    );
  }

  // In an upside-down list the header sits at the foot, under the newest post.
  const footNote = alone
    ? ALONE_NOTE
    : canPost
      ? under18
        ? UNDER_18_POSTING_NOTE
        : postingNote(members.some((m) => m.under_18))
      : note;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: group.name }} />
      <SafeAreaView
        edges={keyboardHeight > 0 ? ['left', 'right'] : ['bottom', 'left', 'right']}
        // The box to write in rides on the keyboard, on both platforms, as in
        // Screen (src/components/screen.tsx).
        style={[styles.safeArea, keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null]}>
        <View style={[styles.details, { borderBottomColor: theme.backgroundElement }]}>
          <FormSection
            title="About this group"
            summary={members.length ? peopleCount(members.length) : 'Hide it, or report a post'}>
            {members.map((m) => (
              <View key={m.profile_id} style={styles.row}>
                <ThemedText type="small" style={styles.grow} numberOfLines={1}>
                  {m.full_name ?? 'Unnamed member'}
                  {m.under_18 ? ' (under 18)' : ''}
                </ThemedText>
                {m.detail ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {m.detail}
                  </ThemedText>
                ) : null}
              </View>
            ))}
            <Button
              title={group.hidden ? 'Show in my groups' : 'Hide this group'}
              variant="secondary"
              busy={hiding}
              onPress={toggleHidden}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {group.hidden
                ? 'Hidden: new posts still reach you, already marked read.'
                : 'Hiding moves it to Hidden groups. New posts still reach you, already marked read.'}
            </ThemedText>
            <RaiseConcernLink label="Worried about a post? Open it and report it, or raise a concern" />
            <Button
              title="Blocked people"
              variant="secondary"
              onPress={() => router.push('/messages/blocked')}
            />
            <ThemedText type="small" themeColor="textSecondary">
              To block someone, open one of their posts. You stop seeing their posts in your groups.
            </ThemedText>
          </FormSection>
        </View>

        <FlatList
          ref={listRef}
          testID="chat-posts"
          style={styles.grow}
          contentContainerStyle={styles.list}
          data={posts}
          inverted
          keyExtractor={(p) => p.id}
          renderItem={renderPost}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onEndReached={loadOlder}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            footNote ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.footNote}>
                {footNote}
              </ThemedText>
            ) : undefined
          }
          ListFooterComponent={
            loadingOlder ? (
              <ActivityIndicator style={styles.older} />
            ) : posts.length && !olderLeft ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.older}>
                Start of the group
              </ThemedText>
            ) : undefined
          }
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No posts yet.
              {canPost ? ' Start the conversation below.' : ''}
            </ThemedText>
          }
        />

        {canPost ? (
          <View style={[styles.composer, { borderTopColor: theme.backgroundElement }]}>
            <ErrorText>{error}</ErrorText>
            <View style={styles.row}>
              <TextInput
                accessibilityLabel="Post to the group"
                value={body}
                onChangeText={setBody}
                placeholder="Write a message"
                placeholderTextColor={theme.textSecondary}
                multiline
                rows={1}
                maxLength={MAX_LENGTH}
                style={[
                  styles.input,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Post"
                disabled={posting}
                onPress={post}
                style={({ pressed }) => [
                  styles.send,
                  { backgroundColor: theme.accent, opacity: posting || pressed ? 0.7 : 1 },
                ]}>
                {posting ? (
                  <ActivityIndicator color={theme.onAccent} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    Post
                  </ThemedText>
                )}
              </Pressable>
            </View>
            {body.length > MAX_LENGTH - 200 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {MAX_LENGTH - body.length} characters left
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  details: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: {
    flexGrow: 1,
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  postRow: {
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  mineRow: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  italic: {
    fontStyle: 'italic',
  },
  hidden: {
    opacity: 0.55,
  },
  meta: {
    fontSize: 12,
  },
  footNote: {
    textAlign: 'center',
    paddingTop: Spacing.two,
  },
  older: {
    textAlign: 'center',
    paddingVertical: Spacing.two,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    paddingTop: 11,
    paddingBottom: 11,
    fontFamily: BrandFonts.regular,
    fontSize: 16,
  },
  send: {
    height: 44,
    minWidth: 64,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
});
