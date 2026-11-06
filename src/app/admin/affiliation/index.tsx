import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { PersonPicker } from '@/components/person-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, isMinor, parseDate } from '@/lib/age';
import {
  affiliationCriteria,
  registrationsToCheck,
  type Affiliation,
  type ReturnInfo,
} from '@/lib/affiliation';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { seasonLabel } from '@/lib/use-teams';

/**
 * The club's affiliation record for its member association: its details,
 * primary contacts and a checklist of Netball WA's criteria for affiliated
 * clubs.
 */
export default function AffiliationScreen() {
  const theme = useTheme();
  const [saved, setSaved] = useState<Affiliation | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [incorporation, setIncorporation] = useState('');
  const [affiliatedWith, setAffiliatedWith] = useState('');
  const [registeredOn, setRegisteredOn] = useState('');
  const [contact1, setContact1] = useState<string | null>(null);
  const [contact2, setContact2] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [returnInfo, setReturnInfo] = useState<ReturnInfo | null>(null);
  const [returnEmail, setReturnEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [settingsResult, peopleResult, returnResult] = await Promise.all([
      supabase.rpc('admin_affiliation').maybeSingle(),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').order('full_name'),
      supabase.rpc('admin_affiliation_return').maybeSingle(),
    ]);
    if (settingsResult.error) {
      setError(settingsResult.error.message);
      return;
    }
    const a = settingsResult.data as Affiliation | null;
    setSaved(a);
    setIncorporation(a?.incorporation_number ?? '');
    setAffiliatedWith(a?.affiliated_with ?? '');
    setRegisteredOn(formatDate(a?.registered_on));
    setContact1(a?.primary_contact_1_id ?? null);
    setContact2(a?.primary_contact_2_id ?? null);
    setChecks(a?.checks ?? {});
    setNotes(a?.notes ?? '');
    const info = returnResult.data as ReturnInfo | null;
    setReturnInfo(info);
    setReturnEmail(info?.return_email ?? '');
    // The same rule as the database: approved adults who aren't stood down.
    setPeople(
      ((peopleResult.data as Profile[] | null) ?? []).filter(
        (p) => !p.stood_down_at && !isMinor(p.date_of_birth, p.under_17),
      ),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // The checklist follows what's on screen, so it updates before saving.
  const criteria = saved
    ? affiliationCriteria(
        {
          incorporation_number: incorporation,
          affiliated_with: affiliatedWith,
          registered_on: parseDate(registeredOn) ?? null,
          primary_contact_1_id: contact1,
          primary_contact_2_id: contact2,
          checks,
          team_count: saved.team_count,
        },
      )
    : [];
  const missing = criteria.filter((c) => c.need === 'required' && !c.met).length;

  async function save() {
    setError(null);
    setNotice(null);
    const registered = parseDate(registeredOn);
    if (registered === undefined) {
      setError('Enter the day the club registered as DD/MM/YYYY.');
      return;
    }
    setBusy(true);
    const { error: saveError } = await supabase.rpc('admin_set_affiliation', {
      p_incorporation_number: incorporation,
      p_affiliated_with: affiliatedWith,
      p_registered_on: registered,
      p_primary_contact_1_id: contact1,
      p_primary_contact_2_id: contact2,
      p_checks: checks,
      p_notes: notes,
    });
    let failed = saveError?.message ?? null;
    if (!failed && returnEmail.trim() !== (returnInfo?.return_email ?? '')) {
      const { error: emailError } = await supabase.rpc('admin_set_affiliation_return_email', {
        p_email: returnEmail,
      });
      failed = emailError?.message ?? null;
    }
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    await load();
    setNotice('Saved.');
  }

  const toCheck = saved ? registrationsToCheck(saved) : 0;

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Keep the records your member association and Netball WA ask for each year. The checklist
        follows Netball WA’s Membership Policy for affiliated clubs. Only admins see this.
      </ThemedText>


      <View style={styles.group}>
        <ThemedText type="smallBold">Details</ThemedText>
        <TextField
          label="Incorporation number"
          value={incorporation}
          onChangeText={setIncorporation}
          placeholder="Blank if not incorporated"
          autoCapitalize="characters"
          maxLength={60}
        />
        <TextField
          label="Affiliated with"
          value={affiliatedWith}
          onChangeText={setAffiliatedWith}
          placeholder="Your member association"
          maxLength={120}
        />
        <TextField
          label="Last registered with them (DD/MM/YYYY)"
          value={registeredOn}
          onChangeText={setRegisteredOn}
          placeholder="DD/MM/YYYY"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <TextField
          label="Send affiliation returns to (email)"
          value={returnEmail}
          onChangeText={setReturnEmail}
          placeholder="Your association’s affiliations email"
          keyboardType="email-address"
          autoCapitalize="none"
          maxLength={200}
        />
        {saved ? (
          <ThemedText type="small" themeColor="textSecondary">
            {saved.season
              ? `${saved.team_count} ${saved.team_count === 1 ? 'team' : 'teams'} in ${seasonLabel(saved.season)}.`
              : 'No squads or teams yet.'}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold">Primary contacts</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Two adults the association and Netball WA can contact about the club. Their names and
          emails go in the affiliation return, so let them know.
        </ThemedText>
        <PersonPicker
          label="Primary contact 1"
          people={people.filter((p) => p.id !== contact2)}
          selected={contact1}
          onChange={setContact1}
        />
        <PersonPicker
          label="Primary contact 2"
          people={people.filter((p) => p.id !== contact1)}
          selected={contact2}
          onChange={setContact2}
        />
      </View>

      {saved ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Checklist</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {missing === 0
              ? 'Every required item is done.'
              : `${missing} required ${missing === 1 ? 'item' : 'items'} still to do. Tick the ones the app can’t see.`}
          </ThemedText>
          {criteria.map((c) => (
            <Card key={c.key} style={styles.row}>
              <View style={styles.grow}>
                <ThemedText type="smallBold">
                  {c.manual ? '' : c.met ? '✓ ' : '✗ '}
                  {c.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {[c.need === 'required' ? 'Required' : 'Recommended', c.detail]
                    .filter(Boolean)
                    .join(' · ')}
                </ThemedText>
              </View>
              {c.manual ? (
                <Switch
                  accessibilityLabel={c.label}
                  value={c.met}
                  onValueChange={(on) => setChecks({ ...checks, [c.key]: on })}
                  trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                  thumbColor={theme.text}
                  {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
                />
              ) : null}
            </Card>
          ))}
        </View>
      ) : null}

      {saved?.season ? (
        <PressableCard onPress={() => router.push('/admin/affiliation/registrations')}>
          <ThemedText type="smallBold">PlayHQ registrations {seasonLabel(saved.season)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {saved.registrations_total === 0
              ? 'Nobody is in a squad or team yet'
              : `${saved.registered} of ${saved.registrations_total} registered${
                  saved.not_registered ? ` · ${saved.not_registered} not registered` : ''
                }${toCheck ? ` · ${toCheck} to check` : ''}`}
          </ThemedText>
        </PressableCard>
      ) : null}

      <PressableCard onPress={() => router.push('/admin/affiliation/return')}>
        <ThemedText type="smallBold">Affiliation return</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {returnInfo?.last_sent_at
            ? `Last sent ${localDay(returnInfo.last_sent_at)}${
                returnInfo.last_sent_by_name ? ` by ${returnInfo.last_sent_by_name}` : ''
              } to ${returnInfo.last_sent_to}`
            : 'A yearly summary for your association, as a PDF. None sent yet'}
        </ThemedText>
      </PressableCard>

      <TextField
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        placeholder="For example, where the evidence is kept"
        multiline
        maxLength={2000}
      />

      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save" onPress={save} busy={busy} />
      {saved?.updated_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last saved {localDay(saved.updated_at)}
          {saved.updated_by_name ? ` by ${saved.updated_by_name}` : ''}.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1, gap: Spacing.half },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
