import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AlertBadge, AlertEdge, AlertIcon } from '@/components/todo-alert';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { PersonalTask } from '@/lib/personal-tasks';
import { dueAlert, sortByAlert, type Todo } from '@/lib/todos';

type Entry = { kind: 'todo'; todo: Todo } | { kind: 'task'; task: PersonalTask };

/**
 * The member's to-do list: what the club needs from them, then their own
 * personal tasks, or a short "all caught up" when there's nothing left.
 * Red warnings (overdue, missing checks) go to the top, then amber ones.
 */
export function TodoList({
  todos,
  personalTasks = [],
  onToggleTask,
}: {
  todos: Todo[];
  personalTasks?: PersonalTask[];
  onToggleTask?: (task: PersonalTask, done: boolean) => void;
}) {
  const theme = useTheme();
  // The task just ticked off, so a mistaken tap can be undone.
  const [ticked, setTicked] = useState<PersonalTask | null>(null);
  const count = todos.length + personalTasks.length;
  const entries = sortByAlert<Entry>(
    [
      ...todos.map((todo) => ({ kind: 'todo' as const, todo })),
      ...personalTasks.map((task) => ({ kind: 'task' as const, task })),
    ],
    (entry) => (entry.kind === 'todo' ? entry.todo.alert : dueAlert(entry.task.due_on)),
    (entry) => (entry.kind === 'todo' ? entry.todo.dueOn : entry.task.due_on),
  );

  function toggle(task: PersonalTask, done: boolean) {
    setTicked(done ? task : null);
    onToggleTask?.(task, done);
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="smallBold">To do</ThemedText>
        {count > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
              {count}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <Card style={styles.list}>
        {count === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.caughtUp}>
            ✓ You’re all caught up.
          </ThemedText>
        ) : null}
        {entries.map((entry, index) =>
          entry.kind === 'task' ? (
            <TaskRow
              key={entry.task.id}
              task={entry.task}
              onToggle={toggle}
              divider={index > 0}
            />
          ) : (
            <Pressable
              key={entry.todo.key}
              accessibilityRole="button"
              accessibilityHint="Opens it so you can tick it off"
              onPress={() => router.push(entry.todo.href)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && {
                  borderTopWidth: 1,
                  borderTopColor: theme.backgroundSelected,
                },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <AlertEdge alert={entry.todo.alert} />
              <View style={[styles.dot, { borderColor: theme.accent }]} />
              <View style={styles.text}>
                <View style={styles.titleRow}>
                  <AlertIcon alert={entry.todo.alert} />
                  <ThemedText type="smallBold" style={styles.title}>
                    {entry.todo.title}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {entry.todo.detail}
                </ThemedText>
              </View>
              <AlertBadge alert={entry.todo.alert} />
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                ›
              </ThemedText>
            </Pressable>
          ),
        )}
        {ticked && !personalTasks.some((t) => t.id === ticked.id) ? (
          <View style={[styles.footer, { borderTopColor: theme.backgroundSelected }]}>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              style={styles.text}
              numberOfLines={1}>
              Ticked off {ticked.title}
            </ThemedText>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => toggle(ticked, false)}>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                Undo
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.footer, { borderTopColor: theme.backgroundSelected }]}>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/tasks/new')}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              + Add a task
            </ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/tasks')}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Your tasks ›
            </ThemedText>
          </Pressable>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flexShrink: 1,
  },
  caughtUp: {
    padding: Spacing.three,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    padding: Spacing.three,
    borderTopWidth: 1,
  },
});
