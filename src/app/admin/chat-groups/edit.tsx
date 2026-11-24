import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PeoplePicker } from '@/components/people-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import {
  type AdminChatGroup,
  choosableRoles,
  groupRuleSummary,
  keepChoosableRoles,
  peopleCount,
  under18Note,
} from '@/lib/chat-groups';
import { pluralRoleLabels } from '@/lib/labels';
import { type PickablePerson, withoutPerson, withPerson } from '@/lib/people-picker';
import { memberName } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

type Person = { id: string; full_name: string | null; email: string | null };

/**
 * Sets up or changes an admin's chat group: a name, and who is in it. Roles
 * across the club; or squads and teams, everyone in them or only some roles;
 * and named people on top. Who is in it is worked out when each post is
 * sent, so it follows squad and team changes.
 */
export default function EditChatGroupScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const theme = useTheme();
  const teams = useTeams();
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [people, setPeople] = useState<PickablePerson[]>([]);
  const [everyone, setEveryone] = useState<PickablePerson[]>([]);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    member_count: number;
    under_18_count: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  // The admin has seen the under-18 warning and pressed Save again.
  const [under18Confirmed, setUnder18Confirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: members }, groupsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('status', 'approved')
        .order('full_name'),
      id ? supabase.rpc('admin_chat_groups') : Promise.resolve({ data: [] }),
    ]);
    const pickable = ((members as Person[] | null) ?? []).map((m) => ({
      id: m.id,
      name: memberName(m),
      email: m.email,
    }));
    setEveryone(pickable);
    if (id) {
      const group = ((groupsResult.data as AdminChatGroup[] | null) ?? []).find((g) => g.id === id);
      if (group) {
        setName(group.name);
        setRoles(group.roles);
        setTeamIds(group.team_ids);
        setPeople(pickable.filter((p) => group.people.includes(p.id)));
        setClosedAt(group.closed_at);
      }
      setLoaded(true);
    } else {
      // The admin setting it up is in it, so they can post; they can take
      // themselves off if they're only setting it up for others.
      const me = pickable.find((p) => p.id === session?.user.id);
      if (me) setPeople((list) => (list.length ? list : [me]));
    }
  }, [id, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // How many people it takes in, as chosen so far.
  useEffect(() => {
    let current = true;
    supabase
      .rpc('admin_chat_group_preview', {
        p_roles: roles,
        p_team_ids: teamIds,
        p_people: people.map((p) => p.id),
      })
      .then(({ data }) => {
        if (!current) return;
        const row = (data as { member_count: number; under_18_count: number }[] | null)?.[0];
        setPreview(row ?? null);
        setUnder18Confirmed(false);
      });
    return () => {
      current = false;
    };
  }, [roles, teamIds, people]);

  function toggleTeam(teamId: string) {
    const next = teamIds.includes(teamId)
      ? teamIds.filter((t) => t !== teamId)
      : [...teamIds, teamId];
    setTeamIds(next);
    setRoles((r) => keepChoosableRoles(r, next.length > 0));
  }

  function toggleRole(role: AppRole) {
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  }

  async function save() {
    // A group with members under 18 asks once more (Matt, 24 November 2026).
    if (preview && preview.under_18_count > 0 && !under18Confirmed) {
      setUnder18Confirmed(true);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_save_chat_group', {
      p_id: id ?? null,
      p_name: name,
      p_roles: roles,
      p_team_ids: teamIds,
      p_people: people.map((p) => p.id),
    });
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  async function setClosed(closed: boolean) {
    if (!id) return;
    setBusy(true);
    const { error: closeError } = await supabase.rpc('admin_set_chat_group_closed', {
      p_id: id,
      p_closed: closed,
    });
    setBusy(false);
    if (closeError) {
      setError(closeError.message);
      return;
    }
    router.back();
  }

  if (!loaded) return <Screen>{null}</Screen>;

  const teamNames = teams.filter((t) => teamIds.includes(t.id)).map((t) => teamLabel(t, teams));
  const note = preview ? under18Note(preview.under_18_count) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Chat group' : 'New chat group' }} />
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Such as Selectors"
        maxLength={80}
      />

      <ChipGroup
        label="Squads and teams (optional)"
        options={teams.map((t) => ({
          value: t.id,
          label: teamLabel(t, teams),
        }))}
        selected={teamIds}
        onToggle={toggleTeam}
      />
      <ChipGroup
        label={teamIds.length ? 'Only these roles in them (optional)' : 'Roles across the club'}
        options={choosableRoles(teamIds.length > 0).map((r) => ({
          value: r,
          label: pluralRoleLabels[r],
        }))}
        selected={roles}
        onToggle={toggleRole}
      />
      <PeoplePicker
        label="People"
        hint="Anyone else to add by name."
        people={everyone}
        selected={people}
        onAdd={(p) => setPeople((list) => withPerson(list, p))}
        onRemove={(p) => setPeople((list) => withoutPerson(list, p.id))}
        placeholder="Name or email"
      />

      <View style={styles.summary}>
        <ThemedText type="smallBold">
          {groupRuleSummary(roles, teamNames, people.length)}
        </ThemedText>
        {preview ? (
          <ThemedText type="small" themeColor="textSecondary">
            {peopleCount(preview.member_count)} now. It follows squad and team changes.
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Admins don’t read groups they aren’t in. Guests and temporary helpers are never included.
        </ThemedText>
      </View>

      {note ? (
        <Card style={[styles.warning, { borderColor: theme.accent }]}>
          <ThemedText type="smallBold" themeColor="accent">
            ⚠ This group includes members under 18
          </ThemedText>
          <ThemedText type="small">{note}</ThemedText>
          {under18Confirmed ? (
            <ThemedText type="smallBold">Tap Save again to set it up with them in it.</ThemedText>
          ) : null}
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button
        title={under18Confirmed ? 'Save with under 18s in it' : 'Save'}
        onPress={save}
        busy={busy}
      />
      {id ? (
        <Button
          title={closedAt ? 'Open the group again' : 'Close the group'}
          variant="secondary"
          onPress={() => setClosed(!closedAt)}
          busy={busy}
        />
      ) : null}
      {id ? (
        <ThemedText type="small" themeColor="textSecondary">
          Closing keeps every post. Nobody can add to a closed group until it’s opened again.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: Spacing.one,
  },
  warning: {
    gap: Spacing.one,
    borderWidth: 2,
  },
});
