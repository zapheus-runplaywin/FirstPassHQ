import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useTeams } from '@/lib/use-teams';

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  team_id: string | null;
};

const CLUB = 'club';

export default function CalendarsScreen() {
  const theme = useTheme();
  const teams = useTeams();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<string>(CLUB);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      supabase
        .from('calendars')
        .select('id, name, url, team_id')
        .order('created_at')
        .then(({ data }) => setCalendars(data ?? [])),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const trimmedUrl = url.trim();
    if (!/^(https|webcal):\/\//i.test(trimmedUrl)) {
      setError('Paste the ICS link from Outlook. It starts with https://');
      return;
    }
    const team = teams.find((t) => t.id === scope);
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('calendars').insert({
      name: name.trim() || (team ? `${team.name} calendar` : 'Club calendar'),
      url: trimmedUrl,
      team_id: team?.id ?? null,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName('');
    setUrl('');
    await load();
  }

  function remove(calendar: CalendarRow) {
    Alert.alert('Remove calendar?', `Members will stop seeing events from ${calendar.name}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('calendars').delete().eq('id', calendar.id);
          await load();
        },
      },
    ]);
  }

  const scopeLabel = (teamId: string | null) =>
    teamId ? (teams.find((t) => t.id === teamId)?.name ?? 'Team') : 'Everyone in the club';

  return (
    <Screen>
      <View style={styles.section}>
        <ThemedText type="smallBold">Calendars</ThemedText>
        {calendars.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No calendars yet. Add the club calendar below.
          </ThemedText>
        ) : (
          calendars.map((calendar) => (
            <Card key={calendar.id}>
              <ThemedText type="smallBold">{calendar.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Shown to {scopeLabel(calendar.team_id)}
              </ThemedText>
              <Pressable accessibilityRole="button" onPress={() => remove(calendar)}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  Remove
                </ThemedText>
              </Pressable>
            </Card>
          ))
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Add a calendar</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          In Outlook, publish the calendar and copy its ICS link.
        </ThemedText>
        <TextField
          label="ICS link"
          value={url}
          onChangeText={setUrl}
          placeholder="https://outlook.office365.com/…/calendar.ics"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <TextField label="Name (optional)" value={name} onChangeText={setName} />
        <ChipGroup
          label="Show to"
          options={[
            { value: CLUB, label: 'Everyone' },
            ...teams.map((t) => ({ value: t.id, label: t.name })),
          ]}
          selected={[scope]}
          onToggle={setScope}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Add calendar" onPress={add} busy={saving} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
});
