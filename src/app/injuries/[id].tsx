import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { StatusPill } from '@/components/injury-card';
import { RaiseConcernLink } from '@/components/safeguarding';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import {
  DOCUMENT_TYPES,
  type DocumentRule,
  formatDateString,
  type PhotoShows,
  injuryUpdateLabels,
  returnQuickPicks,
  shareInjuryDocument,
  uploadInjuryDocument,
} from '@/lib/injuries';
import { logRecordView } from '@/lib/record-access';
import { hasRole } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Injury, InjuryDocumentEvent, InjuryUpdate } from '@/lib/types';

const UPDATE_COLUMNS =
  'id, author_name, kind, notes, restrictions, expected_return, document_path, document_name, document_removed_at, created_at';

/** What the member is doing on this screen, if anything. */
type Action = 'update' | 'clearance' | 'endorse' | 'accept' | 'send_back';

export default function InjuryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const [injury, setInjury] = useState<Injury | null | undefined>(undefined);
  const [updates, setUpdates] = useState<InjuryUpdate[]>([]);
  const [action, setAction] = useState<Action | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [log, setLog] = useState<InjuryDocumentEvent[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [injuryResult, updatesResult, shareResult, logResult] = await Promise.all([
      supabase.rpc('visible_injuries', { p_include_cleared: true, p_injury_id: id }),
      supabase
        .from('injury_updates')
        .select(UPDATE_COLUMNS)
        .eq('injury_id', id)
        .order('created_at', { ascending: false }),
      supabase.rpc('can_share_injury', { p_injury_id: id }),
      // Only the athlete, their guardians and admins see who opened documents.
      supabase.rpc('injury_document_log', { p_injury_id: id }),
    ]);
    const shown = ((injuryResult.data as Injury[] | null) ?? [])[0] ?? null;
    setInjury(shown);
    if (shown) logRecordView(shown.athlete_id, 'injury', shown.id);
    setUpdates((updatesResult.data as InjuryUpdate[] | null) ?? []);
    setCanShare(shareResult.data === true);
    setLog(logResult.error ? null : ((logResult.data as InjuryDocumentEvent[] | null) ?? []));
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
    profile?.status === 'approved' && hasRole(profile, 'committee', 'admin');
  const hasDocuments = updates.some((u) => u.document_path && !u.document_removed_at);

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
          <UpdateCard
            key={update.id}
            update={update}
            canShare={canShare}
            log={
              log && update.document_path
                ? log.filter((e) => e.document_path === update.document_path)
                : null
            }
          />
        ))}
        {hasDocuments ? (
          <ThemedText type="small" themeColor="textSecondary">
            {canShare
              ? 'This clearance is waiting for the committee, so you can Share its documents to keep them in the club’s records. Each share is recorded and shown to the athlete, their guardians and admins.'
              : 'Documents open in the app only. Every view and share is recorded and shown to the athlete, their guardians and admins.'}
          </ThemedText>
        ) : null}
      </View>

      <RaiseConcernLink
        context={`${injury.athlete_name ?? 'An athlete'}’s ${injury.body_area.toLowerCase()} injury`}
      />
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
  // The committee can also send back a request a coach hasn't looked at yet,
  // but not their own or their own child's (`can_report`), as the database
  // never asks them to sign those off.
  if (isCommittee && !injury.can_report && injury.status === 'clearance_requested') {
    return (
      <View style={styles.actions}>
        <Waiting text="Waiting for one of the athlete’s coaches or a physio to endorse it." />
        <Button title="Send back" variant="secondary" onPress={() => onChoose('send_back')} />
      </View>
    );
  }
  if (injury.status === 'clearance_requested') {
    return <Waiting text="Waiting for one of the athlete’s coaches or a physio to endorse it." />;
  }
  if (injury.status === 'coach_endorsed') {
    return (
      <Waiting text="Waiting for a committee member to accept it. It has to be someone other than the coach or physio who endorsed it." />
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
  const [rule, setRule] = useState<DocumentRule>('letter');
  const [shows, setShows] = useState<PhotoShows>('letter');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowsDocument = action === 'update' || action === 'clearance';
  const isPhoto = !!attachment && attachment.mimeType !== 'application/pdf';

  useEffect(() => {
    if (!allowsDocument) return;
    supabase
      .rpc('injury_document_rule', { p_athlete_id: injury.athlete_id })
      .then(({ data }) => setRule((data as DocumentRule | null) ?? 'letter'));
  }, [allowsDocument, injury.athlete_id]);

  async function pickDocument() {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) {
      setAttachment(result.assets[0]);
      setShows('letter');
      setConfirmed(false);
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
    if (action === 'update' && !expectedReturn) {
      setError('Choose when they’re expected back.');
      return;
    }
    if (action === 'clearance' && !attachment) {
      setError('Attach proof of clearance, such as a letter from the physio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const path = attachment
        ? await uploadInjuryDocument(injury, attachment, rule, confirmed ? shows : null)
        : null;
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
              {documentHint[rule]} Up to 10 MB. It can’t be removed once it’s sent.
            </ThemedText>
          )}
          <Button
            title={attachment ? 'Choose a different file' : 'Attach a file'}
            variant="secondary"
            onPress={pickDocument}
          />
          {isPhoto && rule !== 'photos' ? (
            <PhotoDeclaration
              athleteName={injury.athlete_name ?? 'my child'}
              canShowInjury={rule === 'consent'}
              shows={shows}
              onShows={(value) => {
                setShows(value);
                setConfirmed(false);
              }}
              confirmed={confirmed}
              onConfirm={setConfirmed}
            />
          ) : null}
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

const documentHint: Record<DocumentRule, string> = {
  photos: 'A PDF or photo.',
  letter: 'A PDF or a photo of the physio’s or doctor’s letter or report, not of the injury.',
  consent:
    'A PDF or a photo of the letter or report. A photo of the injury only if you consent to the club keeping it.',
};

/**
 * For an athlete under 18: what the photo shows, confirmed before it's sent.
 * A photo of the injury itself is only offered to a verified guardian, when
 * the club allows it, and needs their consent.
 */
function PhotoDeclaration({
  athleteName,
  canShowInjury,
  shows,
  onShows,
  confirmed,
  onConfirm,
}: {
  athleteName: string;
  canShowInjury: boolean;
  shows: PhotoShows;
  onShows: (value: PhotoShows) => void;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.document}>
      {canShowInjury ? (
        <ChipGroup
          label="The photo shows"
          options={[
            { value: 'letter', label: 'The letter or report' },
            { value: 'injury', label: 'The injury' },
          ]}
          selected={[shows]}
          onToggle={(value) => onShows(value)}
        />
      ) : null}
      <Card style={styles.consent}>
        <ThemedText type="small" style={styles.grow}>
          {shows === 'injury'
            ? `I’m ${athleteName}’s parent or guardian. I consent to the club keeping this photo with their injury record, where their coaches, physios, the committee and admins can view it in the app. Every view is recorded.`
            : 'This is a photo of the physio’s or doctor’s letter or report, not of the injury.'}
        </ThemedText>
        <Switch
          accessibilityLabel={
            shows === 'injury'
              ? 'I consent to the club keeping this photo'
              : 'This is a photo of the letter or report'
          }
          value={confirmed}
          onValueChange={onConfirm}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.text}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
        />
      </Card>
    </View>
  );
}

const eventLabels: Record<InjuryDocumentEvent['kind'], string> = {
  viewed: 'Viewed by',
  shared: 'Shared by',
  consented: 'Photo consent from',
  letter_declared: 'Confirmed as a photo of the letter by',
};

/**
 * One entry in the history. The committee member accepting a clearance can
 * also share its documents, to keep them in the club's records.
 */
function UpdateCard({
  update,
  canShare,
  log,
}: {
  update: InjuryUpdate;
  canShare: boolean;
  log: InjuryDocumentEvent[] | null;
}) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  function view() {
    if (!update.document_path) return;
    router.push({
      pathname: '/injuries/document',
      params: { path: update.document_path, name: update.document_name ?? 'Document' },
    });
  }

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
          {update.document_removed_at ? (
            <ThemedText type="small" themeColor="textSecondary">
              Removed {formatDateTime(new Date(update.document_removed_at))}, after the club’s keep
              period. The record of it stays.
            </ThemedText>
          ) : (
            <View style={styles.links}>
              <Pressable accessibilityRole="button" onPress={view} style={styles.link}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  View
                </ThemedText>
              </Pressable>
              {canShare ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={share}
                  disabled={opening}
                  style={styles.link}>
                  <ThemedText type="smallBold" style={{ color: theme.tint }}>
                    {opening ? 'Opening…' : 'Share'}
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          )}
          <ErrorText>{error}</ErrorText>
          {log ? (
            <View>
              {log.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Nobody has opened it yet.
                </ThemedText>
              ) : (
                log.map((e, i) => (
                  <ThemedText key={i} type="small" themeColor="textSecondary">
                    {eventLabels[e.kind]} {e.viewer_name ?? 'a former member'}
                    {e.viewer_role ? ` (${e.viewer_role.toLowerCase()})` : ''} ·{' '}
                    {formatDateTime(new Date(e.created_at))}
                  </ThemedText>
                ))
              )}
            </View>
          ) : null}
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
  links: {
    flexDirection: 'row',
    gap: Spacing.four,
  },
  link: {
    paddingVertical: Spacing.one,
  },
  consent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
