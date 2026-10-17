import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { WeekDateField } from '@/components/week-date-field';
import { deleteTask, loadTask, saveTask } from '@/lib/personal-tasks';

/** Adds one of the member's own tasks, or changes or deletes one (`id`). */
export function TaskForm({ id = null }: { id?: string | null }) {
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadTask(id).then((task) => {
      if (task) {
        setTitle(task.title);
        setDueOn(task.due_on);
      } else {
        setMissing(true);
      }
      setLoading(false);
    });
  }, [id]);

  async function save() {
    if (!title.trim()) {
      setError('Say what the task is.');
      return;
    }
    setSaving(true);
    setError(null);
    const saveError = await saveTask(id, title, dueOn);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  async function remove() {
    if (!id) return;
    setDeleting(true);
    const deleteError = await deleteTask(id);
    setDeleting(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.back();
  }

  if (missing) {
    return (
      <Screen>
        <ThemedText themeColor="textSecondary">This task has been deleted.</ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <TextField
        label="Task"
        value={title}
        onChangeText={setTitle}
        placeholder="For example, wash my training kit"
        maxLength={200}
        autoFocus={!id}
        editable={!loading}
        returnKeyType="done"
        onSubmitEditing={save}
      />
      {/* Waits for the task, so the week opens on its due date. */}
      {loading ? null : (
        <WeekDateField
          label="Due"
          value={dueOn}
          onChange={setDueOn}
          emptyLabel="No due date"
          clearLabel="Remove due date"
        />
      )}
      <ThemedText type="small" themeColor="textSecondary">
        Only you can see your tasks. Your coaches, parents or guardians and the club’s admins can’t,
        and they can’t be shared or sent to anyone.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Add task'} onPress={save} busy={saving} disabled={loading} />
      {id ? (
        <ConfirmDelete
          title="Delete task"
          warning="This deletes the task for good."
          confirmTitle="Delete it"
          onConfirm={remove}
          busy={deleting}
        />
      ) : null}
    </Screen>
  );
}
