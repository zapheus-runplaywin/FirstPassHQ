import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type AbsenceReason, useAbsenceReasons } from '@/lib/absences';
import { supabase } from '@/lib/supabase';

/**
 * The reasons athletes and parents choose from when they report an absence.
 * Admins switch reasons off and add the club's own. Reasons are never
 * deleted, so absences reported with one keep it.
 */
export default function AbsenceReasonsScreen() {
  const { reasons, reload } = useAbsenceReasons(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Type the reason first.');
      return;
    }
    if (reasons?.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('That reason is already on the list. Switch it on instead.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('absence_categories').insert({
      name: trimmed,
      sort_order: Math.max(0, ...(reasons ?? []).map((r) => r.sort_order)) + 1,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName('');
    await reload();
  }

  async function toggle(reason: AbsenceReason, active: boolean) {
    setError(null);
    const { error: updateError } = await supabase
      .from('absence_categories')
      .update({ active })
      .eq('id', reason.id);
    if (updateError) setError(updateError.message);
    await reload();
  }

  if (reasons === null) return null;
  const on = reasons.filter((r) => r.active).length;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Athletes and parents choose one of these when they report an absence, and the Attendance
        report counts absences by reason. Switch off the ones your club doesn’t use. Absences
        already reported keep their reason.
      </ThemedText>

      <View style={styles.section}>
        <ThemedText type="smallBold">
          Reasons ({on} of {reasons.length} on)
        </ThemedText>
        {reasons.map((reason) => (
          <ReasonRow key={reason.id} reason={reason} onToggle={(value) => toggle(reason, value)} />
        ))}
        {on === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            With every reason off, members report absences without one.
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Add a reason</ThemedText>
        <TextField
          label="Reason"
          value={name}
          onChangeText={setName}
          placeholder="For example, State League final"
          maxLength={40}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Add reason" onPress={add} busy={saving} />
      </View>
    </Screen>
  );
}

function ReasonRow({
  reason,
  onToggle,
}: {
  reason: AbsenceReason;
  onToggle: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.row}>
      <View style={styles.rowText}>
        <ThemedText type="smallBold">{reason.name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {reason.active ? 'On' : 'Off'}
        </ThemedText>
      </View>
      <Switch
        accessibilityLabel={reason.name}
        value={reason.active}
        onValueChange={onToggle}
        trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
        thumbColor={theme.text}
        {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
