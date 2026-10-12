import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { volunteerExemptionLabels } from '@/lib/safety';
import { supabase } from '@/lib/supabase';

/**
 * A volunteer an admin exempted from the Working With Children Check reads
 * and accepts the declaration that goes with it. Their coach, manager or
 * physio role starts once they do. Afterwards it shows what they accepted.
 */
export default function DeclarationScreen() {
  const { exemption, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!exemption) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          You don’t have a volunteer exemption. A club admin records one if you volunteer without a
          Working With Children Check.
        </ThemedText>
      </Screen>
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('accept_volunteer_declaration');
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
      <ThemedText type="smallBold">{volunteerExemptionLabels[exemption.basis]}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {exemption.basis === 'parent_volunteer'
          ? 'In WA a parent who volunteers at the club their child is in doesn’t need a Working With Children Check, and can’t apply for one.'
          : 'In WA a volunteer under 18 doesn’t need a Working With Children Check, and can’t apply for one.'}{' '}
        A club admin has recorded that for you. The club keeps this declaration as its record.
      </ThemedText>
      <Card>
        <ThemedText type="small">{exemption.declaration_text}</ThemedText>
      </Card>
      {exemption.declared_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          You accepted this on {localDay(exemption.declared_at)}.
          {exemption.valid && exemption.ends_on
            ? ` It applies until ${formatDate(exemption.ends_on)}.`
            : ''}
          {!exemption.valid
            ? ' It no longer applies, so you need a Working With Children Check.'
            : ''}
        </ThemedText>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          <Button title="I agree" onPress={accept} busy={busy} />
          <ThemedText type="small" themeColor="textSecondary">
            If any of this isn’t true, don’t agree. Talk to a club admin instead.
          </ThemedText>
        </>
      )}
    </Screen>
  );
}
