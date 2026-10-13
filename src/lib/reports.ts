import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import {
  affiliationCriteria,
  isThisYear,
  memberTypeLabels,
  officeLabels,
  officesFor,
  registrationsToCheck,
  tierLabels,
  type Affiliation,
  type Officer,
  type Registration,
} from '@/lib/affiliation';
import { formatDate, isMinor } from '@/lib/age';
import type { ClubPolicies } from '@/lib/consents';
import { formatDateString, toDateString } from '@/lib/injuries';
import { rolesLabel } from '@/lib/labels';
import type { Report, ReportRow, ReportSection } from '@/lib/pdf';
import { hasRole, rolesOf } from '@/lib/roles';
import {
  barringNotices,
  exemptionStatus,
  needsWwcc,
  screeningNoticeLabels,
  standDownReasonLabels,
  volunteerExemptionLabels,
  volunteerTimeOff,
  WWCC_WARNING_DAYS,
  wwccRecordIssues,
  wwccStatus,
  wwccValidationLabels,
} from '@/lib/safety';
import type {
  Profile,
  SafeguardingContacts,
  ScreeningNotice,
  StandDown,
  Team,
  TeamRole,
  VolunteerExemption,
} from '@/lib/types';
import { seasonLabel, teamLabel } from '@/lib/use-teams';

/** "West Coast Thunder" -> "west-coast-thunder", for file names. */
export function fileSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}

/** Opens the share sheet for a PDF. On the web it downloads instead. */
export async function sharePdf(fileName: string, bytes: Uint8Array) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  file.write(bytes);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: fileName,
  });
}

/**
 * Supabase returns at most 1,000 rows a request, so long lists are fetched a
 * page at a time.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = (data as T[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

/** Splits a list so `.in()` filters stay well inside URL limits. */
export function chunk<T>(items: T[], size = 150) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** A member's place in a squad or team, from `team_members`. */
export type Placement = { team_id: string; profile_id: string; team_role: TeamRole };

export function memberName(member: Pick<Profile, 'full_name' | 'email'>) {
  return member.full_name || member.email || 'Unnamed member';
}

/** The current squads and teams a member is in with one of these team roles. */
function groupsOf(profileId: string, placements: Placement[], teams: Team[], roles: TeamRole[]) {
  return placements
    .filter((p) => p.profile_id === profileId && roles.includes(p.team_role))
    .map((p) => teams.find((t) => t.id === p.team_id))
    .filter((t): t is Team => !!t)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((t) => teamLabel(t, teams))
    .join('\n');
}

