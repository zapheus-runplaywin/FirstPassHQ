import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { SettingSwitch } from '@/components/setting-switch';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import { SAVED_NOTICE, saveClubProfile, savedLook } from '@/lib/club-settings';
import { supabase } from '@/lib/supabase';

/**
 * Administration > Club options: how the club is set up, apart from its look
 * and features. Whether members join a squad first, and whether physios get
 * messages sent to the whole club.
 */
export default function ClubOptionsScreen() {
  const club = useClub();
  const saved = club.profile;

  const [squads, setSquads] = useState(club.squads);
  /** Whether physios get messages sent to the whole club. Off unless an admin turns it on. */
  const [physioMessages, setPhysioMessages] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fill the form once, from the latest saved settings.
  useEffect(() => {
    club.reload().finally(() => setLoaded(true));
    supabase
      .rpc('physios_get_club_messages')
      .then(({ data }) => setPhysioMessages(data === true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filledFrom, setFilledFrom] = useState<typeof saved | undefined>(undefined);
  if (loaded && filledFrom !== saved) {
    setFilledFrom(saved);
    setSquads(club.squads);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    // The name, colours, logo and feature switches go back as saved: this page doesn't change them.
    const saveError = await saveClubProfile(savedLook(saved), club.features, squads);
    if (saveError) {
      setSaving(false);
      setError(saveError);
      return;
    }
    const { error: physioError } = await supabase.rpc('admin_set_physios_get_club_messages', {
      p_on: physioMessages,
    });
    if (physioError) {
      setSaving(false);
      setError(physioError.message);
      return;
    }
    await club.reload();
    setSaving(false);
    setNotice(SAVED_NOTICE);
  }

  return (
    <Screen>
      <View style={styles.section}>
        <ThemedText type="smallBold">Squads</ThemedText>
        <Card style={styles.row}>
          <View style={styles.rowText}>
            <ThemedText type="smallBold">Members join a squad first</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {squads
                ? 'New members join a squad. At selections, admins name teams from it with final team athletes and training partners.'
                : 'Members join a team straight away, as a final team athlete or training partner. There are no squads.'}
            </ThemedText>
          </View>
          <SettingSwitch label="Members join a squad first" value={squads} onValueChange={setSquads} />
        </Card>
        {squads !== club.squads ? (
          <ThemedText type="small" themeColor="textSecondary">
            {squads
              ? 'From now on, new teams are named from a squad. Teams you already have keep their members.'
              : 'Squads you already have stay until the season ends, and nobody is moved. From now on you add teams on their own, and the next season starts with this season’s teams.'}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Physios</ThemedText>
        <Card style={styles.row}>
          <View style={styles.rowText}>
            <ThemedText type="smallBold">Physios get club messages</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Physios always get messages sent to Physios and to the squads and teams they’re
              in. Turn this on to also send them messages sent to everyone in the club.
            </ThemedText>
          </View>
          <SettingSwitch
            label="Physios get club messages"
            value={physioMessages}
            onValueChange={setPhysioMessages}
          />
        </Card>
      </View>

      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save club options" onPress={save} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
});
