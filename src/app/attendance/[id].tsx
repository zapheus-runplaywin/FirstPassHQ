import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AttendanceRegister } from '@/components/attendance-register';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { marksToSave } from '@/lib/attendance';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark, AttendanceSession } from '@/lib/types';

export default function AttendanceSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<AttendanceSession | null | undefined>(undefined);
  const [register, setRegister] = useState<AttendanceMark[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [sessionResult, registerResult] = await Promise.all([
      supabase.rpc('attendance_sessions_list').eq('id', id).maybeSingle(),
      supabase.rpc('attendance_register', { p_session_id: id }),
    ]);
    const loaded = (sessionResult.data as AttendanceSession | null) ?? null;
    setSession(loaded);
    setName(loaded?.name ?? '');
    setRegister((registerResult.data as AttendanceMark[] | null) ?? []);
  }, [id]);

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

  function mark(profileId: string, present: boolean) {
    setRegister((r) => r.map((m) => (m.profile_id === profileId ? { ...m, present } : m)));
  }

  async function save() {
    if (!session) return;
    if (!name.trim()) {
      setError('Name the session.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_attendance', {
      p_session_id: session.id,
      p_team_id: session.team_id,
      p_name: name,
      p_held_at: session.held_at,
      p_marks: marksToSave(register),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setEditing(false);
    await load();
  }

  async function cancel() {
    setEditing(false);
    setError(null);
    await load();
  }

  if (session === undefined) return null;
  if (session === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This attendance record isn’t available.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        {editing ? (
          <TextField label="Session" value={name} onChangeText={setName} maxLength={100} />
        ) : (
          <ThemedText type="subtitle">{session.name}</ThemedText>
        )}
        <ThemedText themeColor="textSecondary">{session.team_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateTime(new Date(session.held_at))}
          {session.taken_by_name ? ` · Taken by ${session.taken_by_name}` : ''}
        </ThemedText>
      </View>

      <AttendanceRegister register={register} onChange={editing ? mark : undefined} />

      <ErrorText>{error}</ErrorText>
      {session.can_edit ? (
        editing ? (
          <View style={styles.actions}>
            <Button title="Save changes" onPress={save} busy={saving} />
            <Button title="Cancel" variant="secondary" onPress={cancel} disabled={saving} />
          </View>
        ) : (
          <Button title="Change attendance" variant="secondary" onPress={() => setEditing(true)} />
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  actions: {
    gap: Spacing.two,
  },
});