/** The local day of an ISO time, such as "Tue 7 Oct 2026". */
/** A timestamp as the local day, DD/MM/YYYY. */
export function localDay(iso: string) {
  return formatDateString(toDateString(new Date(iso)));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

// ---------------------------------------------------------------------------
// Working With Children Checks
// ---------------------------------------------------------------------------

/** A member accepting the club's policies, from `policy_acknowledgements`. */
export type Acknowledgement = {
  profile_id: string;
  policy_version: string;
  acknowledged_at: string;
};

/** Today in the phone's time zone, as YYYY-MM-DD. */
function localIsoDay() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, '0')}`;
}

export function wwccReport(
  members: Profile[],
  placements: Placement[],
  teams: Team[],
  standDowns: StandDown[] = [],
  exemptions: VolunteerExemption[] = [],
  notices: ScreeningNotice[] = [],
  /** The club's WWC Registration Officer, if it has named one. */
  officerName: string | null = null,
  /** Who accepted the club's policies, newest first. */
  acknowledgements: Acknowledgement[] = [],
): Report {
  const approved = members.filter((m) => m.status === 'approved');
  // Temporary helpers outside their dates need nothing, and are listed on their own.
  const volunteers = approved
    .filter((m) => hasRole(m, 'volunteer'))
    .sort((a, b) => (b.volunteer_from ?? '').localeCompare(a.volunteer_from ?? ''));
  const openExemption = new Map(exemptions.filter((e) => !e.ended_at).map((e) => [e.profile_id, e]));
  // A volunteer exemption stands in for a check they don't have.
  const screenedByExemption = (m: Profile) => {
    const kind = wwccStatus(m).kind;
    return openExemption.has(m.id) && kind !== 'current' && kind !== 'expiring';
  };
  const people = approved
    .filter((m) => needsWwcc(m) && !screenedByExemption(m) && !volunteerTimeOff(m))
    .map((m) => ({ member: m, name: memberName(m), status: wwccStatus(m) }))
    .sort(byName);
  // Committee members and admins another admin excused from the check, with the reason.
  const exempt = approved
    .filter((m) => hasRole(m, 'committee', 'admin') && !needsWwcc(m))
    .map((m) => ({ member: m, name: memberName(m) }))
    .sort(byName);
  const nameOf = (id: string | null) => {
    const admin = id ? members.find((m) => m.id === id) : undefined;
    return admin ? memberName(admin) : 'A former admin';
  };

  const current = (status: (typeof people)[number]['status']) =>
    status.kind === 'current' || status.kind === 'expiring';
  const row = ({ member, name, status }: (typeof people)[number]): ReportRow => {
    const recordIssues = current(status) ? wwccRecordIssues(member) : [];
    return {
      cells: [
        name,
        member.wwcc_card_name?.trim() ?? '',
        formatDate(member.date_of_birth),
        rolesLabel(rolesOf(member)),
        groupsOf(member.id, placements, teams, ['coach', 'manager', 'physio']),
        member.wwcc_number?.trim() ?? '',
        formatDate(member.wwcc_expires_on),
        member.wwcc_validated_at
          ? `${localDay(member.wwcc_validated_at)}, ${wwccValidationLabels[member.wwcc_validation_method ?? 'online'].toLowerCase()} by ${nameOf(member.wwcc_validated_by ?? null)}`
          : '',
        member.wwcc_unit_linked_at ? localDay(member.wwcc_unit_linked_at) : '',
        [status.short, ...recordIssues].join('. '),
      ],
      flag: status.problem || recordIssues.length > 0,
    };
  };

  const columns = [
    { label: 'Name', width: 1.3 },
    { label: 'Name on card', width: 1.2 },
    { label: 'Born', width: 0.8 },
    { label: 'Roles', width: 1.0 },
    { label: 'Squads and teams', width: 1.2 },
    { label: 'Card number', width: 1.0 },
    { label: 'Expires', width: 0.8 },
    { label: 'Validated', width: 1.5 },
    { label: 'Linked with Unit', width: 0.9 },
    { label: 'Status', width: 1.5 },
  ];
  const count = (kind: string) => people.filter((p) => p.status.kind === kind).length;
  const exemptColumns = [
    { label: 'Name', width: 1.4 },
    { label: 'Roles', width: 1.1 },
    { label: 'Reason', width: 2.6 },
    { label: 'Exempted by', width: 1.1 },
    { label: 'On', width: 0.8 },
  ];

  return {
    title: 'Working With Children Checks',
    subtitle: `Approved coaches, managers, physios, temporary helpers, committee members and admins. WWC Registration Officer: ${officerName ?? 'not named yet'}`,
    landscape: true,
    stats: [
      { label: 'Need a check', value: people.length },
      { label: 'Current', value: count('current') },
      { label: `Expire within ${WWCC_WARNING_DAYS} days`, value: count('expiring') },
      { label: 'Expired', value: count('expired') },
      { label: 'Missing', value: count('missing') },
      { label: 'Committee and admins exempt', value: exempt.length },
      {
        label: 'Exempt from a check',
        value: approved.filter((m) => needsWwcc(m) && screenedByExemption(m)).length,
      },
      {
        label: 'To validate',
        value: people.filter(
          (p) => current(p.status) && wwccRecordIssues(p.member).some((i) => i.includes('validated')),
        ).length,
      },
      { label: 'Stood down now', value: standDowns.filter((s) => !s.lifted_at).length },
      {
        label: 'Temporary helpers helping now',
        value: volunteers.filter((m) => !volunteerTimeOff(m)).length,
      },
    ],
    sections: [
      {
        title: 'Needs attention',
        note: `Missing, expired or expiring within ${WWCC_WARNING_DAYS} days, never validated or validated over a year ago, or not linked to the club with the Screening Unit. Their coach, manager, physio and committee roles are paused while a check is missing or expired. Admin roles are not paused, so the club is never locked out, but an admin can be stood down.`,
        columns,
        rows: people
          .filter((p) => p.status.problem || (current(p.status) && wwccRecordIssues(p.member).length > 0))
          .map(row),
        empty: 'Every check is current.',
      },
      {
        title: 'Current',
        columns,
        rows: people
          .filter((p) => !p.status.problem && wwccRecordIssues(p.member).length === 0)
          .map(row),
        empty: 'No current checks recorded.',
      },
      {
        title: 'Committee members and admins exempted',
        note: 'Excused from the check by another admin, with the reason they gave.',
        columns: exemptColumns,
        rows: exempt.map(({ member, name }) => ({
          cells: [
            name,
            rolesLabel(rolesOf(member)),
            member.wwcc_exempt_reason?.trim() ?? '',
            nameOf(member.wwcc_exempted_by),
            member.wwcc_exempted_at ? localDay(member.wwcc_exempted_at) : '',
          ],
        })),
        empty: 'Nobody is exempt.',
      },
      {
        title: 'Exempt from a check',
        note: 'Parent volunteers at their child’s club and volunteers under 18 don’t need a check in WA, and nor does someone not ordinarily resident in WA for two weeks after they arrive or up to 30 days at a national event or tour, once in any 12 months. Each accepts a declaration in the app; the exemption ends by itself when the child or volunteer turns 18, the child leaves, or its last day passes. Ended exemptions are listed after current ones.',
        columns: [
          { label: 'Name', width: 1.3 },
          { label: 'Exemption', width: 1.5 },
          { label: 'Recorded', width: 1.3 },
          { label: 'Declaration', width: 1.0 },
          { label: 'Status', width: 2.0 },
        ],
        rows: exemptions
          .filter((e) => e.ended_at || approved.some((m) => m.id === e.profile_id))
          .map((e) => {
            const member = members.find((m) => m.id === e.profile_id);
            const status = exemptionStatus(e);
            return {
              cells: [
                member ? memberName(member) : 'A former member',
                `${volunteerExemptionLabels[e.basis]}${e.child_name ? ` for ${e.child_name}` : ''}${e.event_name ? `: ${e.event_name}, run by ${e.organiser ?? 'unknown'}` : ''}${e.starts_on && e.ends_on ? `, ${formatDate(e.starts_on)} to ${formatDate(e.ends_on)}` : ''}`,
                `${localDay(e.set_at)} by ${e.set_by_name ?? 'a former admin'}`,
                e.declared_at ? `Accepted ${localDay(e.declared_at)}` : 'Waiting',
                e.ended_at
                  ? `Ended ${localDay(e.ended_at)} by ${e.ended_by_name ?? 'a former admin'}${e.end_note ? ` (${e.end_note})` : ''}`
                  : status.label,
              ],
              flag: !e.ended_at && status.problem,
            };
          }),
        empty: 'No volunteer exemptions recorded.',
      },
      {
        title: 'Temporary helpers',
        note: 'Everyone approved to help for a day or a short time, newest first. They get no club features. Each was approved only once they accepted the club’s code of conduct and safeguarding policy and a check or accepted exemption covered every day they help.',
        columns: [
          { label: 'Name', width: 1.3 },
          { label: 'Helping with', width: 1.8 },
          { label: 'Dates', width: 1.3 },
          { label: 'Screened by', width: 2.0 },
          { label: 'Policies accepted', width: 1.0 },
          { label: 'Status', width: 1.0 },
        ],
        rows: volunteers.map((m) => {
          const exemption = exemptions.find((e) => e.profile_id === m.id && !e.ended_at);
          const card = wwccStatus(m);
          const accepted = acknowledgements.find((a) => a.profile_id === m.id);
          const today = localIsoDay();
          const status = m.stood_down_at
            ? 'Stood down'
            : m.volunteer_until && m.volunteer_until < today
              ? 'Finished'
              : m.volunteer_from && m.volunteer_from > today
                ? 'Upcoming'
                : 'Helping now';
          return {
            cells: [
              memberName(m),
              m.volunteer_task ?? '',
              m.volunteer_from && m.volunteer_until
                ? `${formatDate(m.volunteer_from)} to ${formatDate(m.volunteer_until)}`
                : '',
              card.kind === 'current' || card.kind === 'expiring'
                ? `Card ${m.wwcc_number?.trim() ?? ''}, expires ${formatDate(m.wwcc_expires_on)}`
                : exemption
                  ? exemptionStatus(exemption).label
                  : card.label,
              accepted ? localDay(accepted.acknowledged_at) : 'No',
              status,
            ],
            flag: status === 'Helping now' && needsWwcc(m) && card.problem && !exemption?.valid,
          };
        }),
        empty: 'No temporary helpers.',
      },
      {
        title: 'Screening Unit notices',
        note: 'Every notice recorded, newest first. Interim negative notices, negative notices, interstate decisions and cancelled cards are reported to the governing body in writing.',
        columns: [
          { label: 'Name', width: 1.3 },
          { label: 'Notice', width: 1.3 },
          { label: 'Received', width: 0.8 },
          { label: 'What the club did', width: 2.4 },
          { label: 'Governing body told', width: 1.4 },
        ],
        rows: notices.map((n) => {
          const barring = barringNotices.includes(n.kind);
          return {
            cells: [
              n.member_name,
              screeningNoticeLabels[n.kind],
              formatDate(n.received_on),
              n.action,
              n.governing_body_told_on
                ? `${formatDate(n.governing_body_told_on)} by ${n.governing_body_told_by_name ?? 'a former admin'}`
                : barring
                  ? 'Not yet'
                  : 'Not needed',
            ],
            flag: barring && !n.governing_body_told_on,
          };
        }),
        empty: 'No notices recorded.',
      },
      {
        title: 'Stand-downs',
        note: 'Members an admin stood down from child-related roles, newest first, including ones since lifted.',
        columns: [
          { label: 'Name', width: 1.3 },
          { label: 'Reason', width: 1.6 },
          { label: 'Stood down', width: 1.3 },
          { label: 'Lifted', width: 1.3 },
          { label: 'Notes', width: 1.9 },
        ],
        rows: standDowns.map((s) => ({
          cells: [
            s.member_name,
            standDownReasonLabels[s.reason],
            `${localDay(s.started_at)} by ${s.started_by_name ?? 'a former admin'}`,
            s.lifted_at ? `${localDay(s.lifted_at)} by ${s.lifted_by_name ?? 'a former admin'}` : 'Still stood down',
            [s.note, s.lift_note].filter(Boolean).join(' · '),
          ],
          flag: !s.lifted_at,
        })),
        empty: 'Nobody has been stood down.',
      },
    ],
    footnote:
      'From the cards admins record and validate in Members. Each card is validated online or sighted at least once a year and whenever it is renewed.',
  };
}

// ---------------------------------------------------------------------------
// Under 18s and their parents and guardians
// ---------------------------------------------------------------------------

export type Guardianship = { guardian_id: string; athlete_id: string };

/** The consents in force for an athlete under 18. */
export type ChildConsentStatus = { athlete_id: string; data: boolean; health: boolean };

function viewsLabel(summary: RecordAccessSummary | undefined) {
  if (!summary || Number(summary.views) === 0) return 'None';
  const views = Number(summary.views);
  const viewers = Number(summary.viewers);
  return `${views} by ${viewers} ${viewers === 1 ? 'person' : 'people'}`;
}

function consentLabel(consent: ChildConsentStatus | undefined) {
  if (!consent || (!consent.data && !consent.health)) return 'None given';
  if (consent.data && consent.health) return 'Check-ins and injuries';
  return consent.data ? 'Check-ins only' : 'Injuries only';
}

/** Views of a child's records by people other than them and their guardians, last 12 months. */
export type RecordAccessSummary = {
  subject_id: string;
  views: number;
  viewers: number;
  last_viewed_at: string;
};

/** Whole years old today. */
export function ageOn(dateOfBirth: string, today = new Date()) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const birthdayPassed =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  return today.getFullYear() - year - (birthdayPassed ? 0 : 1);
}

export function under18sReport(
  members: Profile[],
  guardianships: Guardianship[],
  placements: Placement[],
  teams: Team[],
  consents: ChildConsentStatus[] = [],
  access: RecordAccessSummary[] = [],
): Report {
  const accessOf = new Map(access.map((a) => [a.subject_id, a]));
  const byId = new Map(members.map((m) => [m.id, m]));
  const consentOf = new Map(consents.map((c) => [c.athlete_id, c]));
  const athletes = members
    .filter(
      (m) => m.status === 'approved' && hasRole(m, 'athlete') && isMinor(m.date_of_birth, m.under_17),
    )
    .map((m) => ({
      member: m,
      name: memberName(m),
      guardians: guardianships
        .filter((g) => g.athlete_id === m.id)
        .map((g) => byId.get(g.guardian_id))
        .filter((g): g is Profile => !!g)
        .sort((a, b) => memberName(a).localeCompare(memberName(b))),
    }))
    .sort(byName);

  const row = ({ member, name, guardians }: (typeof athletes)[number]): ReportRow => ({
    cells: [
      name,
      member.date_of_birth
        ? `${formatDate(member.date_of_birth)} (${ageOn(member.date_of_birth)})`
        : 'Not recorded',
      groupsOf(member.id, placements, teams, ['athlete']),
      guardians.length
        ? guardians
            .map(
              (g) =>
                `${memberName(g)}${g.status !== 'approved' ? ' (not approved)' : !g.verified_at ? ' (not verified)' : ''}`,
            )
            .join('\n')
        : 'None linked',
      guardians.map((g) => g.email ?? g.playhq_email ?? '').join('\n'),
      consentLabel(consentOf.get(member.id)),
      viewsLabel(accessOf.get(member.id)),
    ],
    flag: guardians.length === 0,
  });

  const columns = [
    { label: 'Athlete', width: 1.3 },
    { label: 'Date of birth (age)', width: 1 },
    { label: 'Squad or team', width: 1.2 },
    { label: 'Parents and guardians', width: 1.5 },
    { label: 'Guardian email', width: 1.8 },
    { label: 'Consent', width: 1.1 },
    { label: 'Record views (12 months)', width: 1 },
  ];
  const fullConsent = athletes.filter((a) => {
    const c = consentOf.get(a.member.id);
    return !!c?.data && !!c?.health;
  }).length;
  const withGuardian = athletes.filter((a) => a.guardians.length > 0);
  const noBirthday = athletes.filter((a) => !a.member.date_of_birth).length;

  return {
    title: 'Under 18s and their guardians',
    subtitle: 'Approved athletes under 18 today',
    landscape: true,
    stats: [
      { label: 'Athletes under 18', value: athletes.length },
      { label: 'With a parent or guardian', value: withGuardian.length },
      { label: 'No parent or guardian', value: athletes.length - withGuardian.length },
      { label: 'No date of birth', value: noBirthday },
      { label: 'Full consent given', value: fullConsent },
      { label: 'Consent missing', value: athletes.length - fullConsent },
      {
        label: 'Record views (12 months)',
        value: athletes.reduce((n, a) => n + Number(accessOf.get(a.member.id)?.views ?? 0), 0),
      },
    ],
    sections: [
      {
        title: 'No parent or guardian linked',
        columns,
        rows: athletes.filter((a) => a.guardians.length === 0).map(row),
        empty: 'Every athlete under 18 has a parent or guardian linked.',
      },
      {
        title: 'With parents or guardians',
        columns,
        rows: withGuardian.map(row),
        empty: 'No athletes under 18 have a parent or guardian linked yet.',
      },
    ],
    footnote:
      'Under 18 is worked out from the date of birth, or from the admin’s “Under 18” choice when no date of birth is recorded. “Not verified” means the guardian hasn’t been checked with their in-app code or against PlayHQ. Consent is given by a verified parent or guardian in the app; until it is, the athlete’s coaches, physios and the committee don’t see their check-ins or injuries. Record views counts each time someone other than the athlete or their guardians opened their injuries, injury documents, check-ins, game goals or member record in the last 12 months; each athlete’s page lists who.',
  };
}

// ---------------------------------------------------------------------------
// Integrity training
// ---------------------------------------------------------------------------

export type CourseProgress = {
  name: string;
  due_on: string;
  members: {
    profile_id: string;
    full_name: string | null;
    status: 'to_do' | 'submitted' | 'approved' | 'sent_back';
    completed_on: string | null;
    reviewed_by_name: string | null;
    reviewed_at: string | null;
  }[];
};

const courseStatusLabels = {
  to_do: 'To do',
  submitted: 'Waiting to be checked',
  approved: 'Approved',
  sent_back: 'Sent back',
};

export function integrityReport(
  seasonName: string,
  courses: CourseProgress[],
  today: string,
): Report {
  const people = new Map<string, { name: string; outstanding: string[]; overdue: boolean }>();
  for (const course of courses) {
    for (const m of course.members) {
      const person = people.get(m.profile_id) ?? {
        name: m.full_name ?? 'Unnamed member',
        outstanding: [],
        overdue: false,
      };
      if (m.status !== 'approved') {
        person.outstanding.push(
          m.status === 'to_do' ? course.name : `${course.name} (${courseStatusLabels[m.status].toLowerCase()})`,
        );
        if (course.due_on < today) person.overdue = true;
      }
      people.set(m.profile_id, person);
    }
  }
  const everyone = [...people.values()].sort(byName);
  const outstanding = everyone.filter((p) => p.outstanding.length > 0);

  return {
    title: 'Integrity training',
    subtitle: `Sports Integrity Australia courses for ${seasonName}`,
    stats: [
      { label: 'Courses', value: courses.length },
      { label: 'Members who must complete one', value: everyone.length },
      { label: 'All done', value: everyone.length - outstanding.length },
      { label: 'Still to finish', value: outstanding.length },
      { label: 'Past a due date', value: outstanding.filter((p) => p.overdue).length },
    ],
    sections: [
      {
        title: 'Still to finish',
        note: 'Red: past the due date for at least one course.',
        columns: [
          { label: 'Member', width: 1 },
          { label: 'Courses not yet approved', width: 2 },
        ],
        rows: outstanding.map((p) => ({
          cells: [p.name, p.outstanding.join('\n')],
          flag: p.overdue,
        })),
        empty: 'Everyone has finished their training.',
      },
      ...courses.map((course) => {
        const approved = course.members.filter((m) => m.status === 'approved').length;
        return {
          title: course.name,
          note: `Due ${formatDateString(course.due_on)} · ${approved} of ${course.members.length} approved`,
          columns: [
            { label: 'Member', width: 1.4 },
            { label: 'Status', width: 1.2 },
            { label: 'Completed', width: 0.9 },
            { label: 'Checked by', width: 1.3 },
          ],
          rows: [...course.members]
            .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
            .map((m) => ({
              cells: [
                m.full_name ?? 'Unnamed member',
                courseStatusLabels[m.status],
                formatDate(m.completed_on),
                m.reviewed_by_name && m.status !== 'submitted'
                  ? `${m.reviewed_by_name}${m.reviewed_at ? `, ${formatDate(toDateString(new Date(m.reviewed_at)))}` : ''}`
                  : '',
              ],
              flag: m.status !== 'approved' && course.due_on < today,
            })),
          empty: 'Nobody has to complete it.',
        };
      }),
    ],
    footnote: 'Approved means a committee member or admin has checked the certificate.',
  };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type AttendanceSessionRow = {
  id: string;
  club_wide: boolean;
  team_id: string | null;
  team_name: string;
  name: string;
  held_at: string;
  taken_by_name: string | null;
};

export type AttendanceMarkRow = { session_id: string; profile_id: string; present: boolean };

export function rateLabel(present: number, total: number) {
  return total === 0 ? '' : `${Math.round((present / total) * 100)}%`;
}

export function attendanceReport(
  periodLabel: string,
  groupsLabel: string,
  sessions: AttendanceSessionRow[],
  marks: AttendanceMarkRow[],
  names: Map<string, string>,
): Report {
  const groupOf = (s: AttendanceSessionRow) => (s.club_wide ? 'Whole club' : s.team_name);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const groups = [...new Set(sessions.map(groupOf))];
  const present = marks.filter((m) => m.present).length;

  const sessionRows = [...sessions]
    .sort((a, b) => a.held_at.localeCompare(b.held_at))
    .map((s) => {
      const own = marks.filter((m) => m.session_id === s.id);
      const here = own.filter((m) => m.present).length;
      return {
        cells: [
          localDay(s.held_at),
          groupOf(s),
          s.name,
          String(here),
          String(own.length - here),
          rateLabel(here, own.length),
          s.taken_by_name ?? '',
        ],
      };
    });

  return {
    title: 'Attendance',
    subtitle: `${periodLabel} · ${groupsLabel}`,
    stats: [
      { label: 'Sessions', value: sessions.length },
      { label: 'Athletes', value: new Set(marks.map((m) => m.profile_id)).size },
      { label: 'Times present', value: present },
      { label: 'Attendance', value: rateLabel(present, marks.length) || '–' },
    ],
    sections: [
      ...groups.map((group) => {
        const tally = new Map<string, { name: string; present: number; total: number }>();
        for (const mark of marks) {
          const session = sessionById.get(mark.session_id);
          if (!session || groupOf(session) !== group) continue;
          const t = tally.get(mark.profile_id) ?? {
            name: names.get(mark.profile_id) ?? 'Unnamed member',
            present: 0,
            total: 0,
          };
          t.total += 1;
          if (mark.present) t.present += 1;
          tally.set(mark.profile_id, t);
        }
        const count = sessions.filter((s) => groupOf(s) === group).length;
        return {
          title: group,
          note: `${count} ${count === 1 ? 'session' : 'sessions'}`,
          columns: [
            { label: 'Athlete', width: 2 },
            { label: 'Present', width: 0.8 },
            { label: 'Absent', width: 0.8 },
            { label: 'Attendance', width: 0.9 },
          ],
          rows: [...tally.values()].sort(byName).map((t) => ({
            cells: [t.name, String(t.present), String(t.total - t.present), rateLabel(t.present, t.total)],
          })),
          empty: 'No athletes marked.',
        };
      }),
      {
        title: 'Sessions',
        columns: [
          { label: 'Date', width: 1.1 },
          { label: 'Squad or team', width: 1.2 },
          { label: 'Session', width: 1.6 },
          { label: 'Present', width: 0.7 },
          { label: 'Absent', width: 0.7 },
          { label: 'Rate', width: 0.6 },
          { label: 'Taken by', width: 1.2 },
        ],
        rows: sessionRows,
        empty: 'No attendance taken in this period.',
      },
    ],
    footnote: 'Attendance is the share of marked sessions an athlete was present for.',
  };
}

// ---------------------------------------------------------------------------
// Award results
// ---------------------------------------------------------------------------

export type VoteBreakdownRow = {
  team_id: string | null;
  fixture_id: string | null;
  fixture_label: string | null;
  starts_at: string | null;
  preseason: boolean;
  nominee_key: string;
  nominee_name: string;
  rank: number;
  votes: number;
  points: number;
};

export type TurnoutRow = {
  team_id: string | null;
  fixture_id: string | null;
  fixture_label: string | null;
  starts_at: string | null;
  preseason: boolean;
  ballots: number;
  voters: number;
};

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n] ?? 'th'}`;

