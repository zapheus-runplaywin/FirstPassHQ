/**
 * The shape of the app once someone is in: which tabs they have, which hub
 * (Team, Family or Club) each of their jobs gives them, and where each thing
 * that used to be a card on the one Home screen now lives.
 *
 * Nothing here decides who may see a card. Each card keeps the rule it always
 * had (src/lib/home.tsx works those out); this only decides where a card that
 * is shown goes. A card that fits none of the member's hubs goes to Me, so
 * nothing a member could reach before can go missing.
 */
import type { KpiRelation } from '@/lib/kpis';

/** The fourth tab, named for what the member looks after. */
export type HubName = 'team' | 'family' | 'club';

export const HUBS: HubName[] = ['team', 'family', 'club'];

export const HUB_TITLES: Record<HubName, string> = {
  team: 'Team',
  family: 'Family',
  club: 'Club',
};

/** Where a card can live: a hub, Me, or the top of Today. */
export type Place = HubName | 'me' | 'today';

export type TabName = 'index' | 'calendar' | 'messages' | HubName | 'me';

/**
 * What the member does at the club, worked out from their usable roles and
 * their places in squads and teams (so a paused role counts for nothing).
 */
export type Jobs = {
  /** Plays: holds the athlete role, or is in a squad or team as an athlete. */
  athlete: boolean;
  /** Coaches, manages or is a physio, by role or by a place in a squad or team. */
  staff: boolean;
  /** An approved parent or guardian. */
  guardian: boolean;
  /** On the committee, or an admin. */
  clubOfficer: boolean;
};

/** The hubs a member has, in the order the switch shows them. */
export function hubsFor(jobs: Jobs): HubName[] {
  const hubs: HubName[] = [];
  if (jobs.athlete || jobs.staff) hubs.push('team');
  if (jobs.guardian) hubs.push('family');
  if (jobs.clubOfficer) hubs.push('club');
  return hubs;
}

/**
 * The hub the tab bar opens until the member picks another: the one for their
 * main role, or the first they have.
 */
export function defaultHub(hubs: HubName[], mainRole: string | null | undefined): HubName | null {
  const wanted: HubName | null =
    mainRole === 'admin' || mainRole === 'committee'
      ? 'club'
      : mainRole === 'guardian'
        ? 'family'
        : 'team';
  return hubs.includes(wanted) ? wanted : (hubs[0] ?? null);
}

/**
 * The tabs in the bar, left to right. People with one job to do (waiting for
 * approval, a child waiting for a parent, temporary helpers, Studio on its
 * own) keep a single screen and no bar.
 */
export function tabsFor({
  single,
  calendar,
  messages,
  hub,
}: {
  /** One focused screen, no tab bar. */
  single: boolean;
  /** The calendar is switched on. */
  calendar: boolean;
  /** Messages are switched on and this member gets them. */
  messages: boolean;
  /** The hub the bar shows, if the member has one. */
  hub: HubName | null;
}): TabName[] {
  if (single) return ['index'];
  const tabs: TabName[] = ['index'];
  if (calendar) tabs.push('calendar');
  if (messages) tabs.push('messages');
  if (hub) tabs.push(hub);
  tabs.push('me');
  return tabs;
}

/** Everything that used to be a card or section on the one Home screen. */
export const HOME_CARDS = [
  'verification',
  'concerns',
  'dailyCheckIn',
  'checkIns',
  'attendance',
  'myAttendance',
  'injuries',
  'sessionPlans',
  'reports',
  'administration',
  'surveys',
  'awards',
  'integrity',
  'kpis',
  'selectionAssessments',
  'selectionAudits',
  'selection',
  'registers',
  'guardianOf',
  'children',
  'groups',
] as const;

export type HomeCard = (typeof HOME_CARDS)[number];

/** What placing a card depends on, beyond the member's jobs. */
export type PlacementFacts = Jobs & {
  /** May send surveys to a squad, team or the club. */
  canSendSurveys: boolean;
  /** Has surveys of their own to answer, or answered. */
  hasSurveys: boolean;
  /** Has integrity training of their own to complete. */
  hasOwnTraining: boolean;
  /** Whose Season KPIs they can see: their own, a child's, people they set them for. */
  kpiRelations: KpiRelation[];
};

