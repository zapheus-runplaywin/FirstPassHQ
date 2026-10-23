import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Affiliation, type Officer, type ReturnInfo } from '@/lib/affiliation';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import type { ClubPolicies } from '@/lib/consents';
import { toDateString } from '@/lib/injuries';
import type { Report } from '@/lib/pdf';
import { loadCourses, loadWwccData } from '@/lib/report-data';
import {
  affiliationReturn,
  integrityReport,
  localDay,
  memberName,
  wwccReport,
  type ReturnSafeguarding,
} from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { currentSeason } from '@/lib/training';
import type { SafeguardingContacts } from '@/lib/types';
import { seasonLabel, useTeams } from '@/lib/use-teams';

type Data = {
  affiliation: Affiliation;
  officers: Officer[];
  info: ReturnInfo | null;
  contacts: { name: string; email: string | null }[];
  safeguarding: ReturnSafeguarding;
  wwcc: Report['stats'];
  training: { season: string; stats: Report['stats'] };
};

/**
 * The yearly affiliation return: the club's affiliation records and counts,
 * shown as it will be sent, with a button that sends it as a PDF.
 */
export default function AffiliationReturnScreen() {
  const { committeeChecksFrom, statisticianChecksFrom } = useAuth();
  const club = useClub();
  const teams = useTeams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [includeWwcc, setIncludeWwcc] = useState(true);
  const [includeTraining, setIncludeTraining] = useState(true);
  const theme = useTheme();
  const trainingSeason = currentSeason(teams.map((t) => t.season));

  const load = useCallback(async () => {
    try {
      const [settings, officers, info, safeguarding, policies, wwccData, training] =
        await Promise.all([
          supabase.rpc('admin_affiliation').maybeSingle(),
          supabase.rpc('admin_affiliation_officers'),
          supabase.rpc('admin_affiliation_return').maybeSingle(),
          supabase.rpc('safeguarding_contacts').maybeSingle(),
          supabase.rpc('club_policies').maybeSingle(),
          loadWwccData(),
          loadCourses(trainingSeason),
        ]);
      if (settings.error) throw new Error(settings.error.message);
      const affiliation = settings.data as Affiliation;
      const contacts = [affiliation.primary_contact_1_id, affiliation.primary_contact_2_id]
        .map((id) => wwccData.members.find((m) => m.id === id))
        .filter((m) => !!m)
        .map((m) => ({ name: memberName(m), email: m.email }));
      setData({
        affiliation,
        officers: (officers.data as Officer[] | null) ?? [],
        info: info.data as ReturnInfo | null,
        contacts,
        safeguarding: {
          contacts: safeguarding.data as SafeguardingContacts | null,
          policies: policies.data as ClubPolicies | null,
          wwcOfficerName: wwccData.officerName,
        },
        wwcc: wwccReport(
          wwccData.members,
          wwccData.placements,
          teams,
          wwccData.standDowns,
          wwccData.exemptions,
          wwccData.notices,
          wwccData.officerName,
          wwccData.acknowledgements,
          committeeChecksFrom,
          wwccData.applications,
          statisticianChecksFrom,
        ).stats,
        training: {
          season: seasonLabel(trainingSeason),
          stats: integrityReport(
            seasonLabel(trainingSeason),
            training.courses,
            toDateString(new Date()),
          ).stats,
        },
      });
      setError(training.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The return didn’t load. Try again.');
    }
  }, [committeeChecksFrom, statisticianChecksFrom, teams, trainingSeason]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const email = data?.info?.return_email ?? null;

  async function onShared() {
    if (!data || !email) return;
    const { error: logError } = await supabase.rpc('admin_log_affiliation_return', {
      p_season: data.affiliation.season,
    });
    if (logError) throw new Error(logError.message);
    if (Platform.OS === 'web') {
      const subject = `Affiliation return from ${club.name}`;
      const body = `Hello,\n\nPlease find ${club.name}’s affiliation return attached.\n\nThanks`;
      await Linking.openURL(
        `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      );
    }
    setNotice(
      Platform.OS === 'web'
        ? 'The PDF downloaded and an email opened. Attach the PDF, then send it.'
        : `Make sure it went to ${email}.`,
    );
    await load();
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="small" themeColor="textSecondary">
        A yearly summary for your association or Netball WA: the club’s affiliation records,
        safeguarding set-up and counts. It names no member under 18 and has nothing about any
        child. This is exactly what will be sent.
      </ThemedText>
      {data && !email ? (
        <PressableCard onPress={() => router.push('/admin/affiliation')}>
          <ThemedText type="smallBold">Add where returns go</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Enter your association’s email under Affiliation, then come back to send.
          </ThemedText>
        </PressableCard>
      ) : null}
      {data?.info?.last_sent_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last sent {localDay(data.info.last_sent_at)}
          {data.info.last_sent_by_name ? ` by ${data.info.last_sent_by_name}` : ''} to{' '}
          {data.info.last_sent_to}.
        </ThemedText>
      ) : null}
      {data
        ? [
            {
              label: 'Working With Children Check counts',
              value: includeWwcc,
              set: setIncludeWwcc,
            },
            { label: 'Integrity training counts', value: includeTraining, set: setIncludeTraining },
          ].map((option) => (
            <Card key={option.label} style={styles.row}>
              <View style={styles.grow}>
                <ThemedText type="smallBold">{option.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {option.value ? 'In the return' : 'Left out'}
                </ThemedText>
              </View>
              <Switch
                accessibilityLabel={option.label}
                value={option.value}
                onValueChange={option.set}
                trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                thumbColor={theme.text}
                {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
              />
            </Card>
          ))
        : null}
      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      {data ? (
        <ReportView
          report={affiliationReturn({
            clubName: club.name,
            affiliation: data.affiliation,
            officers: data.officers,
            contacts: data.contacts,
            safeguarding: data.safeguarding,
            wwcc: includeWwcc ? data.wwcc : null,
            training: includeTraining ? data.training : null,
          })}
          action={{
            title: 'Send return',
            disabled: !email,
            note: !email
              ? 'Add the email address returns go to first.'
              : Platform.OS === 'web'
                ? `Downloads the PDF and opens an email to ${email}. Attach the PDF before you send.`
                : `Opens the share sheet. Choose Mail and send it to ${email}.`,
            onShared,
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
