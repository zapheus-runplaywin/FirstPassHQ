import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { formatShortDay } from '@/lib/format';
import { parseDateString, toDateString } from '@/lib/injuries';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * A task a member added to their own to-do list. Only they can see it: not
 * their parents or guardians, coaches, the committee or admins.
 */
export type PersonalTask = {
  id: string;
  title: string;
  /** Such as "2026-10-17", or null when it has no due date. */
  due_on: string | null;
  done_at: string | null;
  created_at: string;
};

const COLUMNS = 'id, title, due_on, done_at, created_at';

/** How many ticked-off tasks the tasks screen shows. */
export const DONE_SHOWN = 30;

/** Soonest due first, then tasks with no due date, oldest first. */
export function sortTasks(tasks: PersonalTask[]) {
  return [...tasks].sort((a, b) => {
    if (a.due_on !== b.due_on) {
      if (a.due_on === null) return 1;
      if (b.due_on === null) return -1;
      return a.due_on.localeCompare(b.due_on);
    }
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Such as "Personal · Due Tomorrow", "Personal · Overdue since Mon 13 Oct" or,
 * once ticked off, "Personal · Done Tue 14 Oct".
 */
export function taskDetail(task: PersonalTask, today = new Date()) {
  if (task.done_at) return `Personal · Done ${formatShortDay(new Date(task.done_at))}`;
  if (!task.due_on) return 'Personal';
  const day = formatShortDay(parseDateString(task.due_on));
  return task.due_on < toDateString(today)
    ? `Personal · Overdue since ${day}`
    : `Personal · Due ${day}`;
}

/**
 * The signed-in member's own tasks. Those still to do, and with `withDone` the
 * most recently ticked off as well.
 */
export function usePersonalTasks({ withDone = false }: { withDone?: boolean } = {}) {
  const { profile } = useAuth();
  const approved = profile?.status === 'approved';
  const [open, setOpen] = useState<PersonalTask[]>([]);
  const [done, setDone] = useState<PersonalTask[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!approved) return;
    const [openResult, doneResult] = await Promise.all([
      supabase.from('personal_tasks').select(COLUMNS).is('done_at', null),
      withDone
        ? supabase
            .from('personal_tasks')
            .select(COLUMNS)
            .not('done_at', 'is', null)
            .order('done_at', { ascending: false })
            .limit(DONE_SHOWN)
        : Promise.resolve({ data: [] }),
    ]);
    setOpen(sortTasks((openResult.data as PersonalTask[] | null) ?? []));
    setDone((doneResult.data as PersonalTask[] | null) ?? []);
    setLoaded(true);
  }, [approved, withDone]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /** Ticks a task off, or puts it back on the list, straight away on screen. */
  const setTaskDone = useCallback(
    async (task: PersonalTask, isDone: boolean) => {
      const doneAt = isDone ? new Date().toISOString() : null;
      const changed = { ...task, done_at: doneAt };
      if (isDone) {
        setOpen((tasks) => tasks.filter((t) => t.id !== task.id));
        setDone((tasks) => [changed, ...tasks]);
      } else {
        setDone((tasks) => tasks.filter((t) => t.id !== task.id));
        setOpen((tasks) => sortTasks([...tasks, changed]));
      }
      const { error } = await supabase
        .from('personal_tasks')
        .update({ done_at: doneAt })
        .eq('id', task.id);
      if (error) await load();
      return error;
    },
    [load],
  );

  return {
    personalTasks: approved ? open : [],
    doneTasks: approved ? done : [],
    personalTasksLoaded: loaded,
    reloadPersonalTasks: load,
    setTaskDone,
  };
}

/** Adds a task, or saves changes to one. */
export async function saveTask(id: string | null, title: string, dueOn: string | null) {
  const fields = { title: title.trim(), due_on: dueOn };
  const { error } = id
    ? await supabase.from('personal_tasks').update(fields).eq('id', id)
    : await supabase.from('personal_tasks').insert(fields);
  return error;
}

export async function deleteTask(id: string) {
  const { error } = await supabase.from('personal_tasks').delete().eq('id', id);
  return error;
}

/** Deletes every task the member has ticked off. */
export async function deleteDoneTasks() {
  const { error } = await supabase.from('personal_tasks').delete().not('done_at', 'is', null);
  return error;
}

export async function loadTask(id: string) {
  const { data } = await supabase.from('personal_tasks').select(COLUMNS).eq('id', id).maybeSingle();
  return (data as PersonalTask | null) ?? null;
}
