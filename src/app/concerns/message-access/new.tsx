import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { type ConcernPerson, matchPeople } from '@/lib/concerns';
import { toDateString } from '@/lib/injuries';
import {
  ACCESS_HOURS,
  defaultRange,
  linkLabels,
  MAX_DAYS,
  type MessageAccessLink,
  type MessageAccessPerson,
  requestProblem,
} from '@/lib/message-access';
import { supabase } from '@/lib/supabase';

/** How many people to offer while searching for someone else involved. */
const PERSON_MATCHES = 5;

/**
 * The Child Safety Officer or Complaints Manager asks to read one member's
 * messages for a concern. An admin who isn't involved answers it.
 */
export default function NewMessageAccessScreen() {
  const { concern: concernId, reference } = useLocalSearchParams<{
    concern: string;
    reference?: string;
  }>();
  const [named, setNamed] = useState<MessageAccessPerson[]>([]);
  const [everyone, setEveryone] = useState<ConcernPerson[]>([]);
  // 'other', or the link and person for someone named on the concern, such
  // as 'about:<id>' (a concern can be about several people).
  const [choice, setChoice] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [{ from, to }, setRange] = useState<{
    from: string | null;
    to: string | null;
  }>(defaultRange());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [namedResult, everyoneResult] = await Promise.all([
        supabase.rpc('message_access_people', { p_concern_id: concernId }),
        supabase.rpc('concern_about_people'),
      ]);
      setNamed((namedResult.data as MessageAccessPerson[] | null) ?? []);
      setEveryone((everyoneResult.data as ConcernPerson[] | null) ?? []);
    })();
  }, [concernId]);

  const linkOptions = [
    ...named.map((p) => ({
      value: `${p.link}:${p.profile_id}`,
      label: `${linkLabels[p.link]}: ${p.name}`,
    })),
    { value: 'other', label: linkLabels.other },
  ];
  const link: MessageAccessLink | null =
    choice === null ? null : (choice.split(':')[0] as MessageAccessLink);
  const matches = link === 'other' ? matchPeople(everyone, search, PERSON_MATCHES) : [];
  const chosenOther = link === 'other' ? everyone.find((p) => p.id === subjectId) : undefined;

  function chooseLink(next: string) {
    setChoice(next);
    setSearch('');
    setSubjectId(
      next === 'other'
        ? null
        : (named.find((p) => `${p.link}:${p.profile_id}` === next)?.profile_id ?? null),
    );
  }

  async function send() {
    const problem = requestProblem({ subjectId, from, to, reason });
    if (problem || !link) {
      setError(problem ?? 'Say how this person is involved in the concern');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('request_message_access', {
      p_concern_id: concernId,
      p_subject_id: subjectId,
      p_link: link,
      p_from: from,
      p_to: to,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.replace({
      pathname: '/concerns/message-access/[id]',
      params: { id: data as string },
    });
  }

  const today = toDateString(new Date());

  return (
    <Screen>
      <Card>
        <ThemedText type="smallBold">
          {reference ? `For concern ${reference}` : 'For this concern'}
        </ThemedText>
        <ThemedText type="small">
          An admin who isn’t involved answers your request. If they approve it, you can read this
          person’s messages from the dates you choose for {ACCESS_HOURS} hours, on your own account
          only. Every message you open is recorded. Nobody else is told: not the person, their
          parents or the committee.
        </ThemedText>
      </Card>

      <View style={styles.group}>
        <ChipGroup
          label="Whose messages"
          options={linkOptions}
          selected={choice ? [choice] : []}
          onToggle={chooseLink}
        />
        {link === 'other' ? (
          <>
            <TextField
              label="Search members"
              value={search}
              onChangeText={setSearch}
              placeholder="Name"
            />
            {matches.length > 0 ? (
              <ChipGroup
                options={matches.map((p) => ({ value: p.id, label: p.name }))}
                selected={subjectId ? [subjectId] : []}
                onToggle={setSubjectId}
              />
            ) : null}
            {chosenOther ? (
              <ThemedText type="small" themeColor="textSecondary">
                {chosenOther.name}. Say in the reason how they’re involved.
              </ThemedText>
            ) : null}
          </>
        ) : null}
      </View>

      <DateField
        label="From"
        value={from}
        onChange={(value) => setRange({ from: value, to })}
        quickPicks={[
          { label: '30 days ago', days: -30 },
          { label: '90 days ago', days: -MAX_DAYS },
        ]}
        max={today}
      />
      <DateField
        label="To"
        value={to}
        onChange={(value) => setRange({ from, to: value })}
        quickPicks={[{ label: 'Today', days: 0 }]}
        max={today}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Up to {MAX_DAYS} days at a time. Ask again for more.
      </ThemedText>

      <TextField
        label="Why you need to read them"
        value={reason}
        onChangeText={setReason}
        placeholder="What you’re checking. Leave out the concern’s details: the admin sees only its reference."
        multiline
        maxLength={1000}
      />

      <ErrorText>{error}</ErrorText>
      <Button title="Send to an admin" onPress={send} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
