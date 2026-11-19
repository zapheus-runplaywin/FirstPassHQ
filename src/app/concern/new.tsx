import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ReportedMessage, SafeguardingContactsCard } from '@/components/safeguarding';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { parseDate } from '@/lib/age';
import { concernStatusLabels, type ConcernPerson, involvesChildLabels, matchPeople } from '@/lib/concerns';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { InvolvesChild, Message, MyConcern } from '@/lib/types';

const involvesOptions = Object.keys(involvesChildLabels) as InvolvesChild[];

/** How many people to offer while searching for who it's about. */
const PERSON_MATCHES = 5;

/**
 * Anyone signed in, guests and people waiting for approval included, tells
 * the club about something that worries them. Shows who to call first, and
 * the concerns they've raised before with where each is up to.
 */
export default function RaiseConcernScreen() {
  // Where they came from, for example a message or an injury, and the
  // message they're reporting, which the concern keeps a copy of.
  const { context, message: messageId } = useLocalSearchParams<{ context?: string; message?: string }>();
  const [message, setMessage] = useState<Pick<Message, 'sender_name' | 'created_at' | 'body'> | null>(null);
  const [body, setBody] = useState('');
  const [aboutText, setAboutText] = useState('');
  const [aboutId, setAboutId] = useState<string | null>(null);
  const [people, setPeople] = useState<ConcernPerson[]>([]);
  const [happened, setHappened] = useState('');
  const [involves, setInvolves] = useState<InvolvesChild>('unsure');
  const [anonymous, setAnonymous] = useState(false);
  const [contactOk, setContactOk] = useState(true);
  const [contactDetails, setContactDetails] = useState('');
  const [mine, setMine] = useState<MyConcern[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [peopleResult, mineResult, messageResult] = await Promise.all([
      supabase.rpc('concern_people'),
      supabase.rpc('my_concerns'),
      messageId
        ? supabase.from('messages').select('sender_name, created_at, body').eq('id', messageId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setPeople((peopleResult.data as ConcernPerson[] | null) ?? []);
    setMine((mineResult.data as MyConcern[] | null) ?? []);
    setMessage((messageResult.data as Pick<Message, 'sender_name' | 'created_at' | 'body'> | null) ?? null);
  }, [messageId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const matches = aboutId ? [] : matchPeople(people, aboutText, PERSON_MATCHES);

  async function send() {
    const happenedOn = parseDate(happened);
    if (!body.trim()) {
      setError('Say what happened.');
      return;
    }
    if (happenedOn === undefined) {
      setError('Enter the date as DD/MM/YYYY, or leave it blank.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('raise_concern', {
      p_body: body,
      p_about_text: aboutText,
      p_about_member_id: aboutId,
      p_happened_on: happenedOn,
      p_involves_child: involves,
      p_contact_ok: !anonymous && contactOk,
      p_contact_details: contactDetails,
      p_anonymous: anonymous,
      p_context: context ?? null,
      p_message_id: messageId ?? null,
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSent(true);
    setBody('');
    setAboutText('');
    setAboutId(null);
    setHappened('');
    setContactDetails('');
    load();
  }

  return (
    <Screen>
      <SafeguardingContactsCard />

      {sent ? (
        <Card>
          <ThemedText type="smallBold">Thank you for telling us</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            The club’s Child Safety Officer, Complaints Manager and admins can see it now. You can
            see where it’s up to below. If a child is in danger, call 000.
          </ThemedText>
        </Card>
      ) : (
        <View style={styles.group}>
          <ThemedText type="small" themeColor="textSecondary">
            Tell the club about anything that worries you: how a child is being treated, something
            someone said or did, or a message that didn’t feel right. You don’t need to be sure.
            The club’s Child Safety Officer, Complaints Manager and admins see it, but not the
            person it’s about.
          </ThemedText>
          {message ? (
            <>
              <ReportedMessage
                title="The message you’re reporting"
                senderName={message.sender_name}
                sentAt={message.created_at}
                body={message.body}
              />
              <ThemedText type="small" themeColor="textSecondary">
                A copy of this message is kept with your concern, so the people who look into it
                can read it even if the message is later removed.
              </ThemedText>
            </>
          ) : context ? (
            <ThemedText type="small" themeColor="textSecondary">
              About: {context}
            </ThemedText>
          ) : null}
          <TextField
            label="What happened?"
            value={body}
            onChangeText={setBody}
            placeholder="In your own words"
            multiline
            maxLength={5000}
          />
          <TextField
            label="Who is it about? (optional)"
            value={aboutText}
            onChangeText={(text) => {
              setAboutText(text);
              setAboutId(null);
            }}
            placeholder="A name, or a description"
            maxLength={300}
          />
          {matches.length > 0 ? (
            <ChipGroup
              options={matches.map((p) => ({ value: p.id, label: p.name }))}
              selected={[]}
              onToggle={(id) => {
                setAboutId(id);
                setAboutText(people.find((p) => p.id === id)?.name ?? '');
              }}
            />
          ) : null}
          <TextField
            label="When did it happen? (optional)"
            value={happened}
            onChangeText={setHappened}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <ChipGroup
            label="Is a child’s safety involved?"
            options={involvesOptions.map((v) => ({ value: v, label: involvesChildLabels[v] }))}
            selected={[involves]}
            onToggle={setInvolves}
          />
          <ChipGroup
            label="Your name"
            options={[
              { value: 'show', label: 'Show my name' },
              { value: 'hide', label: 'Don’t show my name' },
            ]}
            selected={[anonymous ? 'hide' : 'show']}
            onToggle={(v) => setAnonymous(v === 'hide')}
          />
          {anonymous ? (
            <ThemedText type="small" themeColor="textSecondary">
              The people who look into it won’t see who you are, so they can’t ask you more. The app
              still keeps it with your account, so you can see where it’s up to.
            </ThemedText>
          ) : (
            <>
              <ChipGroup
                label="Can they contact you about it?"
                options={[
                  { value: 'yes', label: 'Yes' },
                  { value: 'no', label: 'No' },
                ]}
                selected={[contactOk ? 'yes' : 'no']}
                onToggle={(v) => setContactOk(v === 'yes')}
              />
              {contactOk ? (
                <TextField
                  label="Best way to reach you (optional)"
                  value={contactDetails}
                  onChangeText={setContactDetails}
                  placeholder="Phone number, or a good time to call"
                  maxLength={300}
                />
              ) : null}
            </>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title="Send to the club" onPress={send} busy={busy} />
        </View>
      )}

      {mine.length > 0 ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Concerns you’ve raised</ThemedText>
          {mine.map((c) => (
            <Card key={c.id}>
              <ThemedText type="small">
                {localDay(c.created_at)}
                {c.about_text ? ` · ${c.about_text}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {concernStatusLabels[c.status]}
                {c.anonymous ? ' · your name not shown' : ''}
              </ThemedText>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
