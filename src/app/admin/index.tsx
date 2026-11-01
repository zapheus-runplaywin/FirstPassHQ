import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isMinor } from '@/lib/age';
import { formatMonth } from '@/lib/format';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { athletesWithVerifiedGuardian } from '@/lib/guardian-links';
import { rejectionReasonLabels, roleLabels, rolesLabel, staffTitle } from '@/lib/labels';
import { safetyIssues } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type {
  CoachTitle,
  Profile,
  Team,
  TeamRole,
  VolunteerExemption,
  WwccApplication,
} from '@/lib/types';
import { rolesOf } from '@/lib/roles';

/** One squad or team a coach or manager is in. */
type StaffRow = {
  profile_id: string;
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  team: Pick<Team, 'name' | 'kind' | 'sort_order'>;
};

export default function MembersScreen() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [links, setLinks] = useState<Pair[]>([]);
  const [requests, setRequests] = useState<Pair[]>([]);
  const [exemptions, setExemptions] = useState<Map<string, VolunteerExemption>>(new Map());
  const [applications, setApplications] = useState<Map<string, WwccApplication>>(new Map());
  const [groupTitles, setGroupTitles] = useState<Map<string, string>>(new Map());
  const [inactive, setInactive] = useState<Map<string, string>>(new Map());
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [
      profilesResult,
      guardiansResult,
      exemptionsResult,
      staffResult,
      inactiveResult,
      applicationsResult,
      requestsResult,
    ] = await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).order('full_name', { nullsFirst: false }),
      supabase.from('guardianships').select('guardian_id, athlete_id'),
      supabase.rpc('admin_volunteer_exemptions'),
      // Coaches and managers in this season's squads and teams, for their titles.
      supabase
        .from('team_members')
        .select('profile_id, team_role, coach_title, team:teams!inner (name, kind, sort_order)')
        .in('team_role', ['coach', 'manager'])
        .eq('team.archived', false),
      // Members with no squad, team or club role for 2 years.
      supabase.rpc('admin_inactive_members'),
      supabase.rpc('admin_wwcc_applications'),
      // Parents and guardians who entered a child's link code.
      supabase.from('guardian_link_requests').select('guardian_id, athlete_id'),
    ]);
    setInactive(
      new Map(
        ((inactiveResult.data as { profile_id: string; last_active: string }[] | null) ?? []).map(
          (row) => [row.profile_id, row.last_active],
        ),
      ),
    );
    const staff = (staffResult.data as unknown as StaffRow[] | null) ?? [];
    const byMember = new Map<string, StaffRow[]>();
    for (const row of staff) byMember.set(row.profile_id, [...(byMember.get(row.profile_id) ?? []), row]);
    setGroupTitles(new Map([...byMember].map(([id, rows]) => [id, staffTitle(rows)])));
    const open = ((exemptionsResult.data as VolunteerExemption[] | null) ?? []).filter(
      (e) => !e.ended_at,
    );
    setExemptions(new Map(open.map((e) => [e.profile_id, e])));
    const openApplications = (
      (applicationsResult.data as WwccApplication[] | null) ?? []
    ).filter((a) => !a.ended_at);
    setApplications(new Map(openApplications.map((a) => [a.profile_id, a])));
    setMembers((profilesResult.data as Profile[] | null) ?? []);
    setLinks((guardiansResult.data as Pair[] | null) ?? []);
    setRequests((requestsResult.data as Pair[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const byId = new Map(members.map((m) => [m.id, m]));
  const nameOf = (id: string) => byId.get(id)?.full_name || 'someone';
  // Children with an approved, verified parent or guardian: the rest are locked.
  const withGuardian = athletesWithVerifiedGuardian(links, (id) => byId.get(id));
  const codeEnteredFor = (guardianId: string) =>
    requests.filter((r) => r.guardian_id === guardianId).map((r) => nameOf(r.athlete_id));
  const codeEnteredBy = (athleteId: string) =>
    requests.filter((r) => r.athlete_id === athleteId).map((r) => nameOf(r.guardian_id));

  const query = search.trim().toLowerCase();
  const matching = members.filter(
    (m) =>
      !query ||
      [m.full_name, m.preferred_name, m.email, m.playhq_email].some((v) => v?.toLowerCase().includes(query)),
  );
  const waiting = matching
    .filter((m) => m.status === 'pending' && m.join_requested_at)
    .sort((a, b) => (a.join_requested_at ?? '').localeCompare(b.join_requested_at ?? ''));
  const approved = matching.filter((m) => m.status === 'approved');
  // Approved parents and guardians who entered another child's code.
  const askingToLink = approved.filter((m) => requests.some((r) => r.guardian_id === m.id));
  // The people behind the child-safety to-dos on the home screen, with why.
  const issues = new Map(
    approved.map((m) => [m.id, safetyIssues(m, withGuardian.has(m.id), exemptions.get(m.id), applications.get(m.id))]),
  );
  const needsChecking = approved.filter((m) => issues.get(m.id)?.length);
  const gone = approved.filter((m) => inactive.has(m.id));
  const notRequested = matching.filter((m) => m.status === 'pending' && !m.join_requested_at);
  const rejected = matching.filter((m) => m.status === 'rejected');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <TextField
        label="Search"
        value={search}
        onChangeText={setSearch}
        placeholder="Name, preferred name or email"
        autoCapitalize="none"
      />
      <Section
        title="Needs checking"
        members={needsChecking}
        describe={(m) => `${rolesLabel(rolesOf(m))} · ${issues.get(m.id)?.join(' · ')}`}
        warn
      />
      <Section
        title="Waiting for approval"
        empty="No requests waiting."
        members={waiting}
        describe={(m) =>
          `Asked to join as ${m.requested_role ? roleLabels[m.requested_role] : 'a member'}${saysUnder18(m) ? ' · Says they’re under 18' : ''}${m.verified_at ? ' · Verified in person' : ''}${linkLabel(m, codeEnteredFor(m.id), codeEnteredBy(m.id))}`
        }
      />
      <Section
        title="Parents asking to be linked"
        members={askingToLink}
        describe={(m) => `Entered ${codeEnteredFor(m.id).join(' and ')}’s code · Link them on their page`}
        warn
      />
      <Section
        title="Members"
        empty="No approved members yet."
        members={approved}
        describe={(m) =>
          issues.get(m.id)?.length
            ? `${rolesLabel(rolesOf(m))} · Needs checking`
            : rolesLabel(rolesOf(m), m.title, m.head_physio, groupTitles.get(m.id))
        }
      />
      <Section
        title="No team or role for 2 years"
        members={gone}
        describe={(m) =>
          `${rolesLabel(rolesOf(m))} · Last active ${formatMonth(new Date(inactive.get(m.id) ?? ''))} · Delete them if they’ve left`
        }
      />
      <Section
        title="Signed in, no request yet"
        members={notRequested}
        describe={(m) => m.email ?? ''}
      />
      <Section
        title="Not approved"
        members={rejected}
        describe={(m) =>
          m.rejection_reason ? rejectionReasonLabels[m.rejection_reason] : (m.email ?? '')
        }
      />
    </Screen>
  );
}

function Section({
  title,
  empty,
  members,
  describe,
  warn,
}: {
  title: string;
  empty?: string;
  members: Profile[];
  describe: (member: Profile) => string;
  /** Show the description in the club's highlight colour. */
  warn?: boolean;
}) {
  if (members.length === 0 && !empty) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {members.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        members.map((m) => (
          <PressableCard
            key={m.id}
            onPress={() => router.push({ pathname: '/admin/[id]', params: { id: m.id } })}>
            <ThemedText type="smallBold">{m.full_name || m.email || 'Unnamed member'}</ThemedText>
            <ThemedText type="small" themeColor={warn ? 'tint' : 'textSecondary'}>
              {describe(m)}
            </ThemedText>
          </PressableCard>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
});

/** A parent or guardian and the child they are linked to, or asked to be. */
type Pair = { guardian_id: string; athlete_id: string };

/** Who entered whose link code, for a request waiting for approval. */
function linkLabel(m: Profile, children: string[], parents: string[]) {
  if (m.requested_role === 'guardian') {
    return children.length > 0
      ? ` · Entered ${children.join(' and ')}’s code`
      : ' · Hasn’t entered a child’s code yet';
  }
  if (parents.length > 0) return ` · ${parents.join(' and ')} entered their code`;
  return saysUnder18(m) ? ' · No parent has entered their code yet' : '';
}

/** An athlete whose date of birth at Join makes them under 18. Not checked yet. */
function saysUnder18(m: Profile) {
  return (
    m.requested_role === 'athlete' &&
    !!m.declared_date_of_birth &&
    isMinor(m.declared_date_of_birth, false)
  );
}
