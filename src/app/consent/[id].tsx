import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { PolicyLinks } from '@/components/policy-links';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  type ChildConsent,
  type ConsentKind,
  type ConsentRecord,
  consentKindLabels,
  consentText,
  useClubPolicies,
} from '@/lib/consents';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/**
 * A parent or guardian's consent for their child under 18: who sees the
 * child's daily check-ins and injury details, and whether live streams may
 * name them with their own game stats. Each consent can be given or
 * withdrawn at any time, and every change is kept.
 */
export default function ConsentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const policies = useClubPolicies();
  const theme = useTheme();
  const [child, setChild] = useState<ChildConsent | null | undefined>(undefined);
  const [history, setHistory] = useState<ConsentRecord[]>([]);
  const [choice, setChoice] = useState<Record<ConsentKind, boolean>>({
    data: false,
    health: false,
    publish: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [childrenResult, historyResult] = await Promise.all([
      supabase.rpc('my_child_consents'),
      supabase.rpc('child_consent_history', { p_athlete_id: id }),
    ]);
    const found =
      ((childrenResult.data as ChildConsent[] | null) ?? []).find((c) => c.athlete_id === id) ??
      null;
    setChild(found);
    if (found) setChoice({ data: found.data, health: found.health, publish: found.publish });
    setHistory((historyResult.data as ConsentRecord[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function save() {
    setBusy(true);
    setError(null);
    let { error: rpcError } = await supabase.rpc('set_child_consent', {
      p_athlete_id: id,
      p_data: choice.data,
      p_health: choice.health,
    });
    if (!rpcError && child && choice.publish !== child.publish) {
      ({ error: rpcError } = await supabase.rpc('set_child_publish_consent', {
        p_athlete_id: id,
        p_publish: choice.publish,
      }));
    }
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  if (child === undefined) return <Screen>{null}</Screen>;
  if (child === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          Consent is only for parents and guardians of athletes under 18.
        </ThemedText>
      </Screen>
    );
  }

  const name = child.full_name ?? 'your child';
  return (
    <Screen>
      <Stack.Screen options={{ title: `Consent for ${name}` }} />
      <ThemedText type="small">
        The club keeps information about {name} so they can train and play safely. Choose who else
        can see it. {name} and you always can, and the club’s admins can always see their injuries but
        never their check-in answers. You can change this at any time.
      </ThemedText>
      <PolicyLinks intro="Read the club’s policies first:" />
      {!child.can_consent ? (
        <Card>
          <ThemedText type="small">
            A club admin needs to verify your identity before you can give consent. Ask them to
            check your registration.
          </ThemedText>
        </Card>
      ) : (
        <>
          {(['data', 'health', 'publish'] as const).map((kind) => (
            <Card key={kind} style={styles.row}>
              <View style={styles.grow}>
                <ThemedText type="smallBold">{consentText[kind].title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {consentText[kind].detail}
                </ThemedText>
              </View>
              <Switch
                accessibilityLabel={`I consent: ${consentText[kind].title}`}
                value={choice[kind]}
                onValueChange={(on) => setChoice({ ...choice, [kind]: on })}
                trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                thumbColor={theme.text}
                {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
              />
            </Card>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Photos of injuries are separate: you’re asked each time you add one, if the club allows
            them.
            {policies?.policy_version ? ` Policy version ${policies.policy_version}.` : ''}
          </ThemedText>
          <ErrorText>{error}</ErrorText>
          <Button title="Save" onPress={save} busy={busy} />
        </>
      )}

      {history.length > 0 ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">History</ThemedText>
          {history.map((h, i) => (
            <ThemedText key={i} type="small" themeColor="textSecondary">
              {consentKindLabels[h.kind]}: given by {h.given_by_name ?? 'a former guardian'}{' '}
              {formatDateTime(new Date(h.given_at))} (version {h.policy_version})
              {h.withdrawn_at
                ? `, withdrawn by ${h.withdrawn_by_name ?? 'a former guardian'} ${formatDateTime(new Date(h.withdrawn_at))}`
                : ''}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  grow: { flex: 1, gap: Spacing.one },
  group: { gap: Spacing.two },
});
