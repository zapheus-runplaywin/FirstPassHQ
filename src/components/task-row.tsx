import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { taskDetail, type PersonalTask } from '@/lib/personal-tasks';

/**
 * One of the member's own tasks: the circle ticks it off (or puts it back),
 * the rest of the row opens it to edit.
 */
export function TaskRow({
  task,
  onToggle,
  divider,
}: {
  task: PersonalTask;
  onToggle: (task: PersonalTask, done: boolean) => void;
  divider: boolean;
}) {
  const theme = useTheme();
  const done = !!task.done_at;
  return (
    <View
      style={[
        styles.row,
        divider && {
          borderTopWidth: 1,
          borderTopColor: theme.backgroundSelected,
        },
      ]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? `Put back ${task.title}` : `Tick off ${task.title}`}
        hitSlop={12}
        onPress={() => onToggle(task, !done)}
        style={styles.tick}>
        <View
          style={[
            styles.circle,
            { borderColor: theme.accent },
            done && { backgroundColor: theme.accent },
          ]}>
          {done ? (
            <ThemedText type="smallBold" style={[styles.check, { color: theme.onAccent }]}>
              ✓
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens it so you can change or delete it"
        onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.6 }]}>
        <View style={styles.text}>
          <ThemedText
            type="smallBold"
            style={done ? { textDecorationLine: 'line-through' } : undefined}>
            {task.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {taskDetail(task)}
          </ThemedText>
        </View>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          ›
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tick: {
    paddingLeft: Spacing.three,
    paddingVertical: Spacing.three,
  },
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    fontSize: 11,
    lineHeight: 14,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});
