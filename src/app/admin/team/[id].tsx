import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { teamPositionLabel } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { CoachTitle, RosterEntry, Team, TeamRole, TeamSelection } from '@/lib/types';
import { TEAM_COLUMNS } from '@/lib/use-teams';

/** An approved member who could be in a team without a squad. */
type ClubPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: 'athlete' | 'coach' | 'manager';
};

/** For each person who can be picked: how they are selected for this team, if at all. */
type Pick = TeamSelection | 'in' | 'out';

const athleteOptions: { value: Pick; label: string }[] = [
  { value: 'touring', label: 'Final team' },
  { value: 'training_partner', label: 'Training partner' },
  { value: 'out', label: 'Not selected' },
];
const staffOptions: { value: Pick; label: string }[] = [
  { value: 'in', label: 'In this team' },
  { value: 'out', label: 'Not in this team' },
];

export default function NameTeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [squad, setSquad] = useState<Team | null>(null);
  const [squadMembers, setSquadMembers] = useState<RosterEntry[] | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [titles, setTitles] = useState<Record<string, CoachTitle | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: teamRow } = await supabase
        .from('teams')
        .select(TEAM_COLUMNS)
        .eq('id', id)
        .single();
      const loadedTeam = teamRow as Team | null;
      if (loadedTeam?.kind !== 'team') {
        setError('Team not found.');
        return;
      }
      const { data: teamRoster } = await supabase.rpc('team_roster', { p_team_id: id });
      const current = new Map(
        ((teamRoster as RosterEntry[] | null) ?? []).map((m) => [m.profile_id, m]),
      );

      let members: RosterEntry[];
      if (loadedTeam.squad_id) {
        const [squadResult, squadRoster] = await Promise.all([
          supabase.from('teams').select(TEAM_COLUMNS).eq('id', loadedTeam.squad_id).single(),
          supabase.rpc('team_roster', { p_team_id: loadedTeam.squad_id }),
        ]);
        setSquad(squadResult.data as Team | null);
        members = (squadRoster.data as RosterEntry[] | null) ?? [];
      } else {
        // Without a squad, anyone in the club who can be in a team: athletes first.
        const { data: people } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('status', 'approved')
          .in('role', ['athlete', 'coach', 'manager'])
          .order('full_name');
        const order: TeamRole[] = ['athlete', 'coach', 'manager'];
        members = ((people as ClubPerson[] | null) ?? [])
          .map((p) => ({
            profile_id: p.id,
            full_name: p.full_name || p.email,
            team_role: p.role,
            coach_title: current.get(p.id)?.coach_title ?? null,
            selection: null,
          }))
          .sort((a, b) => order.indexOf(a.team_role) - order.indexOf(b.team_role));
      }
      setTeam(loadedTeam);
      setSquadMembers(members);
      setTitles(
        Object.fromEntries(
          [...current.values()].filter((m) => m.coach_title).map((m) => [m.profile_id, m.coach_title]),
        ),
      );
      setPicks(
        Object.fromEntries(
          members.map((m) => {
            const inTeam = current.get(m.profile_id);
            if (!inTeam) return [m.profile_id, 'out'];
            return [m.profile_id, inTeam.selection ?? 'in'];
          }),
        ),
      );
    })();
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_team_members', {
      p_team_id: id,
      p_members: Object.entries(picks)
        .filter(([, pick]) => pick !== 'out')
        .map(([profile_id, pick]) => ({
          profile_id,
          selection: pick === 'in' ? null : pick,
          // Coaches keep their title; new ones start as head coach.
          coach_title: titles[profile_id] ?? null,
        })),
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  if (!team || !squadMembers) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const count = (pick: Pick) => Object.values(picks).filter((p) => p === pick).length;

  return (
    <Screen>
      <Stack.Screen options={{ title: team.name }} />

      <Card>
        <ThemedText type="smallBold">
          {count('touring')} final team · {count('training_partner')} training partners
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {team.squad_id
            ? `Choosing from the ${squad?.name ?? 'squad'}. People not selected stay in the squad.`
            : 'Choosing from everyone approved as an athlete, coach or manager. Add guardians from their member page.'}
        </ThemedText>
      </Card>

      {squadMembers.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {team.squad_id
            ? 'No one is in the squad yet. Add members to the squad from Members first.'
            : 'No athletes, coaches or managers are approved yet. Approve them from Members first.'}
        </ThemedText>
      ) : (
        squadMembers.map((member) => (
          <View key={member.profile_id} style={styles.member}>
            <ChipGroup
              label={`${member.full_name ?? 'Unnamed member'} · ${teamPositionLabel(member.team_role, member.coach_title)}`}
              options={member.team_role === 'athlete' ? athleteOptions : staffOptions}
              selected={[picks[member.profile_id] ?? 'out']}
              onToggle={(pick) => setPicks((current) => ({ ...current, [member.profile_id]: pick }))}
            />
          </View>
        ))
      )}

      <ErrorText>{error}</ErrorText>
      <Button title="Save team" onPress={save} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  member: {
    gap: Spacing.one,
  },
});
