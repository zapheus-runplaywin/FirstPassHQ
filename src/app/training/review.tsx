import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import {
  dueLabel,
  useCanCheckTraining,
  useTrainingToReview,
  type CertificateToReview,
} from '@/lib/training';

/** Certificates waiting for the committee. Each is approved or sent back with a note. */
export default function ReviewCertificatesScreen() {
  const canCheck = useCanCheckTraining();
  const { toReview, reloadToReview } = useTrainingToReview();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reloadToReview();
    setRefreshing(false);
  }

  if (!canCheck) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          Only the committee and admins check certificates.
        </ThemedText>
      </Screen>
    );
  }
  if (toReview === null) return <Screen>{null}</Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {toReview.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          ✓ No certificates are waiting to be checked.
        </ThemedText>
      ) : (
        toReview.map((cert) => (
          <CertificateCard key={cert.certificate_id} cert={cert} onDone={reloadToReview} />
        ))
      )}
      <ThemedText type="small" themeColor="textSecondary">
        Check the name, the course and the date on each certificate before approving it. Nobody
        checks their own certificate or their own child’s.
      </ThemedText>
    </Screen>
  );
}

function CertificateCard({ cert, onDone }: { cert: CertificateToReview; onDone: () => void }) {
  const theme = useTheme();
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    if (!approve && !note.trim()) {
      setError('Say what needs fixing, such as “The name is cut off”.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('review_training_certificate', {
      p_certificate_id: cert.certificate_id,
      p_approve: approve,
      p_note: note,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onDone();
  }

  const uploadedBy =
    cert.submitted_by_name && cert.submitted_by_name !== cert.profile_name
      ? ` · uploaded by ${cert.submitted_by_name}`
      : '';

  return (
    <Card style={styles.card}>
      <View>
        <ThemedText type="smallBold">{cert.profile_name ?? 'Member'}</ThemedText>
        <ThemedText type="small">{cert.requirement_name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Completed {formatDateString(cert.completed_on)} · {dueLabel(cert.due_on)}
          {uploadedBy}
        </ThemedText>
      </View>
      {cert.notes ? <ThemedText type="small">“{cert.notes}”</ThemedText> : null}
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() =>
          router.push({
            pathname: '/training/document',
            params: { path: cert.document_path, name: cert.document_name ?? 'Certificate' },
          })
        }>
        <ThemedText type="small" style={{ color: theme.tint }}>
          📎 {cert.document_name ?? 'View certificate'}
        </ThemedText>
      </Pressable>

      {!cert.can_review ? (
        <ThemedText type="small" themeColor="textSecondary">
          This is yours or your child’s, so someone else on the committee checks it.
        </ThemedText>
      ) : sendingBack ? (
        <>
          <TextField
            label="What needs fixing?"
            value={note}
            onChangeText={setNote}
            placeholder="The member sees this note"
            multiline
            maxLength={1000}
          />
          <ErrorText>{error}</ErrorText>
          <Button title="Send back" variant="danger" onPress={() => review(false)} busy={busy} />
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => setSendingBack(false)}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <Button title="Approve" onPress={() => review(true)} busy={busy} />
          <Button title="Send back" variant="secondary" onPress={() => setSendingBack(true)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
});
