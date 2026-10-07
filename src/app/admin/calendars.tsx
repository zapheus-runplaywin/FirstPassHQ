import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import {
  calendarColorKey,
  calendarColorKeys,
  CalendarColors,
  type CalendarAudience,
  type CalendarColor,
} from '@/constants/calendar-colors';
import { Colors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  team_id: string | null;
  committee_only: boolean;
  color: CalendarColor | null;
};

const CLUB = 'club';
const COMMITTEE = 'committee';

/** Outlook's published links start with https:// (or webcal://). */
function isCalendarUrl(url: string) {
  return /^(https|webcal):\/\//i.test(url);
}

function audienceOf(
  teamId: string | null,
  committeeOnly: boolean,
  teams: Team[],
): CalendarAudience {
  if (teamId) return teams.find((t) => t.id === teamId)?.kind ?? 'squad';
  return committeeOnly ? 'committee' : 'club';
}

export default function CalendarsScreen() {
  const teams = useTeams();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<string>(CLUB);
  const [color, setColor] = useState<CalendarColor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      supabase
        .from('calendars')
        .select('id, name, url, team_id, committee_only, color')
        .order('created_at')
        .then(({ data }) => setCalendars((data as CalendarRow[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const team = teams.find((t) => t.id === scope);
  const committeeOnly = scope === COMMITTEE;
  const newAudience = audienceOf(team?.id ?? null, committeeOnly, teams);

  async function add() {
    const trimmedUrl = url.trim();
    if (!isCalendarUrl(trimmedUrl)) {
      setError('Paste the ICS link from Outlook. It starts with https://');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('calendars').insert({
      name:
        name.trim() ||
        (team ? `${team.name} calendar` : committeeOnly ? 'Committee calendar' : 'Club calendar'),
      url: trimmedUrl,
      team_id: team?.id ?? null,
      committee_only: committeeOnly,
      color,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName('');
    setUrl('');
    setColor(null);
    await load();
  }

  const scopeLabel = (calendar: CalendarRow) =>
    calendar.team_id
      ? (teams.find((t) => t.id === calendar.team_id)?.name ?? 'Team')
      : calendar.committee_only
        ? 'the committee'
        : 'Everyone in the club';

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
            <CalendarCard
              key={calendar.id}
              calendar={calendar}
              shownTo={scopeLabel(calendar)}
              audience={audienceOf(calendar.team_id, calendar.committee_only, teams)}
              onChanged={load}
            />
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
            { value: COMMITTEE, label: 'Committee' },
            ...teams.map((t) => ({ value: t.id, label: teamLabel(t, teams) })),
          ]}
          selected={[scope]}
          onToggle={setScope}
        />
        <ColorPicker selected={calendarColorKey(color, newAudience)} onSelect={setColor} />
        <ErrorText>{error}</ErrorText>
        <Button title="Add calendar" onPress={add} busy={saving} />
      </View>
    </Screen>
  );
}

function CalendarCard({
  calendar,
  shownTo,
  audience,
  onChanged,
}: {
  calendar: CalendarRow;
  shownTo: string;
  audience: CalendarAudience;
  onChanged: () => PromiseLike<unknown>;
}) {
  const theme = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(calendar.name);
  const [url, setUrl] = useState(calendar.url);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorKey = calendarColorKey(calendar.color, audience);

  async function update(changes: Partial<CalendarRow>) {
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('calendars')
      .update(changes)
      .eq('id', calendar.id);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return false;
    }
    await onChanged();
    return true;
  }

  async function saveEdit() {
    const trimmedUrl = url.trim();
    if (!isCalendarUrl(trimmedUrl)) {
      setError('Paste the ICS link from Outlook. It starts with https://');
      return;
    }
    if (await update({ name: name.trim() || calendar.name, url: trimmedUrl })) setEditing(false);
  }

  async function remove() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    const { error: deleteError } = await supabase.from('calendars').delete().eq('id', calendar.id);
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await onChanged();
  }

  return (
    <Card>
      <View style={styles.cardTitle}>
        <View style={[styles.swatchSmall, { backgroundColor: CalendarColors[colorKey].hex }]} />
        <ThemedText type="smallBold" style={styles.flex}>
          {calendar.name}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Shown to {shownTo}
      </ThemedText>

      {editing ? (
        <>
          <TextField label="Name" value={name} onChangeText={setName} />
          <TextField
            label="ICS link"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Save" onPress={saveEdit} busy={busy} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setName(calendar.name);
              setUrl(calendar.url);
              setError(null);
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} selectable>
            {calendar.url}
          </ThemedText>
          <ColorPicker selected={colorKey} onSelect={(key) => update({ color: key })} compact />
          <ErrorText>{error}</ErrorText>
          <View style={styles.cardActions}>
            <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                Edit name or link
              </ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={remove} disabled={busy}>
              <ThemedText type="small" style={{ color: confirmingDelete ? '#FF5A5A' : theme.tint }}>
                {confirmingDelete ? 'Tap again to delete' : 'Delete'}
              </ThemedText>
            </Pressable>
            {confirmingDelete ? (
              <Pressable accessibilityRole="button" onPress={() => setConfirmingDelete(false)}>
                <ThemedText type="small" themeColor="textSecondary">
                  Keep it
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </>
      )}
    </Card>
  );
}

/** A row of colour swatches; the selected one is ringed in white. */
function ColorPicker({
  selected,
  onSelect,
  compact = false,
}: {
  selected: CalendarColor;
  onSelect: (color: CalendarColor) => void;
  compact?: boolean;
}) {
  return (
    <View style={styles.pickerField}>
      {compact ? null : <ThemedText type="smallBold">Colour</ThemedText>}
      <View style={styles.swatches}>
        {calendarColorKeys.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={CalendarColors[key].label}
            accessibilityState={{ selected: key === selected }}
            onPress={() => onSelect(key)}
            style={[styles.swatchRing, key === selected && styles.swatchRingSelected]}>
            <View style={[styles.swatch, { backgroundColor: CalendarColors[key].hex }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  flex: {
    flex: 1,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
  },
  pickerField: {
    gap: Spacing.two,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  swatchRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchRingSelected: {
    borderColor: Colors.text,
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  swatchSmall: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
