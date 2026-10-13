import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { PersonPicker } from '@/components/person-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, isMinor, parseDate } from '@/lib/age';
import {
  affiliationCriteria,
  memberTypeLabels,
  officeLabels,
  officesFor,
  registrationsToCheck,
  tierLabels,
  type Affiliation,
  type MemberType,
  type Office,
  type Officer,
  type Tier,
} from '@/lib/affiliation';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { seasonLabel } from '@/lib/use-teams';

type OfficerForm = { profileId: string | null; inductedOn: string };

/**
 * The club's affiliation record for its association or Netball WA: what kind
 * of member it is, its details, primary contacts, officers and a checklist
 * of the governing body's criteria.
 */
export default function AffiliationScreen() {
  const theme = useTheme();
  const [saved, setSaved] = useState<Affiliation | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [memberType, setMemberType] = useState<MemberType>('club');
  const [tier, setTier] = useState<Tier | null>(null);
  const [incorporation, setIncorporation] = useState('');
  const [affiliatedWith, setAffiliatedWith] = useState('');
  const [registeredOn, setRegisteredOn] = useState('');
  const [contact1, setContact1] = useState<string | null>(null);
  const [contact2, setContact2] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [officers, setOfficers] = useState<Partial<Record<Office, OfficerForm>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [settingsResult, officersResult, peopleResult] = await Promise.all([
      supabase.rpc('admin_affiliation').maybeSingle(),
      supabase.rpc('admin_affiliation_officers'),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').order('full_name'),
    ]);
    if (settingsResult.error) {
      setError(settingsResult.error.message);
      return;
    }
    const a = settingsResult.data as Affiliation | null;
    setSaved(a);
    setMemberType(a?.member_type ?? 'club');
    setTier(a?.tier ?? null);
    setIncorporation(a?.incorporation_number ?? '');
    setAffiliatedWith(a?.affiliated_with ?? '');
    setRegisteredOn(formatDate(a?.registered_on));
    setContact1(a?.primary_contact_1_id ?? null);
    setContact2(a?.primary_contact_2_id ?? null);
    setChecks(a?.checks ?? {});
    setNotes(a?.notes ?? '');
    setOfficers(
      Object.fromEntries(
        ((officersResult.data as Officer[] | null) ?? []).map((o) => [
          o.office,
          { profileId: o.profile_id, inductedOn: formatDate(o.inducted_on) },
        ]),
      ),
    );
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

  const offices = memberType === 'association' ? officesFor(tier) : [];
  // The checklist follows what's on screen, so it updates before saving.
  const criteria = saved
    ? affiliationCriteria(
        {
          member_type: memberType,
          tier,
          incorporation_number: incorporation,
          affiliated_with: affiliatedWith,
          registered_on: parseDate(registeredOn) ?? null,
          primary_contact_1_id: contact1,
          primary_contact_2_id: contact2,
          checks,
          team_count: saved.team_count,
        },
        offices
          .map((office) => ({ office, form: officers[office] }))
          .filter(({ form }) => !!form?.profileId)
          .map(({ office, form }) => ({
            office,
            profile_id: form!.profileId!,
            name: '',
            inducted_on: parseDate(form!.inductedOn) ?? null,
          })),
      )
    : [];
  const missing = criteria.filter((c) => c.need === 'required' && !c.met).length;

  function setOfficer(office: Office, change: Partial<OfficerForm>) {
    const current = officers[office] ?? { profileId: null, inductedOn: '' };
    setOfficers({ ...officers, [office]: { ...current, ...change } });
  }

  async function save() {
    setError(null);
    setNotice(null);
    const registered = parseDate(registeredOn);
    if (registered === undefined) {
      setError(
        memberType === 'club'
          ? 'Enter the day the club registered as DD/MM/YYYY.'
          : 'Enter the day the agreement was signed as DD/MM/YYYY.',
      );
      return;
    }
    for (const office of offices) {
      if (parseDate(officers[office]?.inductedOn ?? '') === undefined) {
        setError(`Enter the ${officeLabels[office]}’s induction date as DD/MM/YYYY.`);
        return;
      }
    }
    if (memberType === 'association' && !tier) {
      setError('Choose the association’s tier.');
      return;
    }
    setBusy(true);
    const { error: saveError } = await supabase.rpc('admin_set_affiliation', {
      p_member_type: memberType,
      p_tier: tier,
      p_incorporation_number: incorporation,
      p_affiliated_with: affiliatedWith,
      p_registered_on: registered,
      p_primary_contact_1_id: contact1,
      p_primary_contact_2_id: contact2,
      p_checks: checks,
      p_notes: notes,
    });
    let failed = saveError?.message ?? null;
    for (const office of failed ? [] : offices) {
      const form = officers[office];
      const { error: officerError } = await supabase.rpc('admin_set_affiliation_officer', {
        p_office: office,
        p_profile_id: form?.profileId ?? null,
        p_inducted_on: form?.profileId ? (parseDate(form.inductedOn) ?? null) : null,
      });
      if (officerError) {
        failed = `${officeLabels[office]}: ${officerError.message}`;
        break;
      }
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
        Keep the records your association or Netball WA asks for each year. The checklist follows
        Netball WA’s Membership Policy. Only admins see this.
      </ThemedText>

      <ChipGroup
        label="This club is"
        options={(['club', 'association'] as MemberType[]).map((value) => ({
          value,
          label: memberTypeLabels[value],
        }))}
        selected={[memberType]}
        onToggle={setMemberType}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {memberType === 'club'
          ? 'A club whose teams play in a member association’s competition.'
          : 'A member association or member entity of Netball WA, with affiliated clubs.'}
      </ThemedText>
      {memberType === 'association' ? (
        <ChipGroup
          label="Tier"
          options={([1, 2, 3, 4] as Tier[]).map((value) => ({
            value: String(value),
            label: tierLabels[value],
          }))}
          selected={tier ? [String(tier)] : []}
          onToggle={(value) => setTier(Number(value) as Tier)}
        />
      ) : null}

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
          placeholder={memberType === 'club' ? 'Your member association' : 'Netball WA'}
          maxLength={120}
        />
        <TextField
          label={
            memberType === 'club'
              ? 'Last registered with them (DD/MM/YYYY)'
              : 'Annual agreement signed (DD/MM/YYYY)'
          }
          value={registeredOn}
          onChangeText={setRegisteredOn}
          placeholder="DD/MM/YYYY"
          keyboardType="numbers-and-punctuation"
          maxLength={10}
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
          Two adults the association and Netball WA can contact about the club.
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

      {offices.length > 0 ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Officers</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Who holds each office, and the day they completed Sport Integrity Australia’s
            Safeguarding Children and Young People in Sport Induction.
          </ThemedText>
          {offices.map((office) => (
            <View key={office} style={styles.group}>
              <PersonPicker
                label={officeLabels[office]}
                people={people}
                selected={officers[office]?.profileId ?? null}
                onChange={(id) => setOfficer(office, { profileId: id })}
              />
              {officers[office]?.profileId ? (
                <TextField
                  label="Induction completed (DD/MM/YYYY)"
                  value={officers[office]?.inductedOn ?? ''}
                  onChangeText={(value) => setOfficer(office, { inductedOn: value })}
                  placeholder="Blank if not yet"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {saved ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Checklist</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {criteria.length === 0
              ? 'Choose the tier to see the checklist.'
              : missing === 0
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
