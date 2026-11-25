/**
 * The pieces of Today (src/app/(tabs)/index.tsx): the next thing on the
 * calendar, what needs the member, the rest of the week, and a clear finish
 * once nothing is left. Nothing here counts streaks or scores; when the list
 * is empty it says so and stops.
 */
import { Image, type ImageSource } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConcernLights, concernLightsLabel } from '@/components/concern-lights';
import { CountBadge, IconSquare } from '@/components/home/feature-card';
import { Icon } from '@/components/icon';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { AlertBadge, AlertEdge, AlertIcon } from '@/components/todo-alert';
import { Card } from '@/components/ui';
import { StatusColours } from '@/constants/status';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarEvent } from '@/lib/calendar';
import type { ConcernCounts } from '@/lib/concerns';
import { formatEventTime, formatShortDay } from '@/lib/format';
import type { PersonalTask } from '@/lib/personal-tasks';
import type { SessionAction } from '@/lib/session';
import { laterLabel, needsYouGroups, startTime, todayLabel, whenLabel } from '@/lib/today';
import { todoIcon } from '@/lib/todo-icons';
import type { Todo } from '@/lib/todos';

/** Size of the club logo at the top of Today. */
export const TODAY_LOGO_SIZE = 40;

/** The club's logo and today's date, beside Raise a concern in Today's top bar. */
export function ClubAndDate({
  logo,
  clubName,
  now,
}: {
  logo: ImageSource | number;
  clubName: string;
  now: Date;
}) {
  return (
    <>
      <Image
        testID="home-club-logo"
        source={logo}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel={clubName}
      />
      <ThemedText type="smallBold" themeColor="textSecondary" numberOfLines={1}>
        {todayLabel(now)}
      </ThemedText>
    </>
  );
}

/**
 * "Hi <name>" with the roles held beneath it and any titles held
 * (captaincies and safeguarding posts such as Child Safety Officer) under
 * those. A long name wraps to a second line and, on phones, shrinks a little
 * rather than run to a third.
 */
