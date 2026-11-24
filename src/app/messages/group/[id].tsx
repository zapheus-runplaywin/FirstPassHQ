import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormSection } from '@/components/form-section';
import { RaiseConcernLink } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import {
  type ChatGroup,
  type ChatGroupMember,
  type ChatPost,
  peopleCount,
  postingNote,
  readOnlyNote,
  UNDER_18_POSTING_NOTE,
} from '@/lib/chat-groups';
import { formatSentAt } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const MAX_LENGTH = 4000;

/**
 * One chat group: its posts, oldest first, and a box to post in for those
 * who can (adults in it, and under-18s in their own squad's or team's groups
 * while a coach is in them). Opening it marks its posts read. Tapping a post
 * opens it on its own, with its read receipts for its sender and a way to
 * report it. The group's coaches can remove a post; its text is kept for
 * safeguarding.
 */
export default function ChatGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { profile } = useAuth();
  const under18 = !!profile && isMinor(profile.date_of_birth, profile.under_17);
  const [group, setGroup] = useState<ChatGroup | null | undefined>(undefined);
  const [posts, setPosts] = useState<ChatPost[]>([]);
  const [members, setMembers] = useState<ChatGroupMember[]>([]);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [hiding, setHiding] = useState(false);
  // The post a coach is about to remove, waiting for them to confirm.
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [groupsResult, postsResult, membersResult] = await Promise.all([
      supabase.rpc('my_chat_groups'),
      supabase.rpc('chat_group_posts', { p_group_id: id }),
      // Empty for members under 18, who don't see who else is in a group.
      supabase.rpc('chat_group_members', { p_group_id: id }),
    ]);
    const found = ((groupsResult.data as ChatGroup[] | null) ?? []).find((g) => g.id === id);
    setGroup(found ?? null);
    setPosts((postsResult.data as ChatPost[] | null) ?? []);
    setMembers((membersResult.data as ChatGroupMember[] | null) ?? []);
    if (found) await supabase.rpc('mark_chat_group_read', { p_group_id: id });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
  }

  async function removePost(messageId: string) {
    const { error: removeError } = await supabase.rpc('remove_chat_post', {
      p_message_id: messageId,
    });
    setRemoving(null);
    if (removeError) {
      setError(removeError.message);
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

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: group.name }} />

      {members.length > 0 ? (
        <FormSection title="Who’s in this group" summary={peopleCount(members.length)}>
          {members.map((m) => (
            <View key={m.profile_id} style={styles.row}>
              <ThemedText type="small" style={styles.grow} numberOfLines={1}>
                {m.full_name ?? 'Unnamed member'}
                {m.under_18 ? ' (under 18, reads only)' : ''}
              </ThemedText>
              {m.detail ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {m.detail}
                </ThemedText>
              ) : null}
            </View>
          ))}
        </FormSection>
      ) : null}

      {posts.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No posts yet.
          {group.can_post ? ' Start the conversation below.' : ''}
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {posts.map((p) => (
            <PressableCard
              key={p.id}
              onPress={() =>
                router.push({
                  pathname: '/messages/[id]',
                  params: { id: p.id },
                })
              }>
              <View style={styles.row}>
                <ThemedText
                  type="smallBold"
                  style={[styles.grow, p.mine ? { color: theme.tint } : undefined]}
                  numberOfLines={1}>
                  {p.mine ? 'You' : p.sender_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatSentAt(new Date(p.created_at))}
                </ThemedText>
              </View>
              <ThemedText
                type="small"
                themeColor={p.body_removed || p.removed_by_name ? 'textSecondary' : undefined}
                selectable>
                {p.body}
              </ThemedText>
              {p.mine && p.recipient_count ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Read by {p.read_count ?? 0} of {p.recipient_count}
                </ThemedText>
              ) : null}
              {group.can_remove && !p.removed_by_name ? (
                removing === p.id ? (
                  <View style={styles.row}>
                    <ThemedText type="small" style={styles.grow}>
                      Remove this post for everyone? Its text is kept for the club’s safeguarding
                      contacts.
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => removePost(p.id)}
                      hitSlop={8}>
                      <ThemedText type="smallBold" style={{ color: theme.tint }}>
                        Remove
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setRemoving(null)}
                      hitSlop={8}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Keep
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setRemoving(p.id)}
                    hitSlop={8}>
                    <ThemedText type="small" style={{ color: theme.tint }}>
                      Remove post
                    </ThemedText>
                  </Pressable>
                )
              ) : null}
            </PressableCard>
          ))}
        </View>
      )}

      {group.can_post ? (
        <View style={styles.field}>
          <TextField
            label="Post to the group"
            value={body}
            onChangeText={setBody}
            placeholder="Write a message"
            multiline
            maxLength={MAX_LENGTH}
          />
          {body.length > MAX_LENGTH - 200 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {MAX_LENGTH - body.length} characters left
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {under18 ? UNDER_18_POSTING_NOTE : postingNote(members.some((m) => m.under_18))}
          </ThemedText>
          <ErrorText>{error}</ErrorText>
          <Button title="Post" onPress={post} busy={posting} />
        </View>
      ) : note ? (
        <ThemedText type="small" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
});
