import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, parseDate } from '@/lib/age';
import { DOCUMENT_TYPES } from '@/lib/injuries';
import { localDay } from '@/lib/reports';
import { applicationStatus, wwccApplicationEndLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { WwccApplication, WwccApplicationKind } from '@/lib/types';
import {
  APPLICATION_CHECK_DAYS,
  APPLICATION_LAPSE_DAYS,
  APPLICATION_STATUS_URL,
  applicationKindLabels,
  uploadReceipt,
} from '@/lib/wwcc-applications';

type EndReason = 'withdrawn' | 'refused' | 'other';

const endChoices: { value: EndReason; label: string }[] = [
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'refused', label: 'Refused' },
  { value: 'other', label: 'Something else' },
];

/**
 * A member's lodged Working With Children Check application, on their admin
 * page. In WA someone who has applied, new or a renewal, can do
 * child-related work while it's assessed, with the receipt. An admin records
 * it here with the receipt, the member accepts a declaration, and it counts
 * as their check until their card is recorded. An admin confirms it's still
 * being assessed every 30 days; it lapses after 90 without that.
 */
export function WwccApplicationSection({
  memberId,
  isSelf,
  onChange,
}: {
  memberId: string;
  /** Admins don't record or confirm their own. */
  isSelf: boolean;
  /** Called with their open application after every load. */
  onChange?: (application: WwccApplication | null) => void;
}) {
  const theme = useTheme();
  const [applications, setApplications] = useState<WwccApplication[]>([]);
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState('');
  const [lodged, setLodged] = useState('');
  const [kind, setKind] = useState<WwccApplicationKind | null>(null);
  const [receipt, setReceipt] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [endNote, setEndNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_wwcc_applications');
    const theirs = ((data as WwccApplication[] | null) ?? []).filter(
      (a) => a.profile_id === memberId,
    );
    setApplications(theirs);
    onChange?.(theirs.find((a) => !a.ended_at) ?? null);
  }, [memberId, onChange]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const open = applications.find((a) => !a.ended_at);
  const ended = applications.filter((a) => a.ended_at);

  async function pickReceipt() {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      setReceipt(result.assets[0]);
      setError(null);
    }
  }

  async function record() {
    const lodgedOn = parseDate(lodged);
    if (!number.trim()) {
      setError('Enter the application number from the receipt.');
      return;
    }
    if (!lodgedOn) {
      setError('Enter the day it was lodged as DD/MM/YYYY.');
      return;
    }
    if (!kind) {
      setError('Choose whether it’s a new check or a renewal.');
      return;
    }
    if (!receipt) {
      setError('Attach the receipt.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await uploadReceipt(memberId, receipt);
      const { error: rpcError } = await supabase.rpc('admin_record_wwcc_application', {
        p_profile_id: memberId,
        p_application_number: number,
        p_lodged_on: lodgedOn,
        p_kind: kind,
        p_receipt_path: path,
        p_receipt_name: receipt.name,
      });
      if (rpcError) throw new Error(rpcError.message);
      setAdding(false);
      setNumber('');
      setLodged('');
      setKind(null);
      setReceipt(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(application: WwccApplication) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_confirm_wwcc_application', {
      p_application_id: application.id,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  }

  async function end(application: WwccApplication) {
    if (!endReason) {
      setError('Choose why it ended.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_end_wwcc_application', {
      p_application_id: application.id,
      p_reason: endReason,
      p_note: endNote,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setEnding(false);
    setEndReason(null);
    setEndNote('');
    await load();
  }

  const status = open ? applicationStatus(open) : null;

  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Check applied for</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        In WA, someone who has applied for a check, new or a renewal, can start or keep doing
        child-related work while it’s assessed, with the receipt, unless they’ve had a negative or
        interim negative notice, been charged with or convicted of a Class 1 offence as an adult,
        or withdrawn it. Record it here and they accept a declaration in the app. It then counts as
        their check until you record their card. Confirm it’s still being assessed every{' '}
        {APPLICATION_CHECK_DAYS} days; it lapses after {APPLICATION_LAPSE_DAYS} days without that.
      </ThemedText>

      {open && status ? (
        <Card>
          <ThemedText type="small">
            Application {open.application_number}, {applicationKindLabels[open.kind].toLowerCase()},
            lodged {formatDate(open.lodged_on)}
          </ThemedText>
          <ThemedText type="small" themeColor={status.problem ? 'tint' : 'textSecondary'}>
            {status.label}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Recorded by {open.recorded_by_name ?? 'a former admin'} on {localDay(open.recorded_at)}
            {open.declared_at ? `; declaration accepted ${localDay(open.declared_at)}` : ''}
            {open.checked_at
              ? `; last confirmed by ${open.checked_by_name ?? 'a former admin'} on ${localDay(open.checked_at)}`
              : ''}
            .
          </ThemedText>
          <View style={styles.links}>
            <Pressable
              accessibilityRole="link"
              onPress={() =>
                router.push({
                  pathname: '/admin/wwcc-receipt',
                  params: { path: open.receipt_path, name: open.receipt_name ?? undefined },
                })
              }>
              <ThemedText type="small" style={{ color: theme.tint }}>
                Open the receipt
              </ThemedText>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(APPLICATION_STATUS_URL)}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                Check its status online
              </ThemedText>
            </Pressable>
          </View>
        </Card>
      ) : null}

      {open && isSelf ? (
        <ThemedText type="small" themeColor="textSecondary">
          Another admin confirms yours.
        </ThemedText>
      ) : null}

      {open && !isSelf && open.status !== 'stopped' ? (
        <Button
          title="Still being assessed"
          variant="secondary"
          onPress={() => confirm(open)}
          busy={busy}
        />
      ) : null}

      {open && !isSelf ? (
        ending ? (
          <>
            <ChipGroup
              label="Why it ended"
              options={endChoices}
              selected={endReason ? [endReason] : []}
              onToggle={(r) => setEndReason(r === endReason ? null : r)}
            />
            <TextField
              label="What happened (optional)"
              value={endNote}
              onChangeText={setEndNote}
              placeholder="For example, they moved interstate"
              maxLength={500}
            />
            <Button title="End the application" variant="danger" onPress={() => end(open)} busy={busy} />
          </>
        ) : (
          <Button title="It’s ended" variant="secondary" onPress={() => setEnding(true)} />
        )
      ) : null}

      {!open && !isSelf ? (
        adding ? (
          <>
            <TextField
              label="Application number"
              value={number}
              onChangeText={setNumber}
              placeholder="From the receipt"
              autoCapitalize="characters"
              maxLength={40}
            />
            <TextField
              label="Day it was lodged"
              value={lodged}
              onChangeText={setLodged}
              placeholder="DD/MM/YYYY, on the receipt"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            <ChipGroup
              options={(['new', 'renewal'] as const).map((k) => ({
                value: k,
                label: applicationKindLabels[k],
              }))}
              selected={kind ? [kind] : []}
              onToggle={(k) => setKind(k === kind ? null : k)}
            />
            <Button
              title={receipt ? `Receipt: ${receipt.name}` : 'Attach the receipt'}
              variant="secondary"
              onPress={pickReceipt}
            />
            <Button title="Save application" onPress={record} busy={busy} />
          </>
        ) : (
          <Button
            title="Record an application"
            variant="secondary"
            onPress={() => setAdding(true)}
          />
        )
      ) : null}

      {ended.map((a) => (
        <ThemedText key={a.id} type="small" themeColor="textSecondary">
          Earlier: application {a.application_number}, lodged {formatDate(a.lodged_on)}, ended{' '}
          {localDay(a.ended_at!)}
          {a.ended_reason ? ` (${wwccApplicationEndLabels[a.ended_reason]})` : ''}
          {a.end_note ? `: ${a.end_note}` : ''}
        </ThemedText>
      ))}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
});
