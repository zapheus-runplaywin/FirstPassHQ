import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { PolicyLinks } from '@/components/policy-links';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { canHoldTitle, staffTitle } from '@/lib/labels';
import { openNotificationSettings, useTodoNotifications } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { rolesOf } from '@/lib/roles';

export default function MyDetailsScreen() {
  const { profile, memberships, refresh } = useAuth();
  const [preferredName, setPreferredName] = useState(profile?.preferred_name ?? '');
  const [title, setTitle] = useState(profile?.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasTitle = profile?.status === 'approved' && canHoldTitle(rolesOf(profile));
  const groupTitle = profile?.status === 'approved' ? staffTitle(memberships) : '';

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
            team yet. A club admin can change whether you’re a head or assistant coach.
          </ThemedText>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={saving} />

      {profile?.status === 'approved' ? <Notifications /> : null}
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
