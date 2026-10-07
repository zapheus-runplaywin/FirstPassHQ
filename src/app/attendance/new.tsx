import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AttendanceRegister } from '@/components/attendance-register';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { marksToSave } from '@/lib/attendance';
import { formatSentAt } from '@/lib/format';
import { useMessageGroups } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark, RosterEntry, Team } from '@/lib/types';
import { useEvents } from '@/lib/use-events';
import { useTeams } from '@/lib/use-teams';

type NearbySession = { id: string; name: string; held_at: string; taken_by_name: string | null };

export default function TakeAttendanceScreen() {
  const teams = useTeams();
  // The squads and teams the member coaches or manages; every one for admins.
  const groups = useMessageGroups(teams);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [heldAt, setHeldAt] = useState(() => new Date().toISOString());
  const [register, setRegister] = useState<AttendanceMark[] | null>(null);
  const [nearby, setNearby] = useState<NearbySession[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coaches and managers who lead one group don't need to pick it.
  const selectedTeamId = teamId ?? (groups.length === 1 ? groups[0].id : null);
  const team = groups.find((t) => t.id === selectedTeamId) ?? null;
  const suggestions = useSessionSuggestions(team);

  // The athletes in the chosen squad or team, all unmarked.
  useEffect(() => {
    if (!selectedTeamId) return;
    let current = true;
    supabase.rpc('team_roster', { p_team_id: selectedTeamId }).then(({ data }) => {
      if (!current) return;
      setRegister(
        ((data as RosterEntry[] | null) ?? [])
          .filter((r) => r.team_role === 'athlete')
          .map((r) => ({ profile_id: r.profile_id, full_name: r.full_name, present: null })),
      );
    });
    return () => {
      current = false;
    };
  }, [selectedTeamId]);

  // Attendance already taken for this group within 3 hours.
  useEffect(() => {
    if (!selectedTeamId) return;
    let current = true;
    supabase
      .rpc('nearby_attendance_sessions', { p_team_id: selectedTeamId, p_held_at: heldAt })
      .then(({ data }) => {
        if (current) setNearby((data as NearbySession[] | null) ?? []);
      });
    return () => {
      current = false;
    };
  }, [selectedTeamId, heldAt]);

  function mark(profileId: string, present: boolean) {
    setRegister((r) => r?.map((m) => (m.profile_id === profileId ? { ...m, present } : m)) ?? r);
  }

  function markRestPresent() {
    setRegister((r) => r?.map((m) => (m.present === null ? { ...m, present: true } : m)) ?? r);
  }

  async function save() {
    if (!selectedTeamId || !register) {
      setError('Choose a squad or team.');
      return;
    }
    if (!name.trim()) {
      setError('Name the session, for example Tuesday training.');
      return;
    }
    if (register.some((m) => m.present === null)) {
      setError('Mark everyone present or absent first.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('save_attendance', {
      p_session_id: null,
      p_team_id: selectedTeamId,
      p_name: name,
      p_held_at: heldAt,
      p_marks: marksToSave(register),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.replace({ pathname: '/attendance/[id]', params: { id: data as string } });
  }

  const unmarked = register?.filter((m) => m.present === null).length ?? 0;

  return (
    <Screen>
      {groups.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You can take attendance for the squads and teams you coach or manage once an admin adds
          you to one.
        </ThemedText>
      ) : groups.length > 1 ? (
        <ChipGroup
          label="Squad or team"
          options={groups.map((t) => ({ value: t.id, label: t.name }))}
          selected={selectedTeamId ? [selectedTeamId] : []}
          onToggle={(value) => {
            setTeamId(value);
            setRegister(null);
            setNearby([]);
          }}
        />
      ) : (
        <ThemedText type="smallBold">{groups[0].name}</ThemedText>
      )}

      {team ? (
        <>
          <TextField
            label="Session"
            value={name}
            onChangeText={setName}
            placeholder="For example, Tuesday training"
            maxLength={100}
          />
          {suggestions.length > 0 ? (
            <ChipGroup
              label="From today’s calendar"
              options={suggestions.map((s) => ({ value: s.key, label: s.label }))}
              selected={suggestions.filter((s) => s.title === name).map((s) => s.key)}
              onToggle={(key) => {
                const suggestion = suggestions.find((s) => s.key === key);
                if (!suggestion) return;
                setName(suggestion.title);
                setHeldAt(suggestion.start.toISOString());
              }}
            />
          ) : null}

          {nearby.length > 0 ? <NearbyWarning sessions={nearby} /> : null}

          {register ? (
            <>
              <AttendanceRegister register={register} onChange={mark} />
              {unmarked > 0 ? (
                <Button
                  title="Mark the rest present"
                  variant="secondary"
                  onPress={markRestPresent}
                />
              ) : null}
            </>
          ) : null}

          <ErrorText>{error}</ErrorText>
          <Button title="Save attendance" onPress={save} busy={saving} disabled={!register} />
        </>
      ) : null}
    </Screen>
  );
}

/** Two sessions this close together are unlikely, so check it isn't a duplicate. */
function NearbyWarning({ sessions }: { sessions: NearbySession[] }) {
  const theme = useTheme();
  return (
    <Card style={[styles.warning, { borderColor: theme.accent }]}>
      <ThemedText type="smallBold" style={{ color: theme.accent }}>
        Attendance may already have been taken
      </ThemedText>
      {sessions.map((s) => (
        <View key={s.id} style={styles.nearby}>
          <ThemedText type="small">
            {s.taken_by_name ?? 'Someone'} took attendance for “{s.name}” at{' '}
            {formatSentAt(new Date(s.held_at))}. Two sessions within 3 hours of each other is
            unusual.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace({ pathname: '/attendance/[id]', params: { id: s.id } })}
            style={styles.link}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Open that record
            </ThemedText>
          </Pressable>
        </View>
      ))}
      <ThemedText type="small" themeColor="textSecondary">
        If this really is a different session, carry on and save it.
      </ThemedText>
    </Card>
  );
}

/** Today's calendar events for the squad or team, or the club, as session names. */
function useSessionSuggestions(team: Team | null) {
  const { events } = useEvents();
  if (!team || !events) return [];
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return events
    .filter(
      (e) => !e.allDay && e.start < endOfToday && (e.clubWide || e.calendarName === team.name),
    )
    .slice(0, 6)
    .map((e) => ({
      key: e.id,
      title: e.title,
      start: e.start,
      label: `${e.title} · ${formatSentAt(e.start)}`,
    }));
}

const styles = StyleSheet.create({
  warning: {
    borderWidth: 1,
    gap: Spacing.two,
  },
  nearby: {
    gap: Spacing.one,
  },
  link: {
    paddingVertical: Spacing.one,
  },
});
