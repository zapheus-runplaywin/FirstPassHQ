import type { Href } from 'expo-router';

import type { IconName } from '@/components/icon';
import type { Features } from '@/lib/club';

export type AdminMenuItem = {
  title: string;
  detail: string;
  href: Href;
  icon: IconName;
  /** Its name inside a sentence, for an area's summary in the Club tab. */
  short: string;
  /** What an admin might type to find it: the settings and lists it holds. */
  keywords: string[];
};

type MenuOptions = {
  features: Features;
  /** Whether the club uses squads, which renames Teams to Squads and teams. */
  squads: boolean;
  /** Members' live line, such as "No requests waiting". */
  membersDetail: string;
};

/**
 * Everything an admin sets up or looks after for the club: every item the
 * club's features allow, sorted alphabetically by title. The Club tab groups
 * them into its five areas and searches them (src/lib/club-areas.ts); the
 * "Everything, A to Z" screen (src/app/administration.tsx) lists them as they
 * come from here.
 */
export function adminMenuItems({ features, squads, membersDetail }: MenuOptions): AdminMenuItem[] {
  const items: (AdminMenuItem | false)[] = [
    {
      title: 'Members',
      detail: membersDetail,
      href: '/admin',
      icon: 'users',
      short: 'members',
      keywords: [
        'member',
        'join requests',
        'approve',
        'roles',
        'working with children',
        'wwcc',
        'parents',
        'guardians',
        'stand down',
        'verify',
      ],
    },
    {
      title: 'Reports',
      detail: 'Governance and compliance reports to save as PDFs',
      href: '/admin/reports',
      icon: 'bar-chart-2',
      short: 'reports',
      keywords: [
        'pdf',
        'working with children',
        'wwcc',
        'under 18s',
        'guardians',
        'medical details',
        'integrity training',
        'injuries',
        'attendance',
        'session plans',
        'award results',
        'season kpis',
      ],
    },
    {
      title: 'Invite members',
      detail: 'A QR code and link that take new members to the club’s sign-in',
      href: '/admin/invite',
      icon: 'user-plus',
      short: 'invites',
      keywords: ['join', 'new members'],
    },
    {
      title: 'Safeguarding',
      detail: 'Child Safety Officer, Complaints Manager, governing body and policy',
      href: '/admin/safeguarding',
      icon: 'shield',
      short: 'safeguarding contacts',
      keywords: [
        'wwc registration officer',
        'hotline',
        'policies',
        'privacy',
        'committee checks',
        'statistician checks',
        'photos',
        'injury clearances',
        'concussion',
        'concern times',
        'escalation',
      ],
    },
    {
      title: 'Code of conduct',
      detail: 'Who has accepted it this season and who still has to',
      href: '/admin/conduct',
      icon: 'check-square',
      short: 'code of conduct',
      keywords: ['accept'],
    },
    {
      title: 'Club brand',
      detail: 'Club name, logo and colours',
      href: '/admin/club/brand',
      icon: 'image',
      short: 'brand',
      keywords: ['colors', 'look'],
    },
    {
      title: 'Club features',
      detail: 'Which features are on, and which teams try them first',
      href: '/admin/club/features',
      icon: 'toggle-right',
      short: 'features',
      keywords: ['switch', 'turn on', 'turn off', 'pilot'],
    },
    {
      title: 'Club options',
      detail: 'Squads, and whether physios get club messages',
      href: '/admin/club/options',
      icon: 'sliders',
      short: 'options',
      keywords: ['time zone', 'timezone', 'where the club is'],
    },
    {
      title: 'Record keeping',
      detail: 'How long the club keeps records, and removing old ones',
      href: '/admin/club/records',
      icon: 'archive',
      short: 'record keeping',
      keywords: ['retention', 'remove old records', 'delete'],
    },
    {
      title: squads ? 'Squads and teams' : 'Teams',
      detail: squads
        ? 'Add squads and name teams at selections'
        : 'Add teams and choose who is in each',
      href: '/admin/squads',
      icon: 'grid',
      short: squads ? 'squads and teams' : 'teams',
      keywords: ['place', 'coaches', 'managers', 'athletes'],
    },
    {
      title: 'Seasons',
      detail: 'Start the next season and archive the last one',
      href: '/admin/seasons',
      icon: 'repeat',
      short: 'seasons',
      keywords: ['new season'],
    },
    features.messages && {
      title: 'Club captains',
      detail: 'Choose the athletes who can message the whole club',
      href: '/admin/captains',
      icon: 'star',
      short: 'captains',
      keywords: [],
    },
    features.messages &&
      features.chatGroups && {
        title: 'Chat groups',
        detail: 'Set up chat groups for roles, squads and teams, or named people',
        href: '/admin/chat-groups',
        icon: 'message-square',
        short: 'chat groups',
        keywords: ['posts'],
      },
    features.awards && {
      title: 'Awards',
      detail: 'Create award votes, see results and copy annual awards',
      href: '/admin/awards',
      icon: 'award',
      short: 'awards',
      keywords: ['voting'],
    },
    features.integrity && {
      title: 'Integrity training courses',
      detail: 'Sports Integrity Australia courses each role must complete, and who has',
      href: '/admin/training',
      icon: 'book-open',
      short: 'training courses',
      keywords: ['certificates', 'induction'],
    },
    features.selectionAssessments && {
      title: 'Selection rounds and criteria',
      detail: 'Assessment criteria, selection rounds, their panels and the audit report',
      href: '/admin/assessments',
      icon: 'eye',
      short: 'selection rounds',
      keywords: ['selection assessments', 'selectors'],
    },
    features.kpis && {
      title: 'Season KPI reviews',
      detail: 'The dates each season’s KPIs are reviewed',
      href: '/admin/kpi-reviews',
      icon: 'target',
      short: 'KPI reviews',
      keywords: [],
    },
    (features.calendar || features.awards || features.goals) && {
      title: 'Fixtures',
      detail: 'Import match fixtures from PlayHQ',
      href: '/admin/fixtures',
      icon: 'list',
      short: 'fixtures',
      keywords: ['matches'],
    },
    {
      title: 'Games',
      detail: 'Games recorded in FirstPass Vantage, and who recorded each',
      href: '/admin/games',
      icon: 'video',
      short: 'games',
      keywords: ['statistician', 'stats'],
    },
    features.calendar && {
      title: 'Calendars',
      detail: 'Add the club calendar and team calendars',
      href: '/admin/calendars',
      icon: 'calendar',
      short: 'calendars',
      keywords: ['who sees'],
    },
    features.attendance && {
      title: 'Absence reasons',
      detail: 'The reasons members choose when they report an absence',
      href: '/admin/absence-reasons',
      icon: 'x-circle',
      short: 'absence reasons',
      keywords: ['can’t make it'],
    },
    {
      title: 'Club password',
      detail: 'New members need it to ask to join',
      href: '/admin/club-password',
      icon: 'lock',
      short: 'club password',
      keywords: [],
    },
  ];
  return items
    .filter((item): item is AdminMenuItem => item !== false)
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}
