import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FormSection } from '@/components/form-section';
import { Screen } from '@/components/screen';
import { SettingSwitch } from '@/components/setting-switch';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import type { CalendarEvent } from '@/lib/calendar';
import { clubToday } from '@/lib/club-time';
import { addDays, dayKey, formatMonth, startOfWeek } from '@/lib/format';
import { formatDateString, parseDateString, toDateString } from '@/lib/injuries';
import { formatTime, parseTime } from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';
import {
  eventGroups,
  eventKindLabels,
  eventKindTitles,
  eventKinds,
  isEventKind,
  manageErrorMessage,
  MAX_EVENT_DAYS,
  MAX_REPEAT_WEEKS,
  placeSuggestions,
  repeatUntil,
  saveEventArgs,
  shiftDay,
  startedFrom,
  timeAfter,
  type EventForm,
  type EventKind,
} from '@/lib/team-events';
import { earliestDay, latestDay, refreshEvents, useEvent, useEvents } from '@/lib/use-events';
import { teamLabel, useTeamList } from '@/lib/use-teams';
import type { Team } from '@/lib/types';

/** How long a session usually runs, offered as one-tap finish times. */
const LENGTHS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1½ hours' },
  { minutes: 120, label: '2 hours' },
];

/** How long a weekly event usually runs for, offered as one-tap choices. */
const DEFAULT_REPEAT_WEEKS = 8;

/**
 * Adds a squad's or team's event, or changes one (`id`). `team` and `day`
 * start a new one on the squad or team and day the member was looking at.
 */
export default function EditEventScreen() {
  const params = useLocalSearchParams<{ id?: string; team?: string; day?: string }>();
  const existing = useEvent(params.id);
  const { teams, loaded } = useTeamList();
  const { memberships, isAdmin } = useAuth();
  const { events } = useEvents();

  if (!loaded || (params.id && existing === undefined)) return <Screen>{null}</Screen>;

  if (params.id && (!existing || !existing.teamEvent?.canManage)) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          {existing
            ? 'Only this squad’s or team’s coaches and managers can change its events.'
            : 'This event is no longer on the calendar.'}
        </ThemedText>
      </Screen>
    );
  }

  const groups = eventGroups(teams, memberships, isAdmin);
  if (!params.id && groups.length === 0) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          Events are added by the coaches and managers of a squad or team, and by admins. You
          aren’t a coach or manager of a current squad or team.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <EventFormScreen
      existing={existing ?? null}
      groups={groups}
      teams={teams}
      events={events ?? []}
      startTeam={params.team}
      startDay={params.day}
    />
  );
}

function formFrom(existing: CalendarEvent): EventForm {
  const details = existing.teamEvent!;
  return {
    teamId: details.teamId,
    kind: isEventKind(details.kind) ? details.kind : 'other',
    title: existing.title,
    day: details.day,
    allDay: existing.allDay,
    endDay: details.endDay !== details.day ? details.endDay : null,
    startText: existing.allDay ? '' : formatTime(details.startTime),
    endText: existing.allDay ? '' : formatTime(details.endTime),
    location: existing.location ?? '',
    note: existing.description ?? '',
    staffOnly: details.staffOnly,
    repeatWeeks: 0,
  };
}