export function Greeting({
  name,
  roles,
  titles,
}: {
  name: string;
  roles?: string;
  /** Titles held, such as "Captain, Open A · Child Safety Officer", under the roles. */
  titles?: string;
}) {
  return (
    <View style={styles.greetingBlock}>
      <ThemedText
        style={styles.greeting}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessibilityRole="header">
        Hi {name}
      </ThemedText>
      {roles ? (
        <ThemedText type="small" themeColor="textSecondary">
          {roles}
        </ThemedText>
      ) : null}
      {titles ? (
        <ThemedText type="small" testID="home-titles" themeColor="textSecondary">
          {titles}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * The next thing on the member's calendar, with its time large enough to read
 * at arm's length. The whole card opens the event.
 */
export function NextUp({
  event,
  now,
  actions = [],
}: {
  event: CalendarEvent | null;
  now: Date;
  /** What the member can do about it from here, such as Can't make it (src/lib/session.ts). */
  actions?: SessionAction[];
}) {
  const theme = useTheme();
  if (!event) {
    return (
      <Card testID="next-up">
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.eyebrow}>
          Next up
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Nothing on the calendar yet.
        </ThemedText>
      </Card>
    );
  }
  const dated = whenLabel(event, now);
  const card = (
    <Pressable
      testID="next-up"
      accessibilityRole="button"
      accessibilityLabel={`Next up, ${dated}, ${formatEventTime(event)}, ${event.title}${
        event.location ? `, ${event.location}` : ''
      }`}
      onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
      style={({ pressed }) => [
        styles.nextUp,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          borderLeftColor: event.color,
        },
      ]}>
      <View style={styles.nextUpText}>
        <ThemedText type="smallBold" style={[styles.eyebrow, { color: theme.tint }]}>
          Next up · {dated}
        </ThemedText>
        <ThemedText style={styles.time} numberOfLines={1} adjustsFontSizeToFit>
          {startTime(event)}
        </ThemedText>
        <ThemedText style={styles.nextUpTitle} numberOfLines={2}>
          {event.title}
        </ThemedText>
        {event.location ? (
          <View style={styles.place}>
            <Icon name="map-pin" size={14} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.grow}>
              {event.location}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <Icon name="chevron-right" size={20} color={theme.textSecondary} />
    </Pressable>
  );
  if (actions.length === 0) return card;
  return (
    <View style={styles.nextUpWithActions}>
      {card}
      <View style={styles.nextUpActions} testID="next-up-actions">
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            onPress={() => router.push(action.href)}
            style={({ pressed }) => [
              styles.nextUpAction,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
            ]}>
            <Icon name={action.icon} size={14} color={theme.tint} />
            <ThemedText type="smallBold">{action.title}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** The few events after the next one, each opening its event. */
export function LaterEvents({
  title,
  events,
  now,
  onOpenCalendar,
}: {
  title: string;
  events: CalendarEvent[];
  now: Date;
  onOpenCalendar: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onOpenCalendar}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Full calendar
          </ThemedText>
        </Pressable>
      </View>
      {events.length > 0 ? (
        <Card style={styles.list}>
          {events.map((event, index) => {
            const when = laterLabel(event, now);
            return (
              <Pressable
                key={event.id}
                accessibilityRole="button"
                accessibilityLabel={`${event.title}, ${formatShortDay(event.start)}, ${formatEventTime(
                  event,
                )}${event.location ? `, ${event.location}` : ''}`}
                onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}
                style={({ pressed }) => [
                  styles.eventRow,
                  index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
                  pressed && { backgroundColor: theme.backgroundSelected },
                ]}>
                <View style={[styles.eventBar, { backgroundColor: event.color }]} />
                <View style={styles.rowText}>
                  <ThemedText type="smallBold" numberOfLines={2}>
                    {event.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {event.location ? `${when} · ${event.location}` : when}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={18} color={theme.textSecondary} />
              </Pressable>
            );
          })}
        </Card>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing else on the calendar yet.
        </ThemedText>
      )}
    </View>
  );
}

/**
 * What the club needs from the member, then their own tasks. Red warnings
 * (overdue, missing checks) come first, then amber ones. With nothing left it
 * says so, once: that is the moment to put the phone down.
 */
export function NeedsYou({
  todos,
  personalTasks = [],
  onToggleTask,
  onCheckIn,
  otherWork = false,
  now,
}: {
  todos: Todo[];
  personalTasks?: PersonalTask[];
  onToggleTask?: (task: PersonalTask, done: boolean) => void;
  /** Opens the daily check-in over Today, in place of its own page. */
  onCheckIn?: () => void;
  /** Something else on Today is waiting (the safeguarding panel), so an empty list isn't "set for today". */
  otherWork?: boolean;
  now: Date;
}) {
  const theme = useTheme();
  // The task just ticked off, so a mistaken tap can be undone.
  const [ticked, setTicked] = useState<PersonalTask | null>(null);
  const count = todos.length + personalTasks.length;
  const groups = needsYouGroups(todos, personalTasks, now);

  function toggle(task: PersonalTask, done: boolean) {
    setTicked(done ? task : null);
    onToggleTask?.(task, done);
  }

  return (
    <View style={styles.section} testID="needs-you">
      {count > 0 ? (
        <View style={styles.needsHeader}>
          <ThemedText type="smallBold" accessibilityRole="header">
            Needs you
          </ThemedText>
          <CountBadge count={count} />
        </View>
      ) : null}
      {count === 0 && !otherWork ? <AllDone /> : null}
      {groups.map((group) =>
        group.entries.length === 0 ? null : (
          <View key={group.title ?? 'all'} style={styles.group}>
            {group.title ? (
              <ThemedText type="small" themeColor="textSecondary">
                {group.title}
              </ThemedText>
            ) : null}
            <Card style={styles.list}>
              {group.entries.map((entry, index) =>
                entry.kind === 'task' ? (
                  <TaskRow
                    key={entry.task.id}
                    task={entry.task}
                    onToggle={toggle}
                    divider={index > 0}
                  />
                ) : (
                  <TodoRow
                    key={entry.todo.key}
                    todo={entry.todo}
                    divider={index > 0}
                    onPress={
                      entry.todo.key === CHECK_IN_TODO && onCheckIn ? onCheckIn : undefined
                    }
                  />
                ),
              )}
            </Card>
          </View>
        ),
      )}
      {ticked && !personalTasks.some((t) => t.id === ticked.id) ? (
        <View style={[styles.undo, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow} numberOfLines={1}>
            Ticked off {ticked.title}
          </ThemedText>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => toggle(ticked, false)}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              Undo
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.taskLinks}>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push('/tasks/new')}
          style={styles.taskLink}>
          <Icon name="plus" size={16} color={theme.tint} />
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            Add a task
          </ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/tasks')}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Your tasks
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** One of the club's jobs for the member: its warning, what it is, and where it's done. */
function TodoRow({
  todo,
  divider,
  onPress,
}: {
  todo: Todo;
  /** A line above it, when it isn't the first in its list. */
  divider: boolean;
  /** In place of opening the to-do's screen. */
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens it so you can tick it off"
      onPress={onPress ?? (() => router.push(todo.href))}
      style={({ pressed }) => [
        styles.todoRow,
        divider && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <AlertEdge alert={todo.alert} />
      <IconSquare name={todoIcon(todo.href)} />
      <View style={styles.rowText}>
        <View style={styles.titleRow}>
          <AlertIcon alert={todo.alert} />
          <ThemedText type="smallBold" style={styles.shrink}>
            {todo.title}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {todo.detail}
        </ThemedText>
        {/* Under the words, so a long title keeps the row's width. */}
        {todo.alert ? (
          <View style={styles.alertBadge}>
            <AlertBadge alert={todo.alert} />
          </View>
        ) : null}
      </View>
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

/**
 * Safeguarding, before anything else on Today, for the people the concerns
 * register is open to (admins, the safeguarding posts and anyone acting in
 * one, and someone a concern was escalated to): the register's three counts,
 * then each piece of safeguarding work that is waiting, most pressing first.
 * Counts and references only, so nothing a concern says shows at a glance.
 */
export function SafeguardingPanel({
  todos,
  counts,
}: {
  /** The safeguarding to-dos, most pressing first (splitSafeguarding). */
  todos: Todo[];
  /** The register's counts, for someone it is open to. */
  counts: ConcernCounts | null;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section} testID="safeguarding-panel">
      <Card style={styles.list}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            counts
              ? `Safeguarding. ${concernLightsLabel(counts)}. Opens the concerns register`
              : 'Safeguarding. Opens the concerns register'
          }
          onPress={() => router.push('/concerns')}
          style={({ pressed }) => [
            styles.panelHead,
            pressed && { backgroundColor: theme.backgroundSelected },
          ]}>
          <View style={styles.panelTitle}>
            <Icon name="shield" size={18} color={theme.text} />
            <ThemedText type="smallBold" style={styles.grow}>
              Safeguarding
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Concerns register
            </ThemedText>
            <Icon name="chevron-right" size={18} color={theme.textSecondary} />
          </View>
          {counts ? <ConcernLights counts={counts} /> : null}
          {todos.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" testID="safeguarding-quiet">
              Nothing is waiting on you.
            </ThemedText>
          ) : null}
        </Pressable>
        {todos.map((todo) => (
          <TodoRow key={todo.key} todo={todo} divider />
        ))}
      </Card>
    </View>
  );
}

/** The to-do that the check-in sheet answers (src/lib/todos.ts). */
export const CHECK_IN_TODO = 'check-in';

/** How long "Check-in saved for today" stays on Today, with Change beside it. */
export const CHECK_IN_SAVED_MS = 10_000;

/**
 * Said for a few seconds once the check-in sheet has saved, with the way to
 * correct a mistaken tap. A check-in is never removed, only changed.
 */
export function CheckInSaved({ onChange }: { onChange: () => void }) {
  const theme = useTheme();
  return (
    <View
      testID="check-in-saved"
      accessibilityLiveRegion="polite"
      style={[styles.undo, { backgroundColor: theme.backgroundElement }]}>
      <Icon name="check" size={16} color={theme.positive} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.grow} numberOfLines={1}>
        Check-in saved for today
      </ThemedText>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={onChange}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          Change
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Nothing left to do: a tick, a sentence, and nothing asking for more. */
function AllDone() {
  return (
    <Card style={styles.done} testID="all-done">
      <View style={[styles.ring, { borderColor: StatusColours.good }]}>
        <Icon name="check" size={24} color={StatusColours.good} />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={styles.doneTitle} accessibilityRole="header">
          You’re set for today
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Nothing needs you right now.
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: TODAY_LOGO_SIZE,
    height: TODAY_LOGO_SIZE,
  },
  greetingBlock: {
    gap: Spacing.half,
  },
  greeting: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 26,
    lineHeight: 32,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nextUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  nextUpWithActions: {
    gap: Spacing.two,
  },
  nextUpActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  nextUpAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    // Tall enough for a thumb.
    minHeight: 44,
    borderRadius: 999,
  },
  nextUpText: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  time: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 34,
    lineHeight: 40,
  },
  nextUpTitle: {
    fontFamily: BrandFonts.bold,
    fontSize: 16,
    lineHeight: 22,
  },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  group: {
    gap: Spacing.one,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  needsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  list: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
    paddingRight: Spacing.three,
    paddingLeft: Spacing.three,
  },
  eventBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  shrink: {
    flexShrink: 1,
  },
  alertBadge: {
    alignSelf: 'flex-start',
    marginTop: Spacing.one,
  },
  grow: {
    flex: 1,
  },
  panelHead: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  panelTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
  },
  taskLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.one,
    paddingTop: Spacing.one,
  },
  taskLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  ring: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: {
    fontFamily: BrandFonts.extraBold,
    fontSize: 18,
    lineHeight: 24,
  },
});
