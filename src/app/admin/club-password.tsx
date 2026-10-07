import { useCallback, useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/**
 * The password new members enter when they ask to join. Only a hash is kept,
 * so admins can replace it but not see the current one.
 */
export default function ClubPasswordScreen() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState<'save' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(
    () => supabase.rpc('join_password_required').then(({ data }) => setIsSet(data === true)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function save(value: string) {
    if (value && value.trim().length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    setSaving(value ? 'save' : 'clear');
    setError(null);
    setSaved(null);
    const { error: rpcError } = await supabase.rpc('admin_set_join_password', {
      p_password: value,
    });
    setSaving(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setPassword('');
    setSaved(value ? 'Saved. Share the new password with people joining.' : 'Password removed.');
    await load();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {isSet === null
          ? ' '
          : isSet
            ? 'A club password is set. New members must enter it to ask to join. For security it can’t be shown, but you can replace it.'
            : 'No club password is set, so anyone who signs in can ask to join.'}
      </ThemedText>
      <TextField
        label={isSet ? 'New club password' : 'Club password'}
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <ErrorText>{error}</ErrorText>
      {saved ? (
        <ThemedText type="small" themeColor="textSecondary">
          {saved}
        </ThemedText>
      ) : null}
      <Button title="Save password" onPress={() => save(password)} busy={saving === 'save'} />
      {isSet ? (
        <Button
          title="Remove password"
          variant="secondary"
          onPress={() => save('')}
          busy={saving === 'clear'}
        />
      ) : null}
    </Screen>
  );
}
