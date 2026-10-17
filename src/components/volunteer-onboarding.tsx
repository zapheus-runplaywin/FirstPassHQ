import { router } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PolicyLinks } from '@/components/policy-links';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/check-ins';
import { useClubPolicies } from '@/lib/consents';
import { localDay } from '@/lib/reports';
import { exemptionStatus, volunteerExemptionLabels, wwccStatus } from '@/lib/safety';
import { supabase } from '@/lib/supabase';

/**
 * A temporary helper's home: the steps before they can help, and where
 * each is up to. Volunteers see none of the club's features, so this is all
 * their home shows besides Raise a concern.
 */
export function VolunteerOnboarding({ verificationCode }: { verificationCode: ReactNode }) {
  const { profile, exemption } = useAuth();
  const policies = useClubPolicies();
  // When they accepted the club's current policies; null if they haven't.
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped after they accept, to read it back.
  const [reload, setReload] = useState(0);
  const profileId = profile?.id;
  const version = policies?.policy_version;

  useEffect(() => {
    if (!profileId || !version) return;
    supabase
      .from('policy_acknowledgements')
      .select('acknowledged_at')
      .eq('profile_id', profileId)
      .eq('policy_version', version)
      .maybeSingle()
      .then(({ data }) => setAcknowledgedAt(data?.acknowledged_at ?? null));
  }, [profileId, version, reload]);

  if (!profile) return null;

  async function acknowledge() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('acknowledge_club_policies');
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReload((n) => n + 1);
  }

  const approved = profile.status === 'approved';
  const from = profile.volunteer_from;
  const until = profile.volunteer_until;
  const finished = approved && !!until && until < today();
  const dates = from && until ? `${formatDate(from)} to ${formatDate(until)}` : null;
  const card = wwccStatus(profile);
  const cardCurrent = card.kind === 'current' || card.kind === 'expiring';

  if (finished) {
    return (
      <Card>
        <ThemedText type="smallBold">Thanks for helping</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your time as a temporary helper finished on {formatDate(until)}. If you’re helping
          again, ask a club admin to change your dates.
        </ThemedText>
      </Card>
    );
  }

  return (
    <Card>
      <ThemedText type="smallBold">
        {approved ? 'You’re approved to help' : 'Before you help'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {approved
          ? 'Thanks for helping. This is the record the club keeps of how you were cleared.'
          : 'Every adult helping with children needs to be cleared by the club first. Do these, then a club admin approves you.'}
      </ThemedText>

      <Step done={!!profile.volunteer_task && !!dates} title="Your details">
        <ThemedText type="small" themeColor="textSecondary">
          {profile.volunteer_task ?? 'What you’ll help with'}
          {dates ? `, ${dates}` : ''}.
        </ThemedText>
        {!approved ? (
          <Button title="Edit" variant="secondary" onPress={() => router.push('/join')} />
        ) : null}
      </Step>

      <Step done={!!profile.verified_at} title="Who you are">
        {profile.verified_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            A club admin has confirmed who you are.
          </ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              A club admin may ask for this code in person. Never share it with anyone else.
            </ThemedText>
            {verificationCode}
          </>
        )}
      </Step>

      <Step
        done={cardCurrent || (!!exemption?.declared_at && (exemption.valid || !!exemption.starts_on))}
        title="Working With Children Check">
        {cardCurrent ? (
          <ThemedText type="small" themeColor="textSecondary">
            Your card is recorded. It expires {formatDate(profile.wwcc_expires_on)}.
          </ThemedText>
        ) : exemption ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {exemption.declared_at
                ? `${exemptionStatus(exemption).label}.`
                : `A club admin has recorded a ${volunteerExemptionLabels[exemption.basis].toLowerCase()} exemption for you. Read the declaration, and agree if it’s true.`}
            </ThemedText>
            {!exemption.declared_at ? (
              <Button title="Read the declaration" onPress={() => router.push('/declaration')} />
            ) : null}
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {profile.volunteer_screening === 'card'
              ? `A club admin will check card ${profile.declared_wwcc_number ?? ''} online.`
              : profile.volunteer_screening === 'none'
                ? 'You need a WA Working With Children Check before you help. Apply at workingwithchildren.wa.gov.au and tell a club admin when it arrives.'
                : 'A club admin will record your exemption. Then you’ll accept a declaration here.'}
          </ThemedText>
        )}
      </Step>

      <Step done={!!acknowledgedAt} title="Club policies">
        {acknowledgedAt ? (
          <ThemedText type="small" themeColor="textSecondary">
            You accepted the club’s code of conduct and child safeguarding policy on{' '}
            {localDay(acknowledgedAt)}.
          </ThemedText>
        ) : acknowledgedAt === null ? (
          <>
            <PolicyLinks intro="Read the club’s policies:" />
            <ThemedText type="small" themeColor="textSecondary">
              I’ve read the club’s code of conduct and child safeguarding policy, and I’ll follow
              them. I’ll tell the club’s Child Safety Officer about anything that worries me about
              a child’s safety, and call 000 if a child is in danger.
            </ThemedText>
            <ErrorText>{error}</ErrorText>
            <Button title="I agree" onPress={acknowledge} busy={busy} />
          </>
        ) : null}
      </Step>

      <Step done={approved} title="Approved by a club admin">
        <ThemedText type="small" themeColor="textSecondary">
          {approved
            ? `For ${dates ?? 'your dates'}.`
            : 'Once your check or exemption covers all your dates. Pull down to check again.'}
        </ThemedText>
      </Step>
    </Card>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <View style={styles.step}>
      <ThemedText type="smallBold" themeColor={done ? 'textSecondary' : 'text'}>
        {done ? '✓' : '○'} {title}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: Spacing.one, paddingTop: Spacing.two },
});
