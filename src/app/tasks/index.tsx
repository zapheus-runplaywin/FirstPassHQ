import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { TaskRow } from '@/components/task-row';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDelete, ErrorText } from '@/components/ui';
import { DONE_SHOWN, deleteDoneTasks, usePersonalTasks } from '@/lib/personal-tasks';

/** All of the member's own tasks: those still to do, and those ticked off lately. */
export default function TasksScreen() {
  const { personalTasks, doneTasks, personalTasksLoaded, reloadPersonalTasks, setTaskDone } =
    usePersonalTasks({ withDone: true });
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clearDone() {
    setClearing(true);
    const clearError = await deleteDoneTasks();
    setClearing(false);
    setError(clearError?.message ?? null);
    await reloadPersonalTasks();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Your own tasks sit on your to-do list with what the club needs from you. Only you can see
        them.
      </ThemedText>
      <Button title="Add a task" onPress={() => router.push('/tasks/new')} />

      <ThemedText type="smallBold">To do</ThemedText>
      {personalTasks.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {personalTasksLoaded ? 'Nothing to do.' : 'Loading…'}
          </ThemedText>
        </Card>
      ) : (
        <Card style={styles.list}>
          {personalTasks.map((task, index) => (
            <TaskRow key={task.id} task={task} onToggle={setTaskDone} divider={index > 0} />
          ))}
        </Card>
      )}

      {doneTasks.length > 0 ? (
        <>
          <ThemedText type="smallBold">Done</ThemedText>
          <Card style={styles.list}>
            {doneTasks.map((task, index) => (
              <TaskRow key={task.id} task={task} onToggle={setTaskDone} divider={index > 0} />
            ))}
          </Card>
          {doneTasks.length >= DONE_SHOWN ? (
            <ThemedText type="small" themeColor="textSecondary">
              The {DONE_SHOWN} you ticked off most recently.
            </ThemedText>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <ConfirmDelete
            title="Delete done tasks"
            warning="This deletes every task you’ve ticked off, for good."
            confirmTitle="Delete them"
            onConfirm={clearDone}
            busy={clearing}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 0,
    gap: 0,
    overflow: 'hidden',
  },
});
