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
import { useFeature } from '@/lib/club';
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
  type HqCalendarChoice,
} from '@/lib/team-events';
import {
  earliestDay,
  latestDay,
  refreshEvents,
  useEvent,
  useEvents,
  useHqCalendarChoices,
} from '@/lib/use-events';
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

/** What an event is for: a squad or team, or a calendar kept in the app. */
type Target = {
  key: string;
  teamId: string | null;
  calendarId: string | null;
  label: string;
  /** True when it is sent to an admin as a suggestion. */
  suggest: boolean;
};

const teamKey = (id: string) => `team:${id}`;
const calendarKey = (id: string) => `calendar:${id}`;

/**
 * Adds an event, or changes one (`id`): for a squad or team (its coaches and
 * managers, and admins), or on a calendar kept in the app (admins; coaches,
 * managers and committee members suggest one for an admin to accept). `team`,
 * `calendar` and `day` start a new one where the member was looking.
 */
export default function EditEventScreen() {
  const params = useLocalSearchParams<{ id?: string; team?: string; calendar?: string; day?: string }>();
  const existing = useEvent(params.id);
  const { teams, loaded } = useTeamList();
  const { memberships, isAdmin } = useAuth();
  const teamEventsOn = useFeature('teamEvents');
  const { choices, loaded: choicesLoaded } = useHqCalendarChoices();
  const { events } = useEvents();

  if (!loaded || !choicesLoaded || (params.id && existing === undefined)) return <Screen>{null}</Screen>;

  if (params.id && (!existing || !existing.teamEvent?.canManage)) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          {!existing
            ? 'This event is no longer on the calendar.'
            : existing.teamEvent?.hqCalendarId
              ? 'Only admins can change this calendar’s events.'
              : 'Only this squad’s or team’s coaches and managers can change its events.'}
        </ThemedText>
      </Screen>
    );
  }

  const targets: Target[] = [
    ...(teamEventsOn ? eventGroups(teams, memberships, isAdmin) : []).map((g) => ({
      key: teamKey(g.id),
      teamId: g.id,
      calendarId: null,
      label: teamLabel(g, teams),
      suggest: false,
    })),
    ...choices.map((c: HqCalendarChoice) => ({
      key: calendarKey(c.id),
      teamId: null,
      calendarId: c.id,
      label: c.name,
      suggest: c.suggest,
    })),
  ];
  if (!params.id && targets.length === 0) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          There’s nothing you can add an event to. A squad’s or team’s coaches and managers add
          its events, and admins add the club’s.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <EventFormScreen
      existing={existing ?? null}
      targets={targets}
      teams={teams}
      events={events ?? []}
      isAdmin={isAdmin}
      startKey={params.calendar ? calendarKey(params.calendar) : params.team ? teamKey(params.team) : undefined}
      startDay={params.day}
    />
  );
}

