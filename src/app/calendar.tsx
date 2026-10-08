import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AgendaRow, agendaRows } from '@/components/agenda';
import { MonthGrid } from '@/components/month-grid';
import { Screen, useScrollToY } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/lib/calendar';
import { addDays, dayKey, formatDay, startOfDay, startOfWeek } from '@/lib/format';
import { earliestDay, latestDay, useEvents } from '@/lib/use-events';

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
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() => dayKey(new Date()));
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

  const loadMore = (
    <LoadMore
      key="load-more"
      loadedUntil={loadedUntil}
      canLoadMore={canLoadMore}
      busy={loadingMore}
      onPress={() => showMonthsAhead(monthsAhead + LOAD_MORE_MONTHS)}
    />
  );

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
      onToggle={(v: CalendarView) => setView(v)}
    />,
    calendars.length > 0 ? (
      <ChipGroup
        key="filter"
        options={[{ value: ALL, label: 'All' }, { value: CLUB, label: 'Club' }, ...calendars]}
        selected={[filter]}
        onToggle={setFilter}
      />
    ) : null,
  ].filter((item) => item !== null);

  if (events !== null && events.length === 0) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh} gap={Spacing.three}>
        {top}
        <ThemedText type="small" themeColor="textSecondary">
          Nothing on the calendar yet.
        </ThemedText>
        {loadMore}
      </Screen>
    );
  }

  if (view === 'month') {
    const dayEvents = filtered.filter((e) => dayKey(e.start) === selectedDay);
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh} gap={Spacing.three}>
        {top}
        <MonthGrid
          month={month}
          eventDays={eventDays}
          selectedDay={selectedDay}
          onSelect={(date) => setSelectedDay(dayKey(date))}
          earliest={earliest}
          latest={latest}
          onChangeMonth={(next) => {
            setMonth(next);
            loadThrough(next);
          }}
        />
        {dayEvents.length > 0 ? (
          dayEvents.map((event, i) => <AgendaRow key={event.id} event={event} showDate={i === 0} />)
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing on this day.
          </ThemedText>
        )}
      </Screen>
    );
  }

  // The list starts today, or earlier once the week strip steps back a week.
  const listFrom = weekStart < startOfWeek(new Date()) ? weekStart : startOfDay(new Date());
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
