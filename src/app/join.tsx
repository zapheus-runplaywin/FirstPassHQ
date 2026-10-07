import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { isTeamRole, requestableRoles, roleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

export default function JoinScreen() {
  const { session, profile, refresh } = useAuth();
  const teams = useTeams();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [playhqEmail, setPlayhqEmail] = useState(profile?.playhq_email ?? '');
  const [role, setRole] = useState<AppRole | null>(profile?.requested_role ?? null);
  const [teamId, setTeamId] = useState<string | null>(profile?.requested_team_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTeams = role !== null && isTeamRole(role);

  async function submit() {
    if (!fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!role) {
      setError('Please choose what best describes you.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('submit_join_request', {
      p_full_name: fullName,
      p_playhq_email: playhqEmail,
      p_requested_role: role,
      p_requested_team_id: showTeams ? teamId : null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
    router.back();
  }

  return (
    <Screen>
      <TextField
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
      />

      <TextField
        label="PlayHQ email"
        value={playhqEmail}
        onChangeText={setPlayhqEmail}
        placeholder={session?.user.email ?? 'Only if different to your sign-in email'}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <ThemedText type="small" themeColor="textSecondary">
        Only needed if you registered with PlayHQ using a different email to the one you signed in
        with.
      </ThemedText>

      <ChipGroup
        label="I am a"
        options={requestableRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
        selected={role ? [role] : []}
        onToggle={setRole}
      />

      {showTeams ? (
        <ChipGroup
          label="Team or squad"
          options={teams.map((t) => ({ value: t.id, label: t.name }))}
          selected={teamId ? [teamId] : []}
          onToggle={(id) => setTeamId(id === teamId ? null : id)}
        />
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Send request" onPress={submit} busy={saving} />
    </Screen>
  );
}