/** Standings for one group, worked out the same way as `award_results`. */
export function standings(rows: VoteBreakdownRow[], places: number, preseasonWeight: number) {
  const tallies = new Map<
    string,
    { name: string; pre: number; main: number; votes: number; byRank: number[] }
  >();
  for (const r of rows) {
    const t = tallies.get(r.nominee_key) ?? {
      name: r.nominee_name,
      pre: 0,
      main: 0,
      votes: 0,
      byRank: Array.from({ length: places }, () => 0),
    };
    if (r.preseason) t.pre += r.points;
    else t.main += r.points;
    t.votes += r.votes;
    t.byRank[r.rank - 1] = (t.byRank[r.rank - 1] ?? 0) + r.votes;
    tallies.set(r.nominee_key, t);
  }
  const list = [...tallies.values()];
  const totalPre = list.reduce((s, t) => s + t.pre, 0);
  const totalMain = list.reduce((s, t) => s + t.main, 0);
  const scored = list.map((t) => ({
    ...t,
    score:
      preseasonWeight > 0
        ? Math.round(
            (preseasonWeight * (totalPre ? t.pre / totalPre : 0) +
              (100 - preseasonWeight) * (totalMain ? t.main / totalMain : 0)) *
              10,
          ) / 10
        : t.pre + t.main,
  }));
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Equal scores share a place, shown as "=2".
  return scored.map((t, i) => {
    const first = scored.findIndex((s) => s.score === t.score);
    const tied = scored.filter((s) => s.score === t.score).length > 1;
    return { ...t, place: `${tied ? '=' : ''}${first + 1}` };
  });
}

