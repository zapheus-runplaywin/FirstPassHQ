import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Report, ReportRow } from '@/lib/pdf';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type {
  Concern,
  ConcernEvent,
  ConcernEventKind,
  ConcernStatus,
  InvolvesChild,
  SafeguardingContacts,
} from '@/lib/types';

/** Services anyone in Australia can call, shown wherever a concern can be raised. */
export const helplines: { name: string; phone: string; detail: string }[] = [
  { name: 'Police', phone: '000', detail: 'If a child is in danger now' },
  { name: 'Kids Helpline', phone: '1800 55 1800', detail: 'For young people, any time, free' },
  { name: 'Safe Sport Hotline', phone: '1800 161 361', detail: 'Abuse or harm in sport' },
];

export const concernStatusLabels: Record<ConcernStatus, string> = {
  received: 'Received',
  referred: 'Referred',
  under_review: 'Being looked into',
  closed: 'Closed',
};

export const concernEventLabels: Record<ConcernEventKind, string> = {
  note: 'Note',
  referred_governing_body: 'Referred to the governing body',
  referred_police: 'Referred to Police',
  status_changed: 'Status changed',
  about_changed: 'Who it’s about changed',
};

export const involvesChildLabels: Record<InvolvesChild, string> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Not sure',
};

/** A verified parent or guardian of a child a concern is about. */
export type ConcernGuardian = {
  guardian_id: string;
  name: string;
  email: string | null;
  child_id?: string;
  child_name?: string;
};

/**
 * The parents and guardians grouped by child, in the order listed: a concern
 * can be about several children.
 */
export function guardiansByChild(guardians: ConcernGuardian[]) {
  const groups: { childName: string | null; guardians: ConcernGuardian[] }[] = [];
  for (const g of guardians) {
    const name = g.child_name ?? null;
    const last = groups[groups.length - 1];
    if (last && last.childName === name) last.guardians.push(g);
    else groups.push({ childName: name, guardians: [g] });
  }
  return groups;
}

/**
 * The members a concern is about, by name: everyone named, or the single
 * member an older register row gives.
 */
export function concernAboutNames(c: Pick<Concern, 'about_members' | 'about_member_name'>): string[] {
  if (c.about_members && c.about_members.length > 0) return c.about_members.map((m) => m.name);
  return c.about_member_name ? [c.about_member_name] : [];
}

/** Who a concern is about in a line: the members named, else the raiser's words. */
export function concernAboutLine(
  c: Pick<Concern, 'about_members' | 'about_member_name' | 'about_text'>,
): string | null {
  const names = concernAboutNames(c);
  return names.length > 0 ? names.join(', ') : (c.about_text ?? null);
}

/** Someone who looked at a concern's parents and guardians, and when. */
export type ConcernGuardianView = { viewer_name: string | null; created_at: string };

/**
 * "Casey Coach 20 Nov, Alex Admin 19 Nov": who has looked at a concern's
 * parents and guardians, newest first, as `concern_guardian_views` lists them.
 */
export function guardianViewsLine(views: ConcernGuardianView[]) {
  return views.map((v) => `${v.viewer_name ?? 'A former member'} ${localDay(v.created_at)}`).join(', ');
}

/** The most people a concern can name (the database's limit too). */
export const MAX_ABOUT = 10;

/** Someone who can be named as who a concern is about. */
export type ConcernPerson = { id: string; name: string };

/**
 * The people whose name matches what's been typed, at most `max`. One letter
 * matches the start of any part of a name ("A" finds Avery Admin and Sam
 * Alder); two or more also match inside a name. Nothing typed matches nobody.
 */
export function matchPeople(people: ConcernPerson[], typed: string, max: number) {
  const search = typed.trim().toLowerCase();
  if (!search) return [];
  const matches = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.split(/[\s'’-]+/).some((part) => part.startsWith(search))) return true;
    return search.length >= 2 && lower.includes(search);
  };
  return people.filter((p) => matches(p.name)).slice(0, max);
}

/**
 * The names of the club's Child Safety Officers or Complaints Managers who
 * can act now, from `safeguarding_contacts` (one name from an older server).
 * An admin acting in an empty post reads "Avery Admin (acting)".
 */
export function contactNames(
  contacts: SafeguardingContacts | null | undefined,
  post: 'officers' | 'managers',
): string[] {
  if (!contacts) return [];
  const list = post === 'officers' ? contacts.child_safety_officers : contacts.complaints_managers;
  if (list) return list.map((p) => (p.acting === true ? `${p.name} (acting)` : p.name));
  const one = post === 'officers' ? contacts.child_safety_officer_name : contacts.complaints_manager_name;
  return one ? [one] : [];
}

/** The club's safeguarding contacts, loaded when the screen is shown. */
export function useSafeguardingContacts() {
  const [contacts, setContacts] = useState<SafeguardingContacts | null>(null);
  useFocusEffect(
    useCallback(() => {
      supabase
        .rpc('safeguarding_contacts')
        .maybeSingle()
        .then(({ data }) => setContacts((data as SafeguardingContacts | null) ?? null));
    }, []),
  );
  return contacts;
}

/** How many new concerns the member handles, or 0 if they don't handle any. */
export function useNewConcerns(handles: boolean) {
  const [count, setCount] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!handles) return;
      supabase.rpc('new_concerns_count').then(({ data }) => setCount((data as number | null) ?? 0));
    }, [handles]),
  );
  return handles ? count : 0;
}

