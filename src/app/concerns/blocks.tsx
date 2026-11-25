import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormSection } from '@/components/form-section';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  blockLine,
  blockStatus,
  type ChatBlockRecord,
  FOLLOW_UP_NOTE_MAX,
} from '@/lib/chat-blocks';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

/**
 * Blocks in chat groups, for admins, the Child Safety Officer and the
 * Complaints Manager: who blocked whom, when and from which group, and the
 * follow-up. Nobody sees a block they're part of. The posts themselves aren't
 * here: read them through Message access, for a concern.
 */
export default function ChatBlocksScreen() {
  const [blocks, setBlocks] = useState<ChatBlockRecord[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('chat_block_register');
    setBlocks((data as ChatBlockRecord[] | null) ?? []);
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

  const waiting = (blocks ?? []).filter((b) => !b.followed_up_at);
  const done = (blocks ?? []).filter((b) => b.followed_up_at);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        When a member blocks someone in a chat group, it shows here for the admins, the Child Safety
        Officer and the Complaints Manager. Check in with the member who blocked, then record it. If
        it’s a worry about a child, raise a concern.
      </ThemedText>
      {blocks === null ? null : (
        <>
          <View style={styles.group}>
            <ThemedText type="smallBold">To follow up</ThemedText>
            {waiting.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing to follow up.
              </ThemedText>
            ) : (
              waiting.map((b) => <BlockCard key={b.id} block={b} onDone={load} />)
            )}
          </View>
          <FormSection title="Followed up" summary={`${done.length}`}>
            {done.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                None yet.
              </ThemedText>
            ) : (
              done.map((b) => <BlockCard key={b.id} block={b} onDone={load} />)
            )}
          </FormSection>
        </>
      )}
    </Screen>
  );
}

function BlockCard({ block, onDone }: { block: ChatBlockRecord; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function followUp() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('follow_up_chat_block', {
      p_id: block.id,
      p_note: note,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onDone();
  }

  return (
    <View style={styles.group}>
      <Card style={styles.card}>
        <ThemedText type="smallBold">{blockLine(block)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {localDay(block.created_at)}
          {block.group_name ? ` · ${block.group_name}` : ''}
          {block.unblocked_at ? ` · unblocked ${localDay(block.unblocked_at)}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {blockStatus(block)}
          {block.followed_up_at ? `, ${localDay(block.followed_up_at)}` : ''}
        </ThemedText>
        {block.follow_up_note ? <ThemedText type="small">{block.follow_up_note}</ThemedText> : null}
      </Card>
      {block.followed_up_at ? null : (
        <>
          <TextField
            label="What you did (optional)"
            accessibilityLabel="What you did (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={FOLLOW_UP_NOTE_MAX}
            multiline
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Mark as followed up" busy={saving} onPress={followUp} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.one,
  },
});
