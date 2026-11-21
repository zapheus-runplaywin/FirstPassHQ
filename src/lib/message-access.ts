/**
 * Safeguarding access to a member's messages (Matt, 21 November 2026;
 * supabase/migrations/20261121100000_message_archive_and_access.sql).
 *
 * The Child Safety Officer or the Complaints Manager asks to read one
 * member's messages between two dates, at most 90 days apart, for an open
 * concern, with a reason. An admin who isn't involved approves it with a
 * justification or refuses it with reasons; the other safeguarding officer
 * decides only when no such admin exists. Approval opens 24 hours of
 * read-only access for the requester alone. Every list and every message
 * opened is logged, and nobody is told: not the member, their parents or the
 * committee. The database enforces all of this; the app only mirrors the
 * rules to explain them before asking.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { AppRole, MessageAudience } from '@/lib/types';

export type MessageAccessPost = 'child_safety_officer' | 'complaints_manager';
export type MessageAccessLink = 'about' | 'raised_by' | 'other';
export type MessageAccessStatus = 'pending' | 'approved' | 'rejected';

/** One request, as `message_access_requests()` lists it. */
export type MessageAccessRequest = {
  id: string;
  reference: string;
  created_at: string;
  concern_id: string;
  concern_reference: string;
  concern_open: boolean;
  requested_by_name: string;
  requested_post: MessageAccessPost;
  subject_name: string;
  subject_link: MessageAccessLink;
  from_date: string;
  to_date: string;
  reason: string;
  status: MessageAccessStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  access_expires_at: string | null;
  /** The signed-in member made it. */
  mine: boolean;
  /** The signed-in member may approve or refuse it. */
  can_decide: boolean;
  /** How many messages have been opened under it. */
  views: number;
};

/** One message an open request covers, without its text. */
export type AccessedMessage = {
  message_id: string;
  created_at: string;
  sender_name: string;
  sent_by_member: boolean;
  audience: MessageAudience;
  audience_role: AppRole | null;
  audience_label: string | null;
  member_read_at: string | null;
  member_archived_at: string | null;
  text_removed: boolean;
};

/** One line of a request's log. */
export type MessageAccessLogEntry = {
  viewed_at: string;
  viewed_by_name: string;
  kind: 'listed' | 'opened';
  message_sent_at: string | null;
  message_sender_name: string | null;
};

/** Someone a request can name straight from the concern. */
export type MessageAccessPerson = {
  link: MessageAccessLink;
  profile_id: string;
  name: string;
};

export const postLabels: Record<MessageAccessPost, string> = {
  child_safety_officer: 'Child Safety Officer',
  complaints_manager: 'Complaints Manager',
};

export const linkLabels: Record<MessageAccessLink, string> = {
  about: 'Who the concern is about',
  raised_by: 'Who raised the concern',
  other: 'Someone else involved',
};

export const statusLabels: Record<MessageAccessStatus, string> = {
  pending: 'Waiting for an answer',
  approved: 'Approved',
  rejected: 'Refused',
};

/** The longest stretch one request can cover, as in the database. */
export const MAX_DAYS = 90;
/** How long approved access lasts. */
export const ACCESS_HOURS = 24;
/** The shortest reason or decision note the database takes. */
export const MIN_NOTE = 10;

/** A local day as "2026-11-21", as in src/lib/injuries.ts (kept here so this module stays light). */
function toDateString(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysBetween(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The usual stretch: the last 30 days up to today. */
export function defaultRange(today = new Date()) {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  return { from: toDateString(from), to: toDateString(today) };
}

/**
 * What's wrong with a request before it's sent, in the database's words, or
 * null when it's ready.
 */
export function requestProblem(
  input: {
    subjectId: string | null;
    from: string | null;
    to: string | null;
    reason: string;
  },
  today = new Date(),
): string | null {
  if (!input.subjectId) return 'Choose whose messages to read';
  if (!input.from || !input.to || input.from > input.to)
    return 'Choose a start date on or before the end date';
  if (input.to > toDateString(today)) return 'The end date can’t be in the future';
  if (daysBetween(input.from, input.to) > MAX_DAYS)
    return `Ask for ${MAX_DAYS} days or less at a time`;
  if (input.reason.trim().length < MIN_NOTE)
    return `Give a reason of at least ${MIN_NOTE} characters`;
  return null;
}

/** Whether the requester can read under this request right now. */
export function accessOpen(
  request: Pick<MessageAccessRequest, 'status' | 'access_expires_at' | 'mine'>,
  now = new Date(),
) {
  return (
    request.mine &&
    request.status === 'approved' &&
    !!request.access_expires_at &&
    new Date(request.access_expires_at).getTime() > now.getTime()
  );
}

/** "23 hours 10 minutes left", "5 minutes left" or "Ended". */
export function timeLeft(expiresAt: string | null, now = new Date()) {
  if (!expiresAt) return 'Ended';
  const minutes = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return 'Ended';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '';
  const m = rest > 0 || hours === 0 ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : '';
  return `${[h, m].filter(Boolean).join(' ')} left`;
}

/** The status line for a request, from the reader's side. */
export function requestStatusLine(request: MessageAccessRequest, now = new Date()) {
  if (request.status === 'approved') {
    const left = timeLeft(request.access_expires_at, now);
    return left === 'Ended' ? 'Approved · access ended' : `Approved · ${left}`;
  }
  return statusLabels[request.status];
}

/** Waiting requests first, then answered ones; newest first within each. */
export function splitRequests(requests: MessageAccessRequest[]) {
  return {
    waiting: requests.filter((r) => r.status === 'pending'),
    answered: requests.filter((r) => r.status !== 'pending'),
  };
}

/** What a request's to-dos count: answers owed, open access, and the one-admin warning. */
export type MessageAccessTodo = {
  to_decide: number;
  open_access: number;
  only_one_admin: boolean;
};

const NO_TODO: MessageAccessTodo = {
  to_decide: 0,
  open_access: 0,
  only_one_admin: false,
};

/** The signed-in member's message access to-dos, refreshed when the screen is shown. */
export function useMessageAccessTodo(enabled: boolean) {
  const [todo, setTodo] = useState<MessageAccessTodo>(NO_TODO);
  const load = useCallback(async () => {
    if (!enabled) {
      setTodo(NO_TODO);
      return;
    }
    const { data } = await supabase.rpc('message_access_todo');
    const row = Array.isArray(data) ? data[0] : data;
    setTodo((row as MessageAccessTodo | null) ?? NO_TODO);
  }, [enabled]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return todo;
}
