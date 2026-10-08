import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AttendanceRegister } from '@/components/attendance-register';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarEvent } from '@/lib/calendar';
import { marksToSave } from '@/lib/attendance';
import { formatSentAt } from '@/lib/format';
import { useLedGroups } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark, Team } from '@/lib/types';
import { useEvents } from '@/lib/use-events';
import { teamLabel, useTeams } from '@/lib/use-teams';

type NearbySession = { id: string; name: string; held_at: string; taken_by_name: string | null };

/** The chosen group: a squad or team id, or the whole club. */
const CLUB = 'club';

/** An event counts as happening now from an hour before it starts until 30 minutes after it ends. */
const BEFORE_START_MS = 60 * 60 * 1000;
const AFTER_END_MS = 30 * 60 * 1000;

export default function TakeAttendanceScreen() {
  const teams = useTeams();
  // The squads and teams the member coaches or manages; every one for admins.
  const ledGroups = useLedGroups(teams);
  const ledIds = new Set(ledGroups.map((t) => t.id));
  // Any current squad can be chosen for whole-squad events.
  const otherSquads = teams.filter((t) => t.kind === 'squad' && !ledIds.has(t.id));
  const [choice, setChoice] = useState<string | null>(null);
  const [editedName, setEditedName] = useState<string | null>(null);
  const [chosenEvent, setChosenEvent] = useState<CalendarEvent | null>(null);
  const [takenAt] = useState(() => new Date());
  const [register, setRegister] = useState<AttendanceMark[] | null>(null);
  const [nearby, setNearby] = useState<NearbySession[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coaches and managers who lead one group start with it chosen.
  const selected = choice ?? (ledGroups.length === 1 ? ledGroups[0].id : null);
  const team =
    selected && selected !== CLUB ? (teams.find((t) => t.id === selected) ?? null) : null;
  const { today, now: eventNow } = useCalendarEvents(
    selected ? { club: selected === CLUB, team } : null,
  );

  // The event on now is suggested as the session until something else is chosen.
  const event = chosenEvent ?? eventNow;
  const name = editedName ?? event?.title ?? '';
  const heldAt = (event?.start ?? takenAt).toISOString();
  const teamId = selected === CLUB ? null : selected;

  // The athletes in the chosen squad, team or club, all unmarked.
  useEffect(() => {
    if (!selected) return;
    let current = true;
    supabase
      .rpc('attendance_roster', { p_team_id: selected === CLUB ? null : selected })
      .then(({ data }) => {
        if (!current) return;
        setRegister(
          ((data as { profile_id: string; full_name: string | null }[] | null) ?? []).map((r) => ({
            ...r,
            present: null,
          })),
        );
      });
    return () => {
      current = false;
    };
  }, [selected]);

  // Attendance already taken for this group within 3 hours.
  useEffect(() => {
    if (!selected) return;
    let current = true;
    supabase
      .rpc('nearby_attendance_sessions', {
        p_team_id: selected === CLUB ? null : selected,
        p_held_at: heldAt,
      })
      .then(({ data }) => {
        if (current) setNearby((data as NearbySession[] | null) ?? []);
      });
    return () => {
      current = false;
    };
  }, [selected, heldAt]);

  function choose(value: string) {
    setChoice(value);
    setChosenEvent(null);
    setRegister(null);
    setNearby([]);
    setError(null);
  }

  function mark(profileId: string, present: boolean) {
    setRegister((r) => r?.map((m) => (m.profile_id === profileId ? { ...m, present } : m)) ?? r);
  }

  function markRestPresent() {
    setRegister((r) => r?.map((m) => (m.present === null ? { ...m, present: true } : m)) ?? r);
  }

  async function save() {
    if (!selected || !register) {
      setError('Choose who the attendance is for.');
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
      p_team_id: teamId,
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
      <ChipGroup
        label={ledGroups.length > 0 ? 'Your squads and teams' : 'Who is it for?'}
        options={[
          ...ledGroups.map((t) => ({ value: t.id, label: teamLabel(t, teams) })),
          { value: CLUB, label: 'Whole club' },
        ]}
        selected={selected ? [selected] : []}
        onToggle={choose}
      />
      {otherSquads.length > 0 ? (
        <ChipGroup
          label="Whole squad"
          options={otherSquads.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
          selected={selected ? [selected] : []}
          onToggle={choose}
        />
      ) : null}

      {selected ? (
        <>
          <TextField
            label="Session"
            value={name}
            onChangeText={setEditedName}
            placeholder="For example, Tuesday training"
            maxLength={100}
          />
          {event && !chosenEvent && editedName === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Suggested from the calendar: it’s on now, from {formatSentAt(event.start)}.
            </ThemedText>
          ) : null}
          {today.length > 0 ? (
            <ChipGroup
              label="From today’s calendar"
              options={today.map((e) => ({
                value: e.id,
                label: `${e.title} · ${formatSentAt(e.start)}`,
              }))}
              selected={event && editedName === null ? [event.id] : []}
              onToggle={(id) => {
                setChosenEvent(today.find((e) => e.id === id) ?? null);
                setEditedName(null);
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

/**
 * Today's timed calendar events for the chosen group: club events, plus the
 * squad or team's own calendar. `now` is the one happening at the moment.
 */
function useCalendarEvents(group: { club: boolean; team: Team | null } | null) {
  const { events } = useEvents();
  if (!group || !events) return { today: [], now: null };
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const today = events.filter(
    (e) =>
      !e.allDay &&
      e.start < endOfToday &&
      (e.clubWide || (!group.club && e.calendarName === group.team?.name)),
  );
  const happening = today.filter(
    (e) =>
      e.start.getTime() - BEFORE_START_MS <= now.getTime() &&
      now.getTime() <= e.end.getTime() + AFTER_END_MS,
  );
  // Prefer the group's own event over a club one.
  const current = happening.find((e) => !e.clubWide) ?? happening[0] ?? null;
  return { today: today.slice(0, 6), now: current };
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
