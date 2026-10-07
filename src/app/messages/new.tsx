import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { pluralRoleLabels } from '@/lib/labels';
import { useMessageGroups } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { AppRole, MessageAudience } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

const MAX_LENGTH = 4000;

/** Roles an admin can message, in the order they're shown. */
const messageableRoles: AppRole[] = [
  'athlete',
  'guardian',
  'coach',
  'manager',
  'committee',
  'partner',
  'admin',
];

export default function NewMessageScreen() {
  const { isAdmin } = useAuth();
  const teams = useTeams();
  const groups = useMessageGroups(teams);
  const [audience, setAudience] = useState<MessageAudience>(isAdmin ? 'club' : 'group');
  const [role, setRole] = useState<AppRole | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coaches and managers who lead one group don't need to pick it.
  const selectedTeamId = teamId ?? (groups.length === 1 ? groups[0].id : null);

  async function send() {
    if (!body.trim()) {
      setError('Write a message first.');
      return;
    }
    if (audience === 'role' && !role) {
      setError('Choose who to send it to.');
      return;
    }
    if (audience === 'group' && !selectedTeamId) {
      setError('Choose a squad or team.');
      return;
    }
    setSending(true);
    setError(null);
    const { data, error: sendError } = await supabase.rpc('send_group_message', {
      p_body: body,
      p_audience: audience,
      p_role: audience === 'role' ? role : null,
      p_team_id: audience === 'group' ? selectedTeamId : null,
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    router.replace({ pathname: '/messages/[id]', params: { id: data as string } });
  }

  return (
    <Screen>
      {isAdmin ? (
        <ChipGroup
          label="Send to"
          options={[
            { value: 'club', label: 'Everyone' },
            { value: 'role', label: 'A role' },
            { value: 'group', label: 'A squad or team' },
          ]}
          selected={[audience]}
          onToggle={(value) => {
            setAudience(value);
            setError(null);
          }}
        />
      ) : null}

      {audience === 'role' ? (
        <ChipGroup
          label="Role"
          options={messageableRoles.map((r) => ({ value: r, label: pluralRoleLabels[r] }))}
          selected={role ? [role] : []}
          onToggle={setRole}
        />
      ) : null}

      {audience === 'group' ? (
        groups.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            You can message the squads and teams you coach or manage once an admin adds you to one.
          </ThemedText>
        ) : (
          <ChipGroup
            label={isAdmin ? 'Squad or team' : 'Send to'}
            options={groups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
            selected={selectedTeamId ? [selectedTeamId] : []}
            onToggle={setTeamId}
          />
        )
      ) : null}

      <View style={styles.field}>
        <TextField
          label="Message"
          value={body}
          onChangeText={setBody}
          placeholder="Write your message"
          multiline
          maxLength={MAX_LENGTH}
        />
        {body.length > MAX_LENGTH - 200 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {MAX_LENGTH - body.length} characters left
          </ThemedText>
        ) : null}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        You’ll see who has read it. Club admins can read every message.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title="Send" onPress={send} busy={sending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
});
