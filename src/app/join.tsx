import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useSquads } from '@/lib/club';
import { isTeamRole, requestableRoles, roleLabels } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';
import { newestGroups, useTeams } from '@/lib/use-teams';

export default function JoinScreen() {
  const { session, profile, refresh } = useAuth();
  const groups = newestGroups(useTeams());
  const word = useSquads() ? 'squad' : 'team';
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [playhqEmail, setPlayhqEmail] = useState(profile?.playhq_email ?? '');
  const [role, setRole] = useState<AppRole | null>(profile?.requested_role ?? null);
  const [teamId, setTeamId] = useState<string | null>(profile?.requested_team_id ?? null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTeams = role !== null && isTeamRole(role);

  useEffect(() => {
    supabase.rpc('join_password_required').then(({ data }) => setNeedsPassword(data === true));
  }, []);

  async function submit() {
    if (!fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!role) {
      setError('Please choose what best describes you.');
      return;
    }
    if (role === 'guardian' && !playhqEmail.trim()) {
      setError('Please enter the email you used to register with PlayHQ.');
      return;
    }
    if (needsPassword && !password.trim()) {
      setError('Please enter the club password. A club admin can give it to you.');
      return;
    }
    setSaving(true);
    setError(null);
    // A wrong club password comes back as a message, not an error, so the
    // database can keep count of wrong tries.
    const { data: refused, error: rpcError } = await supabase.rpc('submit_join_request', {
      p_full_name: fullName,
      p_playhq_email: playhqEmail,
      p_requested_role: role,
      p_requested_team_id: showTeams ? teamId : null,
      p_join_password: needsPassword ? password : null,
    });
    setSaving(false);
    if (rpcError || refused) {
      setError(rpcError?.message ?? String(refused));
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
        placeholder={
          role === 'guardian'
            ? 'Email used to register with PlayHQ'
            : (session?.user.email ?? 'Only if different to your sign-in email')
        }
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <ThemedText type="small" themeColor="textSecondary">
        {role === 'guardian'
          ? 'Parents and guardians: enter the email you used to register your athlete with PlayHQ, so we can confirm who you are.'
          : 'Only needed if you registered with PlayHQ using a different email to the one you signed in with.'}
      </ThemedText>

      <ChipGroup
        label="I am a"
        options={requestableRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
        selected={role ? [role] : []}
        onToggle={setRole}
      />

      {showTeams ? (
        <ChipGroup
          label={role === 'guardian' ? `Your athlete's ${word}` : word === 'squad' ? 'Squad' : 'Team'}
          options={groups.map((t) => ({ value: t.id, label: t.name }))}
          selected={teamId ? [teamId] : []}
          onToggle={(id) => setTeamId(id === teamId ? null : id)}
        />
      ) : null}

      {needsPassword ? (
        <TextField
          label="Club password"
          value={password}
          onChangeText={setPassword}
          placeholder="Ask a club admin for it"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Send request" onPress={submit} busy={saving} />
    </Screen>
  );
}
