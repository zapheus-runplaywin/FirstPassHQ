import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

/**
 * Rename or remove a squad or team during a season, for when divisions
 * change. Removing archives it rather than deleting it, so its members and
 * history are kept and it can be brought back.
 */
export function GroupActions({ group, onChange }: { group: Team; onChange: () => void }) {
  const [mode, setMode] = useState<'rename' | 'remove' | null>(null);
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const squad = group.kind === 'squad';

  async function rename() {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from('teams')
      .update({ name: name.trim() })
      .eq('id', group.id);
    setSaving(false);
    if (saveError) {
      setError(
        saveError.code === '23505'
          ? 'There is already a squad or team with that name this season.'
          : saveError.message,
      );
      return;
    }
    setMode(null);
    onChange();
  }

  async function remove() {
    setSaving(true);
    setError(null);
    // A squad's teams go with it.
    const { error: saveError } = await supabase
      .from('teams')
      .update({ archived: true })
      .or(`id.eq.${group.id},squad_id.eq.${group.id}`);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setMode(null);
    onChange();
  }

  if (mode === 'rename') {
    return (
      <View style={styles.panel}>
        <TextField
          label={squad ? 'Squad name' : 'Team name'}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Save name" onPress={rename} busy={saving} />
        <Link label="Cancel" onPress={() => setMode(null)} />
      </View>
    );
  }

  if (mode === 'remove') {
    return (
      <Card style={styles.panel}>
        <ThemedText type="smallBold">Remove {group.name} from this season?</ThemedText>
        <ThemedText type="small">
          {squad ? 'It and its teams leave' : 'It leaves'} this season’s lists, home screens and
          coaches’ to-dos. Members, attendance and other records are kept, and you can bring it back
          further down this screen.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        <Button title="Remove" variant="danger" onPress={remove} busy={saving} />
        <Link label="Cancel" onPress={() => setMode(null)} />
      </Card>
    );
  }

  return (
    <View style={styles.links}>
      <Link label="Rename" onPress={() => setMode('rename')} />
      <Link label="Remove" onPress={() => setMode('remove')} />
    </View>
  );
}

/** Squads and teams removed from a current season, with a way to bring each back. */
export function RemovedGroups({ groups, onChange }: { groups: Team[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (groups.length === 0) return null;

  async function restore(group: Team) {
    setError(null);
    // Bringing back a squad brings back its teams; a team needs its squad, if it has one.
    const { error: saveError } = await supabase
      .from('teams')
      .update({ archived: false })
      .or(
        group.kind === 'squad'
          ? `id.eq.${group.id},squad_id.eq.${group.id}`
          : group.squad_id
            ? `id.eq.${group.id},id.eq.${group.squad_id}`
            : `id.eq.${group.id}`,
      );
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onChange();
  }

  return (
    <View style={styles.panel}>
      <ThemedText type="smallBold">Removed this season</ThemedText>
      {groups.map((g) => (
        <View key={g.id} style={styles.removed}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
            {g.name} · {g.kind === 'squad' ? 'squad' : 'team'}
          </ThemedText>
          <Link label="Bring back" onPress={() => restore(g)} />
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <ThemedText type="smallBold" style={{ color: theme.tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
  },
  links: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  link: {
    paddingVertical: Spacing.one,
  },
  removed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
});
