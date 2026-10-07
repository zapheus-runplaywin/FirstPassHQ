import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { StatusPill } from '@/components/injury-card';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import {
  DOCUMENT_TYPES,
  formatDateString,
  injuryUpdateLabels,
  returnQuickPicks,
  shareInjuryDocument,
  uploadInjuryDocument,
} from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import type { Injury, InjuryUpdate } from '@/lib/types';

const UPDATE_COLUMNS =
  'id, author_name, kind, notes, restrictions, expected_return, document_path, document_name, created_at';

/** What the member is doing on this screen, if anything. */
type Action = 'update' | 'clearance' | 'endorse' | 'accept' | 'send_back';

export default function InjuryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [injury, setInjury] = useState<Injury | null | undefined>(undefined);
  const [updates, setUpdates] = useState<InjuryUpdate[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [injuryResult, updatesResult] = await Promise.all([
      supabase.rpc('visible_injuries', { p_include_cleared: true, p_injury_id: id }),
      supabase
        .from('injury_updates')
        .select(UPDATE_COLUMNS)
        .eq('injury_id', id)
        .order('created_at', { ascending: false }),
    ]);
    setInjury(((injuryResult.data as Injury[] | null) ?? [])[0] ?? null);
    setUpdates((updatesResult.data as InjuryUpdate[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function done() {
    setAction(null);
    await load();
  }

  if (injury === undefined) return null;
  if (injury === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This injury isn’t available.
        </ThemedText>
      </Screen>
    );
  }

  const isCommittee =
    profile?.status === 'approved' && (profile.role === 'committee' || profile.role === 'admin');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{injury.body_area}</ThemedText>
        <View style={styles.row}>
          <ThemedText themeColor="textSecondary" style={styles.grow} numberOfLines={1}>
            {injury.athlete_name ?? 'Unnamed athlete'}
          </ThemedText>
          <StatusPill status={injury.status} />
        </View>
      </View>

      <Card>
        <Detail label="Injured" value={formatDateString(injury.injured_on)} />
        <Detail label="Restrictions" value={injury.restrictions ?? 'None'} />
        <Detail
          label="Expected back"
          value={injury.expected_return ? formatDateString(injury.expected_return) : 'Not sure yet'}
        />
      </Card>

      {action ? (
        <ActionForm
          injury={injury}
          action={action}
          onDone={done}
          onCancel={() => setAction(null)}
        />
      ) : (
        <Actions injury={injury} isCommittee={isCommittee} onChoose={setAction} />
      )}

      <View style={styles.section}>
        <ThemedText type="smallBold">History</ThemedText>
        {updates.map((update) => (
          <UpdateCard key={update.id} update={update} />
        ))}
        {isCommittee && updates.some((u) => u.document_path) ? (
          <ThemedText type="small" themeColor="textSecondary">
            Use Share on a document to save it to OneDrive or attach it to an email.
          </ThemedText>
        ) : null}
      </View>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.grow}>
        {value}
      </ThemedText>
    </View>
  );
}

/** The buttons for whatever the member can do next. */
function Actions({
  injury,
  isCommittee,
  onChoose,
}: {
  injury: Injury;
  isCommittee: boolean;
  onChoose: (action: Action) => void;
}) {
  if (injury.can_report && injury.status === 'injured') {
    return (
      <View style={styles.actions}>
        <Button title="Add physio update" onPress={() => onChoose('update')} />
        <Button
          title="Ask for clearance"
          variant="secondary"
          onPress={() => onChoose('clearance')}
        />
      </View>
    );
  }
  if (injury.waiting_for_me && injury.status === 'clearance_requested') {
    return (
      <View style={styles.actions}>
        <Button title="Endorse clearance" onPress={() => onChoose('endorse')} />
        <Button title="Send back" variant="secondary" onPress={() => onChoose('send_back')} />
      </View>
    );
  }
  if (injury.waiting_for_me && injury.status === 'coach_endorsed') {
    return (
      <View style={styles.actions}>
        <Button title="Accept clearance" onPress={() => onChoose('accept')} />
        <Button title="Send back" variant="secondary" onPress={() => onChoose('send_back')} />
      </View>
    );
  }
  // The committee can also send back a request a coach hasn't looked at yet.
  if (isCommittee && injury.status === 'clearance_requested') {
    return (
      <View style={styles.actions}>
        <Waiting text="Waiting for one of the athlete’s coaches to endorse it." />
        <Button title="Send back" variant="secondary" onPress={() => onChoose('send_back')} />
      </View>
    );
  }
  if (injury.status === 'clearance_requested') {
    return <Waiting text="Waiting for one of the athlete’s coaches to endorse it." />;
  }
  if (injury.status === 'coach_endorsed') {
    return (
      <Waiting text="Waiting for a committee member to accept it. It has to be someone other than the coach who endorsed it." />
    );
  }
  return null;
}

function Waiting({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {text}
    </ThemedText>
  );
}

const actionText: Record<
  Action,
  { title: string; notesLabel: string; placeholder: string; submit: string }