type Wanted = (Place | false)[];

/** The first place that applies. */
const first = (...places: Wanted): Wanted => [places.find((p) => p !== false) ?? false];

/**
 * Where each card would like to go. Hubs are only ever named for a job the
 * member holds, so a place listed here always exists for them.
 */
const WANTED: Record<HomeCard, (f: PlacementFacts) => Wanted> = {
  // A parent confirming who they are: a job to do, so it leads Today.
  verification: () => ['today'],
  // Safeguarding work is never behind a hub: the top of Today, and the Club hub.
  concerns: (f) => ['today', f.clubOfficer && 'club'],
  // Their own things.
  dailyCheckIn: () => ['me'],
  myAttendance: () => ['me'],
  awards: () => ['me'],
  // Other people's check-ins and attendance: the people who coach them, and the club.
  checkIns: (f) => [f.staff && 'team', f.clubOfficer && 'club'],
  attendance: (f) => [f.staff && 'team', f.clubOfficer && 'club'],
  // Injuries: your own, your child's, your athletes', the club's clearances.
  injuries: (f) => [
    f.athlete && 'me',
    f.guardian && 'family',
    f.staff && 'team',
    f.clubOfficer && 'club',
  ],
  sessionPlans: (f) =>
    first((f.athlete || f.staff) && 'team', f.guardian && 'family', f.clubOfficer && 'club'),
  reports: (f) => [f.clubOfficer && 'club'],
  administration: (f) => [f.clubOfficer && 'club'],
  registers: (f) => [f.clubOfficer && 'club'],
  // Answering is your own; sending and results sit with the squad, team or club.
  surveys: (f) => [
    f.hasSurveys && 'me',
    f.canSendSurveys && (f.athlete || f.staff) && 'team',
    f.canSendSurveys && f.clubOfficer && 'club',
  ],
  integrity: (f) => [f.hasOwnTraining && 'me', f.clubOfficer && 'club'],
  kpis: (f) => [
    f.kpiRelations.includes('self') && 'me',
    f.kpiRelations.includes('guardian') && f.guardian && 'family',
    f.kpiRelations.includes('setter') && f.staff && 'team',
    (f.kpiRelations.includes('viewer') || f.kpiRelations.includes('setter')) &&
      f.clubOfficer &&
      'club',
  ],
  // A selection round only shows while it runs, and it is the work of those
  // weeks: one tap from Today for the panel (a guest selector has no hub), and
  // with the coach's squads or the club's work too.
  selectionAssessments: (f) => ['today', ...first(f.staff && 'team', f.clubOfficer && 'club')],
  // A committee member's rounds to audit: on Today and with the club's work.
  selectionAudits: () => ['today', 'club'],
  // Selection dates and the coach's feedback, while there are any: on Today,
  // and with your own things or your child's.
  selection: (f) => ['today', (f.athlete || !f.guardian) && 'me', f.guardian && 'family'],
  guardianOf: (f) => [f.guardian && 'family'],
  children: (f) => [f.guardian && 'family'],
  groups: (f) => first((f.athlete || f.staff) && 'team', f.guardian && 'family'),
};

/**
 * Where a card lives for this member: every place that applies, or Me when
 * none does, so a card that is shown is always somewhere.
 */
export function placesFor(card: HomeCard, facts: PlacementFacts): Place[] {
  const hubs = hubsFor(facts);
  const places = WANTED[card](facts).filter(
    (p): p is Place => p !== false && (p === 'me' || p === 'today' || hubs.includes(p)),
  );
  return places.length > 0 ? [...new Set(places)] : ['me'];
}

/** The cards in one place, in the order the old Home screen had them. */
export function cardsIn(place: Place, shown: HomeCard[], facts: PlacementFacts): HomeCard[] {
  return HOME_CARDS.filter(
    (card) => shown.includes(card) && placesFor(card, facts).includes(place),
  );
}
