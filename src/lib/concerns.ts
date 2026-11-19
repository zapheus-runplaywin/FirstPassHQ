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
      c.about_member_name ?? c.about_text ?? '',
      c.body,
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
    footnote: `Only the Child Safety Officer, the Complaints Manager and admins can see concerns, and nobody sees one about themselves, so this copy leaves out any concern about the person who made it. Child abuse and serious crimes go to Police${governingBody ? ` and ${governingBody}` : ''} straight away.`,
    landscape: true,
  };
}
