import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { formatDate, parseDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { canSendOwnCheck, isGuest, submissionStatusText } from '@/lib/wwcc-submissions';
import { supabase } from '@/lib/supabase';

/**
 * A member sends in their own Working With Children Check: the card number,
 * expiry and name on the card. A paused role stays paused until a club admin
 * checks the card with the Screening Unit and accepts it.
 */
export default function SendWwccScreen() {
  const { profile, paused, wwccSubmission: submission, refresh } = useAuth();
  const [number, setNumber] = useState(submission?.card_number ?? '');
  const [expires, setExpires] = useState(formatDate(submission?.expires_on));
  const [cardName, setCardName] = useState(submission?.card_name ?? profile?.full_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A guest's card is optional: no role waits on it.
  const optional = isGuest(profile, paused?.roles);

  if (!canSendOwnCheck(profile, paused?.roles)) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          {paused?.stoodDown
            ? 'A club admin has paused your roles. Talk to a club admin about it.'
            : 'Your roles at the club don’t need a Working With Children Check.'}
        </ThemedText>
      </Screen>
    );
  }

  async function send() {
    const expiresOn = parseDate(expires);
    if (!number.trim()) {
      setError('Enter the card number.');
      return;
    }
    if (!expiresOn) {
      setError('Enter the expiry date on the card as DD/MM/YYYY.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('submit_my_wwcc', {
      p_card_number: number,
      p_expires_on: expiresOn,
      p_card_name: cardName,
    });
    if (rpcError) {
      setBusy(false);
      setError(rpcError.message);
      return;
    }
    await refresh();
    setBusy(false);
    if (router.canGoBack()) router.back();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {optional
          ? 'Guests don’t need a Working With Children Check. If you have one, enter it as it appears on the card or on the Screening Unit’s website. A club admin checks it with the Screening Unit before it counts. The club needs a current check before it can name you Child Safety Officer or Complaints Manager.'
          : 'Enter your Working With Children Check card as it appears on the card or on the Screening Unit’s website. A club admin checks it with the Screening Unit before it counts, so a paused role stays paused until they accept it.'}
      </ThemedText>
      {submission ? (
        <Card>
          <ThemedText type="small">{submissionStatusText(submission, optional)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Sent {localDay(submission.submitted_at)}
            {submission.decided_at ? `, sent back ${localDay(submission.decided_at)}` : ''}.
          </ThemedText>
        </Card>
      ) : null}
      <TextField
        label="Card number"
        value={number}
        onChangeText={setNumber}
        placeholder="As on the card"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={30}
      />
      <TextField
        label="Expires"
        value={expires}
        onChangeText={setExpires}
        placeholder="DD/MM/YYYY"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <TextField
        label="Name on the card"
        value={cardName}
        onChangeText={setCardName}
        autoCapitalize="words"
        maxLength={120}
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={submission?.status === 'waiting' ? 'Send the corrected card' : 'Send to a club admin'}
        onPress={send}
        busy={busy}
      />
      {optional ? null : (
      <ThemedText type="small" themeColor="textSecondary">
        Still waiting for your card? Show a club admin your application receipt and they can record
        the application, which counts while it’s assessed. If you never work with children, ask a
        club admin whether you can be exempted, with the reason.
      </ThemedText>
      )}
    </Screen>
  );
}
