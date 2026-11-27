import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarEvent } from '@/lib/calendar';
import { useAuth } from '@/lib/auth';
import { clubToday } from '@/lib/club-time';
import { formatEventTime, formatShortDay } from '@/lib/format';
import { formatDateString, toDateString } from '@/lib/injuries';
import {
  attachmentFromDocument,
  attachmentFromPhoto,
  attachmentProblem,
  copyPlanFile,
  MAX_PLAN_FILES,
  parseTime,
  PLAN_COLUMNS,
  PLAN_FILE_TYPES,
  type PlanAttachment,
  type PlanCoach,
  removePlanFile,
  type SessionPlan,
  type SessionPlanFile,
  timeOf,
  uploadPlanFile,
  usePlanGroups,
} from '@/lib/session-plans';
import { supabase } from '@/lib/supabase';
import { useEvent, useEvents } from '@/lib/use-events';
import { teamLabel, useTeams } from '@/lib/use-teams';

const dayQuickPicks = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: -1 },
  { label: 'Tomorrow', days: 1 },
];

/** How far either side of today calendar sessions are offered. */
const CALENDAR_DAYS = 14;
const CALENDAR_CHOICES = 8;

/**
 * Adds a session plan, or changes one when opened with `id`. Opened with
 * `copy`, it starts as a copy of that plan (Use again), files included, for a
 * new session.
 */
export default function EditSessionPlanScreen() {
  const params = useLocalSearchParams<{ id?: string; copy?: string; team?: string; event?: string }>();
  // Opened from a session on the calendar (a new plan only): its squad or
  // team, time and place start filled in, as choosing it below would. The
  // form waits for the session, so it is filled in before anything is typed.
  const fromSession = !!params.event && !params.id && !params.copy;
  const opened = useEvent(fromSession ? params.event : undefined);
  if (fromSession && opened === undefined) return <Screen>{null}</Screen>;
  return <PlanForm startEvent={fromSession ? (opened ?? null) : null} startTeam={params.team} />;
}

