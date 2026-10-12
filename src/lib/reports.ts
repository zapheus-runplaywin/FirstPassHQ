import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatDate, isMinor } from '@/lib/age';
import { formatDateString, toDateString } from '@/lib/injuries';
import { rolesLabel } from '@/lib/labels';
import type { Report, ReportRow } from '@/lib/pdf';
import { hasRole, rolesOf } from '@/lib/roles';
import { needsWwcc, standDownReasonLabels, WWCC_WARNING_DAYS, wwccStatus } from '@/lib/safety';
import type { Profile, StandDown, Team, TeamRole } from '@/lib/types';
import { teamLabel } from '@/lib/use-teams';

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

export function wwccReport(
  members: Profile[],
  placements: Placement[],
  teams: Team[],
  standDowns: StandDown[] = [],
): Report {
  const approved = members.filter((m) => m.status === 'approved');
  const people = approved
    .filter((m) => needsWwcc(m))
    .map((m) => ({ member: m, name: memberName(m), status: wwccStatus(m) }))
    .sort(byName);
  // Committee members an admin excused from the check, with the reason.
  const exempt = approved
    .filter((m) => hasRole(m, 'committee') && !needsWwcc(m))
    .map((m) => ({ member: m, name: memberName(m) }))
    .sort(byName);
  const nameOf = (id: string | null) => {
    const admin = id ? members.find((m) => m.id === id) : undefined;
    return admin ? memberName(admin) : 'A former admin';
  };

  const row = ({ member, name, status }: (typeof people)[number]): ReportRow => ({
    cells: [
      name,
      rolesLabel(rolesOf(member)),
      groupsOf(member.id, placements, teams, ['coach', 'manager', 'physio']),
      member.wwcc_number?.trim() ?? '',
      formatDate(member.wwcc_expires_on),
      status.short,
    ],
    flag: status.problem,
  });

  const columns = [
    { label: 'Name', width: 1.4 },
    { label: 'Roles', width: 1.1 },
    { label: 'Squads and teams', width: 1.3 },
    { label: 'WWCC number', width: 1.1 },
    { label: 'Expires', width: 0.8 },
    { label: 'Status', width: 1.3 },
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
    subtitle: 'Approved coaches, managers, physios and committee members',
    stats: [
      { label: 'Need a check', value: people.length },
      { label: 'Current', value: count('current') },
      { label: `Expire within ${WWCC_WARNING_DAYS} days`, value: count('expiring') },
      { label: 'Expired', value: count('expired') },
      { label: 'Missing', value: count('missing') },
      { label: 'Committee exempt', value: exempt.length },
      { label: 'Stood down now', value: standDowns.filter((s) => !s.lifted_at).length },
    ],
    sections: [
      {
        title: 'Needs attention',
        note: `Missing, expired or expiring within ${WWCC_WARNING_DAYS} days. Their coach, manager, physio and committee roles are paused while a check is missing or expired.`,
        columns,
        rows: people.filter((p) => p.status.problem).map(row),
        empty: 'Every check is current.',
      },
      {
        title: 'Current',
        columns,
        rows: people.filter((p) => !p.status.problem).map(row),
        empty: 'No current checks recorded.',
      },
      {
        title: 'Committee members exempted',
        note: 'Excused from the check by an admin, with the reason they gave.',
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
      'From the check numbers and expiry dates admins record in Members. Confirm them against the state WWCC register.',
  };
}

// ---------------------------------------------------------------------------
// Under 18s and their parents and guardians
// ---------------------------------------------------------------------------

export type Guardianship = { guardian_id: string; athlete_id: string };

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
): Report {
  const byId = new Map(members.map((m) => [m.id, m]));
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
    ],
    flag: guardians.length === 0,
  });

  const columns = [
    { label: 'Athlete', width: 1.3 },
    { label: 'Date of birth (age)', width: 1 },
    { label: 'Squad or team', width: 1.2 },
    { label: 'Parents and guardians', width: 1.5 },
    { label: 'Guardian email', width: 1.8 },
  ];
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
      'Under 18 is worked out from the date of birth, or from the admin’s “Under 18” choice when no date of birth is recorded. “Not verified” means the guardian hasn’t been checked with their in-app code or against PlayHQ.',
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
