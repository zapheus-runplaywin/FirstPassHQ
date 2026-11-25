import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { MyChatBlock } from '@/lib/chat-blocks';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

/**
 * The people the member has blocked in chat groups, with Unblock. Their posts
 * show again as soon as they're unblocked.
 */
export default function BlockedPeopleScreen() {
  const [blocks, setBlocks] = useState<MyChatBlock[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_chat_blocks');
    setBlocks((data as MyChatBlock[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function unblock(profileId: string) {
    setBusy(profileId);
    setError(null);
    const { error: unblockError } = await supabase.rpc('unblock_chat_member', {
      p_profile_id: profileId,
    });
    setBusy(null);
    if (unblockError) {
      setError(unblockError.message);
      return;
    }
    await load();
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        Posts from people you’ve blocked don’t show in your chat groups. They aren’t told. Club
        messages from them still reach you. To block someone, open one of their posts in a group.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      {blocks === null ? null : blocks.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You haven’t blocked anyone.
        </ThemedText>
      ) : (
        blocks.map((b) => (
          <Card key={b.profile_id} style={styles.card}>
            <View>
              <ThemedText type="smallBold">{b.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Blocked {localDay(b.blocked_at)}
                {b.group_name ? ` in ${b.group_name}` : ''}
              </ThemedText>
            </View>
            <Button
              title="Unblock"
              variant="secondary"
              busy={busy === b.profile_id}
              onPress={() => unblock(b.profile_id)}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
});