function EventFormScreen({
  existing,
  groups,
  teams,
  events,
  startTeam,
  startDay,
}: {
  existing: CalendarEvent | null;
  groups: Team[];
  teams: Team[];
  events: CalendarEvent[];
  startTeam: string | undefined;
  startDay: string | undefined;
}) {
  const editing = existing !== null;
  const [form, setForm] = useState<EventForm>(() => {
    if (existing) return formFrom(existing);
    const teamId =
      groups.find((g) => g.id === startTeam)?.id ?? (groups.length === 1 ? groups[0].id : null);
    const day = startDay && /^\d{4}-\d{2}-\d{2}$/.test(startDay) ? startDay : clubToday();
    return {
      teamId,
      kind: 'training',
      title: eventKindTitles.training,
      day,
      allDay: false,
      endDay: null,
      startText: '',
      endText: '',
      location: '',
      note: '',
      staffOnly: false,
      repeatWeeks: 0,
    };
  });
  // Whether the member has typed their own name, times or place: until they
  // have, picking a kind or a squad fills them in from last time.
  const [typed, setTyped] = useState({ title: editing, times: editing, place: editing });
  const [filledFrom, setFilledFrom] = useState<EventKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (changes: Partial<EventForm>) => setForm((current) => ({ ...current, ...changes }));

  /** Picks the squad or team and kind, filling in from the last event like it. */
  function choose(teamId: string | null, kind: EventKind) {
    if (editing) {
      set({ kind });
      return;
    }
    const result = startedFrom(form, events, teamId, kind, typed);
    setForm(result.form);
    setFilledFrom(result.filledFrom);
  }

  // The first look at the form, once events have loaded: fill in from last
  // time for the squad or team it opens on.
  const [started, setStarted] = useState(false);
  if (!started && !editing && events.length > 0) {
    setStarted(true);
    if (form.teamId) choose(form.teamId, form.kind);
  }

  const group = teams.find((t) => t.id === form.teamId) ?? null;
  const groupWord = !group ? 'group' : group.kind === 'team' ? 'team' : 'squad';
  const start = form.startText.trim() ? parseTime(form.startText) : null;
  const places = useMemo(
    () => placeSuggestions(events, form.teamId).filter((p) => p !== form.location.trim()),
    [events, form.teamId, form.location],
  );
  // Dots under the days this squad or team already has something on.
  const busyDays = useMemo(() => {
    const days = new Map<string, string[]>();
    for (const event of events) {
      if (event.cancelled || !form.teamId || !event.teamIds?.includes(form.teamId)) continue;
      if (existing && event.id === existing.id) continue;
      const key = dayKey(event.start);
      const colors = days.get(key) ?? [];
      if (!colors.includes(event.color)) colors.push(event.color);
      days.set(key, colors);
    }
    return days;
  }, [events, form.teamId, existing]);
  const sameDay = useMemo(
    () =>
      events.filter(
        (e) =>
          !e.cancelled &&
          !!form.teamId &&
          e.teamIds?.includes(form.teamId) &&
          e.id !== existing?.id &&
          toDateString(e.start) === form.day,
      ),
    [events, form.teamId, form.day, existing],
  );

  const days = form.allDay && form.endDay ? daysBetween(form.day, form.endDay) + 1 : 1;
  const repeats = form.repeatWeeks > 1;

  async function save() {
    const result = saveEventArgs(form, existing?.teamEvent?.id ?? null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_team_event', result.args);
    setSaving(false);
    if (saveError) {
      setError(manageErrorMessage(saveError.message));
      return;
    }
    refreshEvents();
    router.back();
  }

  const more = [
    form.staffOnly ? 'Coaches and managers only' : `Whole ${groupWord}`,
    form.note.trim() ? 'with a note' : 'no note',
  ].join(' · ');

  return (
    <Screen gap={Spacing.three}>
      <Stack.Screen options={{ title: editing ? 'Change event' : 'Add an event' }} />

      {editing || groups.length === 1 ? (
        <ThemedText type="smallBold">
          For {group ? teamLabel(group, teams) : (existing?.calendarName ?? '')}
        </ThemedText>
      ) : (
        <ChipGroup
          label="For"
          options={groups.map((g) => ({ value: g.id, label: teamLabel(g, teams) }))}
          selected={form.teamId ? [form.teamId] : []}
          onToggle={(teamId) => choose(teamId, form.kind)}
        />
      )}

      <ChipGroup
        label="What"
        options={eventKinds.map((kind) => ({ value: kind, label: eventKindLabels[kind] }))}
        selected={[form.kind]}
        onToggle={(kind) => choose(form.teamId, kind)}
      />

      <TextField
        label="Name"
        value={form.title}
        maxLength={100}
        placeholder={form.kind === 'other' ? 'Such as Team photo' : undefined}
        onChangeText={(title) => {
          setTyped((t) => ({ ...t, title: true }));
          set({ title });
        }}
      />

      <DayField
        label={form.allDay && days > 1 ? 'First day' : 'Day'}
        value={form.day}
        busyDays={busyDays}
        onChange={(day) =>
          set({
            day,
            // A longer event keeps its length when its first day moves.
            endDay: form.endDay ? shiftDay(day, days - 1) : null,
          })
        }
      />
      {sameDay.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Already on that day: {sameDay.map((e) => e.title).join(', ')}.
        </ThemedText>
      ) : null}

      <View style={styles.switchRow}>
        <ThemedText type="smallBold" style={styles.flex}>
          All day
        </ThemedText>
        <SettingSwitch
          label="All day"
          value={form.allDay}
          onValueChange={(allDay) => {
            setTyped((t) => ({ ...t, times: true }));
            set({ allDay, endDay: null });
          }}
        />
      </View>

      {form.allDay ? (
        <Stepper
          label="Runs for"
          value={days === 1 ? 'One day' : `${days} days, until ${formatDateString(form.endDay!)}`}
          lessLabel="One day fewer"
          moreLabel="One day more"
          canLess={days > 1}
          canMore={days < MAX_EVENT_DAYS}
          onLess={() => set({ endDay: days > 2 ? shiftDay(form.day, days - 2) : null })}
          onMore={() => set({ endDay: shiftDay(form.day, days) })}
        />
      ) : (
        <View style={styles.block}>
          <View style={styles.times}>
            <View style={styles.flex}>
              <TextField
                label="Starts"
                value={form.startText}
                placeholder="6:00 pm"
                autoCapitalize="none"
                onChangeText={(startText) => {
                  setTyped((t) => ({ ...t, times: true }));
                  set({ startText });
                }}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Finishes"
                value={form.endText}
                placeholder="7:30 pm"
                autoCapitalize="none"
                onChangeText={(endText) => {
                  setTyped((t) => ({ ...t, times: true }));
                  set({ endText });
                }}
              />
            </View>
          </View>
          {start ? (
            <ChipGroup
              options={LENGTHS.filter((l) => timeAfter(start, l.minutes)).map((l) => ({
                value: String(l.minutes),
                label: l.label,
              }))}
              selected={LENGTHS.filter(
                (l) => form.endText.trim() && parseTime(form.endText) === timeAfter(start, l.minutes),
              ).map((l) => String(l.minutes))}
              onToggle={(minutes) => {
                setTyped((t) => ({ ...t, times: true }));
                set({ endText: formatTime(timeAfter(start, Number(minutes))) });
              }}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Write a time like 6pm or 18:00.
            </ThemedText>
          )}
        </View>
      )}

      <View style={styles.block}>
        <TextField
          label="Where"
          value={form.location}
          maxLength={200}
          placeholder="The venue or address"
          onChangeText={(location) => {
            setTyped((t) => ({ ...t, place: true }));
            set({ location });
          }}
        />
        {places.length > 0 ? (
          <ChipGroup
            // The chip shows the name of the place; the whole address goes in the field.
            options={places.map((place) => ({ value: place, label: place.split(',')[0].trim() || place }))}
            selected={[]}
            onToggle={(location) => {
              setTyped((t) => ({ ...t, place: true }));
              set({ location });
            }}
          />
        ) : null}
      </View>

      {filledFrom ? (
        <ThemedText type="small" themeColor="textSecondary">
          Filled in from this {groupWord}’s last {eventKindLabels[filledFrom].toLowerCase()}. Change anything that’s different.
        </ThemedText>
      ) : null}

      {editing ? (
        existing.teamEvent?.seriesId ? (
          <ThemedText type="small" themeColor="textSecondary">
            This changes this one only. The other weeks stay as they are.
          </ThemedText>
        ) : null
      ) : (
        <View style={styles.block}>
          <ChipGroup
            label="Repeats"
            options={[
              { value: 'once', label: 'Just this once' },
              { value: 'weekly', label: 'Every week' },
            ]}
            selected={[repeats ? 'weekly' : 'once']}
            onToggle={(choice) =>
              set({ repeatWeeks: choice === 'weekly' ? form.repeatWeeks || DEFAULT_REPEAT_WEEKS : 0 })
            }
          />
          {repeats ? (
            <>
              <Stepper
                label="For"
                value={`${form.repeatWeeks} weeks`}
                lessLabel="One week fewer"
                moreLabel="One week more"
                canLess={form.repeatWeeks > 2}
                canMore={form.repeatWeeks < MAX_REPEAT_WEEKS}
                onLess={() => set({ repeatWeeks: form.repeatWeeks - 1 })}
                onMore={() => set({ repeatWeeks: form.repeatWeeks + 1 })}
              />
              <ThemedText type="small" themeColor="textSecondary">
                The last one is on {formatDateString(repeatUntil(form.day, form.repeatWeeks))}.
              </ThemedText>
            </>
          ) : null}
        </View>
      )}

      <FormSection title="Who sees it, and a note" summary={more}>
        <ChipGroup
          label="Who sees it"
          options={[
            { value: 'all', label: `Whole ${groupWord}` },
            { value: 'staff', label: 'Coaches and managers only' },
          ]}
          selected={[form.staffOnly ? 'staff' : 'all']}
          onToggle={(choice) => set({ staffOnly: choice === 'staff' })}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {form.staffOnly
            ? `Only this ${groupWord}’s coaches and managers, and admins, see it.`
            : `Everyone in the ${groupWord} sees it: athletes, their parents and guardians, coaches, managers and physios.`}
        </ThemedText>
        <TextField
          label="Note (optional)"
          value={form.note}
          maxLength={2000}
          multiline
          placeholder="What to bring, where to meet"
          onChangeText={(note) => set({ note })}
        />
      </FormSection>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button
        title={
          editing
            ? 'Save changes'
            : repeats
              ? `Add ${form.repeatWeeks} events`
              : 'Add to the calendar'
        }
        onPress={save}
        busy={saving}
      />
    </Screen>
  );
}

