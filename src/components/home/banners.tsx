/**
 * The notices and single screens that used to sit at the top of the one Home
 * screen: paused roles, checks falling due, and what someone sees while they
 * wait to be approved or run Studio only. Their wording hasn't changed.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChildCodeCard, WaitingForGuardian } from '@/components/guardian-link';
import { NoAppChildCard } from '@/components/no-app-child';
import { SafeguardingContactsCard } from '@/components/safeguarding';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { pausedReason, waitsOnDeclaration } from '@/lib/home-labels';
import { rejectionReasonMessages, rolesLabel } from '@/lib/labels';
import { committeeCheckDue, statisticianCheckDue } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import { canSendOwnCheck, submissionStatusText } from '@/lib/wwcc-submissions';

/** Roles the member holds but can't use: an expired check or a stand-down. */
export function PausedRoles() {
  const { profile, paused } = useAuth();
  if (!paused) return null;
  const roles = rolesLabel(paused.roles);
  const what = `${roles.toLowerCase()} ${paused.roles.length > 1 ? 'roles are' : 'role is'}`;
  const canSend =
    canSendOwnCheck(profile, paused.roles) &&
    !waitsOnDeclaration(paused.exemption, paused.application);
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">{roles} paused</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {pausedReason(paused, what)}
      </ThemedText>
      {canSend ? <SendOwnCheck /> : null}
    </Card>
  );
}

/**
 * Where the member's own card is up to, with the button to send it: waiting
 * for an admin, sent back with a note, or not sent yet.
 */
export function SendOwnCheck() {
  const { wwccSubmission: submission } = useAuth();
  return (
    <>
      {submission ? (
        <ThemedText type="small">{submissionStatusText(submission)}</ThemedText>
      ) : null}
      <Button
        title={
          !submission
            ? 'Add your card'
            : submission.status === 'returned'
              ? 'Send it again'
              : 'Change what you sent'
        }
        variant={submission?.status === 'waiting' ? 'secondary' : 'primary'}
        onPress={() => router.push('/wwcc')}
      />
    </>
  );
}

/**
 * A committee member who kept their role without a check: from the club's
 * committee checks date it pauses unless they have one or are exempt.
 */
