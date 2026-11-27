import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CalendarPhoneLink } from '@/components/calendar-phone-link';
import { Screen } from '@/components/screen';
import { SettingSwitch } from '@/components/setting-switch';
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
import { readCalendarForImport, type ImportEvent } from '@/lib/calendar-import';
import { checkCalendarUrl, cleanCalendarUrl } from '@/lib/calendar-url';
import { formatDateString, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';
import { earliestDay, latestDay, refreshEvents } from '@/lib/use-events';
import { teamLabel, useTeams } from '@/lib/use-teams';

type CalendarRow = {
  id: string;
  name: string;
  /** The Outlook link, or null for a calendar kept in the app. */
  url: string | null;
  color: CalendarColor | null;
  /** Kept in the app: admins add its events here, and no link is read. */
  in_hq: boolean;
  takes_suggestions: boolean;
  /** When a linked calendar was moved in, and by whom. */
  moved_in_at: string | null;
  moved_in_by_name: string | null;
  calendar_audiences: AudienceRow[] | null;
  hq_calendar_events: { count: number }[] | null;
};

/** Where a calendar is kept: read from an Outlook link, or changed in the app. */
type Home = 'link' | 'app';

const SUGGESTIONS_LABEL = 'Coaches, managers and committee can suggest events';

const NEEDS_SOMEONE = 'Choose who sees this calendar.';

/** Saves a calendar kept in the app, who sees it and whether it takes suggestions. */
async function saveAppCalendar(
  id: string | null,
  name: string,
  color: CalendarColor | null,
  shownTo: CalendarShownTo,
  takesSuggestions: boolean,
) {
  return supabase.rpc('admin_save_hq_calendar', {
    p_id: id,
    p_name: name,
    p_color: color,
    ...saveArgs(shownTo),
    p_takes_suggestions: takesSuggestions,
  });
}

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
  const [loaded, setLoaded] = useState(false);
  // With calendars already listed, the form to add another stays folded away
  // until asked for, so the screen is the list.
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [home, setHome] = useState<Home>('link');
  const [takesSuggestions, setTakesSuggestions] = useState(true);
  const [shownTo, setShownTo] = useState<CalendarShownTo>(nobody);
  const [color, setColor] = useState<CalendarColor | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The phone links that are on, by calendar: the key of each.
  const [phoneLinks, setPhoneLinks] = useState<Record<string, string>>({});

  const load = useCallback(
    () =>
      Promise.all([
        supabase
          .from('calendars')
          .select(
            'id, name, url, color, in_hq, takes_suggestions, moved_in_at, moved_in_by_name, calendar_audiences (kind, role, post, team_id), hq_calendar_events (count)',
          )
          .order('created_at'),
        supabase.rpc('admin_calendar_phone_links'),
      ]).then(([{ data }, { data: links }]) => {
        setCalendars((data as CalendarRow[] | null) ?? []);
        setPhoneLinks(
          Object.fromEntries(
            ((links as { calendar_id: string; token: string }[] | null) ?? []).map((l) => [l.calendar_id, l.token]),
          ),
        );
        setLoaded(true);
      }),
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
    const problem = home === 'link' ? await checkCalendarUrl(trimmedUrl) : null;
    if (problem) {
      setSaving(false);
      setError(problem);
      return;
    }
    const onlyTeam =
      shownTo.teamIds.length === 1 && shownTo.roles.length === 0 && shownTo.posts.length === 0
        ? teams.find((t) => t.id === shownTo.teamIds[0])
        : undefined;
    const newName =
      name.trim() ||
      (shownTo.everyone
        ? 'Club calendar'
        : onlyTeam
          ? `${onlyTeam.name} calendar`
          : newAudience === 'committee'
            ? 'Committee calendar'
            : 'Calendar');
    const { error: insertError } =
      home === 'app'
        ? await saveAppCalendar(null, newName, color, shownTo, takesSuggestions)
        : await saveCalendar(null, newName, trimmedUrl, color, shownTo);
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    refreshEvents();
    setName('');
    setUrl('');
    setColor(null);
    setShownTo(nobody);
    setAdding(false);
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
            <CalendarCard
              key={calendar.id}
              calendar={calendar}
              teams={teams}
              phoneLink={phoneLinks[calendar.id] ?? null}
              onChanged={load}
            />
          ))
        )}
      </View>

      {!loaded ? null : !adding && calendars.length > 0 ? (
        <Button title="Add another calendar" variant="secondary" onPress={() => setAdding(true)} />
      ) : (
        <View style={styles.section}>
          <ThemedText type="smallBold">Add a calendar</ThemedText>
          <ChipGroup
            label="Where it’s kept"
            options={[
              { value: 'link', label: 'An Outlook link' },
              { value: 'app', label: 'In the app' },
            ]}
            selected={[home]}
            onToggle={(value) => {
              setHome(value as Home);
              setError(null);
            }}
          />
          {home === 'link' ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                You keep changing it in Outlook, and the app shows what Outlook has. In Outlook,
                publish the calendar and copy its ICS link.
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
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                You add its events here in the app, from Add an event in the Calendar tab. Nothing
                to set up in Outlook.
              </ThemedText>
              <SuggestionsSwitch value={takesSuggestions} onChange={setTakesSuggestions} />
            </>
          )}
          <TextField label="Name (optional)" value={name} onChangeText={setName} />
          <ThemedText type="small" themeColor="textSecondary">
            Only the people you choose see the calendar, so keep each calendar to the people who
            need it, and split the club’s calendars when different people need different events.
          </ThemedText>
          <ShownToPicker shownTo={shownTo} teams={teams} onChange={setShownTo} />
          <ColorPicker selected={calendarColorKey(color, newAudience)} onSelect={setColor} />
          <ErrorText>{error}</ErrorText>
          <Button title="Add calendar" onPress={add} busy={saving} />
          {calendars.length > 0 ? (
            <Button
              title="Cancel"
              variant="secondary"
              disabled={saving}
              onPress={() => {
                setAdding(false);
                setError(null);
              }}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function CalendarCard({
  calendar,
  teams,
  phoneLink,
  onChanged,
}: {
  calendar: CalendarRow;
  teams: Team[];
  /** The key of its phone link, or null while it has none. */
  phoneLink: string | null;
  onChanged: () => PromiseLike<unknown>;
}) {
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const savedShownTo = shownToFromRows(calendar.calendar_audiences);
  const audience = colourAudience(savedShownTo, teams);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(calendar.name);
  const [url, setUrl] = useState(calendar.url ?? '');
  const [takesSuggestions, setTakesSuggestions] = useState(calendar.takes_suggestions);
  const [shownTo, setShownTo] = useState<CalendarShownTo>(savedShownTo);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Moving a linked calendar into the app: the events read from its link, once read.
  const [moving, setMoving] = useState<{ events: ImportEvent[]; first: Date | null; last: Date | null } | null>(
    null,
  );
  const eventCount = calendar.hq_calendar_events?.[0]?.count ?? 0;
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
    if (!calendar.in_hq && trimmedUrl !== calendar.url) {
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
    const { error: saveError } = calendar.in_hq
      ? await saveAppCalendar(calendar.id, name.trim() || calendar.name, calendar.color, shownTo, takesSuggestions)
      : await saveCalendar(calendar.id, name.trim() || calendar.name, trimmedUrl, calendar.color, shownTo);
    setBusy(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    refreshEvents();
    await onChanged();
    setEditing(false);
  }

  /** Reads the link one last time, to say what moving it in will bring across. */
  async function readLink() {
    if (!calendar.url) return;
    setBusy(true);
    setError(null);
    const reading = await readCalendarForImport(calendar.url, earliestDay(), latestDay());
    setBusy(false);
    if ('error' in reading) {
      setError(reading.error);
      return;
    }
    setMoving(reading);
  }

  async function moveIn() {
    if (!moving) return;
    setBusy(true);
    setError(null);
    const { error: moveError } = await supabase.rpc('admin_move_calendar_into_hq', {
      p_id: calendar.id,
      p_events: moving.events,
    });
    setBusy(false);
    if (moveError) {
      setError(moveError.message);
      return;
    }
    setMoving(null);
    refreshEvents();
    await onChanged();
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
    refreshEvents();
    await onChanged();
  }

  if (moving) {
    const count = moving.events.length;
    return (
      <Card>
        <ThemedText type="smallBold">Move {calendar.name} into the app?</ThemedText>
        <ThemedText type="small">
          {count === 0
            ? 'The link has no events in the two years the app shows, so the calendar starts empty.'
            : `The link has ${count} ${count === 1 ? 'event' : 'events'}${
                moving.first && moving.last
                  ? `, from ${formatDateString(toDateString(moving.first))} to ${formatDateString(toDateString(moving.last))}`
                  : ''
              }. They are copied into the app.`}
        </ThemedText>
        <ThemedText type="small">
          From then on you change this calendar in the app, and the app stops reading Outlook:
          anything changed in Outlook afterwards won’t show. The same people see it, in the same
          colour. This can’t be undone, though the link is kept on record.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        <Button
          title={count === 0 ? 'Move it into the app' : `Move ${count} ${count === 1 ? 'event' : 'events'} into the app`}
          onPress={moveIn}
          busy={busy}
        />
        <Button
          title="Keep it in Outlook"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setMoving(null);
            setError(null);
          }}
        />
      </Card>
    );
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
          {calendar.in_hq ? (
            <SuggestionsSwitch value={takesSuggestions} onChange={setTakesSuggestions} />
          ) : (
            <TextField
              label="ICS link"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          )}
          <ShownToPicker shownTo={shownTo} teams={teams} onChange={setShownTo} />
          <ErrorText>{error}</ErrorText>
          <Button title="Save" onPress={saveEdit} busy={busy} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setName(calendar.name);
              setUrl(calendar.url ?? '');
              setTakesSuggestions(calendar.takes_suggestions);
              setShownTo(savedShownTo);
              setError(null);
              setEditing(false);
            }}
          />
        </>
      ) : (
        <>
          {calendar.in_hq ? (
            <ThemedText type="small" themeColor="textSecondary">
              Kept in the app · {eventCount} {eventCount === 1 ? 'event' : 'events'}
              {calendar.takes_suggestions ? ' · takes suggestions' : ''}
              {calendar.moved_in_at
                ? `. Moved in from Outlook on ${formatDateString(toDateString(new Date(calendar.moved_in_at)))}${
                    calendar.moved_in_by_name ? ` by ${calendar.moved_in_by_name}` : ''
                  }`
                : ''}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} selectable>
              {calendar.url}
            </ThemedText>
          )}
          {/* A phone link is only for a calendar kept in the app and shown to everyone. */}
          {calendar.in_hq && savedShownTo.everyone ? (
            <CalendarPhoneLink calendarId={calendar.id} token={phoneLink} onChanged={onChanged} />
          ) : null}
          <ColorPicker selected={colorKey} onSelect={(key) => update({ color: key })} compact />
          <ErrorText>{error}</ErrorText>
          <View style={styles.cardActions}>
            <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                {calendar.in_hq ? 'Change name or who sees it' : 'Change name, link or who sees it'}
              </ThemedText>
            </Pressable>
            {calendar.in_hq ? null : (
              <Pressable accessibilityRole="button" onPress={readLink} disabled={busy}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  {busy ? 'Reading the link…' : 'Move into the app'}
                </ThemedText>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={remove} disabled={busy}>
              <ThemedText type="small" style={{ color: confirmingDelete ? '#FF5A5A' : theme.tint }}>
                {confirmingDelete
                  ? calendar.in_hq && eventCount > 0
                    ? `Tap again to delete it and its ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`
                    : 'Tap again to delete'
                  : 'Delete'}
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

/** Whether coaches, managers and committee members may suggest events for a calendar kept in the app. */
function SuggestionsSwitch({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.pickerField}>
      <View style={styles.cardTitle}>
        <ThemedText type="smallBold" style={styles.flex}>
          {SUGGESTIONS_LABEL}
        </ThemedText>
        <SettingSwitch label={SUGGESTIONS_LABEL} value={value} onValueChange={onChange} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {value
          ? 'Those who see this calendar suggest an event; nobody else sees it until an admin adds it.'
          : 'Only admins add events to it.'}
      </ThemedText>
    </View>
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
      {compact ? null : (
        <ThemedText type="small" themeColor="textSecondary">
          The colour you pick is kept for this calendar. Squads and teams take theirs from the
          colours no calendar uses.
        </ThemedText>
      )}
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
