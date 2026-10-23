import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { dayLabel, EffortScale, SessionLogList, WeeklyLoad } from '@/components/session-log';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { today } from '@/lib/check-ins';
import { toDateString } from '@/lib/injuries';
import {
  loggableDays,
  MAX_MINUTES,
  SESSION_KINDS,
  SESSION_LOG_COLUMNS,
  sessionProblem,
} from '@/lib/session-logs';
import { supabase } from '@/lib/supabase';
import type { SessionKind, SessionLog } from '@/lib/types';

/** Four weeks of sessions, for the weekly load. */
const HISTORY_DAYS = 28;

type Draft = { id: string | null; day: string; kind: SessionKind; minutes: string; rpe: number | null };

const blank = (): Draft => ({ id: null, day: today(), kind: 'training', minutes: '', rpe: null });

/**
 * The athlete's training log beside their check-in: each session's minutes
 * and how hard it felt (customer review R10). Shown only to athletes.
 */
export function SessionLogSection({ athleteId, minor }: { athleteId: string; minor: boolean }) {
  const [logs, setLogs] = useState<SessionLog[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_DAYS);
    const { data } = await supabase
      .from('session_logs')
      .select(SESSION_LOG_COLUMNS)
      .eq('athlete_id', athleteId)
      .gte('day', toDateString(since))
      .order('day', { ascending: false })
      .order('updated_at', { ascending: false });
    setLogs((data as SessionLog[] | null) ?? []);
  }, [athleteId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function edit(log: SessionLog) {
    setError(null);
    setDraft({ id: log.id, day: log.day, kind: log.kind, minutes: String(log.minutes), rpe: log.rpe });
  }

  async function save() {
    if (!draft) return;
    const problem = sessionProblem(draft.minutes, draft.rpe);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_session_log', {
      p_id: draft.id,
      p_day: draft.day,
      p_kind: draft.kind,
      p_minutes: Number(draft.minutes.trim()),
      p_rpe: draft.rpe,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setDraft(null);
    await load();
  }

  async function remove() {
    if (!draft?.id) return;
    setSaving(true);
    setError(null);
    const { error: deleteError } = await supabase.rpc('delete_session_log', { p_id: draft.id });
    setSaving(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setDraft(null);
    await load();
  }

  // A session being changed keeps its own day in the choices, even if it's
  // too old to log now; the database decides.
  const days = loggableDays(today());
  if (draft && !days.includes(draft.day)) days.push(draft.day);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Training sessions</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Log each training, game or gym session: how long it was and how hard it felt. Minutes times
        effort is the session’s load, so you and your coaches can see your week build up.{' '}
        {minor
          ? 'Your parents or guardians see them, and your coaches once a parent or guardian agrees.'
          : 'Your coaches see them.'}{' '}
        Your teammates never do.
      </ThemedText>
      {logs ? <WeeklyLoad logs={logs} /> : null}

      {draft ? (
        <View style={styles.section}>
          <ChipGroup
            label="Day"
            options={days.map((d) => ({ value: d, label: dayLabel(d) }))}
            selected={[draft.day]}
            onToggle={(day) => setDraft({ ...draft, day })}
          />
          <ChipGroup
            label="Session"
            options={SESSION_KINDS}
            selected={[draft.kind]}
            onToggle={(kind) => setDraft({ ...draft, kind })}
          />
          <TextField
            label="Minutes"
            value={draft.minutes}
            onChangeText={(minutes) => setDraft({ ...draft, minutes })}
            keyboardType="number-pad"
            placeholder="For example, 90"
            maxLength={String(MAX_MINUTES).length}
          />
          <EffortScale value={draft.rpe} onChange={(rpe) => setDraft({ ...draft, rpe })} />
          <ErrorText>{error}</ErrorText>
          <Button
            title={draft.id ? 'Update session' : 'Save session'}
            onPress={save}
            busy={saving}
          />
          {draft.id ? (
            <Button title="Delete session" variant="danger" onPress={remove} disabled={saving} />
          ) : null}
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setDraft(null);
              setError(null);
            }}
            disabled={saving}
          />
        </View>
      ) : (
        <Button title="Log a session" variant="secondary" onPress={() => setDraft(blank())} />
      )}

      {logs && logs.length > 0 ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Tap a session to change or delete it.
          </ThemedText>
          <SessionLogList logs={logs} onPress={edit} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
});
