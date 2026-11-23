import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { PolicyLinks } from '@/components/policy-links';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { crashReportsOn, reportCrash } from '@/lib/crash-reports';
import { canHoldTitle, staffTitle } from '@/lib/labels';
import { shareableLog } from '@/lib/log';
import { openNotificationSettings, useTodoNotifications } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { hasRole, rolesOf } from '@/lib/roles';
import { wwccStatus } from '@/lib/safety';
import { isGuest, submissionStatusText } from '@/lib/wwcc-submissions';

export default function MyDetailsScreen() {
  const { profile, memberships, refresh, wwccSubmission, paused } = useAuth();
  const [preferredName, setPreferredName] = useState(profile?.preferred_name ?? '');
  const [title, setTitle] = useState(profile?.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTitle = profile?.status === 'approved' && canHoldTitle(rolesOf(profile));
  const groupTitle = profile?.status === 'approved' ? staffTitle(memberships) : '';
  const coaches = memberships.some((m) => m.team_role === 'coach');
  const isAthlete =
    profile?.status === 'approved' &&
    (hasRole(profile, 'athlete') || memberships.some((m) => m.team_role === 'athlete'));

  async function save() {
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('save_my_details', {
      p_preferred_name: preferredName,
      p_title: hasTitle ? title : null,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await refresh();
    router.back();
  }

  return (
    <Screen>
      <TextField
        label="Preferred name"
        value={preferredName}
        onChangeText={setPreferredName}
        placeholder={profile?.full_name ?? undefined}
        autoComplete="name-given"
        textContentType="nickname"
        maxLength={40}
      />
      <ThemedText type="small" themeColor="textSecondary">
        What you like to be called. The app greets you by it. Leave it blank to use your name
        {profile?.full_name ? `, ${profile.full_name}` : ''}.
      </ThemedText>

      {hasTitle ? (
        <>
          <TextField
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="President, Secretary, Treasurer…"
            autoCapitalize="words"
            maxLength={40}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Your position at the club, shown with your role. Leave it blank if you don’t hold
            one.
          </ThemedText>
        </>
      ) : null}

      {groupTitle ? (
        <View style={styles.groupTitle}>
          <ThemedText type="smallBold">{hasTitle ? 'Team title' : 'Title'}</ThemedText>
          <ThemedText>{groupTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Set by the app from the teams you coach or manage, or your squad if you’re not in a
            team yet.{coaches ? ' A club admin can change whether you’re a head or assistant coach.' : ''}
          </ThemedText>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={saving} />

      {isAthlete && profile ? (
        <PressableCard
          onPress={() => router.push({ pathname: '/medical/[id]', params: { id: profile.id } })}>
          <ThemedText type="smallBold">Medical and emergency details</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Emergency contacts, allergies, conditions, medications and an action plan for your
            coaches, managers and physios
          </ThemedText>
        </PressableCard>
      ) : null}
      {profile?.status === 'approved' && isGuest(profile, paused?.roles) ? (
        <PressableCard onPress={() => router.push('/wwcc')}>
          <ThemedText type="smallBold">Working With Children Check (optional)</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {wwccSubmission
              ? submissionStatusText(wwccSubmission, true)
              : ['current', 'expiring'].includes(wwccStatus(profile).kind)
                ? `Card ${profile.wwcc_number} recorded. Tap to send in a new one.`
                : 'Guests don’t need one. If you have a card, add it here: the club needs a current check before it can name you Child Safety Officer or Complaints Manager.'}
          </ThemedText>
        </PressableCard>
      ) : null}
      {profile?.status === 'approved' ? <Notifications /> : null}
      {Platform.OS !== 'web' ? <AppLog /> : null}
      <PolicyLinks intro="The club’s policies:" />
    </Screen>
  );
}

/** The to-do notification switch. It saves as soon as it's changed. */
function Notifications() {
  const theme = useTheme();
  const { on, permission, save } = useTodoNotifications();
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setError(null);
    try {
      await save(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save that. Try again.');
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Notifications</ThemedText>
      <Card style={styles.row}>
        <View style={styles.rowText}>
          <ThemedText type="smallBold">To-do notifications</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A notification on your phone when something new is on your to-do list. None are sent
            between 8 pm and 7 am.
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel="To-do notifications"
          value={on ?? true}
          disabled={on === null}
          onValueChange={change}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.text}
          {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
        />
      </Card>
      {on && permission === 'denied' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Your phone is blocking notifications from this app. Allow them in your phone’s
            settings.
          </ThemedText>
          <Button title="Open phone settings" variant="secondary" onPress={openNotificationSettings} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/**
 * "Send app log": the phone's share sheet with the newest part of the app's
 * own log (src/lib/log.ts), for when support asks for it. The log keeps
 * names, emails, health details and tokens out.
 */
function AppLog() {
  const { isAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);

  // For an admin to check crash reports reach Sentry (docs/beta-builds.md, "Crash reports").
  function sendTestReport() {
    reportCrash(new Error('Test crash report from Your details'));
    setTestSent(true);
  }

  async function send() {
    setError(null);
    setBusy(true);
    try {
      const file = shareableLog();
      if (!file) {
        setError('There’s no app log on this phone yet.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        UTI: 'public.plain-text',
        dialogTitle: 'App log',
      });
    } catch {
      setError('Couldn’t open the share sheet. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Help with a problem</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        If the app isn’t working as it should, send its log to whoever is helping you, such as by
        email. The log notes what the app did on this phone, and the app keeps names, emails,
        health details and passwords out of it. It goes only where you send it.
      </ThemedText>
      <Button title="Send app log" variant="secondary" onPress={send} busy={busy} />
      <ErrorText>{error}</ErrorText>
      {isAdmin && crashReportsOn() ? (
        <>
          <Button title="Send a test crash report" variant="secondary" onPress={sendTestReport} />
          {testSent ? (
            <ThemedText type="small" themeColor="textSecondary">
              Sent. It shows in Sentry within a few minutes, as “Test crash report from Your
              details”.
            </ThemedText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.one,
  },
  groupTitle: {
    gap: Spacing.half,
  },
});
