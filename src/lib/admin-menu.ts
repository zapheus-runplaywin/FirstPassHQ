import type { Href } from 'expo-router';

import type { Features } from '@/lib/club';

export type AdminMenuItem = {
  title: string;
  detail: string;
  href: Href;
};

type MenuOptions = {
  features: Features;
  /** Whether the club uses squads, which renames Teams to Squads and teams. */
  squads: boolean;
  /** Members' live line, such as "No requests waiting". */
  membersDetail: string;
};

/**
 * The Administration screen's menu: every item the club's features allow,
 * sorted alphabetically by title so admins can find one in a long list.
 */
export function adminMenuItems({ features, squads, membersDetail }: MenuOptions): AdminMenuItem[] {
  const items: (AdminMenuItem | false)[] = [
    { title: 'Members', detail: membersDetail, href: '/admin' },
    {
      title: 'Reports',
      detail: 'Governance and compliance reports to save as PDFs',
      href: '/admin/reports',
    },
    {
      title: 'Invite members',
      detail: 'A QR code and link that take new members to the club’s sign-in',
      href: '/admin/invite',
    },
    {
      title: 'Safeguarding',
      detail: 'Child Safety Officer, Complaints Manager, governing body and policy',
      href: '/admin/safeguarding',
    },
    {
      title: 'Code of conduct',
      detail: 'Who has accepted it this season and who still has to',
      href: '/admin/conduct',
    },
    {
      title: 'Club settings',
      detail: 'Club name, colours, logo and which features are on',
      href: '/admin/club',
    },
    {
      title: squads ? 'Squads and teams' : 'Teams',
      detail: squads
        ? 'Add squads and name teams at selections'
        : 'Add teams and choose who is in each',
      href: '/admin/squads',
    },
    {
      title: 'Seasons',
      detail: 'Start the next season and archive the last one',
      href: '/admin/seasons',
    },
    features.messages && {
      title: 'Club captains',
      detail: 'Choose the athletes who can message the whole club',
      href: '/admin/captains',
    },
    features.awards && {
      title: 'Awards',
      detail: 'Create award votes, see results and copy annual awards',
      href: '/admin/awards',
    },
    features.integrity && {
      title: 'Integrity training',
      detail: 'Sports Integrity Australia courses each role must complete, and who has',
      href: '/admin/training',
    },
    features.kpis && {
      title: 'Season KPI reviews',
      detail: 'The dates each season’s KPIs are reviewed',
      href: '/admin/kpi-reviews',
    },
    (features.calendar || features.awards || features.goals) && {
      title: 'Fixtures',
      detail: 'Import match fixtures from PlayHQ',
      href: '/admin/fixtures',
    },
    features.calendar && {
      title: 'Calendars',
      detail: 'Add the club calendar and team calendars',
      href: '/admin/calendars',
    },
    features.attendance && {
      title: 'Absence reasons',
      detail: 'The reasons members choose when they report an absence',
      href: '/admin/absence-reasons',
    },
    features.injuries && {
      title: 'Injury report',
      detail: 'Injuries and their status, as a PDF or CSV',
      href: '/admin/injuries',
    },
    {
      title: 'Club password',
      detail: 'New members need it to ask to join',
      href: '/admin/club-password',
    },
  ];
  return items
    .filter((item): item is AdminMenuItem => item !== false)
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}
