import { useLocalSearchParams } from 'expo-router';

import { TaskForm } from '@/components/task-form';

/** Changes or deletes one of the member's own tasks. */
export default function EditTaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TaskForm id={id} />;
}
