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
  /** Months the text of a message involving a child is kept. */
  child_messages_months: number;
  /** Days after clearance an injury's files are kept. */
  injury_documents_days: number;
};

type PeriodKey = Exclude<
  keyof Retention,
  'enabled' | 'updated_by_name' | 'updated_at' | 'injury_documents_days'
>;

async function loadRetention() {
  const [{ data }, { data: childMonths }, { data: days }] = await Promise.all([
    supabase.rpc('record_retention').maybeSingle(),
    supabase.rpc('child_messages_keep_months'),
    supabase.rpc('injury_documents_keep_days'),
  ]);
  if (!data) return null;
  return {
    ...(data as Omit<Retention, 'child_messages_months' | 'injury_documents_days'>),
    child_messages_months: typeof childMonths === 'number' ? childMonths : 84,
    injury_documents_days: typeof days === 'number' ? days : 365,
  } as Retention;
}

const oneToFive = [12, 24, 36, 48, 60];
const children = [36, 60, 84, 120, 180];

const periods: { key: PeriodKey; label: string; note: string; choices: number[] }[] = [
  {
    key: 'check_ins_months',
    label: 'Daily check-ins',
    note: 'From the day of the check-in. Coaches use recent weeks, so 1 year is enough for most clubs. If a check-in worries you, raise a concern: concerns are never removed.',
    choices: [3, 6, 12, 24],
  },
  {
    key: 'goals_months',
    label: 'Game goals, reflections and athletes’ season KPIs',
    note: 'Game goals from the game, with their comments and team goals. Athletes’ season KPIs and reviews from their last change, once their season is archived. Recommended: 1 year.',
    choices: oneToFive,
  },
  {
    key: 'messages_months',
    label: 'Message text',
    note: 'Messages between adults. Only the words go: the message stays, with who sent it, who it went to and who read it. Recommended: 3 years.',
    choices: [12, 24, 36, 60, 84],
  },
  {
    key: 'child_messages_months',
    label: 'Message text involving a child',
    note: 'Messages sent by or to anyone who was under 18 at the time, kept at least as long as other messages so a late complaint about what was said can still be checked. Recommended: 7 years.',
    choices: children,
  },
  {
    key: 'attendance_months',
    label: 'Attendance',
    note: 'Who was at each session, with absences and session plans, from the day of the session. Recommended: 1 year.',
    choices: oneToFive,
  },
  {
    key: 'certificates_months',
    label: 'Training certificates',
    note: 'From when the certificate was added, with its file. Recommended: 1 year.',
    choices: oneToFive,
  },
  {
    key: 'access_log_months',
    label: 'Who viewed a child’s records',
    note: 'Which adults opened a child’s details, so a guardian or the club can check later. Recommended: 7 years.',
    choices: children,
  },
];

const injuryDocumentDays = [90, 365, 1095];

/** The choices, plus the club's saved period when it's one no longer offered. */
function withSaved(choices: number[], saved: number | undefined) {
  return saved === undefined || choices.includes(saved)
    ? choices
    : [...choices, saved].sort((a, b) => a - b);
}

function months(m: number) {
  if (m % 12 !== 0) return `${m} ${m === 1 ? 'month' : 'months'}`;
  const y = m / 12;
  return `${y} ${y === 1 ? 'year' : 'years'}`;
}

function days(d: number) {
  if (d % 365 === 0) {
    const y = d / 365;
    return `${y} ${y === 1 ? 'year' : 'years'}`;
  }
  return `${d} days`;
}

/**
 * How long the club keeps everyday records, and the switch that lets the
 * daily clean-up remove anything older. Concerns are never removed, and
 * injuries keep their own 12 months after an athlete leaves; their files go
 * a chosen time after clearance. A period the club saved before it stopped
 * being offered still shows, so saving never shortens it.
 */
export function RecordRetention() {
  const theme = useTheme();
  const [saved, setSaved] = useState<Retention | null>(null);
  const [draft, setDraft] = useState<Retention | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    loadRetention().then((row) => {
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
    const { error: rpcError } = await supabase.rpc('admin_set_record_retention_all', {
      p_enabled: draft.enabled,
      p_check_ins_months: draft.check_ins_months,
      p_goals_months: draft.goals_months,
      p_messages_months: draft.messages_months,
      p_child_messages_months: draft.child_messages_months,
      p_attendance_months: draft.attendance_months,
      p_certificates_months: draft.certificates_months,
      p_access_log_months: draft.access_log_months,
      p_injury_documents_days: draft.injury_documents_days,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const row = (await loadRetention()) ?? draft;
    setSaved(row);
    setDraft(row);
    setNotice('Saved.');
  }

  const changed = JSON.stringify(saved) !== JSON.stringify(draft);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Keeping records</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        How long the club keeps members’ records, adults’ and children’s. Concerns are never
        removed. Injuries are removed 12 months after an athlete leaves.
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
            options={withSaved(p.choices, saved?.[p.key]).map((m) => ({
              value: String(m),
              label: months(m),
            }))}
            selected={[String(draft[p.key])]}
            onToggle={(value) => setDraft({ ...draft, [p.key]: Number(value) })}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {p.note}
          </ThemedText>
        </View>
      ))}
      <View style={styles.period}>
        <ChipGroup
          label="Injury documents"
          options={withSaved(injuryDocumentDays, saved?.injury_documents_days).map((d) => ({
            value: String(d),
            label: days(d),
          }))}
          selected={[String(draft.injury_documents_days)]}
          onToggle={(value) => setDraft({ ...draft, injury_documents_days: Number(value) })}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Letters, reports and photos go this long after the injury is cleared. The injury, its
          sign-offs and who added and viewed each document stay. Recommended: 1 year.
        </ThemedText>
      </View>
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