/**
 * How a concern's clock stands for the member chased about it: nothing
 * recorded after the club's first-action time ('new_late'), a child's concern
 * not yet referred ('refer'), or no step for the club's Important or Urgent
 * time. `escalated` when it reached the member by escalation.
 */
export type ConcernClockStage = 'new_late' | 'refer' | 'important' | 'urgent';

export type ConcernClock = {
  concern_id: string;
  reference: string;
  stage: ConcernClockStage;
  clock_from: string;
  escalated: boolean;
};

const CLOCK_STAGES: ConcernClockStage[] = ['new_late', 'refer', 'important', 'urgent'];

/** The concerns the signed-in member is chased about, refreshed when the screen is shown. */
export function useConcernClocks(handles: boolean) {
  const [clocks, setClocks] = useState<ConcernClock[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (!handles) return;
      supabase
        .rpc('my_concern_clocks')
        .then(({ data }) =>
          setClocks(((data as ConcernClock[] | null) ?? []).filter((c) => CLOCK_STAGES.includes(c.stage))),
        );
    }, [handles]),
  );
  return handles ? clocks : [];
}

/** One step on a concern's escalation: who it reached, or why it passed someone by. */
export type ConcernEscalation = {
  reached_at: string;
  target_name: string;
  skipped: boolean;
  reason: string | null;
};

/** A look at a concern by someone who handles it only because it was escalated to them. */
export type ConcernEscalatedView = { viewer_name: string; viewed_at: string };

/** One escalation step as a line for the concern screen. */
export function escalationLine(step: ConcernEscalation): string {
  return step.skipped
    ? `Passed over ${step.target_name}${step.reason ? `: ${step.reason}` : ''}`
    : `Escalated to ${step.target_name}`;
}

/**
 * The home screen's traffic lights: red for new concerns nobody has acted on,
 * orange for open ones someone has (a note, a referral or a status change),
 * green for those closed in the last 4 weeks. Counts only.
 */
export type ConcernCounts = { new: number; inProgress: number; closedRecently: number };

export const noConcernCounts: ConcernCounts = { new: 0, inProgress: 0, closedRecently: 0 };

type ConcernCountsRow = {
  new_count: number;
  in_progress_count: number;
  closed_recent_count: number;
};

/** The traffic-light counts for a member who handles concerns, or zeros. */
export function useConcernCounts(handles: boolean) {
  const [counts, setCounts] = useState<ConcernCounts>(noConcernCounts);
  useFocusEffect(
    useCallback(() => {
      if (!handles) return;
      supabase
        .rpc('concern_counts')
        .maybeSingle()
        .then(({ data }) => {
          const row = data as ConcernCountsRow | null;
          setCounts(
            row
              ? {
                  new: row.new_count ?? 0,
                  inProgress: row.in_progress_count ?? 0,
                  closedRecently: row.closed_recent_count ?? 0,
                }
              : noConcernCounts,
          );
        });
    }, [handles]),
  );
  return handles ? counts : noConcernCounts;
}

/** The concerns register as a report, with everything done about each one. */
export function concernsReport(
  concerns: Concern[],
  history: Record<string, ConcernEvent[]>,
  governingBody: string | null,
): Report {
  const open = concerns.filter((c) => c.status !== 'closed');
  const row = (c: Concern): ReportRow => ({
    cells: [
      localDay(c.created_at),
      concernAboutLine(c) ?? '',
      c.reported_message_body
        ? `${c.body}\n\nReported message from ${c.reported_message_sender_name ?? 'a former member'}, ${localDay(c.reported_message_sent_at ?? c.created_at)}: “${c.reported_message_body}”`
        : c.body,
      involvesChildLabels[c.involves_child],
      c.anonymous ? 'Name not shown' : (c.raised_by_name ?? 'A former member'),
      concernStatusLabels[c.status],
      (history[c.id] ?? [])
        .map(
          (e) =>
            `${localDay(e.created_at)} ${concernEventLabels[e.kind]}${e.note ? `: ${e.note}` : ''} (${e.by_name ?? 'a former member'})`,
        )
        .join('\n'),
    ],
    flag: c.status === 'received',
  });
  const columns = [
    { label: 'Raised', width: 0.8 },
    { label: 'About', width: 1.1 },
    { label: 'What happened', width: 2.4 },
    { label: 'Child', width: 0.6 },
    { label: 'Raised by', width: 1.0 },
    { label: 'Status', width: 0.9 },
    { label: 'What was done', width: 2.6 },
  ];
  return {
    title: 'Concerns register',
    subtitle: 'Concerns raised in the app, newest first',
    stats: [
      { label: 'Open', value: open.length },
      { label: 'Not acted on yet', value: concerns.filter((c) => c.status === 'received').length },
      {
        label: 'Referred to Police or the governing body',
        value: concerns.filter((c) =>
          (history[c.id] ?? []).some(
            (e) => e.kind === 'referred_police' || e.kind === 'referred_governing_body',
          ),
        ).length,
      },
      { label: 'Closed', value: concerns.length - open.length },
    ],
    sections: [
      { title: 'Open', columns, rows: open.map(row), empty: 'No open concerns.' },
      {
        title: 'Closed',
        columns,
        rows: concerns.filter((c) => c.status === 'closed').map(row),
        empty: 'None closed.',
      },
    ],
    footnote: `Only the Child Safety Officers, the Complaints Managers and admins can see concerns, and nobody sees one about themselves, so this copy leaves out any concern about the person who made it. Child abuse and serious crimes go to Police${governingBody ? ` and ${governingBody}` : ''} straight away.`,
    landscape: true,
  };
}
