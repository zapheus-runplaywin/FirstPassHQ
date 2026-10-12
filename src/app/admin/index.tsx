import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { rejectionReasonLabels, roleLabels, rolesLabel } from '@/lib/labels';
import { safetyIssues } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { Profile, VolunteerExemption } from '@/lib/types';
import { rolesOf } from '@/lib/roles';

export default function MembersScreen() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [withGuardian, setWithGuardian] = useState<Set<string>>(new Set());
  const [exemptions, setExemptions] = useState<Map<string, VolunteerExemption>>(new Map());
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [profilesResult, guardiansResult, exemptionsResult] = await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).order('full_name', { nullsFirst: false }),
      supabase.from('guardianships').select('athlete_id'),
      supabase.rpc('admin_volunteer_exemptions'),
    ]);
    const open = ((exemptionsResult.data as VolunteerExemption[] | null) ?? []).filter(
      (e) => !e.ended_at,
    );
    setExemptions(new Map(open.map((e) => [e.profile_id, e])));
    setMembers((profilesResult.data as Profile[] | null) ?? []);
    setWithGuardian(
      new Set(
        ((guardiansResult.data as { athlete_id: string }[] | null) ?? []).map((g) => g.athlete_id),
      ),
    );
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
  // The people behind the child-safety to-dos on the home screen, with why.
  const issues = new Map(
    approved.map((m) => [m.id, safetyIssues(m, withGuardian.has(m.id), exemptions.get(m.id))]),
  );
  const needsChecking = approved.filter((m) => issues.get(m.id)?.length);
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
          `Asked to join as ${m.requested_role ? roleLabels[m.requested_role] : 'a member'}${m.verified_at ? ' · Verified in person' : ''}`
        }
      />
      <Section
        title="Members"
        empty="No approved members yet."
        members={approved}
        describe={(m) =>
          issues.get(m.id)?.length
            ? `${rolesLabel(rolesOf(m))} · Needs checking`
            : rolesLabel(rolesOf(m), m.title, m.head_physio)
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
