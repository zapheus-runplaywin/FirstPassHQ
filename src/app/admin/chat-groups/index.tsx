import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { type AdminChatGroup, groupRuleSummary, peopleCount } from '@/lib/chat-groups';
import { supabase } from '@/lib/supabase';
import { teamLabel, useTeamList } from '@/lib/use-teams';

/**
 * The chat groups admins set up. Admins see who is in each and how many
 * posts it has, never the posts, unless they're in the group themselves.
 */
export default function AdminChatGroupsScreen() {
  const { teams, reload: reloadTeams } = useTeamList();
  const [groups, setGroups] = useState<AdminChatGroup[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_chat_groups');
    setGroups((data as AdminChatGroup[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      reloadTeams();
    }, [load, reloadTeams]),
  );

  if (groups === null) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Button title="New group" onPress={() => router.push('/admin/chat-groups/edit')} />
      <ThemedText type="small" themeColor="textSecondary">
        Every squad and team also has automatic groups for its coaches and managers, its coaches and
        physios (with any Head Physio), and each team’s coaches and captains, plus one for all
        managers. Members find them under Messages › Groups and can hide any they don’t need.
      </ThemedText>
      {groups.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No groups set up yet.
        </ThemedText>
      ) : (
        <View style={styles.list}>
          {groups.map((g) => {
            const teamNames = teams
              .filter((t) => g.team_ids.includes(t.id))
              .map((t) => teamLabel(t, teams));
            return (
              <PressableCard
                key={g.id}
                onPress={() =>
                  router.push({
                    pathname: '/admin/chat-groups/edit',
                    params: { id: g.id },
                  })
                }>
                <ThemedText type="smallBold">
                  {g.name}
                  {g.closed_at ? ' (closed)' : ''}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {groupRuleSummary(g.roles, teamNames, g.people.length, {
                    clubRoles: g.club_roles,
                    posts: g.posts,
                  })}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {peopleCount(g.member_count)}
                  {g.under_18_count > 0 ? `, ${g.under_18_count} under 18` : ''} ·{' '}
                  {g.post_count === 1 ? '1 post' : `${g.post_count} posts`}
                </ThemedText>
              </PressableCard>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
});
