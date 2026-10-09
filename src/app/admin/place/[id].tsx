import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { roleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';
import { seasonLabel, useTeams } from '@/lib/use-teams';

type ReturningMember = {
  profile_id: string;
  full_name: string | null;
  role: AppRole;
  last_squad_id: string;
  last_squad_name: string;
};

/** Places last season's members in one of the new season's squads (or teams, without squads). */
export default function PlaceMembersScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const squad = useTeams().find((t) => t.id === id);
  const [members, setMembers] = useState<ReturningMember[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('returning_members', { p_squad_id: id }).then(({ data }) => {
      const loaded = (data as ReturningMember[] | null) ?? [];
      setMembers(loaded);
    });
  }, [id]);

  // Last season's squads, the one with the same name first.
  const groups = [...new Set(members?.map((m) => m.last_squad_name) ?? [])].sort(
    (a, b) => Number(b === squad?.name) - Number(a === squad?.name),
  );

  function toggle(profileId: string) {
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function toggleGroup(name: string) {
    const ids = (members ?? []).filter((m) => m.last_squad_name === name).map((m) => m.profile_id);
    const all = ids.every((i) => chosen.has(i));
    setChosen((c) => {
      const next = new Set(c);
      for (const i of ids) {
        if (all) next.delete(i);
        else next.add(i);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_place_members', {
      p_squad_id: id,
      p_profile_ids: [...chosen],
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: squad?.name ?? 'Place members' }} />
      <ThemedText type="small" themeColor="textSecondary">
        {squad ? `Pick who is coming back for ${squad.name} in ${seasonLabel(squad.season)}. ` : ''}
        They keep their role in the club, and coaches keep their title
        {squad?.kind === 'team' ? '; athletes keep being a final team athlete or training partner' : ''}.
        Anyone already in a {squad?.kind ?? 'squad'} this season isn’t listed. New members still
        send a join request.
      </ThemedText>

      {members?.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Everyone from last season has been placed.
        </ThemedText>
      ) : null}

      {groups.map((name) => {
        const inGroup = (members ?? []).filter((m) => m.last_squad_name === name);
        const all = inGroup.every((m) => chosen.has(m.profile_id));
        return (
          <View key={name} style={styles.group}>
            <View style={styles.header}>
              <ThemedText type="smallBold" style={styles.grow}>
                From last season’s {name}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => toggleGroup(name)}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  {all ? 'Clear' : 'Pick all'}
                </ThemedText>
              </Pressable>
            </View>
            {inGroup.map((m) => {
              const selected = chosen.has(m.profile_id);
              return (
                <Pressable
                  key={m.profile_id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  onPress={() => toggle(m.profile_id)}
                  style={[
                    styles.row,
                    {
                      backgroundColor: selected ? theme.accent : theme.backgroundElement,
                    },
                  ]}>
                  <ThemedText
                    type="small"
                    style={[styles.grow, selected ? { color: theme.onAccent } : undefined]}
                    numberOfLines={1}>
                    {m.full_name ?? 'Unnamed member'}
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={selected ? { color: theme.onAccent } : { color: theme.textSecondary }}>
                    {roleLabels[m.role]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <ErrorText>{error}</ErrorText>
      {members && members.length > 0 ? (
        <Button
          title={
            chosen.size === 0
              ? 'Pick who is coming back'
              : `Add ${chosen.size} to ${squad?.name ?? `the ${squad?.kind ?? 'squad'}`}`
          }
          onPress={save}
          busy={saving}
          disabled={chosen.size === 0}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
});
