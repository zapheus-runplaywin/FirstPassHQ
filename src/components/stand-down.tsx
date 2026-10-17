import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { localDay } from '@/lib/reports';
import { standDownReasonLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { StandDown, StandDownReason } from '@/lib/types';

const reasons = Object.keys(standDownReasonLabels) as StandDownReason[];


/**
 * Admins stand a coach, manager, physio, committee member or admin down from
 * those roles, for example when the Working with Children Screening Unit
 * sends a notice, and lift it later. Shows every past stand-down too.
 */
export function StandDownSection({
  memberId,
  memberName,
  onChange,
}: {
  memberId: string;
  memberName: string;
  /** Called after standing down or lifting, so the screen reloads the member. */
  onChange: () => void;
}) {
  const [history, setHistory] = useState<StandDown[]>([]);
  const [reason, setReason] = useState<StandDownReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('stand_downs')
      .select('*')
      .eq('profile_id', memberId)
      .order('started_at', { ascending: false });
    setHistory((data as StandDown[] | null) ?? []);
  }, [memberId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const open = history.find((s) => !s.lifted_at);

  async function standDown() {
    if (!reason) {
      setError('Choose why.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_stand_down', {
      p_profile_id: memberId,
      p_reason: reason,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReason(null);
    setNote('');
    await load();
    onChange();
  }

  async function lift() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_lift_stand_down', {
      p_profile_id: memberId,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNote('');
    await load();
    onChange();
  }

  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Stand down</ThemedText>
      {open ? (
        <>
          <ThemedText type="small" themeColor="tint">
            Stood down since {localDay(open.started_at)}: {standDownReasonLabels[open.reason]}
            {open.note ? ` (${open.note})` : ''}. Their coach, manager, physio, committee and
            admin roles are paused, and they were taken out of the squads and teams they coach,
            manage or treat.
          </ThemedText>
          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="For example, notice withdrawn by the Screening Unit"
            multiline
            maxLength={1000}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Lift stand-down" variant="secondary" onPress={lift} busy={busy} />
          <ThemedText type="small" themeColor="textSecondary">
            Lifting puts back their places in this season’s squads and teams. A coach, manager or
            physio still needs a current check before their role works again.
          </ThemedText>
        </>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Stops {memberName}’s coach, manager, physio, committee and admin roles straight away,
            for example when the Working with Children Screening Unit sends a notice. Their athlete
            and guardian roles are unchanged.
          </ThemedText>
          <ChipGroup
            options={reasons.map((r) => ({ value: r, label: standDownReasonLabels[r] }))}
            selected={reason ? [reason] : []}
            onToggle={(r) => setReason(r === reason ? null : r)}
          />
          <TextField
            label={reason === 'other' ? 'Why' : 'Note (optional)'}
            value={note}
            onChangeText={setNote}
            placeholder="Kept with the record. Only admins see it."
            multiline
            maxLength={1000}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Stand down now" variant="secondary" onPress={standDown} busy={busy} />
        </>
      )}
      {history
        .filter((s) => s.lifted_at)
        .map((s) => (
          <Card key={s.id}>
            <ThemedText type="small">
              {standDownReasonLabels[s.reason]}
              {s.note ? ` (${s.note})` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Stood down {localDay(s.started_at)} by {s.started_by_name ?? 'a former admin'}, lifted{' '}
              {localDay(s.lifted_at!)} by {s.lifted_by_name ?? 'a former admin'}
              {s.lift_note ? ` (${s.lift_note})` : ''}
            </ThemedText>
          </Card>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
