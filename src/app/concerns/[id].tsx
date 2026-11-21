import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PeoplePicker } from '@/components/people-picker';
import { ReportedMessage } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate } from '@/lib/age';
import {
  concernAboutNames,
  concernEventLabels,
  concernStatusLabels,
  type ConcernGuardian,
  type ConcernGuardianView,
  type ConcernPerson,
  guardiansByChild,
  guardianViewsLine,
  involvesChildLabels,
  MAX_ABOUT,
  useSafeguardingContacts,
} from '@/lib/concerns';
import { useAuth } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Concern, ConcernEvent, ConcernEventKind, ConcernStatus } from '@/lib/types';

/**
 * One concern for those who handle it: what was raised, everything done about
 * it, and buttons to record a referral, a note or a new status.
 */
export default function ConcernScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contacts = useSafeguardingContacts();
  const { isSafeguardingOfficer } = useAuth();
  const [concern, setConcern] = useState<Concern | null | undefined>(undefined);
  const [history, setHistory] = useState<ConcernEvent[]>([]);
  const [people, setPeople] = useState<ConcernPerson[]>([]);
  const [guardians, setGuardians] = useState<ConcernGuardian[]>([]);
  const [guardianViews, setGuardianViews] = useState<ConcernGuardianView[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<ConcernStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aboutError, setAboutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [registerResult, historyResult, peopleResult] = await Promise.all([
      supabase.rpc('concern_register'),
      supabase.rpc('concern_history', { p_concern_id: id }),
      // Every approved member, children and parents included: only those who
      // handle concerns can list them.
      supabase.rpc('concern_about_people'),
    ]);
    const found = ((registerResult.data as Concern[] | null) ?? []).find((c) => c.id === id);
    setConcern(found ?? null);
    setHistory((historyResult.data as ConcernEvent[] | null) ?? []);
    setPeople((peopleResult.data as ConcernPerson[] | null) ?? []);
    // The child's verified parents and guardians, when it names a child. Asked
    // for after the register so the look is kept only for a concern shown.
    const shown = found && concernAboutNames(found).length > 0 ? found : null;
    const guardianResult = shown
      ? await supabase.rpc('concern_guardians', { p_concern_id: id })
      : { data: [] };
    const listed = (guardianResult.data as ConcernGuardian[] | null) ?? [];
    setGuardians(listed);
    const viewsResult =
      listed.length > 0
        ? await supabase.rpc('concern_guardian_views', { p_concern_id: id })
        : { data: [] };
    setGuardianViews((viewsResult.data as ConcernGuardianView[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function record(kind: ConcernEventKind, newStatus: ConcernStatus | null = null) {
    setBusy(kind);
    setError(null);
    const { error: rpcError } = await supabase.rpc('add_concern_event', {
      p_concern_id: id,
      p_kind: kind,
      p_note: note,
      p_status: newStatus,
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNote('');
    setStatus(null);
    load();
  }

  async function changeAbout(memberId: string, add: boolean) {
    setBusy('about');
    setAboutError(null);
    const { error: rpcError } = await supabase.rpc(add ? 'add_concern_about' : 'remove_concern_about', {
      p_concern_id: id,
      p_member_id: memberId,
    });
    setBusy(null);
    if (rpcError) {
      setAboutError(rpcError.message);
      return;
    }
    load();
  }

  if (concern === undefined) return <Screen>{null}</Screen>;
  if (concern === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This concern isn’t available to you. It may be about you, or you no longer handle
          concerns.
        </ThemedText>
      </Screen>
    );
  }

  const body = contacts?.governing_body_name ?? 'the governing body';
  const referred = history.some((e) => e.kind === 'referred_police' || e.kind === 'referred_governing_body');
  const aboutNames = concernAboutNames(concern);
  // Everyone named, as the picker shows them. An older register row names one.
  const aboutPeople = (
    concern.about_members ??
    (concern.about_member_id
      ? [{ id: concern.about_member_id, name: concern.about_member_name ?? 'A member' }]
      : [])
  ).flatMap((m) => (m.id ? [{ id: m.id, name: m.name }] : []));

  return (
    <Screen>
      {concern.involves_child !== 'no' && concern.status !== 'closed' && !referred ? (
        <Card>
          <ThemedText type="smallBold" themeColor="tint">
            Child abuse or a serious crime?
          </ThemedText>
          <ThemedText type="small">
            Refer it to Police and {body} straight away, and record it below. Don’t try to resolve
            it within the club.
          </ThemedText>
        </Card>
      ) : null}

      <Card>
        <ThemedText type="smallBold">
          {concern.reference ? `${concern.reference} · ` : ''}
          {concernStatusLabels[concern.status]} · raised {localDay(concern.created_at)}
        </ThemedText>
        <ThemedText type="small">{concern.body}</ThemedText>
        <Detail label="About" value={aboutNames.length > 0 ? aboutNames.join(', ') : concern.about_text} />
        {aboutNames.length > 0 && concern.about_text && !aboutNames.includes(concern.about_text) ? (
          <Detail label="In their words" value={concern.about_text} />
        ) : null}
        <Detail label="Happened" value={concern.happened_on ? formatDate(concern.happened_on) : null} />
        <Detail label="Child’s safety involved" value={involvesChildLabels[concern.involves_child]} />
        <Detail label="Raised from" value={concern.context} />
        <Detail
          label="Raised by"
          value={concern.anonymous ? 'They asked for their name not to be shown' : concern.raised_by_name}
        />
        {!concern.anonymous ? (
          <Detail
            label="Contact"
            value={
              concern.contact_ok
                ? (concern.contact_details ?? 'Happy to be contacted')
                : 'Asked not to be contacted'
            }
          />
        ) : null}
      </Card>

      {guardians.length > 0 ? (
        <Card testID="concern-guardians">
          {guardiansByChild(guardians).map((group) => (
            <View key={group.childName ?? 'child'} style={styles.guardianGroup}>
              <ThemedText type="smallBold">
                {group.childName ?? aboutNames[0] ?? 'The child'}’s parents and guardians
              </ThemedText>
              {group.guardians.map((g) => (
                <ThemedText key={`${g.child_id ?? ''}${g.guardian_id}`} type="small">
                  {g.name}
                  {g.email ? ` · ${g.email}` : ''}
                </ThemedText>
              ))}
            </View>
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            Verified parents and guardians only. Think before contacting them if the concern may be
            about home. Each look is kept with this concern, never in the child’s record views,
            which parents read.
          </ThemedText>
          {guardianViews.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`Looked at by ${guardianViewsLine(guardianViews)}`}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      {concern.reported_message_body ? (
        <ReportedMessage
          senderName={concern.reported_message_sender_name}
          sentAt={concern.reported_message_sent_at}
          body={concern.reported_message_body}
        />
      ) : null}

      <View style={styles.group}>
        <ThemedText type="smallBold">What’s been done</ThemedText>
        {history.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing recorded yet.
          </ThemedText>
        ) : (
          history.map((e) => (
            <Card key={e.id}>
              <ThemedText type="small">
                {concernEventLabels[e.kind]}
                {e.status && e.kind !== 'referred_governing_body' && e.kind !== 'referred_police'
                  ? `: ${concernStatusLabels[e.status]}`
                  : ''}
              </ThemedText>
              {e.note ? <ThemedText type="small">{e.note}</ThemedText> : null}
              <ThemedText type="small" themeColor="textSecondary">
                {localDay(e.created_at)} by {e.by_name ?? 'a former member'}
              </ThemedText>
            </Card>
          ))
        )}
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold">Record what you did</ThemedText>
        <TextField
          label="Note"
          value={note}
          onChangeText={setNote}
          placeholder="Who you spoke to, what was decided, reference numbers"
          multiline
          maxLength={2000}
        />
        <Button
          title={`Referred to ${body}`}
          variant="secondary"
          onPress={() => record('referred_governing_body')}
          busy={busy === 'referred_governing_body'}
        />
        <Button
          title="Referred to Police"
          variant="secondary"
          onPress={() => record('referred_police')}
          busy={busy === 'referred_police'}
        />
        <Button
          title="Add note"
          variant="secondary"
          onPress={() => record('note')}
          busy={busy === 'note'}
        />
        <ChipGroup
          label="Change status"
          options={(['under_review', 'closed'] as const)
            .filter((s) => s !== concern.status)
            .map((s) => ({ value: s, label: concernStatusLabels[s] }))}
          selected={status ? [status] : []}
          onToggle={(s) => setStatus(s === status ? null : s)}
        />
        {status ? (
          <Button
            title={status === 'closed' ? 'Close it (the note says why)' : 'Save status'}
            onPress={() => record('status_changed', status)}
            busy={busy === 'status_changed'}
          />
        ) : null}
        <ErrorText>{error}</ErrorText>
      </View>

      {isSafeguardingOfficer && concern.status !== 'closed' ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Messages</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Ask an admin to let you read one person’s messages for this concern, for up to 90 days
            at a time. Nobody else is told.
          </ThemedText>
          <Button
            title="Ask to read messages"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/concerns/message-access/new',
                params: {
                  concern: concern.id,
                  reference: concern.reference ?? '',
                },
              })
            }
          />
        </View>
      ) : null}

      <PeoplePicker
        label="Who it’s about"
        hint="Name every member it’s about, so none of them can see it, even if they’re an admin or handle concerns. Each change is saved straight away and kept in the history. If you name yourself, you lose it too."
        people={people}
        selected={aboutPeople}
        onAdd={(p) => changeAbout(p.id, true)}
        onRemove={(p) => changeAbout(p.id, false)}
        max={MAX_ABOUT}
        searchLabel="Search members"
        noneChosen="No member named."
        disabled={busy === 'about'}
      />
      <ErrorText>{aboutError}</ErrorText>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {label}: {value}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  guardianGroup: { gap: Spacing.one },
});