export function awardReport({
  award,
  seasonName,
  summary,
  groups,
  breakdown,
  turnout,
}: {
  award: {
    name: string;
    closes_at: string;
    points: number[];
    by_match: boolean;
    preseason_weight: number;
  };
  seasonName: string;
  summary: string;
  groups: { id: string | null; name: string }[];
  breakdown: VoteBreakdownRow[];
  turnout: TurnoutRow[];
}): Report {
  const places = award.points.length;
  const weighted = award.preseason_weight > 0;
  const placeColumns = award.points.map((p, i) => ({
    label: places === 1 ? 'Votes' : `${ordinal(i + 1)} (${p})`,
    width: 0.6,
  }));
  const ballots = turnout.reduce((s, t) => s + t.ballots, 0);
  const sections: Report['sections'] = [];

  for (const group of groups) {
    const rows = breakdown.filter((r) => r.team_id === group.id);
    const rounds = turnout.filter((t) => t.team_id === group.id);
    const table = standings(rows, places, award.preseason_weight);
    const label = groups.length > 1 || group.id ? ` · ${group.name}` : '';
    const groupBallots = rounds.reduce((s, t) => s + t.ballots, 0);

    sections.push({
      title: `Standings${label}`,
      note: award.by_match
        ? `${groupBallots} ${groupBallots === 1 ? 'ballot' : 'ballots'} over ${rounds.filter((r) => !r.preseason).length} matches${rounds.some((r) => r.preseason) ? ' and the preseason vote' : ''}.`
        : rounds[0]
          ? `${rounds[0].ballots} of ${rounds[0].voters} who could vote cast a ballot.`
          : undefined,
      columns: [
        { label: 'Place', width: 0.5 },
        { label: 'Nominee', width: 1.8 },
        { label: weighted ? 'Score' : 'Points', width: 0.7 },
        ...(weighted
          ? [
              { label: 'Preseason points', width: 0.9 },
              { label: 'Match points', width: 0.8 },
            ]
          : []),
        ...(places > 1 ? [{ label: 'Votes', width: 0.6 }] : []),
        ...placeColumns,
      ],
      rows: table.map((t) => ({
        cells: [
          t.place,
          t.name,
          weighted ? `${t.score.toFixed(1)}%` : String(t.score),
          ...(weighted ? [String(t.pre), String(t.main)] : []),
          ...(places > 1 ? [String(t.votes)] : []),
          ...t.byRank.map(String),
        ],
      })),
      empty: 'No votes.',
    });

    if (award.by_match && rounds.length > 0) {
      sections.push({
        title: `Match by match${label}`,
        columns: [
          { label: 'Match', width: 1.4 },
          { label: 'Date', width: 0.9 },
          { label: 'Ballots', width: 0.7 },
          { label: 'Points', width: 2.4 },
        ],
        rows: rounds.map((round) => {
          const votes = standings(
            rows.filter(
              (r) => r.fixture_id === round.fixture_id && r.preseason === round.preseason,
            ),
            places,
            0,
          );
          return {
            cells: [
              round.preseason ? 'Preseason vote' : (round.fixture_label ?? 'Match'),
              round.starts_at ? localDay(round.starts_at) : '',
              `${round.ballots} of ${round.voters}`,
              votes.map((v) => `${v.name} ${v.score}`).join(' · ') || 'No votes',
            ],
          };
        }),
      });
    }
  }

  return {
    title: `${award.name} results`,
    subtitle: `${seasonName} · Closed ${localDay(award.closes_at)} · ${summary}`,
    landscape: places > 3 || weighted,
    stats: [
      { label: 'Ballots cast', value: ballots },
      { label: 'Nominees voted for', value: new Set(breakdown.map((r) => r.nominee_key)).size },
      ...(groups.length > 1 ? [{ label: 'Squads and teams', value: groups.length }] : []),
    ],
    sections,
    footnote: weighted
      ? `Score is ${award.preseason_weight}% the share of preseason points and ${100 - award.preseason_weight}% the share of match points. Ballots are secret: this shows how many votes each nominee got at each place, not who voted for whom.`
      : 'Ballots are secret: this shows how many votes each nominee got at each place, not who voted for whom.',
  };
}

