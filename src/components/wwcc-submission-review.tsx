import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { localDay } from '@/lib/reports';
import { wwccValidationLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { Profile, WwccSubmission, WwccValidationMethod } from '@/lib/types';

const methods = Object.keys(wwccValidationLabels) as WwccValidationMethod[];

/**
 * A card the member sent in themselves, on their admin page. The admin checks
 * it with the Screening Unit and accepts it, which records the card and its
 * validation together so a paused role starts again, or sends it back with a
 * note the member reads. Nobody checks their own card.
 */
export function WwccSubmissionReview({
  memberId,
  isSelf,
  onAccepted,
}: {
  memberId: string;
  isSelf: boolean;
  /** The card as now recorded on the member. */
  onAccepted: (changes: Partial<Profile>) => void;
}) {
  const theme = useTheme();
  const club = useClub();
  const { session } = useAuth();
  const [submission, setSubmission] = useState<WwccSubmission | null>(null);
  const [cardName, setCardName] = useState('');
  const [method, setMethod] = useState<WwccValidationMethod | null>(null);
  const [linked, setLinked] = useState(false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_wwcc_submissions');
    const mine =
      ((data as WwccSubmission[] | null) ?? []).find((s) => s.profile_id === memberId) ?? null;
    setSubmission(mine);
    setCardName(mine?.card_name ?? '');
  }, [memberId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (done) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {done}
      </ThemedText>
    );
  }
  if (!submission) return null;

  async function accept() {
    if (!submission) return;
    if (!method) {
      setError('Choose how you checked the card.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_accept_wwcc_submission', {
      p_submission_id: submission.id,
      p_card_name: cardName,
      p_method: method,
      p_unit_linked: linked,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const now = new Date().toISOString();
    onAccepted({
      wwcc_number: submission.card_number,
      wwcc_expires_on: submission.expires_on,
      wwcc_card_name: cardName.trim(),
      wwcc_validated_at: now,
      wwcc_validated_by: session?.user.id ?? null,
      wwcc_validation_method: method,
      wwcc_unit_linked_at: linked ? now : null,
    });
    setDone('Card accepted and validated. Their roles that needed it start again now.');
  }

  async function sendBack() {
    if (!submission) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_return_wwcc_submission', {
      p_submission_id: submission.id,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDone('Sent back. They’ll see your note and a to-do to send it again.');
  }

  return (
    <Card style={styles.group}>
      <ThemedText type="smallBold">Card they sent in</ThemedText>
      <ThemedText type="small">
        {submission.card_number}, expires {formatDate(submission.expires_on)}. Name on the card:{' '}
        {submission.card_name}. Sent {localDay(submission.submitted_at)}.
      </ThemedText>
      {isSelf ? (
        <ThemedText type="small" themeColor="textSecondary">
          Another admin needs to check your card.
        </ThemedText>
      ) : returning ? (
        <>
          <TextField
            label="What they need to fix"
            value={note}
            onChangeText={setNote}
            placeholder="For example, the Screening Unit shows a different expiry date"
            multiline
            maxLength={500}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Send it back" variant="secondary" onPress={sendBack} busy={busy} />
          <Button title="Cancel" variant="secondary" onPress={() => setReturning(false)} />
        </>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            It doesn’t count until you accept it. Check the card on the Working with Children
            Screening Unit’s website, or sight it, then accept it. That records the card and your
            validation together.
          </ThemedText>
          <TextField
            label="Name on the card"
            value={cardName}
            onChangeText={setCardName}
            maxLength={120}
          />
          <ChipGroup
            label="How you checked it"
            options={methods.map((m) => ({ value: m, label: wwccValidationLabels[m] }))}
            selected={method ? [method] : []}
            onToggle={(m) => setMethod(m === method ? null : m)}
          />
          <View style={styles.switchRow}>
            <View style={styles.grow}>
              <ThemedText type="small">Registered card with {club.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                So the Screening Unit tells the club if the card’s status changes
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel={`Registered card with ${club.name}`}
              value={linked}
              onValueChange={setLinked}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
              thumbColor={theme.text}
              {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
            />
          </View>
          <ErrorText>{error}</ErrorText>
          <Button title="Accept and validate" onPress={accept} busy={busy} />
          <Button title="Send it back" variant="secondary" onPress={() => setReturning(true)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
