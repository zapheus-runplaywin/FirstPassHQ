import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { PersonPicker } from '@/components/person-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { wwccStatus } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { ClubPolicies } from '@/lib/consents';
import type { Profile, SafeguardingContacts, VolunteerExemption } from '@/lib/types';

/**
 * The club's Child Safety Officer and Complaints Manager, who see and act on
 * concerns members raise, and the governing body's contact details and the
 * club's safeguarding policy, shown wherever a concern can be raised.
 */
export default function SafeguardingScreen() {
  const [eligible, setEligible] = useState<Profile[]>([]);
  const [officer, setOfficer] = useState<string | null>(null);
  const [manager, setManager] = useState<string | null>(null);
  const [wwcOfficer, setWwcOfficer] = useState<string | null>(null);
  const [savedWwcOfficer, setSavedWwcOfficer] = useState<string | null>(null);
  const [bodyName, setBodyName] = useState('');
  const [bodyPhone, setBodyPhone] = useState('');
  const [bodyUrl, setBodyUrl] = useState('');
  const [policyUrl, setPolicyUrl] = useState('');
  const [minorPhotos, setMinorPhotos] = useState(false);
  const [physioOnly, setPhysioOnly] = useState(false);
  const [concussionDays, setConcussionDays] = useState<'21' | '12'>('21');
  const [conductEachSeason, setConductEachSeason] = useState(false);
  const [committeeFrom, setCommitteeFrom] = useState<string | null>(null);
  const [savedCommitteeFrom, setSavedCommitteeFrom] = useState<string | null>(null);
  const [privacyUrl, setPrivacyUrl] = useState('');
  const [conductUrl, setConductUrl] = useState('');
  const [policyVersion, setPolicyVersion] = useState('1');
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [
      contactsResult,
      membersResult,
      exemptionsResult,
      photosResult,
      policiesResult,
      wwcOfficerResult,
      conductResult,
      committeeFromResult,
      injuryRulesResult,
    ] = await Promise.all([
      supabase.rpc('safeguarding_contacts').maybeSingle(),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').order('full_name'),
      supabase.rpc('admin_volunteer_exemptions'),
      supabase.rpc('safeguarding_photo_setting'),
      supabase.rpc('club_policies').maybeSingle(),
      supabase.rpc('admin_wwc_officer').maybeSingle(),
      supabase.rpc('conduct_each_season_setting'),
      supabase.rpc('committee_checks_from'),
      supabase.rpc('injury_rules').maybeSingle(),
    ]);
    const officerId = (wwcOfficerResult.data as { officer_id: string } | null)?.officer_id ?? null;
    setWwcOfficer(officerId);
    setSavedWwcOfficer(officerId);
    const policies = policiesResult.data as ClubPolicies | null;
    setPrivacyUrl(policies?.privacy_policy_url ?? '');
    setConductUrl(policies?.code_of_conduct_url ?? '');
    setPolicyVersion(policies?.policy_version ?? '1');
    setMinorPhotos(photosResult.data === true);
    const rules = injuryRulesResult.data as {
      physio_only_endorsement: boolean;
      concussion_min_days: number;
    } | null;
    setPhysioOnly(rules?.physio_only_endorsement === true);
    setConcussionDays(rules?.concussion_min_days === 12 ? '12' : '21');
    setConductEachSeason(conductResult.data === true);
    const from = typeof committeeFromResult.data === 'string' ? committeeFromResult.data : null;
    setCommitteeFrom(from);
    setSavedCommitteeFrom(from);
    const contacts = contactsResult.data as SafeguardingContacts | null;
    setOfficer(contacts?.child_safety_officer_id ?? null);
    setManager(contacts?.complaints_manager_id ?? null);
    setBodyName(contacts?.governing_body_name ?? '');
    setBodyPhone(contacts?.governing_body_phone ?? '');
    setBodyUrl(contacts?.governing_body_url ?? '');
    setPolicyUrl(contacts?.policy_url ?? '');
    const exempt = new Set(
      ((exemptionsResult.data as VolunteerExemption[] | null) ?? [])
        .filter((e) => !e.ended_at && e.valid)
        .map((e) => e.profile_id),
    );
    // The same rule as the database: approved adults, not stood down, screened.
    setEligible(
      ((membersResult.data as Profile[] | null) ?? []).filter((m) => {
        const check = wwccStatus(m).kind;
        return (
          !isMinor(m.date_of_birth, m.under_17) &&
          !m.stood_down_at &&
          !hasRole(m, 'guest', 'volunteer') &&
          (check === 'current' || check === 'expiring' || exempt.has(m.id))
        );
      }),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function save() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_safeguarding', {
      p_child_safety_officer_id: officer,
      p_complaints_manager_id: manager,
      p_governing_body_name: bodyName,
      p_governing_body_phone: bodyPhone,
      p_governing_body_url: bodyUrl,
      p_policy_url: policyUrl,
    });
    const { error: photosError } = rpcError
      ? { error: null }
      : await supabase.rpc('admin_set_minor_injury_photos', { p_allowed: minorPhotos });
    const { error: policiesError } =
      rpcError || photosError
        ? { error: null }
        : await supabase.rpc('admin_set_policies', {
            p_privacy_policy_url: privacyUrl,
            p_code_of_conduct_url: conductUrl,
            p_policy_version: policyVersion,
          });
    const { error: conductError } =
      rpcError || photosError || policiesError
        ? { error: null }
        : await supabase.rpc('admin_set_conduct_each_season', { p_on: conductEachSeason });
    const { error: injuryError } =
      rpcError || photosError || policiesError || conductError
        ? { error: null }
        : await supabase.rpc('admin_set_injury_rules', {
            p_physio_only_endorsement: physioOnly,
            p_concussion_min_days: Number(concussionDays),
          });
    // The WWC Registration Officer and committee checks date go last, as they
    // can change who manages these settings.
    const { error: officerError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      wwcOfficer === savedWwcOfficer
        ? { error: null }
        : await supabase.rpc('admin_set_wwc_officer', { p_profile_id: wwcOfficer });
    const { error: committeeError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      officerError ||
      !committeeFrom ||
      committeeFrom === savedCommitteeFrom
        ? { error: null }
        : await supabase.rpc('admin_set_committee_checks_from', { p_date: committeeFrom });
    const failed =
      rpcError ??
      photosError ??
      policiesError ??
      conductError ??
      injuryError ??
      officerError ??
      committeeError;
    setBusy(false);
    if (failed) {
      setError(failed.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Members can raise a concern from their home screen, the check-in screen, injuries and
        messages. The Child Safety Officer, the Complaints Manager and admins see every concern,
        except one about themselves. Choose two different people, each an adult with a current
        Working With Children Check, so a concern about one can go to the other.
      </ThemedText>
      <PersonPicker
        label="Child Safety Officer"
        people={eligible}
        selected={officer}
        onChange={setOfficer}
      />
      <PersonPicker
        label="Complaints Manager"
        people={eligible}
        selected={manager}
        onChange={setManager}
      />

      <PersonPicker
        label="WWC Registration Officer"
        people={eligible.filter((m) => hasRole(m, 'admin', 'committee'))}
        selected={wwcOfficer}
        onChange={setWwcOfficer}
      />
      <ThemedText type="small" themeColor="textSecondary">
        An admin or committee member who keeps the club’s Working With Children Check records,
        registers members’ cards with the club through the Screening Unit and receives its notices.
        Shown on the Working With Children Checks report.
      </ThemedText>

      {savedCommitteeFrom ? (
        <View style={styles.group}>
          <DateField
            label="Committee checks required from"
            value={committeeFrom}
            onChange={setCommitteeFrom}
            quickPicks={[{ label: 'Today', days: 0 }]}
            max={savedCommitteeFrom}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Committee members approved before checks were needed keep their role until this day
            without one. From then, a committee member with no check and no exemption has their
            committee role paused. You can bring the date forward but not push it back; exempt
            anyone who never works with children, with the reason, on their member page.
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.group}>
        <ThemedText type="smallBold">Governing body</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Shown to everyone raising a concern. Child abuse and serious crimes go to Police and the
          governing body straight away.
        </ThemedText>
        <TextField
          label="Name"
          value={bodyName}
          onChangeText={setBodyName}
          placeholder="For example, your state association"
          maxLength={100}
        />
        <TextField
          label="Phone or hotline"
          value={bodyPhone}
          onChangeText={setBodyPhone}
          keyboardType="phone-pad"
          maxLength={30}
        />
        <TextField
          label="Complaints form link"
          value={bodyUrl}
          onChangeText={setBodyUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={500}
        />
      </View>
      <View style={styles.group}>
        <ThemedText type="smallBold">Club policies</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Links to policies hosted on your club’s website. They show on Join, Your details and
          where parents give consent. The user guide (section 12) links to templates to adapt.
        </ThemedText>
        <TextField
          label="Child safeguarding policy (link)"
          value={policyUrl}
          onChangeText={setPolicyUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={500}
        />
        <TextField
          label="Privacy policy (link)"
          value={privacyUrl}
          onChangeText={setPrivacyUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={500}
        />
        <TextField
          label="Code of conduct (link)"
          value={conductUrl}
          onChangeText={setConductUrl}
          placeholder="https://"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={500}
        />
        <TextField
          label="Policy version"
          value={policyVersion}
          onChangeText={setPolicyVersion}
          placeholder="For example, 2026-1"
          maxLength={30}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Each parent’s consent, and each code of conduct acceptance, is kept with the version in
          force at the time.
        </ThemedText>
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold">Code of conduct each season</ThemedText>
        <Card style={styles.switchRow}>
          <ThemedText type="small" style={styles.grow}>
            Ask every member to accept the code of conduct once a season
          </ThemedText>
          <Switch
            accessibilityLabel="Ask every member to accept the code of conduct once a season"
            value={conductEachSeason}
            onValueChange={setConductEachSeason}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            thumbColor={theme.text}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          />
        </Card>
        <ThemedText type="small" themeColor="textSecondary">
          Off by default. Leave it off if members already sign your code of conduct another way,
          such as in their PlayHQ registration. When it’s on and the code of conduct is linked
          above, it goes on every member’s to-do list each season, and a verified parent or
          guardian accepts it for an under 18.
        </ThemedText>
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold">Photos of under 18s’ injuries</ThemedText>
        <Card style={styles.switchRow}>
          <ThemedText type="small" style={styles.grow}>
            Allow a verified parent or guardian to add a photo of their child’s injury, after they
            confirm their consent
          </ThemedText>
          <Switch
            accessibilityLabel="Allow photos of under 18s’ injuries"
            value={minorPhotos}
            onValueChange={setMinorPhotos}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            thumbColor={theme.text}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          />
        </Card>
        <ThemedText type="small" themeColor="textSecondary">
          Off by default, so under 18s attach the physio’s or doctor’s letter as a PDF. Athletes
          under 18 can never add a photo themselves.
        </ThemedText>
      </View>

      <View style={styles.group}>
        <ThemedText type="smallBold">Injury clearances</ThemedText>
        <Card style={styles.switchRow}>
          <ThemedText type="small" style={styles.grow}>
            Only physios endorse clearances
          </ThemedText>
          <Switch
            accessibilityLabel="Only physios endorse clearances"
            value={physioOnly}
            onValueChange={setPhysioOnly}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            thumbColor={theme.text}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          />
        </Card>
        <ThemedText type="small" themeColor="textSecondary">
          Off by default, so an athlete’s coach or a physio endorses a return to play. Turn it on
          only if every squad and team has a physio, or the club has a Head Physio, or clearances
          will wait. A suspected concussion always needs a physio.
        </ThemedText>
        <ChipGroup
          label="Concussion: earliest return"
          options={[
            { value: '21', label: '21 days' },
            { value: '12', label: '12 days (elite program)' },
          ]}
          selected={[concussionDays]}
          onToggle={(value) => setConcussionDays(value)}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Netball Australia sets at least 21 days before a return after concussion for community
          and pathway netball, and 12 at elite level, with a doctor’s clearance either way.
        </ThemedText>
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
