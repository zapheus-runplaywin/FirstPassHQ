import { router } from 'expo-router';
import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';

/**
 * A member who has applied for a Working With Children Check reads and
 * accepts the declaration that lets the application count as their check
 * while it's assessed. Their coach, manager, physio or committee role starts
 * once they do. Afterwards it shows what they accepted.
 */
export default function WwccApplicationScreen() {
  const { wwccApplication: application, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!application) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          You don’t have a Working With Children Check application recorded. Once you’ve applied,
          show a club admin the receipt and they’ll record it.
        </ThemedText>
      </Screen>
    );
  }

  async function accept() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('accept_wwcc_application_declaration');
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
      <ThemedText type="smallBold">Working With Children Check application</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        In WA you can start or keep doing child-related work while your application is assessed, as
        long as none of the things below applies. A club admin has recorded your application{' '}
        {application.application_number}, lodged {formatDate(application.lodged_on)}. The club keeps
        this declaration as its record.
      </ThemedText>
      <Card>
        <ThemedText type="small">{application.declaration_text}</ThemedText>
      </Card>
      {application.declared_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          You accepted this on {localDay(application.declared_at)}.
          {application.status === 'in_force'
            ? ' It counts as your check until your card arrives. Add your card from Today as soon as it does, for a club admin to check.'
            : application.status === 'lapsed'
              ? ' It has lapsed because nobody at the club confirmed it’s still being assessed. Ask a club admin to check it.'
              : ' It no longer counts. Talk to a club admin.'}
        </ThemedText>
      ) : application.status === 'stopped' ? (
        <ThemedText type="small" themeColor="textSecondary">
          A notice from the Screening Unit means this application doesn’t count. Talk to a club admin.
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
