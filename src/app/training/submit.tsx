import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DOCUMENT_TYPES, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import { dueLabel, isOutstanding, uploadCertificate, useMyTraining } from '@/lib/training';

const completedQuickPicks = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: -1 },
  { label: 'A week ago', days: -7 },
];

/**
 * Uploads a certificate: tick the training it covers, say when it was
 * completed and attach the certificate. Opened with `profile` for a child, and
 * `requirement` to start with that training ticked.
 */
export default function SubmitCertificateScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ profile?: string; requirement?: string }>();
  const { myTraining } = useMyTraining();
  const [profileChoice, setProfileChoice] = useState<string | null>(params.profile ?? null);
  const [ticked, setTicked] = useState<string[]>(params.requirement ? [params.requirement] : []);
  const [completedOn, setCompletedOn] = useState<string | null>(toDateString(new Date()));
  const [notes, setNotes] = useState('');
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (myTraining === null) return <Screen>{null}</Screen>;

  const outstanding = myTraining.filter(isOutstanding);
  // The member and any children who still have training to do.
  const people = outstanding.filter(
    (row, i) => outstanding.findIndex((r) => r.profile_id === row.profile_id) === i,
  );
  const profileId = profileChoice ?? people[0]?.profile_id ?? null;
  const choices = outstanding.filter((row) => row.profile_id === profileId);
  const tickedHere = ticked.filter((id) => choices.some((c) => c.requirement_id === id));
  // A parent uploading for their child sees the child's name, not "you".
  const forChild = choices.find((c) => !c.is_me);
  const who = forChild ? (forChild.profile_name ?? 'your athlete') : 'you';

  function toggle(id: string) {
    setTicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      setAttachment(result.assets[0]);
      setError(null);
    }
  }

  async function submit() {
    if (!profileId) return;
    if (tickedHere.length === 0) {
      setError('Tick the training this certificate is for.');
      return;
    }
    if (!completedOn) {
      setError('Choose the day it was completed.');
      return;
    }
    if (!attachment) {
      setError('Attach the certificate of completion.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const path = await uploadCertificate(profileId, attachment);
      const { error: rpcError } = await supabase.rpc('submit_training_certificate', {
        p_profile_id: profileId,
        p_requirement_ids: tickedHere,
        p_completed_on: completedOn,
        p_document_path: path,
        p_document_name: attachment.name,
        p_notes: notes,
      });
      if (rpcError) throw new Error(rpcError.message);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!profileId) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          There is no training waiting for a certificate.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      {people.length > 1 ? (
        <ChipGroup
          label="Who is it for?"
          options={people.map((p) => ({
            value: p.profile_id,
            label: p.is_me ? 'Me' : (p.profile_name ?? 'Athlete'),
          }))}
          selected={[profileId]}
          onToggle={setProfileChoice}
        />
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold">Certificate achieved</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tick each course this certificate shows {who} completed.
        </ThemedText>
        {choices.map((row) => {
          const on = tickedHere.includes(row.requirement_id);
          return (
            <Pressable
              key={row.requirement_id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => toggle(row.requirement_id)}
              style={({ pressed }) => [
                styles.tick,
                {
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <View
                style={[
                  styles.box,
                  { borderColor: theme.accent },
                  on && { backgroundColor: theme.accent },
                ]}>
                {on ? (
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    ✓
                  </ThemedText>
                ) : null}
              </View>
              <View style={styles.flex}>
                <ThemedText type="smallBold">{row.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {row.status === 'sent_back' ? 'Sent back · ' : ''}
                  {dueLabel(row.due_on)}
                </ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>

      <DateField
        label="Completed on"
        value={completedOn}
        onChange={setCompletedOn}
        quickPicks={completedQuickPicks}
        max={toDateString(new Date())}
      />

      <View style={styles.section}>
        <ThemedText type="smallBold">Certificate of completion</ThemedText>
        {attachment ? (
          <ThemedText type="small" numberOfLines={1}>
            📎 {attachment.name}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            A PDF or photo, up to 10 MB. It can’t be removed once it’s sent.
          </ThemedText>
        )}
        <Button
          title={attachment ? 'Choose a different file' : 'Attach the certificate'}
          variant="secondary"
          onPress={pickDocument}
        />
      </View>

      <TextField
        label="Note (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything the committee should know"
        multiline
        maxLength={1000}
      />

      <ErrorText>{error}</ErrorText>
      <Button title="Send for checking" onPress={submit} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
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
  flex: {
    flex: 1,
    gap: Spacing.half,
  },
});