function daysBetween(from: string, to: string) {
  return Math.round((parseDateString(to).getTime() - parseDateString(from).getTime()) / 86400000);
}

/**
 * Picks the day from a week at a time, with a dot under days the squad or
 * team already has something on.
 */
function DayField({
  label,
  value,
  busyDays,
  onChange,
}: {
  label: string;
  value: string;
  busyDays: Map<string, string[]>;
  onChange: (day: string) => void;
}) {
  const theme = useTheme();
  const picked = parseDateString(value);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(picked));
  const [earliest] = useState(() => earliestDay());
  const [latest] = useState(() => latestDay());
  return (
    <View style={styles.block}>
      <View style={styles.dayHeader}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {/* Thursday decides the month, so a week across two months takes the one it mostly sits in. */}
        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(addDays(weekStart, 3))}
        </ThemedText>
      </View>
      <View style={[styles.strip, { backgroundColor: theme.backgroundElement }]}>
        <WeekStrip
          weekStart={weekStart}
          eventDays={busyDays}
          selectedDay={dayKey(picked)}
          onSelect={(date) => onChange(toDateString(date))}
          onChangeWeek={setWeekStart}
          earliest={earliest}
          latest={latest}
        />
      </View>
      <ThemedText type="small" testID="event-day">
        {formatDateString(value)}
      </ThemedText>
    </View>
  );
}

/** A value with a button each side to take one off or add one. */
function Stepper({
  label,
  value,
  lessLabel,
  moreLabel,
  canLess,
  canMore,
  onLess,
  onMore,
}: {
  label: string;
  value: string;
  lessLabel: string;
  moreLabel: string;
  canLess: boolean;
  canMore: boolean;
  onLess: () => void;
  onMore: () => void;
}) {
  const theme = useTheme();
  const arrow = (symbol: string, name: string, enabled: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.stepArrow, { opacity: !enabled ? 0.3 : pressed ? 0.6 : 1 }]}>
      <ThemedText type="subtitle" style={{ color: theme.tint }}>
        {symbol}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.block}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={[styles.stepper, { backgroundColor: theme.backgroundElement }]}>
        {arrow('−', lessLabel, canLess, onLess)}
        <ThemedText style={styles.stepValue}>{value}</ThemedText>
        {arrow('+', moreLabel, canMore, onMore)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  block: {
    gap: Spacing.two,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  times: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  strip: {
    borderRadius: 12,
    padding: Spacing.one,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 48,
  },
  stepArrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    flex: 1,
    textAlign: 'center',
  },
});