function PlanForm({
  startEvent,
  startTeam,
}: {
  startEvent: CalendarEvent | null;
  /** The squad or team to start with, when it is one they can add plans for. */
  startTeam: string | undefined;
}) {
  const params = useLocalSearchParams<{ id?: string; copy?: string }>();
  const { isAdmin } = useAuth();
  const theme = useTheme();
  const teams = useTeams();
  const groups = usePlanGroups(teams);
  const { eventsOn: events, showPast } = useEvents();

  // Set once the plan has been saved, so a retry after a failed upload
  // changes the same plan rather than adding another.
  const [planId, setPlanId] = useState<string | null>(params.id ?? null);
  const [loaded, setLoaded] = useState(!params.id && !params.copy);
  const [groupChoice, setGroupChoice] = useState<string | null>(
    startEvent && startTeam ? startTeam : null,
  );
  const [title, setTitle] = useState(startEvent?.title ?? '');
  const [sessionOn, setSessionOn] = useState<string | null>(
    startEvent ? toDateString(startEvent.start) : clubToday(),
  );
  const [startText, setStartText] = useState(
    startEvent && !startEvent.allDay ? timeOf(startEvent.start) : '',
  );
  const [endText, setEndText] = useState(
    startEvent && !startEvent.allDay && startEvent.end.getTime() > startEvent.start.getTime()
      ? timeOf(startEvent.end)
      : '',
  );
  const [location, setLocation] = useState(startEvent?.location ?? '');
  const [notes, setNotes] = useState('');
  const [runBy, setRunBy] = useState('');
  const [shareCoaches, setShareCoaches] = useState(true);
  const [shareAthletes, setShareAthletes] = useState(false);
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [coaches, setCoaches] = useState<PlanCoach[]>([]);
  const [fromEvent, setFromEvent] = useState<CalendarEvent | null>(startEvent);
  const [existingFiles, setExistingFiles] = useState<SessionPlanFile[]>([]);
  const [filesToCopy, setFilesToCopy] = useState<SessionPlanFile[]>([]);
  const [attachments, setAttachments] = useState<PlanAttachment[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Past sessions too, for plans written after the session.
  useEffect(() => {
    showPast();
  }, [showPast]);

  useEffect(() => {
    supabase.rpc('session_plan_coaches').then(({ data }) => {
      setCoaches((data as PlanCoach[] | null) ?? []);
    });
  }, []);

  // Fill the form from the plan being changed or copied.
  useEffect(() => {
    const sourceId = params.id ?? params.copy;
    if (!sourceId) return;
    let current = true;
    Promise.all([
      supabase.from('session_plans').select(PLAN_COLUMNS).eq('id', sourceId).maybeSingle(),
      supabase
        .from('session_plan_files')
        .select('id, plan_id, path, name, content_type, size_bytes, added_by_name, created_at')
        .eq('plan_id', sourceId)
        .order('created_at'),
      supabase.from('session_plan_shares').select('profile_id').eq('plan_id', sourceId),
    ]).then(([plan, files, shares]) => {
      if (!current) return;
      const p = plan.data as SessionPlan | null;
      if (!p) {
        setError('That plan couldn’t be found.');
        setLoaded(true);
        return;
      }
      const copying = !params.id;
      setGroupChoice(p.team_id);
      setTitle(p.title);
      setSessionOn(copying ? clubToday() : p.session_on);
      setStartText(p.starts_at?.slice(0, 5) ?? '');
      setEndText(p.ends_at?.slice(0, 5) ?? '');
      setLocation(p.location ?? '');
      setNotes(p.notes ?? '');
      setRunBy(p.run_by ?? '');
      setShareCoaches(p.share_team_coaches);
      setShareAthletes(p.share_athletes);
      // Named shares are only readable by the author and admins.
      setCoachIds(
        ((shares.data as { profile_id: string }[] | null) ?? []).map((s) => s.profile_id),
      );
      const planFiles = (files.data as SessionPlanFile[] | null) ?? [];
      if (copying) setFilesToCopy(planFiles);
      else setExistingFiles(planFiles);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [params.id, params.copy]);

  // A copy can only go to groups the member can add plans for, so a plan
  // shared from another group starts its copy with no group chosen. A plan
  // being changed keeps its group, even one the member doesn't coach.
  const editing = !!params.id;
  const chosen =
    groupChoice && (editing || groups.some((g) => g.id === groupChoice)) ? groupChoice : null;
  const groupId = chosen ?? (groups.length === 1 ? groups[0].id : null);
  const group = teams.find((t) => t.id === groupId) ?? null;
  const groupOptions = groups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }));
  if (editing && group && !groups.some((g) => g.id === group.id)) {
    groupOptions.push({ value: group.id, label: teamLabel(group, teams) });
  }

  // Coaches of the chosen group are covered by the first tick box.
  const otherCoaches = coaches.filter((c) => !groupId || !c.team_ids.includes(groupId));
  const calendarChoices = nearbySessions(events, group?.name ?? null);
  const fileCount =
    existingFiles.length + filesToCopy.length + attachments.length;
  const room = MAX_PLAN_FILES - fileCount;

  function pickEvent(event: CalendarEvent) {
    setFromEvent(event);
    setTitle(event.title);
    setSessionOn(toDateString(event.start));
    if (event.allDay) {
      setStartText('');
      setEndText('');
    } else {
      setStartText(timeOf(event.start));
      setEndText(event.end.getTime() > event.start.getTime() ? timeOf(event.end) : '');
    }
    setLocation(event.location ?? '');
    setError(null);
  }

  function addAttachments(chosen: PlanAttachment[]) {
    const problems = chosen.map(attachmentProblem).filter(Boolean);
    const ok = chosen.filter((a) => !attachmentProblem(a)).slice(0, Math.max(room, 0));
    setAttachments((current) => [...current, ...ok]);
    if (problems.length > 0) setError(problems[0]);
    else if (ok.length < chosen.length) setError(`A plan can have up to ${MAX_PLAN_FILES} photos and files.`);
    else setError(null);
  }

  async function pickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(room, 1),
      // Compressing also turns iPhone HEIC photos into JPEG.
      quality: 0.7,
    });
    if (!result.canceled) addAttachments(result.assets.map(attachmentFromPhoto));
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Allow the camera in your phone’s settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled) addAttachments(result.assets.map(attachmentFromPhoto));
  }

  async function pickFiles() {
    const result = await DocumentPicker.getDocumentAsync({
      type: PLAN_FILE_TYPES,
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) addAttachments(result.assets.map(attachmentFromDocument));
  }

  async function removeExisting(file: SessionPlanFile) {
    setRemoving(file.id);
    setError(null);
    try {
      await removePlanFile(file);
      setExistingFiles((current) => current.filter((f) => f.id !== file.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file wasn’t removed. Try again.');
    } finally {
      setRemoving(null);
    }
  }

  async function save() {
    if (!groupId) {
      setError('Choose the squad or team the session is for.');
      return;
    }
    if (!title.trim()) {
      setError('Name the session, for example Tuesday training.');
      return;
    }
    if (!sessionOn) {
      setError('Choose the day of the session.');
      return;
    }
    const startsAt = startText.trim() ? parseTime(startText) : null;
    const endsAt = endText.trim() ? parseTime(endText) : null;
    if ((startText.trim() && !startsAt) || (endText.trim() && !endsAt)) {
      setError('Write times like 6:00 pm or 18:00.');
      return;
    }
    if (!notes.trim() && fileCount === 0) {
      setError('Write the plan, or attach a photo or file of it.');
      return;
    }
    setSaving(true);
    setError(null);
    let saved = false;
    try {
      const { data, error: saveError } = await supabase.rpc('save_session_plan', {
        p_id: planId,
        p_team_id: groupId,
        p_title: title,
        p_session_on: sessionOn,
        p_starts_at: startsAt,
        p_ends_at: endsAt,
        p_location: location,
        p_notes: notes,
        p_run_by: runBy,
        p_share_team_coaches: shareCoaches,
        p_share_athletes: shareAthletes,
        p_coach_ids: coachIds.filter((c) => otherCoaches.some((o) => o.profile_id === c)),
        p_copied_from: params.copy ?? null,
      });
      if (saveError) throw new Error(saveError.message);
      const id = data as string;
      setPlanId(id);
      saved = true;
      // Each file is taken off the list once it's in, so a retry only sends the rest.
      for (const file of filesToCopy) {
        await copyPlanFile(id, file);
        setFilesToCopy((current) => current.filter((f) => f.id !== file.id));
      }
      for (const attachment of attachments) {
        await uploadPlanFile(id, attachment);
        setAttachments((current) => current.filter((a) => a !== attachment));
      }
      if (params.id) router.back();
      else router.replace({ pathname: '/session-plans/[id]', params: { id } });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setError(saved ? `${message} The plan is saved; tap Save again to send the rest.` : message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <Screen>{null}</Screen>;

  if (groupOptions.length === 0) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          Session plans are added by the coaches of a squad or team, and by admins. You aren’t
          a coach of a current squad or team.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen
        options={{ title: params.id ? 'Change session plan' : 'Add a session plan' }}
      />
      <ChipGroup
        label="Squad or team"
        options={groupOptions}
        selected={groupId ? [groupId] : []}
        onToggle={(value) => {
          setGroupChoice(value);
          setFromEvent(null);
        }}
      />

      {group && calendarChoices.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Fill in from the calendar</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Pick a session to copy its name, day, times and place. The plan keeps these even if
            the calendar changes later.
          </ThemedText>
          {calendarChoices.map((event) => {
            const on = fromEvent?.id === event.id;
            return (
              <Pressable
                key={event.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => pickEvent(event)}
                style={({ pressed }) => [
                  styles.event,
                  {
                    backgroundColor: on
                      ? theme.accent
                      : pressed
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                  },
                ]}>
                <ThemedText
                  type="smallBold"
                  numberOfLines={1}
                  style={on ? { color: theme.onAccent } : undefined}>
                  {event.title}
                </ThemedText>
                <ThemedText
                  type="small"
                  numberOfLines={1}
                  style={on ? { color: theme.onAccent } : undefined}
                  themeColor={on ? undefined : 'textSecondary'}>
                  {formatShortDay(event.start)} · {formatEventTime(event)}
                  {event.location ? ` · ${event.location}` : ''}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <TextField
        label="Session"
        value={title}
        onChangeText={setTitle}
        placeholder="For example, Tuesday training"
        maxLength={120}
      />
      <DateField label="Day" value={sessionOn} onChange={setSessionOn} quickPicks={dayQuickPicks} />
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField
            label="Starts (optional)"
            value={startText}
            onChangeText={setStartText}
            placeholder="6:00 pm"
            maxLength={10}
          />
        </View>
        <View style={styles.grow}>
          <TextField
            label="Finishes (optional)"
            value={endText}
            onChangeText={setEndText}
            placeholder="7:30 pm"
            maxLength={10}
          />
        </View>
      </View>
      <TextField
        label="Place (optional)"
        value={location}
        onChangeText={setLocation}
        placeholder="For example, Main court"
        maxLength={200}
      />
      {isAdmin || runBy ? (
        <TextField
          label="Run by (optional)"
          value={runBy}
          onChangeText={setRunBy}
          placeholder="For example, the S&C partner"
          maxLength={120}
        />
      ) : null}

      <TextField
        label="Plan"
        value={notes}
        onChangeText={setNotes}
        placeholder="Warm up, drills, focus areas, anything you want to record"
        multiline
        maxLength={20000}
      />

      <View style={styles.section}>
        <ThemedText type="smallBold">Photos and files</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Photos of the plan, PDFs or Word documents, up to {MAX_PLAN_FILES} of 10 MB each. Take
          photos of the plan or whiteboard, not of athletes.
        </ThemedText>
        {existingFiles.map((file) => (
          <View key={file.id} style={styles.fileRow}>
            <ThemedText type="small" numberOfLines={1} style={styles.grow}>
              📎 {file.name}
            </ThemedText>
            <Button
              title="Remove"
              variant="secondary"
              busy={removing === file.id}
              onPress={() => removeExisting(file)}
            />
          </View>
        ))}
        {filesToCopy.map((file) => (
          <View key={file.id} style={styles.fileRow}>
            <ThemedText type="small" numberOfLines={1} style={styles.grow}>
              📎 {file.name}
            </ThemedText>
            <Button
              title="Leave out"
              variant="secondary"
              onPress={() => setFilesToCopy((current) => current.filter((f) => f.id !== file.id))}
            />
          </View>
        ))}
        {attachments.map((attachment, i) => (
          <View key={`${attachment.uri}-${i}`} style={styles.fileRow}>
            <ThemedText type="small" numberOfLines={1} style={styles.grow}>
              📎 {attachment.name}
            </ThemedText>
            <Button
              title="Leave out"
              variant="secondary"
              onPress={() => setAttachments((current) => current.filter((a) => a !== attachment))}
            />
          </View>
        ))}
        {room > 0 ? (
          <>
            <Button title="Choose photos" variant="secondary" onPress={pickPhotos} />
            {Platform.OS !== 'web' ? (
              <Button title="Take a photo" variant="secondary" onPress={takePhoto} />
            ) : null}
            <Button title="Attach a PDF or Word document" variant="secondary" onPress={pickFiles} />
          </>
        ) : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Share with</ThemedText>
        <Tick
          label="The other coaches of this squad or team"
          on={shareCoaches}
          onPress={() => setShareCoaches(!shareCoaches)}
        />
        <Tick
          label="Its athletes"
          detail="Parents and guardians of athletes under 18 see it too."
          on={shareAthletes}
          onPress={() => setShareAthletes(!shareAthletes)}
        />
        {otherCoaches.length > 0 ? (
          <ChipGroup
            label="Coaches of other squads and teams"
            options={otherCoaches.map((c) => ({
              value: c.profile_id,
              label: `${c.full_name} (${c.groups})`,
            }))}
            selected={coachIds}
            onToggle={(id) =>
              setCoachIds((current) =>
                current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
              )
            }
          />
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Anyone it’s shared with can read it. Nobody can reply to it. Admins can see every plan.
        </ThemedText>
      </View>

      {sessionOn && planId === null && sessionOn > clubToday() ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Planning ahead for {formatDateString(sessionOn)}. You can change the plan after the
            session.
          </ThemedText>
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title={params.id ? 'Save changes' : 'Save session plan'} onPress={save} busy={saving} />
    </Screen>
  );
}

function Tick({
  label,
  detail,
  on,
  onPress,
}: {
  label: string;
  detail?: string;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tick,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={[styles.box, { borderColor: theme.accent }, on && { backgroundColor: theme.accent }]}>
        {on ? (
          <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
            ✓
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.grow}>
        <ThemedText type="small">{label}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The squad or team's sessions within two weeks of today, plus club-wide
 * ones, closest to now first.
 */
function nearbySessions(events: CalendarEvent[] | null, groupName: string | null) {
  if (!events || !groupName) return [];
  const now = Date.now();
  const span = CALENDAR_DAYS * 24 * 60 * 60 * 1000;
  return events
    .filter(
      (e) =>
        (e.clubWide || e.calendarName === groupName) &&
        Math.abs(e.start.getTime() - now) <= span,
    )
    .sort((a, b) => Math.abs(a.start.getTime() - now) - Math.abs(b.start.getTime() - now))
    .slice(0, CALENDAR_CHOICES)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  event: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.half,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 12,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
