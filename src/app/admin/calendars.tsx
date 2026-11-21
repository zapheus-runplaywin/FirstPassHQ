import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import {
  calendarColorKey,
  calendarColorKeys,
  CalendarColors,
  type CalendarColor,
} from '@/constants/calendar-colors';
import { Spacing, type Palette } from '@/constants/theme';
import { useTheme, useThemedStyles } from '@/hooks/use-theme';
import {
  calendarPostLabels,
  calendarPosts,
  calendarRoleLabels,
  calendarRoles,
  colourAudience,
  isShownToSomeone,
  nobody,
  saveArgs,
  shownToFromRows,
  shownToLabel,
  toggled,
  type AudienceRow,
  type CalendarShownTo,
} from '@/lib/calendar-audience';
import { checkCalendarUrl, cleanCalendarUrl } from '@/lib/calendar-url';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';

type CalendarRow = {
  id: string;
  name: string;
  url: string;
  color: CalendarColor | null;
  calendar_audiences: AudienceRow[] | null;
};

const NEEDS_SOMEONE = 'Choose who sees this calendar.';

/** Saves a calendar and who sees it, through the database's admin function. */
async function saveCalendar(
  id: string | null,
  name: string,
  url: string,
  color: CalendarColor | null,
  shownTo: CalendarShownTo,
) {
  return supabase.rpc('admin_save_calendar', {
    p_id: id,
    p_name: name,
    p_url: url,
    p_color: color,
    ...saveArgs(shownTo),
  });
}

export default function CalendarsScreen() {
  const styles = useThemedStyles(makeStyles);
  const teams = useTeams();
  const [calendars, setCalendars] = useState<CalendarRow[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [shownTo, setShownTo] = useState<CalendarShownTo>(nobody);
  const [color, setColor] = useState<CalendarColor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      supabase
        .from('calendars')
        .select('id, name, url, color, calendar_audiences (kind, role, post, team_id)')
        .order('created_at')
        .then(({ data }) => setCalendars((data as CalendarRow[] | null) ?? [])),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const newAudience = colourAudience(shownTo, teams);

  async function add() {
    const trimmedUrl = cleanCalendarUrl(url);
    if (!isShownToSomeone(shownTo)) {
      setError(NEEDS_SOMEONE);
      return;
    }
    setSaving(true);
    setError(null);
    const problem = await checkCalendarUrl(trimmedUrl);
    if (problem) {
      setSaving(false);
      setError(problem);
      return;
    }
    const onlyTeam =
      shownTo.teamIds.length === 1 && shownTo.roles.length === 0 && shownTo.posts.length === 0
        ? teams.find((t) => t.id === shownTo.teamIds[0])
        : undefined;
    const { error: insertError } = await saveCalendar(
      null,
      name.trim() ||
        (shownTo.everyone
          ? 'Club calendar'
          : onlyTeam
            ? `${onlyTeam.name} calendar`
            : newAudience === 'committee'
              ? 'Committee calendar'
              : 'Calendar'),
      trimmedUrl,
      color,
      shownTo,
    );
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName('');
    setUrl('');
    setColor(null);
    setShownTo(nobody);
    await load();
  }

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
            <CalendarCard key={calendar.id} calendar={calendar} teams={teams} onChanged={load} />
          ))
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Add a calendar</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          In Outlook, publish the calendar and copy its ICS link. Only the people you choose see
          the calendar and its link, so keep each calendar to the people who need it, and split
          the club’s calendars when different people need different events.
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
        <ShownToPicker shownTo={shownTo} teams={teams} onChange={setShownTo} />
        <ColorPicker selected={calendarColorKey(color, newAudience)} onSelect={setColor} />
        <ErrorText>{error}</ErrorText>
        <Button title="Add calendar" onPress={add} busy={saving} />
      </View>
    </Screen>
  );
}

function CalendarCard({
  calendar,
  teams,
  onChanged,
}: {
  calendar: CalendarRow;
  teams: Team[];
  onChanged: () => PromiseLike<unknown>;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const savedShownTo = shownToFromRows(calendar.calendar_audiences);
  const audience = colourAudience(savedShownTo, teams);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(calendar.name);
  const [url, setUrl] = useState(calendar.url);
  const [shownTo, setShownTo] = useState<CalendarShownTo>(savedShownTo);
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
    const trimmedUrl = cleanCalendarUrl(url);
    if (!isShownToSomeone(shownTo)) {
      setError(NEEDS_SOMEONE);
      return;
    }
    if (trimmedUrl !== calendar.url) {
      setBusy(true);
      setError(null);
      const problem = await checkCalendarUrl(trimmedUrl);
      setBusy(false);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const { error: saveError } = await saveCalendar(
      calendar.id,
      name.trim() || calendar.name,
      trimmedUrl,
      calendar.color,
      shownTo,
    );
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    await onChanged();
    setEditing(false);
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
        Shown to {shownToLabel(savedShownTo, teams.map((t) => ({ id: t.id, name: teamLabel(t, teams) })))}
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
          <ShownToPicker shownTo={shownTo} teams={teams} onChange={setShownTo} />
          <ErrorText>{error}</ErrorText>
          <Button title="Save" onPress={saveEdit} busy={busy} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setName(calendar.name);
              setUrl(calendar.url);
              setShownTo(savedShownTo);
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
                Change name, link or who sees it
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

const EVERYONE = 'everyone';

/**
 * Who sees a calendar: everyone in the club, or any mix of roles,
 * safeguarding posts, and squads and teams. Admins always see every calendar.
 */
function ShownToPicker({
  shownTo,
  teams,
  onChange,
}: {
  shownTo: CalendarShownTo;
  teams: Team[];
  onChange: (shownTo: CalendarShownTo) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.pickerField}>
      <ChipGroup
        label="Who sees it"
        options={[{ value: EVERYONE, label: 'Everyone in the club' }]}
        selected={shownTo.everyone ? [EVERYONE] : []}
        onToggle={() => onChange({ ...shownTo, everyone: !shownTo.everyone })}
      />
      {shownTo.everyone ? (
        <ThemedText type="small" themeColor="textSecondary">
          Every approved member, including guests. Not temporary helpers.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Or choose the people who need it. They see it if they match any choice. Admins always
            see every calendar.
          </ThemedText>
          <ChipGroup
            label="Roles"
            options={calendarRoles.map((r) => ({ value: r, label: calendarRoleLabels[r] }))}
            selected={shownTo.roles}
            onToggle={(r) => onChange({ ...shownTo, roles: toggled(shownTo.roles, r) })}
          />
          <ChipGroup
            label="Safeguarding posts"
            options={calendarPosts.map((p) => ({ value: p, label: calendarPostLabels[p] }))}
            selected={shownTo.posts}
            onToggle={(p) => onChange({ ...shownTo, posts: toggled(shownTo.posts, p) })}
          />
          {teams.length > 0 ? (
            <ChipGroup
              label="Squads and teams"
              options={teams.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
              selected={shownTo.teamIds}
              onToggle={(id) => onChange({ ...shownTo, teamIds: toggled(shownTo.teamIds, id) })}
            />
          ) : null}
        </>
      )}
    </View>
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    borderColor: colors.text,
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
