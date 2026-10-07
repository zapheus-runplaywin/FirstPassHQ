import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { roleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export default function MembersScreen() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .order('full_name', { nullsFirst: false });
    setMembers((data as Profile[] | null) ?? []);
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
      [m.full_name, m.email, m.playhq_email].some((v) => v?.toLowerCase().includes(query)),
  );
  const waiting = matching
    .filter((m) => m.status === 'pending' && m.join_requested_at)
    .sort((a, b) => (a.join_requested_at ?? '').localeCompare(b.join_requested_at ?? ''));
  const approved = matching.filter((m) => m.status === 'approved');
  const notRequested = matching.filter((m) => m.status === 'pending' && !m.join_requested_at);
  const rejected = matching.filter((m) => m.status === 'rejected');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <TextField
        label="Search"
        value={search}
        onChangeText={setSearch}
        placeholder="Name or email"
        autoCapitalize="none"
      />
      <Section
        title="Waiting for approval"
        empty="No requests waiting."
        members={waiting}
        describe={(m) => `Asked to join as ${m.requested_role ? roleLabels[m.requested_role] : 'a member'}`}
      />
      <Section
        title="Members"
        empty="No approved members yet."
        members={approved}
        describe={(m) => roleLabels[m.role]}
      />
      <Section
        title="Signed in, no request yet"
        members={notRequested}
        describe={(m) => m.email ?? ''}
      />
      <Section title="Not approved" members={rejected} describe={(m) => m.email ?? ''} />
    </Screen>
  );
}

function Section({
  title,
  empty,
  members,
  describe,
}: {
  title: string;
  empty?: string;
  members: Profile[];
  describe: (member: Profile) => string;
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
            <ThemedText type="small" themeColor="textSecondary">
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
