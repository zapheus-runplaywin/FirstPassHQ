import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AgendaRow, agendaRows } from '@/components/agenda';
import { TabHeader } from '@/components/home/tab-header';
import { MonthGrid } from '@/components/month-grid';
import { Screen, useScrollToY } from '@/components/screen';
import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/lib/calendar';
import {
  addDays,
  dayKey,
  formatDay,
  formatMonth,
  monthKey,
  startOfDay,
  startOfWeek,
} from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { useFeature } from '@/lib/club';
import { toDateString } from '@/lib/injuries';
import { eventGroups, waitingSuggestions } from '@/lib/team-events';
import { earliestDay, latestDay, useEvents, useHqCalendarChoices } from '@/lib/use-events';
import { useTeams } from '@/lib/use-teams';

type CalendarView = 'list' | 'month';

/** Leaves room for the pinned month heading when jumping to a day. */
const HEADING_HEIGHT = 44;

/** How many more months each "Load more" adds. */
const LOAD_MORE_MONTHS = 3;

const CLUB = 'club';
const ALL = 'all';

export default function CalendarScreen() {
  const {
    events,
    failed,
    reload,
    loadedUntil,
    monthsAhead,
    canLoadMore,
    loadingMore,
    showMonthsAhead,
    showPast,
  } = useEvents();
  // Members can look back 12 months and ahead 12 months.
  const [earliest] = useState(() => earliestDay());
  const [latest] = useState(() => latestDay());
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<CalendarView>('list');
  const [filter, setFilter] = useState(ALL);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  // Where the list starts when it isn't today: the week the strip moved to, or
  // the month that was open in month view.
  const [listStart, setListStart] = useState<Date | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() => dayKey(new Date()));
  // The day tapped in month view, or null to show the whole month.
  const [monthDay, setMonthDay] = useState<string | null>(null);
  // Where each day starts in the list, reported as rows are laid out.
  const [dayY] = useState(() => new Map<string, number>());

  /** Loads far enough back or ahead to include a date, up to the limits. */
  function loadThrough(date: Date) {
    const today = new Date();
    const months =
      (date.getFullYear() - today.getFullYear()) * 12 + date.getMonth() - today.getMonth();
    if (months < 0) showPast();
    else showMonthsAhead(months + 1);
  }

  // A squad's or team's coaches and managers, and admins, add its events here.
  const { memberships, isAdmin, profile } = useAuth();
  const teams = useTeams();
  const teamEventsOn = useFeature('teamEvents');
  const addFor =
    teamEventsOn && profile?.status === 'approved' ? eventGroups(teams, memberships, isAdmin) : [];
  /** Starts a new event on the day being looked at, for the squad or team filtered to. */
  function addEvent() {
    const picked = view === 'month' ? monthDay : selectedDay;
    // Day keys are year-month-day with the month counted from 0 (dayKey).
    const [y, m, d] = (picked ?? '').split('-').map(Number);
    const day = picked ? toDateString(new Date(y, m, d)) : undefined;
    const team = filter.startsWith('team:') ? filter.slice('team:'.length) : undefined;
    const calendar = addTo.find((c) => c.id === filter)?.id;
    router.push({
      pathname: '/event/edit',
      params: {
        ...(day ? { day } : null),
        ...(team ? { team } : null),
        ...(calendar ? { calendar } : null),
      },
    });
  }
  // The calendars kept in the app: admins add to them, and coaches, managers
  // and committee members suggest events for an admin to accept.
  const { choices: addTo } = useHqCalendarChoices();
  // With nothing to add to but suggestions, the button says so.
  const onlySuggests = addFor.length === 0 && addTo.length > 0 && addTo.every((c) => c.suggest);
  const add =
    addFor.length > 0 || addTo.length > 0 ? (
      <Button
        key="add"
        title={onlySuggests ? 'Suggest an event' : 'Add an event'}
        variant="secondary"
        onPress={addEvent}
      />
    ) : null;
  // Suggestions waiting for an admin's answer, above everything else on their calendar.
  const waiting = useMemo(() => (isAdmin ? waitingSuggestions(events ?? []).length : 0), [events, isAdmin]);
  const toAnswer =
    waiting > 0 ? (
      <Pressable
        key="suggestions"
        accessibilityRole="button"
        onPress={() => router.push('/admin/event-suggestions')}>
        <StatusLine
          tone="attention"
          text={`${waiting} suggested ${waiting === 1 ? 'event' : 'events'} to answer`}
        />
      </Pressable>
    ) : null;

  const loadMore = (
    <LoadMore
      key="load-more"
      loadedUntil={loadedUntil}
      canLoadMore={canLoadMore}
      busy={loadingMore}
      onPress={() => showMonthsAhead(monthsAhead + LOAD_MORE_MONTHS)}
    />
  );

  /** Changes view, keeping the month or week being looked at. */
  function switchView(next: CalendarView) {
    if (next === view) return;
    if (next === 'list') {
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const thisMonth = monthKey(month) === monthKey(new Date());
      setWeekStart(startOfWeek(thisMonth ? new Date() : first));
      setListStart(thisMonth ? null : first);
      setSelectedDay(dayKey(thisMonth ? new Date() : first));
    } else {
      setMonth(listStart ?? new Date());
      setMonthDay(null);
    }
    setView(next);
  }

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  // The squad and team calendars this member can see, for the filter chips.
  const calendars = useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of events ?? []) {
      if (!event.clubWide) seen.set(event.calendarId, event.calendarName);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [events]);

  const filtered = useMemo(
    () =>
      (events ?? []).filter((event) =>
        filter === ALL ? true : filter === CLUB ? event.clubWide : event.calendarId === filter,
      ),
    [events, filter],
  );

  // The calendar colours with something on, for each day.
  const eventDays = useMemo(() => {
    const days = new Map<string, string[]>();
    for (const event of filtered) {
      const colors = days.get(dayKey(event.start)) ?? [];
      if (!colors.includes(event.color)) colors.push(event.color);
      days.set(dayKey(event.start), colors);
    }
    return days;
  }, [filtered]);

  const top = [
    failed.length > 0 ? (
      <ErrorText key="error">
        {Platform.OS === 'web'
          ? 'Outlook calendars only load in the phone app, because web browsers block them. Open the app in Expo Go to see events.'
          : `Couldn't load ${failed.join(', ')}. Pull down to try again.`}
      </ErrorText>
    ) : null,
    <ChipGroup
      key="view"
      options={[
        { value: 'list', label: 'List' },
        { value: 'month', label: 'Month' },
      ]}
      selected={[view]}
      onToggle={switchView}
    />,
    toAnswer,
    add,
    calendars.length > 0 ? (
      <ChipGroup
        key="filter"
        options={[{ value: ALL, label: 'All' }, { value: CLUB, label: 'Club' }, ...calendars]}
        selected={[filter]}
        onToggle={setFilter}
      />
    ) : null,
  ].filter((item) => item !== null);

  const header = <TabHeader title="Calendar" />;

  if (events !== null && events.length === 0) {
    return (
      <Screen tab header={header} refreshing={refreshing} onRefresh={onRefresh} gap={Spacing.three}>
        {top}
        <ThemedText type="small" themeColor="textSecondary">
          Nothing on the calendar yet.
        </ThemedText>
        {loadMore}
      </Screen>
    );
  }

  if (view === 'month') {
    // Only this month's events: the whole month, or the day tapped.
    const monthEvents = filtered.filter((e) => monthKey(e.start) === monthKey(month));
    const shown = monthDay
      ? monthEvents.filter((e) => dayKey(e.start) === monthDay)
      : monthEvents;
    return (
      <Screen tab header={header} refreshing={refreshing} onRefresh={onRefresh} gap={Spacing.three}>
        {top}
        <MonthGrid
          month={month}
          eventDays={eventDays}
          selectedDay={monthDay}
          onSelect={(date) => setMonthDay(monthDay === dayKey(date) ? null : dayKey(date))}
          earliest={earliest}
          latest={latest}
          onChangeMonth={(next) => {
            setMonth(next);
            setMonthDay(null);
            loadThrough(next);
          }}
        />
        {shown.length > 0 ? (
          shown.map((event, i) => (
            <AgendaRow
              key={event.id}
              event={event}
              showDate={i === 0 || dayKey(event.start) !== dayKey(shown[i - 1].start)}
            />
          ))
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {monthDay ? 'Nothing on this day.' : `Nothing on in ${formatMonth(month)}.`}
          </ThemedText>
        )}
        {monthDay ? (
          <Button
            title={`Show all of ${formatMonth(month)}`}
            variant="secondary"
            onPress={() => setMonthDay(null)}
          />
        ) : null}
      </Screen>
    );
  }

  // The list starts today, or at the week or month being looked at.
  const listFrom = listStart ?? startOfDay(new Date());
  const listed = filtered.filter((event) => event.end > listFrom || event.start >= listFrom);
  const listTop = [
    ...top,
    <WeekJump
      key="week"
      events={listed}
      eventDays={eventDays}
      dayY={dayY}
      weekStart={weekStart}
      earliest={earliest}
      latest={latest}
      onChangeWeek={(next) => {
        setWeekStart(next);
        setListStart(dayKey(next) === dayKey(startOfWeek(new Date())) ? null : next);
        // Stepping back needs the week's first day, stepping ahead its last.
        loadThrough(next < weekStart ? next : addDays(next, 6));
      }}
      selectedDay={selectedDay}
      onSelect={setSelectedDay}
    />,
  ];
  const { rows, headingIndexes } = agendaRows(listed, (key, y) => {
    dayY.set(key, y);
  });

  return (
    <Screen
      tab
      header={header}
      refreshing={refreshing}
      onRefresh={onRefresh}
      gap={Spacing.three}
      stickyHeaderIndices={headingIndexes.map((i) => i + listTop.length)}>
      {[...listTop, ...rows, loadMore]}
    </Screen>
  );
}