// ---------------------------------------------------------------------------
// Affiliation
// ---------------------------------------------------------------------------

function checklistSection(criteria: ReturnType<typeof affiliationCriteria>): ReportSection {
  const missing = criteria.filter((c) => c.need === 'required' && !c.met);
  return {
    title: 'Checklist',
    note: missing.length
      ? `${missing.length} required ${missing.length === 1 ? 'item' : 'items'} not done yet, shown in red.`
      : undefined,
    columns: [
      { label: 'Item', width: 2.2 },
      { label: 'Need', width: 0.9 },
      { label: 'Done', width: 0.6 },
      { label: 'How it’s known', width: 1 },
    ],
    rows: criteria.map((c) => ({
      cells: [
        c.detail ? `${c.label}\n${c.detail}` : c.label,
        c.need === 'required' ? 'Required' : 'Recommended',
        c.met ? 'Yes' : 'No',
        c.manual ? 'Ticked by an admin' : 'From the app’s records',
      ],
      flag: c.need === 'required' && !c.met,
    })),
    empty: 'Choose the association’s tier to see the checklist.',
  };
}

function officersSection(affiliation: Affiliation, officers: Officer[]): ReportSection {
  return {
    title: 'Officers and safeguarding induction',
    columns: [
      { label: 'Office', width: 1.6 },
      { label: 'Name', width: 1.2 },
      { label: 'Induction completed', width: 1 },
    ],
    rows: officesFor(affiliation.tier).map((office) => {
      const officer = officers.find((o) => o.office === office);
      return {
        cells: [
          officeLabels[office],
          officer?.name ?? 'Nobody named',
          officer?.inducted_on ? formatDateString(officer.inducted_on) : 'Not recorded',
        ],
        flag: !officer?.inducted_on,
      };
    }),
    empty: 'Choose the association’s tier to see its officers.',
  };
}

