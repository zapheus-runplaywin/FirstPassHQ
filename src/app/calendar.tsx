import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { AgendaRow, agendaRows } from '@/components/agenda';
import { MonthGrid } from '@/components/month-grid';
import { Screen, useScrollToY } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, ErrorText } from '@/components/ui';
import { WeekStrip } from '@/components/week-strip';
import { Spacing } from '@/constants/theme';
import type { CalendarEvent } from '@/lib/calendar';
import { dayKey, startOfWeek } from '@/lib/format';
import { useEvents } from '@/lib/use-events';

type View = 'list' | 'month';

/** Leaves room for the pinned month heading when jumping to a day. */
const HEADING_HEIGHT = 44;

const CLUB = 'club';
const ALL = 'all';

export default function CalendarScreen() {
  const { events, failed, reload } = useEvents();
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>('list');
  const [filter, setFilter] = useState(ALL);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [month, setMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(() => dayKey(new Date()));
  // Where each day starts in the list, reported as rows are laid out.
  const [dayY] = useState(() => new Map<string, number>());

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
      onToggle={(v: View) => setView(v)}
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
          onChangeMonth={setMonth}
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

  const listTop = [
    ...top,
    <WeekJump
      key="week"
      events={filtered}
      eventDays={eventDays}
      dayY={dayY}
      weekStart={weekStart}
      onChangeWeek={setWeekStart}
      selectedDay={selectedDay}
      onSelect={setSelectedDay}
    />,
  ];
  const { rows, headingIndexes } = agendaRows(filtered, (key, y) => {
    dayY.set(key, y);
  });

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={onRefresh}
      gap={Spacing.three}
      stickyHeaderIndices={headingIndexes.map((i) => i + listTop.length)}>
      {[...listTop, ...rows]}
    </Screen>
  );
}

/** The week strip in list view: tapping a day scrolls to its events. */
function WeekJump({
  events,
  eventDays,
  dayY,
  weekStart,
  onChangeWeek,
  selectedDay,
  onSelect,
}: {
  events: CalendarEvent[];
  eventDays: Map<string, string[]>;
  dayY: Map<string, number>;
  weekStart: Date;
  onChangeWeek: (weekStart: Date) => void;
  selectedDay: string | null;
  onSelect: (key: string) => void;
}) {
  const scrollToY = useScrollToY();
  return (
    <WeekStrip
      weekStart={weekStart}
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
