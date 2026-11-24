import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime, formatSentAt } from '@/lib/format';
import { formatDateString } from '@/lib/injuries';
import {
  accessOpen,
  type AccessedMessage,
  linkLabels,
  MIN_NOTE,
  type MessageAccessLogEntry,
  type MessageAccessRequest,
  requestedPostLabel,
  requestStatusLine,
  timeLeft,
} from '@/lib/message-access';
import { audienceLabel } from '@/lib/messages';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

type OpenedMessage = { message_id: string; body: string };

/**
 * One request to read a member's messages: what was asked and why, the
 * answer, and the log of every list and message opened. An admin who isn't
 * involved answers it here; the requester reads here while the 24 hours last.
 */
export default function MessageAccessRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [request, setRequest] = useState<MessageAccessRequest | null | undefined>(undefined);
  const [log, setLog] = useState<MessageAccessLogEntry[]>([]);
  const [messages, setMessages] = useState<AccessedMessage[] | null>(null);
  const [opened, setOpened] = useState<Record<string, OpenedMessage>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [requestsResult, logResult] = await Promise.all([
      supabase.rpc('message_access_requests'),
      supabase.rpc('message_access_log', { p_request_id: id }),
    ]);
    const found = ((requestsResult.data as MessageAccessRequest[] | null) ?? []).find(
      (r) => r.id === id,
    );
    setRequest(found ?? null);
    setLog((logResult.data as MessageAccessLogEntry[] | null) ?? []);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'refuse');
    setError(null);
    const { error: rpcError } = await supabase.rpc('decide_message_access', {
      p_request_id: id,
      p_approve: approve,
      p_note: note.trim(),
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNote('');
    load();
  }

  // Lists the messages the request covers. The list itself is logged.
  async function showMessages() {
    setBusy('list');
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('accessed_messages', {
      p_request_id: id,
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessages((data as AccessedMessage[] | null) ?? []);
    load();
  }

  // Shows one message's text. Every opening is logged.
  async function openMessage(messageId: string) {
    if (opened[messageId]) return;
    setBusy(messageId);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('open_accessed_message', {
      p_request_id: id,
      p_message_id: messageId,
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as OpenedMessage | null;
    if (row) setOpened((all) => ({ ...all, [messageId]: row }));
    load();
  }

  if (request === undefined) return <Screen>{null}</Screen>;
  if (request === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This request isn’t available to you.
        </ThemedText>
      </Screen>
    );
  }

  const open = accessOpen(request);

  return (
    <Screen>
      <Card>
        <ThemedText type="smallBold">
          {request.reference} · concern {request.concern_reference}
          {request.concern_open ? '' : ' (closed)'}
        </ThemedText>
        <ThemedText type="small">
          {request.subject_name}’s messages, {formatDateString(request.from_date)} to{' '}
          {formatDateString(request.to_date)}
        </ThemedText>
        <Detail label="How they’re involved" value={linkLabels[request.subject_link]} />
        <Detail
          label="Asked by"
          value={`${request.requested_by_name} (${requestedPostLabel(request)}), ${localDay(request.created_at)}`}
        />
        <Detail label="Why" value={request.reason} />
        <ThemedText
          type="small"
          themeColor={request.status === 'pending' ? 'tint' : 'textSecondary'}>
          {requestStatusLine(request)}
        </ThemedText>
        {request.decided_by_name ? (
          <>
            <Detail
              label={request.status === 'approved' ? 'Approved by' : 'Refused by'}
              value={`${request.decided_by_name}, ${request.decided_at ? formatDateTime(new Date(request.decided_at)) : ''}`}
            />
            <Detail
              label={request.status === 'approved' ? 'Justification' : 'Reasons'}
              value={request.decision_note}
            />
          </>
        ) : null}
      </Card>

      {request.can_decide ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Your answer</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            If you approve, {request.requested_by_name} can read these messages for 24 hours, and
            nobody else can. Record why you approve or refuse: it’s kept for good with the request.
          </ThemedText>
          <TextField
            label="Justification or reasons"
            value={note}
            onChangeText={setNote}
            placeholder={`At least ${MIN_NOTE} characters`}
            multiline
            maxLength={1000}
          />
          <Button
            title="Approve for 24 hours"
            onPress={() => decide(true)}
            busy={busy === 'approve'}
          />
          <Button
            title="Refuse"
            variant="secondary"
            onPress={() => decide(false)}
            busy={busy === 'refuse'}
          />
        </View>
      ) : null}

      {open ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Messages · {timeLeft(request.access_expires_at)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Read only. Every list and every message you open is recorded with this request.
          </ThemedText>
          {messages === null ? (
            <Button title="Show the messages" onPress={showMessages} busy={busy === 'list'} />
          ) : messages.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No messages between these dates.
            </ThemedText>
          ) : (
            messages.map((m) => (
              <PressableCard key={m.message_id} onPress={() => openMessage(m.message_id)}>
                <View style={styles.row}>
                  <ThemedText type="smallBold" style={styles.grow} numberOfLines={1}>
                    {m.sent_by_member ? `Sent by ${m.sender_name}` : `From ${m.sender_name}`}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatSentAt(new Date(m.created_at))}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  To {audienceLabel(m.audience, m.audience_role, m.audience_label)}
                  {m.sent_by_member ? '' : m.member_read_at ? ' · opened' : ' · not opened'}
                  {m.member_archived_at ? ' · archived' : ''}
                </ThemedText>
                {opened[m.message_id] ? (
                  <ThemedText selectable={false}>{opened[m.message_id].body}</ThemedText>
                ) : (
                  <ThemedText type="small" themeColor="tint">
                    {busy === m.message_id
                      ? 'Opening…'
                      : m.text_removed
                        ? 'Text removed after the keep period'
                        : 'Tap to read'}
                  </ThemedText>
                )}
              </PressableCard>
            ))
          )}
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {request.status !== 'pending' ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Who read what</ThemedText>
          {log.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing read under this request.
            </ThemedText>
          ) : (
            log.map((entry, i) => (
              <ThemedText key={`${entry.viewed_at}-${i}`} type="small" themeColor="textSecondary">
                {formatDateTime(new Date(entry.viewed_at))} · {entry.viewed_by_name}{' '}
                {entry.kind === 'listed'
                  ? 'listed the messages'
                  : `opened the message from ${entry.message_sender_name ?? 'the club'}${
                      entry.message_sent_at
                        ? `, ${formatSentAt(new Date(entry.message_sent_at))}`
                        : ''
                    }`}
              </ThemedText>
            ))
          )}
        </View>
      ) : null}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
});
