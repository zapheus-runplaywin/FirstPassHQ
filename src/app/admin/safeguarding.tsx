import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { PeoplePicker } from '@/components/people-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isMinor } from '@/lib/age';
import { PROFILE_COLUMNS } from '@/lib/auth';
import {
  type PickablePerson,
  withoutPerson,
  withPerson,
} from '@/lib/people-picker';
import { memberName } from '@/lib/reports';
import { hasRole } from '@/lib/roles';
import { wwccStatus } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type { ClubPolicies } from '@/lib/consents';
import type {
  Profile,
  SafeguardingContacts,
  VolunteerExemption,
  WwccApplication,
} from '@/lib/types';

/** The most people in each safeguarding post (the database's limit too). */
const MAX_PER_POST = 5;

/** Someone holding a post, from `admin_safeguarding_posts`. */
type PostHolder = {
  post: 'child_safety_officer' | 'complaints_manager' | 'wwc_officer';
  profile_id: string;
  name: string;
  can_act: boolean;
};

/** A holder as the picker shows them, noting one who can't act now. */
function holderPerson(h: PostHolder): PickablePerson {
  return { id: h.profile_id, name: h.name, note: h.can_act ? null : 'can’t act: no current check' };
}

/** Same people, in any order. */
function samePeople(a: PickablePerson[], b: PickablePerson[]) {
  return a.length === b.length && a.every((p) => b.some((q) => q.id === p.id));
}

/**
 * The club's Child Safety Officers and Complaints Managers, who see and act
 * on concerns members raise, and the governing body's contact details and the
 * club's safeguarding policy, shown wherever a concern can be raised. A
 * larger club can name up to 5 people in each post.
 */
