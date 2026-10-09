import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canHoldTitle } from '@/lib/labels';
import { supabase } from '@/lib/supabase';
import { rolesOf } from '@/lib/roles';

export default function MyDetailsScreen() {
  const { profile, refresh } = useAuth();
  const [preferredName, setPreferredName] = useState(profile?.preferred_name ?? '');
  const [title, setTitle] = useState(profile?.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTitle = profile?.status === 'approved' && canHoldTitle(rolesOf(profile));

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('save_my_details', {
      p_preferred_name: preferredName,
      p_title: hasTitle ? title : null,
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
        label="Preferred name"
        value={preferredName}
        onChangeText={setPreferredName}
        placeholder={profile?.full_name ?? undefined}
        autoComplete="name-given"
        textContentType="nickname"
        maxLength={40}
      />
      <ThemedText type="small" themeColor="textSecondary">
        What you like to be called. The app greets you by it. Leave it blank to use your name
        {profile?.full_name ? `, ${profile.full_name}` : ''}.
      </ThemedText>

      {hasTitle ? (
        <>
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="President, Secretary, Treasurer…"
            autoCapitalize="words"
            maxLength={40}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Your position at the club, shown with your role. Leave it blank if you don’t hold
            one.
          </ThemedText>
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={saving} />
    </Screen>
  );
}
