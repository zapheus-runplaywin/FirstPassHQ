import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { localDay } from '@/lib/reports';
import { wwccRecordIssues, wwccValidationLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { Profile, WwccValidationMethod } from '@/lib/types';

const methods = Object.keys(wwccValidationLabels) as WwccValidationMethod[];

/**
 * An admin records checking a member's current card: the name on it, how it
 * was checked and whether the card is registered with the club, so the
 * Screening Unit tells the club if its status changes.
 * The app keeps who did it and when. Nobody validates their own card.
 */
export function WwccValidation({
  member,
  isSelf,
  validatorName,
  onSaved,
}: {
  member: Profile;
  isSelf: boolean;
  /** Who validated the card last, by their member id. */
  validatorName: (id: string) => string;
  onSaved: (changes: Partial<Profile>) => void;
}) {
  const theme = useTheme();
  const club = useClub();
  const { session } = useAuth();
  const [cardName, setCardName] = useState(member.wwcc_card_name ?? member.full_name ?? '');
  const [method, setMethod] = useState<WwccValidationMethod | null>(null);
  const [linked, setLinked] = useState(!!member.wwcc_unit_linked_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = wwccRecordIssues(member);

  async function validate() {
    if (!method) {
      setError('Choose how you checked the card.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_validate_wwcc', {
      p_profile_id: member.id,
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
    setMethod(null);
    onSaved({
      wwcc_card_name: cardName.trim(),
      wwcc_validated_at: now,
      wwcc_validated_by: session?.user.id ?? null,
      wwcc_validation_method: method,
      wwcc_unit_linked_at: linked ? (member.wwcc_unit_linked_at ?? now) : null,
    });
  }

  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Validation</ThemedText>
      {member.wwcc_validated_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          {wwccValidationLabels[member.wwcc_validation_method ?? 'online']} on{' '}
          {localDay(member.wwcc_validated_at)} by{' '}
          {member.wwcc_validated_by ? validatorName(member.wwcc_validated_by) : 'a former admin'}
          {member.wwcc_card_name ? `. Name on card: ${member.wwcc_card_name}` : ''}.
          {member.wwcc_unit_linked_at
            ? ` Registered with ${club.name} on ${localDay(member.wwcc_unit_linked_at)}.`
            : ''}
        </ThemedText>
      ) : null}
      {issues.length > 0 ? (
        <StatusLine text={`${issues.join('. ')}.`} tone="attention" />
      ) : null}
      {isSelf ? (
        <ThemedText type="small" themeColor="textSecondary">
          Another admin needs to validate your card.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Check the card on the Working with Children Screening Unit’s website, or sight it, at
            least once a year and whenever it’s renewed.
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
          <Card style={styles.switchRow}>
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
          </Card>
          <ErrorText>{error}</ErrorText>
          <Button title="Record validation" variant="secondary" onPress={validate} busy={busy} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