/** The week strip in list view: tapping a day scrolls to its events. */
function WeekJump({
  events,
  eventDays,
  dayY,
  weekStart,
  earliest,
  latest,
  onChangeWeek,
  selectedDay,
  onSelect,
}: {
  events: CalendarEvent[];
  eventDays: Map<string, string[]>;
  dayY: Map<string, number>;
  weekStart: Date;
  earliest: Date;
  latest: Date;
  onChangeWeek: (weekStart: Date) => void;
  selectedDay: string | null;
  onSelect: (key: string) => void;
}) {
  const scrollToY = useScrollToY();
  return (
    <WeekStrip
      weekStart={weekStart}
      earliest={earliest}
      latest={latest}
      eventDays={eventDays}
      selectedDay={selectedDay}
      onChangeWeek={onChangeWeek}
      onSelect={(date) => {
        onSelect(dayKey(date));
        // Jump to that day, or the next day with something on.
        const next = events.find((e) => e.start >= date || dayKey(e.start) === dayKey(date));
        if (!next) return;
        const y = dayY.get(dayKey(next.start));
        if (y !== undefined) scrollToY(Math.max(0, y - HEADING_HEIGHT));
      }}
    />
  );
}

/** The end of the list: load the next few months, or say how far it goes. */
function LoadMore({
  loadedUntil,
  canLoadMore,
  busy,
  onPress,
}: {
  loadedUntil: Date;
  canLoadMore: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.loadMore}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        Showing events up to {formatDay(loadedUntil)}
        {canLoadMore ? '' : ', 12 months ahead'}.
      </ThemedText>
      {canLoadMore ? (
        <Button title="Load more" variant="secondary" onPress={onPress} busy={busy} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loadMore: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
  },
  center: {
    textAlign: 'center',
  },
});