export function affiliationReport(
  affiliation: Affiliation,
  officers: Officer[],
  registrations: Registration[],
): Report {
  const criteria = affiliationCriteria(affiliation, officers);
  const isClub = affiliation.member_type === 'club';
  const season = affiliation.season;
  const contacts = [affiliation.primary_contact_1_name, affiliation.primary_contact_2_name].filter(
    Boolean,
  );
  const status = (r: Registration) =>
    r.registered === null ? 'To check' : r.registered ? 'Registered' : 'Not registered';
  const order = (r: Registration) => (r.registered === false ? 0 : r.registered === null ? 1 : 2);
  const roleNames: Record<string, string> = { athlete: 'Athlete', coach: 'Coach', manager: 'Manager' };

  return {
    title: 'Affiliation',
    subtitle: `${memberTypeLabels[affiliation.member_type]}${
      affiliation.tier && !isClub ? `, ${tierLabels[affiliation.tier]}` : ''
    }. Criteria from Netball WA’s Membership Policy (NWA-POL-07).`,
    stats: [
      { label: 'Required items done', value: `${criteria.filter((c) => c.need === 'required' && c.met).length} of ${criteria.filter((c) => c.need === 'required').length}` },
      ...(season !== null
        ? [
            { label: `Registered in PlayHQ ${seasonLabel(season)}`, value: `${affiliation.registered} of ${affiliation.registrations_total}` },
            { label: 'Not registered', value: affiliation.not_registered },
            { label: 'Still to check', value: registrationsToCheck(affiliation) },
          ]
        : []),
    ],
    sections: [
      {
        title: 'Details',
        columns: [{ label: 'Detail', width: 1 }, { label: 'Recorded', width: 2 }],
        rows: [
          { cells: ['Incorporation number', affiliation.incorporation_number ?? 'Not recorded'] },
          { cells: ['Affiliated with', affiliation.affiliated_with ?? 'Not recorded'] },
          {
            cells: [
              isClub ? 'Last registered' : 'Annual agreement signed',
              affiliation.registered_on ? formatDateString(affiliation.registered_on) : 'Not recorded',
            ],
            flag: !isThisYear(affiliation.registered_on),
          },
          {
            cells: ['Primary contacts', contacts.length ? contacts.join('\n') : 'None named'],
            flag: isClub && contacts.length < 2,
          },
          ...(season !== null
            ? [{ cells: ['Teams this season', `${affiliation.team_count} in ${seasonLabel(season)}`] }]
            : []),
          ...(affiliation.notes ? [{ cells: ['Notes', affiliation.notes] }] : []),
        ],
      },
      checklistSection(criteria),
      ...(!isClub ? [officersSection(affiliation, officers)] : []),
      {
        title: season !== null ? `PlayHQ registrations ${seasonLabel(season)}` : 'PlayHQ registrations',
        columns: [
          { label: 'Name', width: 1.3 },
          { label: 'Role', width: 0.9 },
          { label: 'Squads and teams', width: 1.5 },
          { label: 'Status', width: 1 },
          { label: 'Checked', width: 1.3 },
        ],
        rows: [...registrations]
          .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
          .map((r) => ({
            cells: [
              r.name,
              r.team_roles.map((role) => roleNames[role] ?? role).join(', '),
              r.groups.join('\n'),
              status(r),
              r.checked_at ? `${localDay(r.checked_at)}${r.checked_by_name ? `\n${r.checked_by_name}` : ''}` : '',
            ],
            flag: r.registered !== true,
          })),
        empty: 'Nobody is in a squad or team this season.',
      },
    ],
    footnote:
      'Items “From the app’s records” are worked out from what admins have recorded; the rest are ticked by an admin. Registrations are checked by an admin against PlayHQ for each athlete, coach and manager in the season’s squads and teams.',
  };
}

