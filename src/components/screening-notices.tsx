import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate, parseDate } from '@/lib/age';
import { localDay } from '@/lib/reports';
import { barringNotices, screeningNoticeLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { ScreeningNotice, ScreeningNoticeKind } from '@/lib/types';

const kinds = Object.keys(screeningNoticeLabels) as ScreeningNoticeKind[];

/** Today as DD/MM/YYYY, for date fields. */
function todayText() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return formatDate(`${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, '0')}`);
}

/**
 * Notices from the Working with Children Screening Unit about a member, and
 * what the club did. A notice that bars them from child-related work stands
 * them down at once, and waits until an admin records telling the governing
 * body.
 */
export function ScreeningNotices({
  memberId,
  onStandDown,
}: {
  memberId: string;
  /** Called when recording a notice stood them down, so the screen reloads. */
  onStandDown: () => void;
}) {
  const [notices, setNotices] = useState<ScreeningNotice[]>([]);
  const [kind, setKind] = useState<ScreeningNoticeKind | null>(null);
  const [received, setReceived] = useState(todayText());
  const [action, setAction] = useState('');
  const [toldOn, setToldOn] = useState(todayText());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('screening_notices')
      .select('*')
      .eq('profile_id', memberId)
      .order('received_on', { ascending: false });
    setNotices((data as ScreeningNotice[] | null) ?? []);
  }, [memberId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function record() {
    const receivedOn = parseDate(received);
    if (!kind) {
      setError('Choose what kind of notice it is.');
      return;
    }
    if (!receivedOn) {
      setError('Enter the date it arrived as DD/MM/YYYY.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_record_screening_notice', {
      p_profile_id: memberId,
      p_kind: kind,
      p_received_on: receivedOn,
      p_action: action,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const barring = barringNotices.includes(kind);
    setKind(null);
    setAction('');
    await load();
    if (barring) onStandDown();
  }

  async function reported(notice: ScreeningNotice) {
    const on = parseDate(toldOn);
    if (!on) {
      setError('Enter the date you told them as DD/MM/YYYY.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_screening_notice_reported', {
      p_notice_id: notice.id,
      p_told_on: on,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  }

  const waiting = notices.filter(
    (n) => barringNotices.includes(n.kind) && !n.governing_body_told_on,
  );

  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Screening Unit notices</ThemedText>
      {notices.map((n) => (
        <Card key={n.id}>
          <ThemedText type="small">
            {screeningNoticeLabels[n.kind]}, received {formatDate(n.received_on)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {n.action}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Recorded {localDay(n.recorded_at)} by {n.recorded_by_name ?? 'a former admin'}
            {n.governing_body_told_on
              ? `. Governing body told ${formatDate(n.governing_body_told_on)} (recorded by ${n.governing_body_told_by_name ?? 'a former admin'}).`
              : barringNotices.includes(n.kind)
                ? '. Governing body not told yet.'
                : '.'}
          </ThemedText>
        </Card>
      ))}
      {waiting.length > 0 ? (
        <>
          <ThemedText type="small" themeColor="tint">
            Tell the governing body in writing, then record the date.
          </ThemedText>
          <TextField
            label="Date you told them"
            value={toldOn}
            onChangeText={setToldOn}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {waiting.map((n) => (
            <Button
              key={n.id}
              title={`Governing body told: ${screeningNoticeLabels[n.kind].toLowerCase()}`}
              variant="secondary"
              onPress={() => reported(n)}
              busy={busy}
            />
          ))}
        </>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        Record every notice the Screening Unit sends about this member. An interim negative
        notice, negative notice, interstate decision or cancelled card stands them down straight
        away.
      </ThemedText>
      <ChipGroup
        options={kinds.map((k) => ({ value: k, label: screeningNoticeLabels[k] }))}
        selected={kind ? [kind] : []}
        onToggle={(k) => setKind(k === kind ? null : k)}
      />
      {kind ? (
        <>
          <TextField
            label="Date it arrived"
            value={received}
            onChangeText={setReceived}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <TextField
            label="What the club did"
            value={action}
            onChangeText={setAction}
            placeholder="For example, removed from coaching the same day"
            multiline
            maxLength={1000}
          />
          <Button title="Record notice" variant="secondary" onPress={record} busy={busy} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