function formFrom(existing: CalendarEvent): EventForm {
  const details = existing.teamEvent!;
  return {
    teamId: details.teamId,
    calendarId: details.hqCalendarId ?? null,
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
  targets,
  teams,
  events,
  isAdmin,
  startKey,
  startDay,
}: {
  existing: CalendarEvent | null;
  targets: Target[];
  teams: Team[];
  events: CalendarEvent[];
  isAdmin: boolean;
  startKey: string | undefined;
  startDay: string | undefined;
}) {
  const editing = existing !== null;
  const [form, setForm] = useState<EventForm>(() => {
    if (existing) return formFrom(existing);
    const first = targets.find((t) => t.key === startKey) ?? (targets.length === 1 ? targets[0] : null);
    const day = startDay && /^\d{4}-\d{2}-\d{2}$/.test(startDay) ? startDay : clubToday();
    // A club calendar's events are rarely training, so it starts on Other.
    const kind: EventKind = first?.calendarId ? 'other' : 'training';
    return {
      teamId: first?.teamId ?? null,
      calendarId: first?.calendarId ?? null,
      kind,
      title: eventKindTitles[kind],
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

  const target =
    targets.find((t) => (form.calendarId ? t.calendarId === form.calendarId : !!form.teamId && t.teamId === form.teamId)) ??
    null;
  const onCalendar = !!form.calendarId;
  // A coach's, manager's or committee member's event on a club calendar waits for an admin.
  const suggesting = onCalendar && !isAdmin;
  // An admin changing a suggestion accepts it as changed.
  const accepting = isAdmin && existing?.pending === 'suggested';

  /** Picks what it's for and its kind, filling in from the last event like it. */
  function choose(next: Target | null, kind: EventKind) {
    if (editing) {
      set({ kind });
      return;
    }
    const result = startedFrom(form, events, next?.teamId ?? null, kind, typed, next?.calendarId ?? null);
    setForm(result.form);
    setFilledFrom(result.filledFrom);
  }

  // The first look at the form, once events have loaded: fill in from last
  // time for the squad or team it opens on.
  const [started, setStarted] = useState(false);
  if (!started && !editing && events.length > 0) {
    setStarted(true);
    if (target) choose(target, form.kind);
  }

  const group = teams.find((t) => t.id === form.teamId) ?? null;
  const groupWord = onCalendar ? 'calendar' : !group ? 'group' : group.kind === 'team' ? 'team' : 'squad';
  /** Whether an event is one of the squad's, team's or calendar's this form is for. */
  const sameHome = (e: CalendarEvent) =>
    form.calendarId ? e.calendarId === form.calendarId : !!form.teamId && !!e.teamIds?.includes(form.teamId);
  const start = form.startText.trim() ? parseTime(form.startText) : null;
  const places = useMemo(
    () =>
      placeSuggestions(events, form.teamId, 3, form.calendarId ?? null).filter(
        (p) => p !== form.location.trim(),
      ),
    [events, form.teamId, form.calendarId, form.location],
  );
  // Dots under the days this squad or team already has something on.
  const busyDays = useMemo(() => {
    const days = new Map<string, string[]>();
    for (const event of events) {
      if (event.cancelled || event.pending || !sameHome(event)) continue;
      if (existing && event.id === existing.id) continue;
      const key = dayKey(event.start);
      const colors = days.get(key) ?? [];
      if (!colors.includes(event.color)) colors.push(event.color);
      days.set(key, colors);
    }
    return days;
    // sameHome reads only the two ids below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, form.teamId, form.calendarId, existing]);
  const sameDay = useMemo(
    () =>
      events.filter(
        (e) =>
          !e.cancelled &&
          !e.pending &&
          sameHome(e) &&
          e.id !== existing?.id &&
          toDateString(e.start) === form.day,
      ),
    // sameHome reads only the two ids below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, form.teamId, form.calendarId, form.day, existing],
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
    const { error: saveError } = await supabase.rpc(result.rpc, result.args);
    setSaving(false);
    if (saveError) {
      setError(manageErrorMessage(saveError.message));
      return;
    }
    refreshEvents();
    router.back();
  }

  const more = onCalendar
    ? form.note.trim()
      ? 'With a note'
      : 'No note'
    : [
        form.staffOnly ? 'Coaches and managers only' : `Whole ${groupWord}`,
        form.note.trim() ? 'with a note' : 'no note',
      ].join(' · ');
  const heading = editing ? 'Change event' : suggesting ? 'Suggest an event' : 'Add an event';

  return (
    <Screen gap={Spacing.three}>
      <Stack.Screen options={{ title: heading }} />

      {editing || targets.length === 1 ? (
        <ThemedText type="smallBold">For {target?.label ?? existing?.calendarName ?? ''}</ThemedText>
      ) : (
        <ChipGroup
          label="For"
          options={targets.map((t) => ({ value: t.key, label: t.label }))}
          selected={target ? [target.key] : []}
          onToggle={(key) => choose(targets.find((t) => t.key === key) ?? null, form.kind)}
        />
      )}
      {suggesting ? (
        <ThemedText type="small" themeColor="textSecondary" testID="suggest-note">
          An admin checks it before it goes on the calendar. Until then only you and admins see it.
        </ThemedText>
      ) : null}

      <ChipGroup
        label="What"
        options={eventKinds.map((kind) => ({ value: kind, label: eventKindLabels[kind] }))}
        selected={[form.kind]}
        onToggle={(kind) => choose(target, kind)}
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
          Filled in from this {groupWord}’s last{' '}
          {filledFrom === 'other' ? 'event' : eventKindLabels[filledFrom].toLowerCase()}. Change anything that’s different.
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

      <FormSection title={onCalendar ? 'A note' : 'Who sees it, and a note'} summary={more}>
        {onCalendar ? (
          <ThemedText type="small" themeColor="textSecondary">
            Everyone this calendar is shown to sees the event and its note.
          </ThemedText>
        ) : (
          <>
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
          </>
        )}
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
          accepting
            ? 'Save and add to the calendar'
            : editing
              ? 'Save changes'
              : suggesting
                ? repeats
                  ? `Send ${form.repeatWeeks} events to an admin`
                  : 'Send to an admin'
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