/** What the club has set up for safeguarding, for the affiliation return. */
export type ReturnSafeguarding = {
  contacts: SafeguardingContacts | null;
  policies: ClubPolicies | null;
  wwcOfficerName: string | null;
};

/**
 * The yearly affiliation return a club sends its association or Netball WA:
 * its affiliation records plus counts. Nothing about any member under 18 is in
 * it, so it can go outside the club.
 */
export function affiliationReturn({
  clubName,
  affiliation,
  officers,
  contacts,
  safeguarding,
  wwcc,
  training,
  today = new Date(),
}: {
  clubName: string;
  affiliation: Affiliation;
  officers: Officer[];
  /** The primary contacts, in order, with the email the association can use. */
  contacts: { name: string; email: string | null }[];
  safeguarding: ReturnSafeguarding;
  /** The figures from the Working With Children Checks report. Left out when null. */
  wwcc: Report['stats'] | null;
  /** The figures from the Integrity training report. Left out when null. */
  training: { season: string; stats: Report['stats'] } | null;
  today?: Date;
}): Report {
  const criteria = affiliationCriteria(affiliation, officers, today);
  const isClub = affiliation.member_type === 'club';
  const season = affiliation.season;
  const required = criteria.filter((c) => c.need === 'required');
  const done = required.filter((c) => c.met).length;
  const named = (name: string | null | undefined) => name?.trim() || 'Not named';
  const link = (url: string | null | undefined) => url?.trim() || 'Not linked';
  const counts = (stats: Report['stats']): ReportRow[] =>
    (stats ?? []).map((stat) => ({ cells: [stat.label, String(stat.value)] }));
  const figureColumns = [
    { label: 'Figure', width: 2 },
    { label: 'Count', width: 1 },
  ];

  return {
    title: 'Affiliation return',
    subtitle: `${clubName}: ${memberTypeLabels[affiliation.member_type].toLowerCase()}${
      affiliation.tier && !isClub ? `, ${tierLabels[affiliation.tier]}` : ''
    }, as at ${formatDateString(toDateString(today))}. Criteria from Netball WA’s Membership Policy (NWA-POL-07).`,
    stats: [
      { label: 'Required items done', value: `${done} of ${required.length}` },
      ...(season !== null
        ? [
            { label: `Teams in ${seasonLabel(season)}`, value: affiliation.team_count },
            {
              label: `Registered in PlayHQ ${seasonLabel(season)}`,
              value: `${affiliation.registered} of ${affiliation.registrations_total}`,
            },
          ]
        : []),
    ],
    sections: [
      {
        title: 'Details',
        columns: [
          { label: 'Detail', width: 1 },
          { label: 'Recorded', width: 2 },
        ],
        rows: [
          { cells: ['Incorporation number', affiliation.incorporation_number ?? 'Not incorporated'] },
          { cells: ['Affiliated with', affiliation.affiliated_with ?? 'Not recorded'] },
          {
            cells: [
              isClub ? 'Last registered' : 'Annual agreement signed',
              affiliation.registered_on ? formatDateString(affiliation.registered_on) : 'Not recorded',
            ],
            flag: !isThisYear(affiliation.registered_on, today),
          },
        ],
      },
      {
        title: 'Primary contacts',
        columns: [
          { label: 'Name', width: 1 },
          { label: 'Email', width: 1.5 },
        ],
        rows: contacts.map((c) => ({ cells: [c.name, c.email ?? ''] })),
        empty: 'None named.',
      },
      checklistSection(criteria),
      ...(!isClub ? [officersSection(affiliation, officers)] : []),
      {
        title: season !== null ? `PlayHQ registrations ${seasonLabel(season)}` : 'PlayHQ registrations',
        note: 'Athletes, coaches and managers in the season’s squads and teams, checked against PlayHQ by an admin.',
        columns: figureColumns,
        rows:
          season !== null
            ? [
                { cells: ['People', String(affiliation.registrations_total)] },
                { cells: ['Registered', String(affiliation.registered)] },
                {
                  cells: ['Not registered', String(affiliation.not_registered)],
                  flag: affiliation.not_registered > 0,
                },
                { cells: ['Still to check', String(registrationsToCheck(affiliation))] },
              ]
            : [],
        empty: 'No squads or teams yet.',
      },
      {
        title: 'Safeguarding',
        columns: [
          { label: 'Item', width: 1 },
          { label: 'Recorded', width: 2 },
        ],
        rows: [
          {
            cells: ['Child Safety Officer', named(safeguarding.contacts?.child_safety_officer_name)],
            flag: !safeguarding.contacts?.child_safety_officer_name,
          },
          {
            cells: ['Complaints manager', named(safeguarding.contacts?.complaints_manager_name)],
            flag: !safeguarding.contacts?.complaints_manager_name,
          },
          { cells: ['WWC Registration Officer', named(safeguarding.wwcOfficerName)] },
          {
            cells: ['Safeguarding policy', link(safeguarding.policies?.safeguarding_policy_url ?? safeguarding.contacts?.policy_url)],
            flag: !(safeguarding.policies?.safeguarding_policy_url ?? safeguarding.contacts?.policy_url),
          },
          { cells: ['Code of conduct', link(safeguarding.policies?.code_of_conduct_url)] },
          { cells: ['Privacy policy', link(safeguarding.policies?.privacy_policy_url)] },
          { cells: ['Policy version members accept', safeguarding.policies?.policy_version ?? '1'] },
        ],
      },
      ...(wwcc
        ? [
            {
              title: 'Working With Children Checks',
              note: 'Counts only, from the club’s Working With Children Checks report.',
              columns: figureColumns,
              rows: counts(wwcc),
            },
          ]
        : []),
      ...(training
        ? [
            {
              title: `Integrity training ${training.season}`,
              note: 'Counts only, from the club’s Integrity training report.',
              columns: figureColumns,
              rows: counts(training.stats),
              empty: 'No courses set for the season.',
            },
          ]
        : []),
    ],
    footnote:
      'This return holds the club’s records and counts only. It names no member under 18 and has no details about any child. The primary contacts know their names and emails are shared.',
  };
}
