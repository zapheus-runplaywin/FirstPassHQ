import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Retention = {
  enabled: boolean;
  check_ins_months: number;
  goals_months: number;
  messages_months: number;
  attendance_months: number;
  certificates_months: number;
  access_log_months: number;
  updated_by_name: string | null;
  updated_at: string | null;
};

type PeriodKey = Exclude<keyof Retention, 'enabled' | 'updated_by_name' | 'updated_at'>;

const everyday = [12, 24, 36, 60, 120];
const safety = [84, 120, 180, 240];

const periods: { key: PeriodKey; label: string; note: string; choices: number[] }[] = [
  { key: 'check_ins_months', label: 'Daily check-ins', note: 'From the day of the check-in.', choices: everyday },
  {
    key: 'goals_months',
    label: 'Game goals and reflections',
    note: 'From the game, with their comments and team goals.',
    choices: everyday,
  },
  {
    key: 'messages_months',
    label: 'Message text',
    note: 'The message itself stays, with who sent it, who it went to and who read it.',
    choices: everyday,
  },
  {
    key: 'attendance_months',
    label: 'Attendance',
    note: 'The record of who was with which children: at least 7 years.',
    choices: safety,
  },
  {
    key: 'certificates_months',
    label: 'Training certificates',
    note: 'From when the certificate was added: at least 7 years.',
    choices: safety,
  },
  {
    key: 'access_log_months',
    label: 'Who viewed a child’s records',
    note: 'At least 7 years.',
    choices: safety,
  },
];

function years(months: number) {
  const y = months / 12;
  return `${y} ${y === 1 ? 'year' : 'years'}`;
}

/**
 * How long the club keeps everyday records, and the switch that lets the
 * daily clean-up remove anything older. Concerns are never removed, and
 * injuries keep their own 12 months after an athlete leaves.
 */
export function RecordRetention() {
  const theme = useTheme();
  const [saved, setSaved] = useState<Retention | null>(null);
  const [draft, setDraft] = useState<Retention | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .rpc('record_retention')
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as Retention | null) ?? null;
        setSaved(row);
        setDraft(row);
      });
  }, []);

  if (!draft) return null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: rpcError } = await supabase.rpc('admin_set_record_retention', {
      p_enabled: draft.enabled,
      p_check_ins_months: draft.check_ins_months,
      p_goals_months: draft.goals_months,
      p_messages_months: draft.messages_months,
      p_attendance_months: draft.attendance_months,
      p_certificates_months: draft.certificates_months,
      p_access_log_months: draft.access_log_months,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const { data } = await supabase.rpc('record_retention').maybeSingle();
    const row = (data as Retention | null) ?? draft;
    setSaved(row);
    setDraft(row);
    setNotice('Saved.');
  }

  const changed = JSON.stringify(saved) !== JSON.stringify(draft);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Keeping records</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        How long the club keeps members’ records, including children’s. Concerns are never removed.
        Injuries are removed 12 months after an athlete leaves.
      </ThemedText>
      <Card style={styles.row}>
        <View style={styles.text}>
          <ThemedText type="smallBold">Remove old records</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Each night, records older than these periods are removed for good. They can’t be brought
            back.
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="Remove old records"
          value={draft.enabled}
          onValueChange={(enabled) => setDraft({ ...draft, enabled })}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.text}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
        />
      </Card>
      {periods.map((p) => (
        <View key={p.key} style={styles.period}>
          <ChipGroup
            label={p.label}
            options={p.choices.map((m) => ({ value: String(m), label: years(m) }))}
            selected={[String(draft[p.key])]}
            onToggle={(value) => setDraft({ ...draft, [p.key]: Number(value) })}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {p.note}
          </ThemedText>
        </View>
      ))}
      {saved?.updated_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last changed by {saved.updated_by_name ?? 'an admin'},{' '}
          {formatDateTime(new Date(saved.updated_at))}.
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save keep periods" onPress={save} busy={busy} disabled={!changed} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  text: { flex: 1, gap: Spacing.one },
  period: { gap: Spacing.one },
});
