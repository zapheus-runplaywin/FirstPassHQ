import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/check-ins';
import { localDay } from '@/lib/reports';
import { volunteerExemptionLabels } from '@/lib/safety';
import type { VolunteerExemptionBasis } from '@/lib/types';
import { supabase } from '@/lib/supabase';

/**
 * A volunteer an admin exempted from the Working With Children Check reads
 * and accepts the declaration that goes with it. Their coach, manager,
 * physio or temporary volunteer role starts once they do. Afterwards it shows
 * what they accepted.
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

  // A visitor or national event exemption can start on a later day.
  const notStarted = !!exemption.starts_on && exemption.starts_on > today();

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
        {exemptionIntro[exemption.basis]} A club admin has recorded that for you. The club keeps
        this declaration as its record.
      </ThemedText>
      <Card>
        <ThemedText type="small">{exemption.declaration_text}</ThemedText>
      </Card>
      {exemption.declared_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          You accepted this on {localDay(exemption.declared_at)}.
          {notStarted && exemption.starts_on && exemption.ends_on
            ? ` It applies from ${formatDate(exemption.starts_on)} to ${formatDate(exemption.ends_on)}.`
            : ''}
          {exemption.valid && exemption.ends_on
            ? ` It applies until ${formatDate(exemption.ends_on)}.`
            : ''}
          {!exemption.valid && !notStarted
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

/** Why the exemption applies to them, in WA. */
const exemptionIntro: Record<VolunteerExemptionBasis, string> = {
  parent_volunteer:
    'In WA a parent who volunteers at the club their child is in doesn’t need a Working With Children Check, and can’t apply for one.',
  under_18_volunteer:
    'In WA a volunteer under 18 doesn’t need a Working With Children Check, and can’t apply for one.',
  short_term_visitor:
    'In WA someone who doesn’t normally live in the state doesn’t need a Working With Children Check for the first two weeks after they arrive, once in any 12 months.',
  national_event:
    'In WA someone who doesn’t normally live in the state doesn’t need a Working With Children Check for up to 30 days at a national event or tour, once in any 12 months.',
};