export default function SafeguardingScreen() {
  const [eligible, setEligible] = useState<Profile[]>([]);
  const [officers, setOfficers] = useState<PickablePerson[]>([]);
  const [managers, setManagers] = useState<PickablePerson[]>([]);
  const [wwcOfficers, setWwcOfficers] = useState<PickablePerson[]>([]);
  const [savedWwcOfficers, setSavedWwcOfficers] = useState<PickablePerson[]>([]);
  const [bodyName, setBodyName] = useState('');
  const [bodyPhone, setBodyPhone] = useState('');
  const [bodyUrl, setBodyUrl] = useState('');
  const [policyUrl, setPolicyUrl] = useState('');
  const [minorPhotos, setMinorPhotos] = useState(false);
  const [physioOnly, setPhysioOnly] = useState(false);
  const [concussionDays, setConcussionDays] = useState<'21' | '12'>('21');
  const [committee, setCommittee] = useState<Profile[]>([]);
  const [injuryCommittee, setInjuryCommittee] = useState<InjuryCommittee>(WHOLE_COMMITTEE);
  const [savedInjuryCommittee, setSavedInjuryCommittee] =
    useState<InjuryCommittee>(WHOLE_COMMITTEE);
  const [conductEachSeason, setConductEachSeason] = useState(false);
  const [committeeFrom, setCommitteeFrom] = useState<string | null>(null);
  const [savedCommitteeFrom, setSavedCommitteeFrom] = useState<string | null>(null);
  const [statisticianFrom, setStatisticianFrom] = useState<string | null>(null);
  const [savedStatisticianFrom, setSavedStatisticianFrom] = useState<string | null>(null);
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
      postsResult,
      conductResult,
      committeeFromResult,
      injuryRulesResult,
      applicationsResult,
      statisticianFromResult,
      injuryCommitteeResult,
    ] = await Promise.all([
      supabase.rpc('safeguarding_contacts').maybeSingle(),
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('status', 'approved').order('full_name'),
      supabase.rpc('admin_volunteer_exemptions'),
      supabase.rpc('safeguarding_photo_setting'),
      supabase.rpc('club_policies').maybeSingle(),
      supabase.rpc('admin_safeguarding_posts'),
      supabase.rpc('conduct_each_season_setting'),
      supabase.rpc('committee_checks_from'),
      supabase.rpc('injury_rules').maybeSingle(),
      supabase.rpc('admin_wwcc_applications'),
      supabase.rpc('statistician_checks_from'),
      supabase.rpc('admin_injury_committee').maybeSingle(),
    ]);
    const holders = (postsResult.data as PostHolder[] | null) ?? [];
    const holding = (post: PostHolder['post']) =>
      holders.filter((h) => h.post === post).map(holderPerson);
    setOfficers(holding('child_safety_officer'));
    setManagers(holding('complaints_manager'));
    setWwcOfficers(holding('wwc_officer'));
    setSavedWwcOfficers(holding('wwc_officer'));
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
    const chosen = injuryCommitteeResult.data as { chosen: boolean; member_ids: string[] } | null;
    const choice: InjuryCommittee = {
      chosen: chosen?.chosen === true,
      memberIds: chosen?.member_ids ?? [],
    };
    setInjuryCommittee(choice);
    setSavedInjuryCommittee(choice);
    setConductEachSeason(conductResult.data === true);
    const from = typeof committeeFromResult.data === 'string' ? committeeFromResult.data : null;
    setCommitteeFrom(from);
    setSavedCommitteeFrom(from);
    const statsFrom =
      typeof statisticianFromResult.data === 'string' ? statisticianFromResult.data : null;
    setStatisticianFrom(statsFrom);
    setSavedStatisticianFrom(statsFrom);
    const contacts = contactsResult.data as SafeguardingContacts | null;
    setBodyName(contacts?.governing_body_name ?? '');
    setBodyPhone(contacts?.governing_body_phone ?? '');
    setBodyUrl(contacts?.governing_body_url ?? '');
    setPolicyUrl(contacts?.policy_url ?? '');
    const exempt = new Set(
      ((exemptionsResult.data as VolunteerExemption[] | null) ?? [])
        .filter((e) => !e.ended_at && e.valid)
        .map((e) => e.profile_id),
    );
    // A lodged check application in force counts as a check.
    for (const a of (applicationsResult.data as WwccApplication[] | null) ?? []) {
      if (!a.ended_at && a.status === 'in_force') exempt.add(a.profile_id);
    }
    const members = (membersResult.data as Profile[] | null) ?? [];
    // Admins see injuries as admins, whatever the choice.
    setCommittee(members.filter((m) => hasRole(m, 'committee') && !hasRole(m, 'admin')));
    // The same rule as the database: approved adults, not stood down, screened.
    setEligible(
      members.filter((m) => {
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
    const { error: rpcError } = await supabase.rpc('admin_set_safeguarding_contacts', {
      p_child_safety_officer_ids: officers.map((p) => p.id),
      p_complaints_manager_ids: managers.map((p) => p.id),
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
    const { error: injuryCommitteeError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      sameChoice(injuryCommittee, savedInjuryCommittee)
        ? { error: null }
        : await supabase.rpc('admin_set_injury_committee', {
            p_chosen: injuryCommittee.chosen,
            p_member_ids: injuryCommittee.memberIds,
          });
    // The WWC Registration Officers and committee checks date go last, as they
    // can change who manages these settings.
    const { error: officerError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      injuryCommitteeError ||
      samePeople(wwcOfficers, savedWwcOfficers)
        ? { error: null }
        : await supabase.rpc('admin_set_wwc_officers', {
            p_profile_ids: wwcOfficers.map((p) => p.id),
          });
    const { error: committeeError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      injuryCommitteeError ||
      officerError ||
      !committeeFrom ||
      committeeFrom === savedCommitteeFrom
        ? { error: null }
        : await supabase.rpc('admin_set_committee_checks_from', { p_date: committeeFrom });
    const { error: statisticianError } =
      rpcError ||
      photosError ||
      policiesError ||
      conductError ||
      injuryError ||
      injuryCommitteeError ||
      officerError ||
      committeeError ||
      !statisticianFrom ||
      statisticianFrom === savedStatisticianFrom
        ? { error: null }
        : await supabase.rpc('admin_set_statistician_checks_from', { p_date: statisticianFrom });
    const failed =
      rpcError ??
      photosError ??
      policiesError ??
      conductError ??
      injuryError ??
      injuryCommitteeError ??
      officerError ??
      committeeError ??
      statisticianError;
    setBusy(false);
    if (failed) {
      setError(failed.message);
      return;
    }
    router.back();
  }

  const choosable = eligible.map(asPickable);

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Members can raise a concern from their home screen, the check-in screen, injuries and
        messages. The Child Safety Officers, the Complaints Managers and admins see every concern,
        except one about themselves. Name each an adult with a current Working With Children
        Check. A larger club can name up to {MAX_PER_POST} people in each post. Nobody can hold
        both posts, so a concern about one person can always go to another.
      </ThemedText>
      <PeoplePicker
        label="Child Safety Officer"
        people={choosable.filter((p) => !managers.some((m) => m.id === p.id))}
        selected={officers}
        onAdd={(p) => setOfficers((list) => withPerson(list, p))}
        onRemove={(p) => setOfficers((list) => withoutPerson(list, p.id))}
        max={MAX_PER_POST}
        placeholder="Name or email"
      />
      <PeoplePicker
        label="Complaints Manager"
        people={choosable.filter((p) => !officers.some((o) => o.id === p.id))}
        selected={managers}
        onAdd={(p) => setManagers((list) => withPerson(list, p))}
        onRemove={(p) => setManagers((list) => withoutPerson(list, p.id))}
        max={MAX_PER_POST}
        placeholder="Name or email"
      />

      <PeoplePicker
        label="WWC Registration Officer"
        hint="An admin or committee member who keeps the club’s Working With Children Check records, registers members’ cards with the club through the Screening Unit and receives its notices. Shown on the Working With Children Checks report."
        people={eligible.filter((m) => hasRole(m, 'admin', 'committee')).map(asPickable)}
        selected={wwcOfficers}
        onAdd={(p) => setWwcOfficers((list) => withPerson(list, p))}
        onRemove={(p) => setWwcOfficers((list) => withoutPerson(list, p.id))}
        max={MAX_PER_POST}
        placeholder="Name or email"
      />

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
            anyone who never works with children, with the reason, on their member page. An admin
            with no check stops seeing under 18s’ injuries 30 days after this day, until a check,
            an application or a parent volunteer exemption is recorded.
          </ThemedText>
        </View>
      ) : null}

      {savedStatisticianFrom ? (
        <View style={styles.group}>
          <DateField
            label="Statistician checks required from"
            value={statisticianFrom}
            onChange={setStatisticianFrom}
            quickPicks={[{ label: 'Today', days: 0 }]}
            max={savedStatisticianFrom}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Statisticians approved before they needed a check keep their role until this day
            without one. From then, a statistician with no check, application or exemption has
            their statistician role paused, in HQ and in Vantage. You can bring the date forward
            but not push it back; exempt a statistician who never works with children, such as one
            who only records opens games, with the reason, on their member page.
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

      <View style={styles.group}>
        <ChipGroup
          label="Injuries are seen by"
          options={[
            { value: 'whole', label: 'Whole committee' },
            { value: 'chosen', label: 'Chosen committee members' },
          ]}
          selected={[injuryCommittee.chosen ? 'chosen' : 'whole']}
          onToggle={(value) => setInjuryCommittee((c) => ({ ...c, chosen: value === 'chosen' }))}
        />
        <ThemedText type="small" themeColor="textSecondary">
          The whole committee by default. Choose members to keep injuries to the few who need them,
          such as the president and whoever looks after player welfare. Committee members left out
          don’t see injuries or sign off returns to play. A chosen member sees an under 18’s
          injuries only with a check, an application in force or an exemption. Admins see injuries
          as admins, whatever you choose here.
        </ThemedText>
        {injuryCommittee.chosen ? (
          <>
            {committee.map((m) => {
              const name = m.preferred_name || m.full_name;
              return (
                <Card key={m.id} style={styles.switchRow}>
                  <ThemedText type="small" style={styles.grow}>
                    {m.title ? `${name}, ${m.title}` : name}
                  </ThemedText>
                  <Switch
                    accessibilityLabel={`${name} sees injuries`}
                    value={injuryCommittee.memberIds.includes(m.id)}
                    onValueChange={(on) =>
                      setInjuryCommittee((c) => ({
                        ...c,
                        memberIds: on
                          ? [...c.memberIds, m.id]
                          : c.memberIds.filter((id) => id !== m.id),
                      }))
                    }
                    trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                    thumbColor={theme.text}
                    {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
                  />
                </Card>
              );
            })}
            {!committee.some((m) => injuryCommittee.memberIds.includes(m.id)) ? (
              <ThemedText type="smallBold">
                With nobody chosen, no committee member sees injuries and only admins accept
                clearances.
              </ThemedText>
            ) : null}
          </>
        ) : null}
      </View>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} busy={busy} />
    </Screen>
  );
}

/** A member as the picker searches them: by name or email. */
function asPickable(m: Profile): PickablePerson {
  return { id: m.id, name: memberName(m), email: m.email };
}

/** Who on the committee sees injuries (customer review R7). */
type InjuryCommittee = { chosen: boolean; memberIds: string[] };

const WHOLE_COMMITTEE: InjuryCommittee = { chosen: false, memberIds: [] };

function sameChoice(a: InjuryCommittee, b: InjuryCommittee) {
  return (
    a.chosen === b.chosen &&
    a.memberIds.length === b.memberIds.length &&
    a.memberIds.every((id) => b.memberIds.includes(id))
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
