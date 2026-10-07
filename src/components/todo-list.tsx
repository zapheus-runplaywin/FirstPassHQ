import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Todo } from '@/lib/todos';

/** The member's to-do list, or a short "all caught up" when there's nothing left. */
export function TodoList({ todos }: { todos: Todo[] }) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ThemedText type="smallBold">To do</ThemedText>
        {todos.length > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
              {todos.length}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {todos.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            ✓ You’re all caught up.
          </ThemedText>
        </Card>
      ) : (
        <Card style={styles.list}>
          {todos.map((todo, index) => (
            <Pressable
              key={todo.key}
              accessibilityRole="button"
              accessibilityHint="Opens it so you can tick it off"
              onPress={() => router.push(todo.href)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <View style={[styles.dot, { borderColor: theme.accent }]} />
              <View style={styles.text}>
                <ThemedText type="smallBold">{todo.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {todo.detail}
                </ThemedText>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.tint }}>
                ›
              </ThemedText>
            </Pressable>
          ))}
        </Card>
      )}
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
});
