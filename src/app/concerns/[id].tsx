import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate } from '@/lib/age';
import {
  concernEventLabels,
  concernStatusLabels,
  involvesChildLabels,
  useSafeguardingContacts,
} from '@/lib/concerns';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Concern, ConcernEvent, ConcernEventKind, ConcernStatus } from '@/lib/types';

/** How many people to offer while searching for who it's about. */
const PERSON_MATCHES = 5;

/**
 * One concern for those who handle it: what was raised, everything done about
 * it, and buttons to record a referral, a note or a new status.
 */
export default function ConcernScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contacts = useSafeguardingContacts();
  const [concern, setConcern] = useState<Concern | null | undefined>(undefined);
  const [history, setHistory] = useState<ConcernEvent[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<ConcernStatus | null>(null);
  const [aboutSearch, setAboutSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [registerResult, historyResult, peopleResult] = await Promise.all([
      supabase.rpc('concern_register'),
      supabase.rpc('concern_history', { p_concern_id: id }),
      supabase.rpc('concern_people'),
    ]);
    const found = ((registerResult.data as Concern[] | null) ?? []).find((c) => c.id === id);
    setConcern(found ?? null);
    setHistory((historyResult.data as ConcernEvent[] | null) ?? []);
    setPeople((peopleResult.data as { id: string; name: string }[] | null) ?? []);
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

  async function setAbout(memberId: string | null) {
    setBusy('about');
    setError(null);
    const { error: rpcError } = await supabase.rpc('set_concern_about', {
      p_concern_id: id,
      p_member_id: memberId,
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setAboutSearch('');
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
  const search = aboutSearch.trim().toLowerCase();
  const matches =
    search.length >= 2
      ? people.filter((p) => p.name.toLowerCase().includes(search)).slice(0, PERSON_MATCHES)
      : [];

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
          {concernStatusLabels[concern.status]} · raised {localDay(concern.created_at)}
        </ThemedText>
        <ThemedText type="small">{concern.body}</ThemedText>
        <Detail label="About" value={concern.about_member_name ?? concern.about_text} />
        {concern.about_member_name && concern.about_text && concern.about_text !== concern.about_member_name ? (
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

      <View style={styles.group}>
        <ThemedText type="smallBold">Who it’s about</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Name the member it’s about so they can’t see it, even if they’re an admin or handle
          concerns. If you name yourself, you lose it too.
        </ThemedText>
        <TextField
          label="Search members"
          value={aboutSearch}
          onChangeText={setAboutSearch}
          placeholder="Name"
        />
        {matches.length > 0 ? (
          <ChipGroup
            options={matches.map((p) => ({ value: p.id, label: p.name }))}
            selected={[]}
            onToggle={setAbout}
          />
        ) : null}
        {concern.about_member_id ? (
          <Button
            title="Clear who it’s about"
            variant="secondary"
            onPress={() => setAbout(null)}
            busy={busy === 'about'}
          />
        ) : null}
      </View>
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
});
