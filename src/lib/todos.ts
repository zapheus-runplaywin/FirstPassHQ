import type { Href } from 'expo-router';

import { formatDateString, toDateString } from '@/lib/injuries';
import type { Injury } from '@/lib/types';

/** Something the member still has to do, shown at the top of the home screen. */
export type Todo = {
  key: string;
  title: string;
  detail: string;
  href: Href;
};

/**
 * Everything the member owes, most urgent first, built from what the home
 * screen has already loaded. Each item disappears once it's done.
 */
export function buildTodos({
  userId,
  unreadCount,
  injuries,
  pendingCount,
  today = new Date(),
}: {
  userId: string | undefined;
  unreadCount: number;
  injuries: Injury[];
  pendingCount: number;
  today?: Date;
}): Todo[] {
  const todos: Todo[] = [];

  // Return-to-play sign-offs hold an athlete out of training, so they come first.
  const toSignOff = injuries.filter((i) => i.waiting_for_me);
  if (toSignOff.length === 1) {
    const injury = toSignOff[0];
    todos.push({
      key: 'injury-sign-off',
      title: `Review ${injury.athlete_name ?? 'an athlete'}’s clearance`,
      detail: `${injury.body_area} · waiting for your sign-off`,
      href: { pathname: '/injuries/[id]', params: { id: injury.id } },
    });
  } else if (toSignOff.length > 1) {
    todos.push({
      key: 'injury-sign-off',
      title: `Review ${toSignOff.length} injury clearances`,
      detail: 'Athletes are waiting for your sign-off to return',
      href: '/injuries',
    });
  }

  // An athlete's own injury that has gone past the day they expected to be back.
  const todayString = toDateString(today);
  for (const injury of injuries) {
    if (
      !injury.can_report ||
      injury.status !== 'injured' ||
      !injury.expected_return ||
      injury.expected_return > todayString
    ) {
      continue;
    }
    const whose =
      injury.athlete_id === userId ? 'your' : `${injury.athlete_name ?? 'your athlete'}’s`;
    todos.push({
      key: `injury-update-${injury.id}`,
      title: `Update ${whose} ${injury.body_area.toLowerCase()} injury`,
      detail: `Expected back ${formatDateString(injury.expected_return)}. Ask for clearance or change the date.`,
      href: { pathname: '/injuries/[id]', params: { id: injury.id } },
    });
  }

  if (pendingCount > 0) {
    todos.push({
      key: 'join-requests',
      title: `Approve ${pendingCount} join ${pendingCount === 1 ? 'request' : 'requests'}`,
      detail: 'New members are waiting to be added to a squad',
      href: '/admin',
    });
  }

  if (unreadCount > 0) {
    todos.push({
      key: 'messages',
      title: `Read ${unreadCount} new ${unreadCount === 1 ? 'message' : 'messages'}`,
      detail: 'Your coaches and the club can see when you’ve read them',
      href: '/messages',
    });
  }

  return todos;
}