> = {
  update: {
    title: 'Physio update',
    notesLabel: 'What did the physio say?',
    placeholder: 'Progress, treatment and what to do next',
    submit: 'Save update',
  },
  clearance: {
    title: 'Ask for clearance',
    notesLabel: 'Notes (optional)',
    placeholder: 'Anything the coach or committee should know',
    submit: 'Ask for clearance',
  },
  endorse: {
    title: 'Endorse clearance',
    notesLabel: 'Notes (optional)',
    placeholder: 'For example, trained fully on Tuesday',
    submit: 'Endorse',
  },
  accept: {
    title: 'Accept clearance',
    notesLabel: 'Notes (optional)',
    placeholder: 'Anything to record with the clearance',
    submit: 'Accept and clear to play',
  },
  send_back: {
    title: 'Send back',
    notesLabel: 'Why is it being sent back?',
    placeholder: 'For example, the letter needs the physio’s signature',
    submit: 'Send back',
  },
};

function ActionForm({
  injury,
  action,
  onDone,
  onCancel,
}: {
  injury: Injury;
  action: Action;
  onDone: () => void;
  onCancel: () => void;
}) {
  const text = actionText[action];
  const [notes, setNotes] = useState('');
  const [restrictions, setRestrictions] = useState(injury.restrictions ?? '');
  const [expectedReturn, setExpectedReturn] = useState(injury.expected_return);
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowsDocument = action === 'update' || action === 'clearance';

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
    if ((action === 'update' || action === 'send_back') && !notes.trim()) {
      setError(
        action === 'update' ? 'Write what the physio said.' : 'Say why it’s being sent back.',
      );
      return;
    }
    if (action === 'clearance' && !attachment) {
      setError('Attach proof of clearance, such as a letter from the physio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const path = attachment ? await uploadInjuryDocument(injury, attachment) : null;
      const { error: rpcError } = await rpc(path);
      if (rpcError) throw new Error(rpcError.message);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  function rpc(path: string | null) {
    const p_injury_id = injury.id;
    switch (action) {
      case 'update':
        return supabase.rpc('add_injury_update', {
          p_injury_id,
          p_notes: notes,
          p_restrictions: restrictions,
          p_expected_return: expectedReturn,
          p_document_path: path,
          p_document_name: attachment?.name ?? null,
        });
      case 'clearance':
        return supabase.rpc('request_clearance', {
          p_injury_id,
          p_notes: notes,
          p_document_path: path,
          p_document_name: attachment?.name ?? null,
        });
      case 'endorse':
        return supabase.rpc('endorse_clearance', { p_injury_id, p_notes: notes });
      case 'accept':
        return supabase.rpc('accept_clearance', { p_injury_id, p_notes: notes });
      case 'send_back':
        return supabase.rpc('send_back_clearance', { p_injury_id, p_notes: notes });
    }
  }

  return (
    <View style={styles.form}>
      <ThemedText type="subtitle">{text.title}</ThemedText>
      <TextField
        label={text.notesLabel}
        value={notes}
        onChangeText={setNotes}
        placeholder={text.placeholder}
        multiline
        maxLength={4000}
      />
      {action === 'update' ? (
        <>
          <TextField
            label="Restrictions"
            value={restrictions}
            onChangeText={setRestrictions}
            placeholder="Leave empty if there are none"
            maxLength={1000}
          />
          <DateField
            label="Expected back"
            value={expectedReturn}
            onChange={setExpectedReturn}
            quickPicks={returnQuickPicks}
            optional
          />
        </>
      ) : null}
      {allowsDocument ? (
        <View style={styles.document}>
          <ThemedText type="smallBold">
            {action === 'clearance' ? 'Proof of clearance' : 'Physio report (optional)'}
          </ThemedText>
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
            title={attachment ? 'Choose a different file' : 'Attach a file'}
            variant="secondary"
            onPress={pickDocument}
          />
        </View>
      ) : null}
      {action === 'accept' ? (
        <ThemedText type="small" themeColor="textSecondary">
          This clears the athlete to train and play. Check the proof in the history below first.
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button title={text.submit} onPress={submit} busy={saving} />
      <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={saving} />
    </View>
  );
}

function UpdateCard({ update }: { update: InjuryUpdate }) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  async function share() {
    if (!update.document_path) return;
    setOpening(true);
    setError(null);
    try {
      await shareInjuryDocument(update.document_path, update.document_name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That document couldn’t be opened.');
    } finally {
      setOpening(false);
    }
  }

  return (
    <Card>
      <View style={styles.row}>
        <ThemedText
          type="smallBold"
          style={[styles.grow, update.kind === 'cleared' ? { color: theme.tint } : undefined]}>
          {injuryUpdateLabels[update.kind]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {update.author_name ?? 'Former member'}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDateTime(new Date(update.created_at))}
      </ThemedText>
      {update.notes ? (
        <ThemedText type="small" selectable>
          {update.notes}
        </ThemedText>
      ) : null}
      {update.kind === 'physio_update' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Restrictions: {update.restrictions ?? 'None'} · Expected back:{' '}
          {update.expected_return ? formatDateString(update.expected_return) : 'Not sure yet'}
        </ThemedText>
      ) : null}
      {update.document_path ? (
        <View style={styles.document}>
          <ThemedText type="small" numberOfLines={1}>
            📎 {update.document_name ?? 'Document'}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={share}
            disabled={opening}
            style={styles.link}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {opening ? 'Opening…' : 'View or share'}
            </ThemedText>
          </Pressable>
          <ErrorText>{error}</ErrorText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  detail: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  detailLabel: {
    width: 110,
  },
  actions: {
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
  },
  document: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  link: {
    paddingVertical: Spacing.one,
  },
});
