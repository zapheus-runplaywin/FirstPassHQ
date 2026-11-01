import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { FirstPass } from '@/constants/club';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString } from '@/lib/injuries';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { formatLinkCode, linkCodeMessage, looksLikeLinkCode } from '@/lib/guardian-links';
import { supabase } from '@/lib/supabase';

/**
 * A child under 18 waiting for a parent or guardian: their link code to share,
 * and who has entered it. Until a club admin approves a verified parent or
 * guardian who entered it, this is all the app shows them.
 */
export function WaitingForGuardian() {
  const theme = useTheme();
  const club = useClub();
  const { profile, waitingForGuardian, isLocked, refresh } = useAuth();
  const [copied, setCopied] = useState(false);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!waitingForGuardian) return null;
  const { code, expires_at, parents_waiting } = waitingForGuardian;
  const name = profile?.preferred_name || profile?.full_name || null;

  async function makeNewCode() {
    setMaking(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('new_link_code');
    if (rpcError) setError(rpcError.message);
    setCopied(false);
    await refresh();
    setMaking(false);
  }

  return (
    <Card>
      <ThemedText type="smallBold">Waiting for your parent or guardian</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {isLocked
          ? 'You’re under 18, so the app stays locked until a parent or guardian is linked to you.'
          : 'You’re under 18, so a parent or guardian needs to join the club in the app too.'}{' '}
        Share this code with them. They sign in, ask to join as a parent or guardian and enter it.
        A club admin checks who they are and links you
        {isLocked ? ', and then the app opens for you.' : ' before approving you.'}
      </ThemedText>
      {code ? (
        <View
          style={styles.code}
          accessibilityLabel={`Your link code is ${code.split('').join(' ')}`}>
          <ThemedText type="small" themeColor="textSecondary">
            Your link code
          </ThemedText>
          <ThemedText type="title" style={[styles.codeText, { color: theme.accent }]} selectable>
            {formatLinkCode(code)}
          </ThemedText>
          {expires_at ? (
            <ThemedText type="small" themeColor="textSecondary">
              Works once, until {formatDateString(expires_at.slice(0, 10))}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      {parents_waiting.map((parent) => (
        <ThemedText key={parent} type="small" themeColor="textSecondary">
          ✓ {parent} has entered your code. A club admin will check and link them.
        </ThemedText>
      ))}
      {code ? (
        <View style={styles.actions}>
          <Button
            title="Share code"
            onPress={() =>
              Share.share({ message: linkCodeMessage(code, club.name, name, FirstPass.appName) })
            }
          />
          <Button
            title={copied ? 'Code copied' : 'Copy code'}
            variant="secondary"
            onPress={() => Clipboard.setStringAsync(formatLinkCode(code)).then(() => setCopied(true))}
          />
        </View>
      ) : null}
      <Button title="Make a new code" variant="secondary" onPress={makeNewCode} busy={making} />
      <ThemedText type="small" themeColor="textSecondary">
        A new code stops the old one working. Only share it with your parent or guardian.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

type Request = { athlete_id: string; athlete_name: string | null; requested_at: string };

/**
 * A parent or guardian enters their child's link code. A club admin then checks
 * who they are and links them to that child.
 */
export function ChildCodeCard({ title = 'Enter your child’s code' }: { title?: string }) {
  const { refresh } = useAuth();
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);

  const loadRequests = useCallback(
    () =>
      supabase
        .rpc('my_link_requests')
        .then(({ data }) => setRequests((data as Request[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    supabase
      .rpc('my_link_requests')
      .then(({ data }) => setRequests((data as Request[] | null) ?? []));
  }, []);

  async function enter() {
    if (!looksLikeLinkCode(typed)) {
      setError('Enter the 6-letter code from your child’s app, such as 7KQ-4MD.');
      return;
    }
    setSaving(true);
    setError(null);
    // A wrong code comes back as a message, not an error, so the database can
    // keep count of wrong tries.
    const { data: refused, error: rpcError } = await supabase.rpc('enter_child_code', {
      p_code: typed,
    });
    setSaving(false);
    if (rpcError || refused) {
      setError(rpcError?.message ?? String(refused));
      return;
    }
    setTyped('');
    await Promise.all([loadRequests(), refresh()]);
  }

  return (
    <Card>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your child under 18 sees a link code in their app when they join. Enter it here, and a club
        admin checks who you are and links you to them. Each code works once.
      </ThemedText>
      {requests.map((r) => (
        <ThemedText key={r.athlete_id} type="small" themeColor="textSecondary">
          ✓ You’ve entered {r.athlete_name ?? 'your child'}’s code. A club admin will check and
          link you.
        </ThemedText>
      ))}
      <TextField
        label="Child’s code"
        value={typed}
        onChangeText={setTyped}
        placeholder="7KQ-4MD"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        maxLength={9}
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Enter code" onPress={enter} busy={saving} />
    </Card>
  );
}

const styles = StyleSheet.create({
  code: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  codeText: {
    letterSpacing: 4,
  },
  actions: {
    gap: Spacing.two,
  },
});
