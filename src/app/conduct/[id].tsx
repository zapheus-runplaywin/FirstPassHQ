import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { ConductAcceptance, ConductTodo } from '@/lib/conduct';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

/**
 * The club's code of conduct, accepted once a season: by the member, or by a
 * verified parent or guardian for a child under 18. Shows every season's
 * acceptance with the words accepted.
 */
export default function ConductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const [todo, setTodo] = useState<ConductTodo | null | undefined>(undefined);
  const [history, setHistory] = useState<ConductAcceptance[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelf = id === session?.user.id;

  const load = useCallback(async () => {
    const [todosResult, historyResult] = await Promise.all([
      supabase.rpc('my_conduct_todos'),
      supabase.rpc('conduct_history', { p_profile_id: id }),
    ]);
    setTodo(
      ((todosResult.data as ConductTodo[] | null) ?? []).find((t) => t.profile_id === id) ?? null,
    );
    setHistory((historyResult.data as ConductAcceptance[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function accept() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('accept_code_of_conduct', {
      p_profile_id: id,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (router.canGoBack()) router.back();
    else load();
  }

  if (todo === undefined) return <Screen>{null}</Screen>;

  return (
    <Screen>
      {todo ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {todo.for_child
              ? `Each season a parent or guardian accepts the club’s code of conduct for ${todo.full_name ?? 'their child'}. Read it, go through it with them, then agree below.`
              : 'Each season every member accepts the club’s code of conduct. Read it, then agree below.'}
          </ThemedText>
          {todo.code_of_conduct_url ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => Linking.openURL(todo.code_of_conduct_url!)}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Read the code of conduct
              </ThemedText>
            </Pressable>
          ) : null}
          <Card>
            <ThemedText type="small">{todo.statement}</ThemedText>
          </Card>
          <ErrorText>{error}</ErrorText>
          <Button title="I agree" onPress={accept} busy={busy} />
          <ThemedText type="small" themeColor="textSecondary">
            The club keeps your name, the date and these words as its record.
          </ThemedText>
        </>
      ) : history.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {isSelf
            ? 'Nothing to accept. The club hasn’t added a code of conduct, or a parent or guardian accepts it for you.'
            : 'Nothing to accept for them.'}
        </ThemedText>
      ) : null}

      {history.length > 0 ? (
        <View style={styles.history}>
          <ThemedText type="smallBold">Accepted</ThemedText>
          {history.map((a) => (
            <Card key={`${a.season}-${a.accepted_at}`}>
              <ThemedText type="smallBold">{seasonLabel(a.season)} season</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {a.accepted_as === 'guardian'
                  ? `By ${a.accepted_by_name ?? 'a parent or guardian'}, as parent or guardian`
                  : `By ${a.accepted_by_name ?? 'the member'}`}{' '}
                on {localDay(a.accepted_at)} · version {a.policy_version}
              </ThemedText>
              <ThemedText type="small">{a.statement}</ThemedText>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  history: { gap: Spacing.two },
});
