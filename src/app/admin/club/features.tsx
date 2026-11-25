import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LoadMonitoringSettings } from '@/components/load-monitoring-settings';
import { Screen } from '@/components/screen';
import { SettingSwitch } from '@/components/setting-switch';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { FEATURES, useClub, type FeatureKey } from '@/lib/club';
import { SAVED_NOTICE, saveClubProfile, savedLook } from '@/lib/club-settings';
import {
  checkInsOffNote,
  injuriesOffWarning,
  liveStreamsOffNote,
  openInjuryCounts,
} from '@/lib/feature-switches';
import {
  AUDIENCES,
  loadPilot,
  pilotFeaturesToSave,
  pilotGroupOptions,
  pilotSummary,
  savePilot,
} from '@/lib/pilot';
import { supabase } from '@/lib/supabase';
import type { InjuryStatus } from '@/lib/types';
import { useTeams } from '@/lib/use-teams';

/**
 * Administration > Club features: which features are on, who sees each one
 * (everyone or pilot teams only), the squads and teams in the pilot, and the
 * training load flags while training load is on.
 */
export default function ClubFeaturesScreen() {
  const club = useClub();
  const saved = club.profile;

  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(club.features);
  /** Features that are on for pilot teams only, and the squads and teams in the pilot. */
  const [pilotOnly, setPilotOnly] = useState<FeatureKey[]>([]);
  const [pilotTeams, setPilotTeams] = useState<string[]>([]);
  const teams = useTeams();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fill the form once, from the latest saved settings.
  useEffect(() => {
    club.reload().finally(() => setLoaded(true));
    loadPilot().then((pilot) => {
      setPilotOnly(pilot.features);
      setPilotTeams(pilot.teamIds);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filledFrom, setFilledFrom] = useState<typeof saved | undefined>(undefined);
  if (loaded && filledFrom !== saved) {
    setFilledFrom(saved);
    setFeatures(club.features);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    // The name, colours, logo and squads switch go back as saved: this page doesn't change them.
    const saveError = await saveClubProfile(savedLook(saved), features, club.squads);
    if (saveError) {
      setSaving(false);
      setError(saveError);
      return;
    }
    const pilotError = await savePilot(pilotFeaturesToSave(features, pilotOnly), pilotTeams);
    if (pilotError) {
      setSaving(false);
      setError(pilotError);
      return;
    }
    await club.reload();
    setSaving(false);
    setNotice(SAVED_NOTICE);
  }

  const summary = pilotSummary(pilotFeaturesToSave(features, pilotOnly), pilotTeams);

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Turned-off features disappear from everyone’s app, including the tabs and to-dos.
        Nothing is deleted, so turning one back on brings its records back. A feature that’s on
        can show for everyone or only for pilot teams, to try it with one team first.
      </ThemedText>

      <View style={styles.section}>
        <ThemedText type="smallBold">Features</ThemedText>
        {FEATURES.map((f) => (
          <Card key={f.key} style={styles.featureCard}>
            <View style={styles.featureRow}>
              <View style={styles.featureText}>
                <ThemedText type="smallBold">{f.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {f.detail}
                </ThemedText>
              </View>
              <SettingSwitch
                label={f.label}
                value={features[f.key]}
                onValueChange={(on) => setFeatures({ ...features, [f.key]: on })}
              />
            </View>
            {club.features[f.key] && !features[f.key] ? <FeatureOffNote feature={f.key} /> : null}
            {features[f.key] ? (
              <View accessibilityLabel={`Who sees ${f.label}`}>
                <ChipGroup
                  options={AUDIENCES}
                  selected={[pilotOnly.includes(f.key) ? 'pilot' : 'everyone']}
                  onToggle={(audience) =>
                    setPilotOnly(
                      audience === 'pilot'
                        ? [...pilotOnly.filter((k) => k !== f.key), f.key]
                        : pilotOnly.filter((k) => k !== f.key),
                    )
                  }
                />
              </View>
            ) : null}
          </Card>
        ))}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Pilot squads and teams</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Choose who tries features set to Pilot teams only. A squad brings its teams with it.
          Admins and committee always see them, so they can help.
        </ThemedText>
        {teams.length ? (
          <ChipGroup
            options={pilotGroupOptions(teams)}
            selected={pilotTeams}
            onToggle={(id) =>
              setPilotTeams(
                pilotTeams.includes(id) ? pilotTeams.filter((t) => t !== id) : [...pilotTeams, id],
              )
            }
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Add squads or teams first: in the Club tab, under People.
          </ThemedText>
        )}
        {summary ? (
          <ThemedText type="small" themeColor="textSecondary">
            {summary}
          </ThemedText>
        ) : null}
      </View>

      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save club features" onPress={save} busy={saving} />

      {club.features.checkIns && club.features.trainingLoad ? <LoadMonitoringSettings /> : null}
    </Screen>
  );
}

/**
 * Shown under a switch an admin has just turned off, before they save: what
 * turning it off does to work already under way.
 */
function FeatureOffNote({ feature }: { feature: FeatureKey }) {
  const [counts, setCounts] = useState<{ open: number; clearances: number } | null>(null);
  useEffect(() => {
    if (feature !== 'injuries') return;
    let current = true;
    supabase.rpc('visible_injuries').then(({ data }) => {
      if (current) setCounts(openInjuryCounts((data as { status: InjuryStatus }[] | null) ?? []));
    });
    return () => {
      current = false;
    };
  }, [feature]);
  const text =
    feature === 'injuries'
      ? injuriesOffWarning(counts)
      : feature === 'checkIns'
        ? checkInsOffNote
        : feature === 'liveStreams'
          ? liveStreamsOffNote
          : null;
  if (!text) return null;
  return (
    <ThemedText type="small" themeColor={feature === 'injuries' ? 'tint' : 'textSecondary'}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  featureCard: {
    gap: Spacing.two,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  featureText: {
    flex: 1,
    gap: Spacing.half,
  },
});
