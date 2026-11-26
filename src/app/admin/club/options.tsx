import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { SettingSwitch } from '@/components/setting-switch';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import {
  NOT_LOADED_ERROR,
  saveClubProfile,
  SAVED_NOTICE,
  savedLook,
  useLatestClubSettings,
} from '@/lib/club-settings';
import { CLUB_TIME_ZONES, clubToday, timeZoneLabel } from '@/lib/club-time';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * Administration > Club options: how the club is set up, apart from its look
 * and features. Whether members join a squad first, whether physios get
 * messages sent to the whole club, and the club's time zone, which decides
 * the club's "today" everywhere.
 */
export default function ClubOptionsScreen() {
  const club = useClub();
  const saved = club.profile;

  const [squads, setSquads] = useState(club.squads);
  const [timeZone, setTimeZone] = useState(club.timeZone);
  /** Whether physios get messages sent to the whole club. Off unless an admin turns it on. */
  const [physioMessages, setPhysioMessages] = useState(false);
  const settings = useLatestClubSettings(club.reload);
  const loaded = settings !== 'loading';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The rest of the form, once; the club's settings load in useLatestClubSettings.
  useEffect(() => {
    supabase
      .rpc('physios_get_club_messages')
      .then(({ data }) => setPhysioMessages(data === true));
  }, []);
  const [filledFrom, setFilledFrom] = useState<typeof saved | undefined>(undefined);
  if (loaded && filledFrom !== saved) {
    setFilledFrom(saved);
    setSquads(club.squads);
    setTimeZone(club.timeZone);
  }
  // A zone saved some other way is still shown, so saving keeps it.
  const zones = CLUB_TIME_ZONES.some((z) => z.value === club.timeZone)
    ? CLUB_TIME_ZONES
    : [...CLUB_TIME_ZONES, { value: club.timeZone, label: timeZoneLabel(club.timeZone) }];

  async function save() {
    if (settings !== 'loaded') return;
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
    if (timeZone !== club.timeZone) {
      const { error: zoneError } = await supabase.rpc('admin_set_club_timezone', {
        p_timezone: timeZone,
      });
      if (zoneError) {
        setSaving(false);
        setError(zoneError.message);
        return;
      }
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

      <View style={styles.section}>
        <ThemedText type="smallBold">Time zone</ThemedText>
        <Card style={styles.zone}>
          <ThemedText type="small" themeColor="textSecondary">
            The club’s day starts at midnight here. It decides “today” everywhere in the app: check-ins,
            due dates, when cards and checks run out, birthdays, quiet hours for notifications and the
            dates on notices.
          </ThemedText>
          <ChipGroup
            label="Where the club is"
            options={zones.map((z) => ({ value: z.value, label: z.label.split(' (')[0] }))}
            selected={[timeZone]}
            onToggle={setTimeZone}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {timeZoneLabel(timeZone)}. Today there is {formatDateString(clubToday(new Date(), timeZone))}.
          </ThemedText>
        </Card>
      </View>

      <ErrorText>{settings === 'failed' ? NOT_LOADED_ERROR : error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save club options" onPress={save} busy={saving} disabled={settings !== 'loaded'} />
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
  zone: {
    gap: Spacing.two,
  },
});
