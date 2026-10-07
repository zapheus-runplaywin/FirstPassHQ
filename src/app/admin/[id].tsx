import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { PROFILE_COLUMNS, useAuth } from '@/lib/auth';
import { coachTitleLabels, isTeamRole, roleLabels, selectionLabels, statusLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole, CoachTitle, MemberStatus, Profile, TeamSelection } from '@/lib/types';
import { squadsOf, useTeams } from '@/lib/use-teams';

const allRoles = Object.keys(roleLabels) as AppRole[];
const coachTitles = Object.keys(coachTitleLabels) as CoachTitle[];
const selections = Object.keys(selectionLabels) as TeamSelection[];

/** A squad or team the member is in: their coach title, or how an athlete was selected. */
type Placement = { coach_title: CoachTitle | null; selection: TeamSelection | null };

/** Squads and teams the member is in, keyed by id. */
type Placements = Record<string, Placement>;

export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, refresh } = useAuth();
  const teams = useTeams();
  const [member, setMember] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole>('guest');
  const [selection, setSelection] = useState<Placements>({});
  const [saving, setSaving] = useState<MemberStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [profileResult, teamsResult] = await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single(),
        supabase.from('team_members').select('team_id, coach_title, selection').eq('profile_id', id),
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
        setSelection(
          Object.fromEntries(
            existing.map((t) => [t.team_id, { coach_title: t.coach_title, selection: t.selection }]),
          ),
        );
      } else {
        // Start from what they asked for.
        const requested = profile.requested_role ?? 'guest';
        setRole(requested);
        if (profile.requested_team_id && isTeamRole(requested)) {
          setSelection({
            [profile.requested_team_id]: {
              coach_title: requested === 'coach' ? 'head_coach' : null,
              selection: null,
            },
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
        // Leaving a squad also takes them out of its teams.
        for (const t of teams) {
          if (t.squad_id === teamId) delete next[t.id];
        }
      } else {
        const isTeam = teams.find((t) => t.id === teamId)?.kind === 'team';
        next[teamId] = {
          coach_title: role === 'coach' ? 'head_coach' : null,
          selection: role === 'athlete' && isTeam ? 'touring' : null,
        };
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
          {
            coach_title: newRole === 'coach' ? (current[teamId].coach_title ?? 'head_coach') : null,
            selection:
              newRole === 'athlete' && teams.find((t) => t.id === teamId)?.kind === 'team'
                ? (current[teamId].selection ?? 'touring')
                : null,
          },
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
        ? Object.entries(selection).map(([team_id, placement]) => ({ team_id, ...placement }))
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
  const selectedIds = Object.keys(selection);
  const squads = squadsOf(teams);
  // Teams are named from a squad, so only offer teams in squads they are in.
  const availableTeams = teams.filter((t) => t.squad_id && t.squad_id in selection);

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
            <Detail label="Asked for squad" value={requestedTeam?.name} />
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
          label="Squads"
          options={squads.map((t) => ({ value: t.id, label: t.name }))}
          selected={selectedIds}
          onToggle={toggleTeam}
        />
      ) : null}

      {inTeams && availableTeams.length > 0 ? (
        <ChipGroup
          label="Teams"
          options={availableTeams.map((t) => ({ value: t.id, label: t.name }))}
          selected={selectedIds}
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
                selected={selection[t.id].coach_title ? [selection[t.id].coach_title!] : []}
                onToggle={(title) =>
                  setSelection((current) => ({
                    ...current,
                    [t.id]: { ...current[t.id], coach_title: title },
                  }))
                }
              />
            ))
        : null}

      {role === 'athlete'
        ? teams
            .filter((t) => t.kind === 'team' && t.id in selection)
            .map((t) => (
              <ChipGroup
                key={t.id}
                label={`Selected in ${t.name} as`}
                options={selections.map((s) => ({ value: s, label: selectionLabels[s] }))}
                selected={selection[t.id].selection ? [selection[t.id].selection!] : []}
                onToggle={(choice) =>
                  setSelection((current) => ({
                    ...current,
                    [t.id]: { ...current[t.id], selection: choice },
                  }))
                }
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