export function CommitteeCheckDue() {
  const { profile, committeeChecksFrom } = useAuth();
  if (!profile || !committeeCheckDue(profile, committeeChecksFrom)) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">
        Your committee role needs a Working With Children Check from{' '}
        {formatDate(committeeChecksFrom)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your committee role pauses on that day unless a check is recorded. Apply for one, then add
        your card below for a club admin to check. If you never work with children, ask an admin to
        exempt you with the reason.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

/**
 * Home for someone whose only role is Studio: what the role does, and that
 * HQ has nothing else for them.
 */
export function StudioOnly({ paused }: { paused: boolean }) {
  return (
    <Card>
      <ThemedText type="smallBold">
        {paused ? 'Your Studio role is paused' : 'You can show this club’s live game stats'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {paused
          ? 'A club admin has stood you down, so FirstPass Studio can’t read this club’s stats until they lift it.'
          : 'Sign in to this club from FirstPass Studio with this Google account. Studio can then read the stats the club records for its PlayHQ games, live and finished, to show on streams. Athletes under 18 are only named with their own stats when a parent or guardian has agreed; otherwise Studio shows team totals. Studio can’t change anything, and you won’t see the club’s members, squads, calendar or messages.'}
      </ThemedText>
    </Card>
  );
}

/**
 * A statistician who kept their role without a check: from the club's
 * statistician checks date it pauses unless they have one or are exempt.
 */
export function StatisticianCheckDue() {
  const { profile, statisticianChecksFrom } = useAuth();
  if (!profile || !statisticianCheckDue(profile, statisticianChecksFrom)) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">
        Your statistician role needs a Working With Children Check from{' '}
        {formatDate(statisticianChecksFrom)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your statistician role pauses on that day, in HQ and in Vantage, unless a check is
        recorded. Apply for one, then add your card below for a club admin to check. If you only
        record opens games and never work with children, ask an admin to exempt you with the
        reason.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

/**
 * An admin whose check expired or is missing for over 30 days: they keep
 * every admin power, but don't see under 18s' injuries until it's sorted.
 */
export function AdminChildInjuriesClosed() {
  const { isAdmin } = useAuth();
  const [closed, setClosed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setClosed(false);
        return;
      }
      supabase.rpc('my_admin_sees_children_injuries').then(({ data }) => setClosed(data === false));
    }, [isAdmin]),
  );
  if (!closed) return null;
  return (
    <Card style={styles.pausedCard}>
      <ThemedText type="smallBold">You can’t see under 18s’ injuries right now</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Your Working With Children Check expired or isn’t recorded, and it’s been over 30 days. You
        keep everything else an admin can do. Add your current card below for another admin to
        check, or ask them to record an application you’ve lodged, and you’ll see children’s
        injuries again.
      </ThemedText>
      <SendOwnCheck />
    </Card>
  );
}

export function JoinStatus() {
  const { profile, waitingForGuardian } = useAuth();

  if (profile?.status === 'rejected') {
    return (
      <Card>
        <ThemedText type="smallBold">Request not approved</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {profile.rejection_reason
            ? rejectionReasonMessages[profile.rejection_reason]
            : 'Your request to join was not approved. Check your details and try again, or show a club admin the code below.'}
        </ThemedText>
        <VerificationCode />
        <View style={styles.cardAction}>
          <Button title="Request again" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  if (!profile?.join_requested_at) {
    return (
      <Card>
        <ThemedText type="smallBold">Request to join the club</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tell us who you are so an admin can approve you and, if you play, coach or manage, add
          you to your squad or team.
        </ThemedText>
        <View style={styles.cardAction}>
          <Button title="Request to join" onPress={() => router.push('/join')} />
        </View>
      </Card>
    );
  }

  // A child under 18 asking to join, with a link code for their parent or guardian.
  const child = !!waitingForGuardian;
  const guardian = profile.requested_role === 'guardian';

  return (
    <>
      <Card>
        <ThemedText type="smallBold">Waiting for approval</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {guardian
            ? 'A club admin checks who you are and that you’re your child’s parent or guardian, then approves you, which links you to them. Pull down to check again.'
            : profile.requested_role === 'committee' || profile.requested_role === 'guest'
              ? 'A club admin will approve your request. Pull down to check again.'
              : 'A club admin will approve your request and add you to your squad or team. Pull down to check again.'}
        </ThemedText>
        {profile.verified_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            ✓ A club admin has confirmed who you are.
          </ThemedText>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              If an admin can’t match you to your PlayHQ registration, they may ask for this code in
              person or over a channel they already trust. Never share it with anyone else.
            </ThemedText>
            <VerificationCode />
          </>
        )}
        <View style={styles.cardAction}>
          <Button title="Edit request" variant="secondary" onPress={() => router.push('/join')} />
        </View>
      </Card>
      {guardian ? <ChildCodeCard /> : null}
      {guardian ? <NoAppChildCard /> : null}
      {child ? <WaitingForGuardian /> : null}
      {child ? (
        <ThemedText type="small" themeColor="textSecondary">
          If anything worries you, these people can help:
        </ThemedText>
      ) : null}
      {child ? <SafeguardingContactsCard /> : null}
    </>
  );
}

/** The member's 6-digit code, which an admin enters to confirm who they are. */
export function VerificationCode() {
  const theme = useTheme();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('my_verification_code').then(({ data }) => setCode(data as string | null));
  }, []);

  if (!code) return null;
  return (
    <View style={styles.code} accessibilityLabel={`Your code is ${code.split('').join(' ')}`}>
      <ThemedText type="small" themeColor="textSecondary">
        Your code
      </ThemedText>
      <ThemedText type="title" style={[styles.codeDigits, { color: theme.accent }]} selectable>
        {code.slice(0, 3)} {code.slice(3)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pausedCard: { gap: Spacing.two },
  code: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  codeDigits: {
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  cardAction: {
    marginTop: Spacing.two,
  },
});
