import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { PROFILE_COLUMNS, useAuth } from '@/lib/auth';
import { coachTitleLabels, isTeamRole, roleLabels, statusLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole, CoachTitle, MemberStatus, Profile } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

const allRoles = Object.keys(roleLabels) as AppRole[];
const coachTitles = Object.keys(coachTitleLabels) as CoachTitle[];

/** Selected teams, keyed by team id. The value is the coach title (null for non-coaches). */
type TeamSelection = Record<string, CoachTitle | null>;

export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, refresh } = useAuth();
  const teams = useTeams();
  const [member, setMember] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole>('guest');
  const [selection, setSelection] = useState<TeamSelection>({});
  const [saving, setSaving] = useState<MemberStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [profileResult, teamsResult] = await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single(),
        supabase.from('team_members').select('team_id, coach_title').eq('profile_id', id),
      ]);
      const profile = profileResult.data as Profile | null;
      if (!profile) {
        setError('Member not found.');
        return;
      }
      setMember(profile);

      const existing = teamsResult.data ?? [];
      if (profile.status === 'approved' || existing.length > 0) {
        setRole(profile.role);
        setSelection(Object.fromEntries(existing.map((t) => [t.team_id, t.coach_title])));
      } else {
        // Start from what they asked for.
        const requested = profile.requested_role ?? 'guest';
        setRole(requested);
        if (profile.requested_team_id && isTeamRole(requested)) {
          setSelection({
            [profile.requested_team_id]: requested === 'coach' ? 'head_coach' : null,
          });
        }
      }
    })();
  }, [id]);

  const inTeams = isTeamRole(role);
  const isSelf = id === session?.user.id;

  function toggleTeam(teamId: string) {
    setSelection((current) => {
      const next = { ...current };
      if (teamId in next) {
        delete next[teamId];
      } else {
        next[teamId] = role === 'coach' ? 'head_coach' : null;
      }
      return next;
    });
  }

  function changeRole(newRole: AppRole) {
    setRole(newRole);
    // Coach titles only apply to coaches.
    setSelection((current) =>
      Object.fromEntries(
        Object.keys(current).map((teamId) => [
          teamId,
          newRole === 'coach' ? (current[teamId] ?? 'head_coach') : null,
        ]),
      ),
    );
  }

  async function save(status: MemberStatus) {
    setSaving(status);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_save_member', {
      p_profile_id: id,
      p_role: role,
      p_status: status,
      p_teams: inTeams
        ? Object.entries(selection).map(([team_id, coach_title]) => ({ team_id, coach_title }))
        : [],
    });
    setSaving(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (isSelf) await refresh();
    router.back();
  }

  if (!member) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const requestedTeam = teams.find((t) => t.id === member.requested_team_id);
  const selectedTeamIds = Object.keys(selection);

  return (
    <Screen>
      <Stack.Screen options={{ title: member.full_name || member.email || 'Member' }} />

      <Card>
        <Detail label="Status" value={statusLabels[member.status]} />
        <Detail label="Sign-in email" value={member.email} />
        <Detail label="PlayHQ email" value={member.playhq_email} />
        {member.status !== 'approved' ? (
          <>
            <Detail
              label="Asked to join as"
              value={member.requested_role ? roleLabels[member.requested_role] : null}
            />
            <Detail label="Asked for team" value={requestedTeam?.name} />
          </>
        ) : null}
      </Card>

      <ChipGroup
        label="Role"
        options={allRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
        selected={[role]}
        onToggle={changeRole}
      />

      {inTeams ? (
        <ChipGroup
          label="Teams and squads"
          options={teams.map((t) => ({ value: t.id, label: t.name }))}
          selected={selectedTeamIds}
          onToggle={toggleTeam}
        />
      ) : null}

      {role === 'coach'
        ? teams
            .filter((t) => t.id in selection)
            .map((t) => (
              <ChipGroup
                key={t.id}
                label={`Title for ${t.name}`}
                options={coachTitles.map((c) => ({ value: c, label: coachTitleLabels[c] }))}
                selected={selection[t.id] ? [selection[t.id] as CoachTitle] : []}
                onToggle={(title) => setSelection((current) => ({ ...current, [t.id]: title }))}
              />
            ))
        : null}

      <ErrorText>{error}</ErrorText>

      <View style={styles.actions}>
        {member.status === 'approved' ? (
          <>
            <Button title="Save changes" onPress={() => save('approved')} busy={saving === 'approved'} />
            {!isSelf ? (
              <Button
                title="Remove access"
                variant="secondary"
                onPress={() => save('rejected')}
                busy={saving === 'rejected'}
              />
            ) : null}
          </>
        ) : (
          <>
            <Button title="Approve" onPress={() => save('approved')} busy={saving === 'approved'} />
            {member.status === 'pending' ? (
              <Button
                title="Don't approve"
                variant="secondary"
                onPress={() => save('rejected')}
                busy={saving === 'rejected'}
              />
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value || '—'}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
