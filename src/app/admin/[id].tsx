import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { GuardianHistory } from '@/components/guardian-history';
import { Screen } from '@/components/screen';
import { ScreeningNotices } from '@/components/screening-notices';
import { StandDownSection } from '@/components/stand-down';
import { WwccValidation } from '@/components/wwcc-validation';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  ChipGroup,
  ConfirmDelete,
  ErrorText,
  PressableCard,
  TextField,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, isMinor, parseDate } from '@/lib/age';
import { PROFILE_COLUMNS, useAuth } from '@/lib/auth';
import { useSquads } from '@/lib/club';
import {
  canHoldTitle,
  coachTitleLabels,
  isTeamRole,
  rejectionReasonLabels,
  roleLabels,
  rolesLabel,
  selectionLabels,
  statusLabels,
  teamRoleLabels,
} from '@/lib/labels';
import { logRecordView } from '@/lib/record-access';
import { ageOn, localDay } from '@/lib/reports';
import { hasRole, roleCombinationProblem } from '@/lib/roles';
import {
  canBeExempt,
  exemptionStatus,
  standDownRoles,
  isDatedExemption,
  verificationMethodLabels,
  volunteerExemptionLabels,
  volunteerScreeningLabels,
  wwcSources,
  wwccRoles,
  wwccStatus,
} from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  CoachTitle,
  MemberStatus,
  Profile,
  RejectionReason,
  TeamRole,
  TeamSelection,
  VerificationMethod,
  VolunteerExemption,
  VolunteerExemptionBasis,
} from '@/lib/types';
import { teamLabel, topGroups, useTeams } from '@/lib/use-teams';

const allRoles = Object.keys(roleLabels) as AppRole[];
const coachTitles = Object.keys(coachTitleLabels) as CoachTitle[];
const selections = Object.keys(selectionLabels) as TeamSelection[];
const rejectionReasons = Object.keys(rejectionReasonLabels) as RejectionReason[];

/**
 * A squad or team the member is in: the role they're in it as, their coach
 * title, or how an athlete was selected.
 */
type Placement = {
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  selection: TeamSelection | null;
};

/** Squads and teams the member is in, keyed by id. */
type Placements = Record<string, Placement>;

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole;
  extra_roles: AppRole[];
  verified_at: string | null;
};

/** How many guardians to offer while searching. */
const GUARDIAN_MATCHES = 6;

export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, refresh } = useAuth();
  const teams = useTeams();
  const usesSquads = useSquads();
  const [member, setMember] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole>('guest');
  const [extraRoles, setExtraRoles] = useState<AppRole[]>([]);
  const [selection, setSelection] = useState<Placements>({});
  const [under18, setUnder18] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [wwccNumber, setWwccNumber] = useState('');
  const [wwccExpires, setWwccExpires] = useState('');
  const [exempt, setExempt] = useState(false);
  const [exemptReason, setExemptReason] = useState('');
  // How a coach, manager or physio is screened: a check, or a volunteer exemption.
  const [screening, setScreening] = useState<'check' | VolunteerExemptionBasis>('check');
  const [exemptChild, setExemptChild] = useState<string | null>(null);
  // A visitor's arrival in WA, or a national event's first day, name and organiser.
  const [exemptFrom, setExemptFrom] = useState('');
  const [eventName, setEventName] = useState('');
  const [organiser, setOrganiser] = useState('');
  // A temporary helper's task and dates.
  const [task, setTask] = useState('');
  const [volunteerFrom, setVolunteerFrom] = useState('');
  const [volunteerUntil, setVolunteerUntil] = useState('');
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null>(null);
  const [exemptions, setExemptions] = useState<VolunteerExemption[]>([]);
  const [title, setTitle] = useState('');
  const [headPhysio, setHeadPhysio] = useState(false);
  const [guardianIds, setGuardianIds] = useState<string[]>([]);
  const [savedGuardianIds, setSavedGuardianIds] = useState<string[]>([]);
  const [guardianReason, setGuardianReason] = useState('');
  const [guardianOf, setGuardianOf] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [code, setCode] = useState('');
  const [verifyMethod, setVerifyMethod] = useState<VerificationMethod | null>(null);
  const [verifyNote, setVerifyNote] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saving, setSaving] = useState<MemberStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dobRecord, setDobRecord] = useState<DobRecord | null>(null);

  useEffect(() => {
    (async () => {
      const [profileResult, teamsResult, linksResult, peopleResult, exemptionsResult, dobResult] =
        await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single(),
        supabase
          .from('team_members')
          .select('team_id, team_role, coach_title, selection, team:teams!inner (archived)')
          .eq('profile_id', id)
          // Past seasons are history; only this season's groups are edited here.
          .eq('team.archived', false),
        supabase
          .from('guardianships')
          .select('guardian_id, athlete_id')
          .or(`guardian_id.eq.${id},athlete_id.eq.${id}`),
        supabase
          .from('profiles')
          .select('id, full_name, email, role, extra_roles, verified_at')
          .eq('status', 'approved')
          .order('full_name'),
        supabase.rpc('admin_volunteer_exemptions'),
        supabase.rpc('admin_date_of_birth_record', { p_profile_id: id }).maybeSingle(),
      ]);
      const profile = profileResult.data as Profile | null;
      if (!profile) {
        setError('Member not found.');
        return;
      }
      setMember(profile);
      logRecordView(id, 'member_record');
      setUnder18(profile.under_17);
      setDateOfBirth(formatDate(profile.date_of_birth));
      setDobRecord((dobResult.data as DobRecord | null) ?? null);
      setWwccNumber(profile.wwcc_number ?? '');
      setWwccExpires(formatDate(profile.wwcc_expires_on));
      setExempt(!!profile.wwcc_exempt_reason);
      setExemptReason(profile.wwcc_exempt_reason ?? '');
      const theirs = ((exemptionsResult.data as VolunteerExemption[] | null) ?? []).filter(
        (e) => e.profile_id === id,
      );
      setExemptions(theirs);
      const open = theirs.find((e) => !e.ended_at);
      setScreening(open?.basis ?? 'check');
      setExemptChild(open?.child_id ?? null);
      setExemptFrom(formatDate(open?.starts_on));
      setEventName(open?.event_name ?? '');
      setOrganiser(open?.organiser ?? '');
      setTask(profile.volunteer_task ?? '');
      setVolunteerFrom(formatDate(profile.volunteer_from));
      setVolunteerUntil(formatDate(profile.volunteer_until));
      // When they last accepted the club's policies.
      supabase
        .from('policy_acknowledgements')
        .select('acknowledged_at')
        .eq('profile_id', id)
        .order('acknowledged_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => setAcknowledgedAt(data?.acknowledged_at ?? null));
      setTitle(profile.title ?? '');
      setHeadPhysio(profile.head_physio);
      setReason(profile.rejection_reason);
      const links = linksResult.data ?? [];
      const linked = links.filter((l) => l.athlete_id === id).map((l) => l.guardian_id);
      setGuardianIds(linked);
      setSavedGuardianIds(linked);
      // Start the guardian search from the email the child gave at Join.
      if (!links.some((l) => l.athlete_id === id)) setGuardianSearch(profile.guardian_email ?? '');
      setGuardianOf(links.filter((l) => l.guardian_id === id).map((l) => l.athlete_id));
      setPeople((peopleResult.data as Person[] | null) ?? []);

      const existing = teamsResult.data ?? [];
      if (profile.status === 'approved' || existing.length > 0) {
        setRole(profile.role);
        setExtraRoles(profile.extra_roles ?? []);
        setSelection(
          Object.fromEntries(
            existing.map((t) => [
              t.team_id,
              { team_role: t.team_role, coach_title: t.coach_title, selection: t.selection },
            ]),
          ),
        );
      } else {
        // Start from what they asked for.
        const requested = profile.requested_role ?? 'guest';
        setRole(requested);
        if (profile.requested_team_id && isTeamRole(requested)) {
          setSelection({
            [profile.requested_team_id]: {
              team_role: requested,
              coach_title: requested === 'coach' ? 'head_coach' : null,
              selection: null,
            },
          });
        }
      }
    })();
  }, [id]);

  // Every role they'll hold, main role first, and the ones that put them in squads and teams.
  const roles = [role, ...extraRoles.filter((r) => r !== role)];
  const teamRolesHeld = roles.filter(isTeamRole);
  const inTeams = teamRolesHeld.length > 0;
  const isAthlete = roles.includes('athlete');
  const isGuardian = roles.includes('guardian');
  const isPhysio = roles.includes('physio');
  const dob = parseDate(dateOfBirth);
  // The card as saved, and whether the fields still show it.
  const savedCard = member ? wwccStatus(member).kind : 'missing';
  const savedCardCurrent = savedCard === 'current' || savedCard === 'expiring';
  const cardUnchanged =
    !!member &&
    wwccNumber.trim().toUpperCase() === (member.wwcc_number ?? '') &&
    parseDate(wwccExpires) === (member.wwcc_expires_on ?? null);
  const minor = isMinor(dob, under18);
  const hasGuardians = isAthlete && minor;
  const isVolunteer = roles.includes('volunteer');
  const needsWwcc =
    roles.some((r) => wwccRoles.includes(r)) ||
    isVolunteer ||
    roles.includes('committee') ||
    roles.includes('admin');
  // Only a committee member or admin with no coach, manager or physio role can be excused.
  const exemptable = canBeExempt(roles);
  const isExempt = exemptable && exempt;
  // Coaches, managers, physios and temporary helpers can be screened by an exemption instead.
  const canVolunteer = isVolunteer || roles.some((r) => wwccRoles.includes(r));
  const volunteerBasis = canVolunteer && screening !== 'check' ? screening : null;
  const openExemption = exemptions.find((e) => !e.ended_at);
  const comboProblem = roleCombinationProblem(roles, dob, under18);
  const isSelf = id === session?.user.id;
  // A parent who is also an admin leaves their child's guardians to another admin.
  const myChild = !!session && savedGuardianIds.includes(session.user.id);
  const guardiansChanged =
    hasGuardians &&
    [...guardianIds].sort().join() !== [...savedGuardianIds].sort().join();

  /** A placement in a group as one of their roles. */
  function placementFor(teamId: string, teamRole: TeamRole, current?: Placement): Placement {
    const isTeam = teams.find((t) => t.id === teamId)?.kind === 'team';
    return {
      team_role: teamRole,
      coach_title: teamRole === 'coach' ? (current?.coach_title ?? 'head_coach') : null,
      selection: teamRole === 'athlete' && isTeam ? (current?.selection ?? 'touring') : null,
    };
  }

  /** Keeps every placement in a role they still hold, after their roles change. */
  function fitPlacements(held: TeamRole[]) {
    setSelection((current) =>
      Object.fromEntries(
        Object.entries(current).map(([teamId, placement]) => [
          teamId,
          held.includes(placement.team_role)
            ? placement
            : placementFor(teamId, held[0] ?? placement.team_role, placement),
        ]),
      ),
    );
  }

  /** Sets their role in a squad or team, and in the squad's teams with it. */
  function setTeamRole(teamId: string, teamRole: TeamRole) {
    setSelection((current) => {
      const next = { ...current, [teamId]: placementFor(teamId, teamRole, current[teamId]) };
      for (const t of teams) {
        if (t.squad_id === teamId && t.id in next) {
          next[t.id] = placementFor(t.id, teamRole, next[t.id]);
        }
      }
      return next;
    });
  }

  function toggleTeam(teamId: string) {
    setSelection((current) => {
      const next = { ...current };
      if (teamId in next) {
        delete next[teamId];
        // Leaving a squad also takes them out of its teams.
        for (const t of teams) {
          if (t.squad_id === teamId) delete next[t.id];
        }
      } else {
        // A team takes the role they have in its squad.
        const squadId = teams.find((t) => t.id === teamId)?.squad_id;
        const teamRole = (squadId && next[squadId]?.team_role) || teamRolesHeld[0];
        next[teamId] = placementFor(teamId, teamRole);
      }
      return next;
    });
  }

  function changeRole(newRole: AppRole) {
    const extras = extraRoles.filter((r) => r !== newRole);
    setRole(newRole);
    setExtraRoles(extras);
    fitPlacements([newRole, ...extras].filter(isTeamRole));
  }

  function toggleExtraRole(extra: AppRole) {
    const extras = extraRoles.includes(extra)
      ? extraRoles.filter((r) => r !== extra)
      : [...extraRoles, extra];
    setExtraRoles(extras);
    fitPlacements([role, ...extras].filter(isTeamRole));
  }

  async function verify() {
    setVerifying(true);
    setVerifyError(null);
    const { error: rpcError } = await supabase.rpc('admin_verify_member', {
      p_profile_id: id,
      p_code: code,
    });
    setVerifying(false);
    if (rpcError) {
      setVerifyError(rpcError.message);
      return;
    }
    setCode('');
    setMember(
      (current) =>
        current && {
          ...current,
          verified_at: new Date().toISOString(),
          verification_method: 'code',
          verification_note: null,
        },
    );
  }

  async function recordVerification() {
    if (!verifyMethod) {
      setVerifyError('Choose how you checked who they are.');
      return;
    }
    if (!verifyNote.trim()) {
      setVerifyError('Write what you checked.');
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    const { error: rpcError } = await supabase.rpc('admin_record_verification', {
      p_profile_id: id,
      p_method: verifyMethod,
      p_note: verifyNote,
    });
    setVerifying(false);
    if (rpcError) {
      setVerifyError(rpcError.message);
      return;
    }
    setMember(
      (current) =>
        current && {
          ...current,
          verified_at: new Date().toISOString(),
          verification_method: verifyMethod,
          verification_note: verifyNote.trim(),
        },
    );
  }

  async function save(status: MemberStatus) {
    const expires = parseDate(wwccExpires);
    if (dob === undefined) {
      setError('Enter the date of birth as DD/MM/YYYY.');
      return;
    }
    if (expires === undefined) {
      setError('Enter the check expiry date as DD/MM/YYYY.');
      return;
    }
    if (expires && !cardUnchanged && expires > threeYearsFromToday()) {
      setError('A Working With Children Check lasts three years. Check the expiry date on the card.');
      return;
    }
    if (comboProblem && status === 'approved') {
      setError(comboProblem);
      return;
    }
    if (isExempt && !exemptReason.trim()) {
      setError('Write why they don’t need a Working With Children Check.');
      return;
    }
    if (volunteerBasis === 'parent_volunteer' && !exemptChild) {
      setError('Choose the child they volunteer for.');
      return;
    }
    const exemptStart = parseDate(exemptFrom);
    if (volunteerBasis && isDatedExemption(volunteerBasis) && !exemptStart) {
      setError(
        volunteerBasis === 'short_term_visitor'
          ? 'Enter the day they arrived in WA as DD/MM/YYYY.'
          : 'Enter the first day of the event or tour as DD/MM/YYYY.',
      );
      return;
    }
    const firstDay = parseDate(volunteerFrom);
    const lastDay = parseDate(volunteerUntil);
    if (isVolunteer && (firstDay === undefined || lastDay === undefined)) {
      setError('Enter their first and last day as DD/MM/YYYY.');
      return;
    }
    setSaving(status);
    setError(null);
    // Saved first, because the member rules below depend on them.
    const { error: detailsError } = await supabase.rpc('admin_set_member_details', {
      p_profile_id: id,
      p_date_of_birth: dob,
      p_wwcc_number: wwccNumber,
      p_wwcc_expires_on: expires,
    });
    if (detailsError) {
      setSaving(null);
      setError(detailsError.message);
      return;
    }
    // Also before saving the member: a new committee member or admin needs a check or an exemption.
    const newReason = isExempt ? exemptReason.trim() : '';
    if (newReason !== (member?.wwcc_exempt_reason ?? '')) {
      const { error: exemptError } = await supabase.rpc('admin_set_wwcc_exemption', {
        p_profile_id: id,
        p_reason: newReason,
      });
      if (exemptError) {
        setSaving(null);
        setError(exemptError.message);
        return;
      }
    }
    // Also before saving the member: a new coach or volunteer needs a check or an exemption.
    const exemptionError = await saveExemption(exemptStart ?? null);
    if (exemptionError) {
      setSaving(null);
      setError(exemptionError);
      return;
    }
    // And a new volunteer needs their task and dates.
    if (
      isVolunteer &&
      (task.trim() !== (member?.volunteer_task ?? '') ||
        firstDay !== (member?.volunteer_from ?? null) ||
        lastDay !== (member?.volunteer_until ?? null))
    ) {
      const { error: volunteerError } = await supabase.rpc('admin_set_volunteer_details', {
        p_profile_id: id,
        p_task: task,
        p_from: firstDay,
        p_until: lastDay,
      });
      if (volunteerError) {
        setSaving(null);
        setError(volunteerError.message);
        return;
      }
    }
    const { error: rpcError } = await supabase.rpc('admin_save_member', {
      p_profile_id: id,
      p_role: role,
      p_status: status,
      p_teams: inTeams
        ? Object.entries(selection).map(([team_id, placement]) => ({ team_id, ...placement }))
        : [],
      p_rejection_reason: status === 'rejected' ? reason : null,
      p_under_17: hasGuardians,
      p_guardian_ids: hasGuardians ? guardianIds : [],
      p_extra_roles: extraRoles.filter((r) => r !== role),
      p_guardian_reason: guardiansChanged ? guardianReason : null,
    });
    if (rpcError) {
      setSaving(null);
      setError(rpcError.message);
      return;
    }
    // After the role, because only committee members and admins have a title.
    if (status === 'approved' && canHoldTitle(roles) && title.trim() !== (member?.title ?? '')) {
      const { error: titleError } = await supabase.rpc('admin_set_member_title', {
        p_profile_id: id,
        p_title: title,
      });
      if (titleError) {
        setSaving(null);
        setError(titleError.message);
        return;
      }
    }
    // Also after the role, because only physios can be Head Physio.
    const nextHeadPhysio = isPhysio && headPhysio;
    if (status === 'approved' && nextHeadPhysio !== member?.head_physio) {
      const { error: headError } = await supabase.rpc('admin_set_head_physio', {
        p_profile_id: id,
        p_on: nextHeadPhysio,
      });
      if (headError) {
        setSaving(null);
        setError(headError.message);
        return;
      }
    }
    setSaving(null);
    if (isSelf) await refresh();
    router.back();
  }

  /** Records, changes or ends their volunteer exemption. Returns an error message. */
  async function saveExemption(startsOn: string | null): Promise<string | null> {
    if (volunteerBasis) {
      const child = volunteerBasis === 'parent_volunteer' ? exemptChild : null;
      const dated = isDatedExemption(volunteerBasis);
      const event = volunteerBasis === 'national_event' ? eventName.trim() : '';
      const body = volunteerBasis === 'national_event' ? organiser.trim() : '';
      if (
        openExemption?.basis === volunteerBasis &&
        openExemption.child_id === child &&
        (openExemption.starts_on ?? null) === (dated ? startsOn : null) &&
        (openExemption.event_name ?? '') === event &&
        (openExemption.organiser ?? '') === body
      ) {
        return null;
      }
      const { error: setError } = await supabase.rpc('admin_set_volunteer_exemption', {
        p_profile_id: id,
        p_basis: volunteerBasis,
        p_child_id: child,
        p_starts_on: dated ? startsOn : null,
        p_event_name: event || null,
        p_organiser: body || null,
      });
      return setError?.message ?? null;
    }
    if (!openExemption) return null;
    const { error: endError } = await supabase.rpc('admin_end_volunteer_exemption', {
      p_profile_id: id,
      p_note: canVolunteer
        ? 'Changed to a Working With Children Check'
        : 'No longer in a role that needs one',
    });
    return endError?.message ?? null;
  }

  async function deleteMember() {
    setDeleting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_delete_member', { p_profile_id: id });
    setDeleting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  if (!member) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const requestedTeam = teams.find((t) => t.id === member.requested_team_id);
  const nameOf = (personId: string) => {
    const person = people.find((p) => p.id === personId);
    return person?.full_name || person?.email || 'Unnamed member';
  };
  const search = guardianSearch.trim().toLowerCase();
  const isVerified = (personId: string) => !!people.find((p) => p.id === personId)?.verified_at;
  const guardianMatches = people
    .filter(
      (p) =>
        hasRole(p, 'guardian') &&
        p.id !== id &&
        !guardianIds.includes(p.id) &&
        [p.full_name, p.email].some((v) => v?.toLowerCase().includes(search)),
    )
    .slice(0, GUARDIAN_MATCHES);
  const anyGuardians = people.some((p) => hasRole(p, 'guardian') && p.id !== id);
  const selectedIds = Object.keys(selection);
  // Squads, and teams without one (every team, for a club without squads).
  const groups = topGroups(teams);
  // Teams are named from a squad, so only offer teams in squads they are in.
  const availableTeams = teams.filter((t) => t.squad_id && t.squad_id in selection);

  return (
    <Screen>
      <Stack.Screen options={{ title: member.full_name || member.email || 'Member' }} />

      <Card>
        <Detail label="Status" value={statusLabels[member.status]} />
        <Detail label="Preferred name" value={member.preferred_name} />
        <Detail label="Sign-in email" value={member.email} />
        <Detail label="PlayHQ email" value={member.playhq_email} />
        <Detail
          label="Verified"
          value={
            member.verified_at
              ? `Yes, ${new Date(member.verified_at).toLocaleDateString()}${
                  member.verification_method
                    ? `, ${verificationMethodLabels[member.verification_method].toLowerCase()}`
                    : ''
                }`
              : 'Not yet'
          }
        />
        {member.verified_at && member.verification_note ? (
          <Detail label="What was checked" value={member.verification_note} />
        ) : null}
        {member.declared_date_of_birth ? (
          <Detail
            label="Date of birth they gave"
            value={`${formatDate(member.declared_date_of_birth)} (${ageOn(member.declared_date_of_birth)})`}
          />
        ) : null}
        <Detail label="Guardian email they gave" value={member.guardian_email} />
        {member.status !== 'approved' ? (
          <>
            <Detail
              label="Asked to join as"
              value={member.requested_role ? roleLabels[member.requested_role] : null}
            />
            <Detail
              label={usesSquads ? 'Asked for squad' : 'Asked for team'}
              value={requestedTeam?.name}
            />
          </>
        ) : null}
      </Card>

      <ChipGroup
        label="Role"
        options={allRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
        selected={[role]}
        onToggle={changeRole}
      />

      {(role !== 'guest' && role !== 'volunteer') || extraRoles.length > 0 ? (
        <View style={styles.group}>
          <ChipGroup
            label="Other roles"
            options={allRoles
              .filter((r) => r !== role)
              .map((r) => ({ value: r, label: roleLabels[r] }))}
            selected={extraRoles.filter((r) => r !== role)}
            onToggle={toggleExtraRole}
          />
          {comboProblem ? (
            <ErrorText>{comboProblem}</ErrorText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              For someone with more than one role, such as a coach who is also a parent.
            </ThemedText>
          )}
        </View>
      ) : null}

      {isVolunteer ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Temporary helper</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Someone helping for a day or a short time, paid or unpaid, and not necessarily a club
            member. The app only onboards them: they get no club features or messages. You can
            approve them once they’ve accepted the club’s policies and a check, or an exemption
            they’ve accepted, covers every day they’ll help. Their time ends by itself after their
            last day.
          </ThemedText>
          <TextField
            label="What they’ll help with"
            value={task}
            onChangeText={setTask}
            maxLength={200}
            multiline
          />
          <TextField
            label="First day"
            value={volunteerFrom}
            onChangeText={setVolunteerFrom}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <TextField
            label="Last day"
            value={volunteerUntil}
            onChangeText={setVolunteerUntil}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {member.volunteer_screening ? (
            <Detail label="They said" value={volunteerScreeningLabels[member.volunteer_screening]} />
          ) : null}
          {member.declared_wwcc_number ? (
            <Detail label="Card number they gave" value={member.declared_wwcc_number} />
          ) : null}
          <Detail
            label="Club policies"
            value={acknowledgedAt ? `Accepted ${localDay(acknowledgedAt)}` : 'Not accepted yet'}
          />
        </View>
      ) : null}

      {canHoldTitle(roles) ? (
        <TextField
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="President, Secretary, Treasurer…"
          autoCapitalize="words"
          maxLength={40}
        />
      ) : null}

      {isPhysio ? (
        <View style={styles.group}>
          <ChipGroup
            label="Physio title"
            options={[
              { value: 'physio', label: 'Physio' },
              { value: 'head', label: 'Head Physio' },
            ]}
            selected={[headPhysio ? 'head' : 'physio']}
            onToggle={(choice) => setHeadPhysio(choice === 'head')}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {headPhysio
              ? 'Looks after every athlete, whether or not they are in a squad or team.'
              : `Looks after the athletes in the ${usesSquads ? 'squads and teams' : 'teams'} you place them in below, or every athlete if they are in none.`}
          </ThemedText>
        </View>
      ) : null}

      {inTeams ? (
        <ChipGroup
          label={
            usesSquads
              ? groups.some((t) => t.kind === 'team')
                ? 'Squads and teams'
                : 'Squads'
              : groups.some((t) => t.kind === 'squad')
                ? 'Teams and squads'
                : 'Teams'
          }
          options={groups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
          selected={selectedIds}
          onToggle={toggleTeam}
        />
      ) : null}

      {inTeams && availableTeams.length > 0 ? (
        <ChipGroup
          label="Teams"
          options={availableTeams.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
          selected={selectedIds}
          onToggle={toggleTeam}
        />
      ) : null}

      {teamRolesHeld.length > 1
        ? groups
            .filter((t) => t.id in selection)
            .map((t) => (
              <ChipGroup
                key={t.id}
                label={`Role in ${teamLabel(t, teams)}`}
                options={teamRolesHeld.map((r) => ({ value: r, label: teamRoleLabels[r] }))}
                selected={[selection[t.id].team_role]}
                onToggle={(teamRole) => setTeamRole(t.id, teamRole)}
              />
            ))
        : null}

      {teamRolesHeld.includes('coach')
        ? teams
            .filter((t) => t.id in selection && selection[t.id].team_role === 'coach')
            .map((t) => (
              <ChipGroup
                key={t.id}
                label={`Title for ${teamLabel(t, teams)}`}
                options={coachTitles.map((c) => ({ value: c, label: coachTitleLabels[c] }))}
                selected={selection[t.id].coach_title ? [selection[t.id].coach_title!] : []}
                onToggle={(title) =>
                  setSelection((current) => ({
                    ...current,
                    [t.id]: { ...current[t.id], coach_title: title },
                  }))
                }
              />
            ))
        : null}

      {isAthlete
        ? teams
            .filter(
              (t) =>
                t.kind === 'team' && t.id in selection && selection[t.id].team_role === 'athlete',
            )
            .map((t) => (
              <ChipGroup
                key={t.id}
                label={`Selected in ${teamLabel(t, teams)} as`}
                options={selections.map((s) => ({ value: s, label: selectionLabels[s] }))}
                selected={selection[t.id].selection ? [selection[t.id].selection!] : []}
                onToggle={(choice) =>
                  setSelection((current) => ({
                    ...current,
                    [t.id]: { ...current[t.id], selection: choice },
                  }))
                }
              />
            ))
        : null}

      {isAthlete ? (
        <View style={styles.group}>
          <TextField
            label="Date of birth"
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          {dob ? (
            <ThemedText type="small" themeColor="textSecondary">
              {minor ? 'Under 18, so needs a parent or guardian.' : '18 or over.'}
            </ThemedText>
          ) : dob === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Check their date of birth against PlayHQ or ID and add it before you approve them.
            </ThemedText>
          ) : null}
          {dob && member.declared_date_of_birth && dob !== member.declared_date_of_birth ? (
            <ThemedText type="small" themeColor="textSecondary">
              Not the date they gave ({formatDate(member.declared_date_of_birth)}).
            </ThemedText>
          ) : null}
          {dob === null && member.declared_date_of_birth ? (
            <Button
              title={`I’ve checked it: use ${formatDate(member.declared_date_of_birth)}`}
              variant="secondary"
              onPress={() => setDateOfBirth(formatDate(member.declared_date_of_birth))}
            />
          ) : null}
          {dobRecord?.recorded_at && dob === member.date_of_birth ? (
            <ThemedText type="small" themeColor="textSecondary">
              Recorded by {dobRecord.recorded_by_name ?? 'an admin'} on{' '}
              {new Date(dobRecord.recorded_at).toLocaleDateString()}.
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {needsWwcc ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Working With Children Check</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Coaches, managers, physios, temporary helpers, committee members and admins need a
            current check before you can approve them. In WA, a parent volunteering at their
            child’s club and a volunteer under 18 are exempt instead. So is someone who doesn’t
            normally live in WA, for two weeks after they arrive or up to 30 days at a national
            event or tour, once in any 12 months. Record that here, and they accept a declaration in
            the app before their role starts. You can exempt a committee member or admin with a
            reason. Being supervised by someone with a check doesn’t count.
          </ThemedText>
          <WwcSources />
          {canVolunteer && !isSelf ? (
            <ChipGroup
              options={[
                { value: 'check', label: 'Has a check' },
                ...(
                  [
                    'parent_volunteer',
                    'under_18_volunteer',
                    'short_term_visitor',
                    'national_event',
                  ] as const
                )
                  // A parent volunteer needs a child linked; an under-18 volunteer, a date of birth.
                  .filter(
                    (basis) =>
                      basis === screening ||
                      isDatedExemption(basis) ||
                      (basis === 'parent_volunteer' ? guardianOf.length > 0 : minor),
                  )
                  .map((basis) => ({ value: basis, label: volunteerExemptionLabels[basis] })),
              ]}
              selected={[screening]}
              onToggle={(choice) => setScreening(choice as 'check' | VolunteerExemptionBasis)}
            />
          ) : null}
          {volunteerBasis === 'parent_volunteer' ? (
            <ChipGroup
              label="Their child at the club"
              options={guardianOf.map((c) => ({ value: c, label: nameOf(c) }))}
              selected={exemptChild ? [exemptChild] : []}
              onToggle={(c) => setExemptChild(c === exemptChild ? null : c)}
            />
          ) : null}
          {volunteerBasis && isDatedExemption(volunteerBasis) ? (
            <>
              <TextField
                label={
                  volunteerBasis === 'short_term_visitor'
                    ? 'Day they arrived in WA'
                    : 'First day of the event or tour'
                }
                value={exemptFrom}
                onChangeText={setExemptFrom}
                placeholder="DD/MM/YYYY"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              {volunteerBasis === 'national_event' ? (
                <>
                  <TextField
                    label="Event or tour"
                    value={eventName}
                    onChangeText={setEventName}
                    placeholder="For example, the national championships"
                    maxLength={200}
                  />
                  <TextField
                    label="Organised by"
                    value={organiser}
                    onChangeText={setOrganiser}
                    placeholder="The national or state body running it"
                    maxLength={200}
                  />
                </>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {volunteerBasis === 'short_term_visitor'
                  ? 'Only for someone who doesn’t normally live in WA. It covers the two weeks from the day they arrived in WA, and ends by itself.'
                  : 'Only for someone who doesn’t normally live in WA, and only for child-related work at an event or tour run by a recognised body with children from more than one state, territory or country. It covers 30 days in a row from the first day, and ends by itself.'}{' '}
                A person can use one of these two exemptions once in any 12 months, anywhere in WA,
                so the app refuses a second one within 12 months and they confirm they haven’t used
                one elsewhere.
              </ThemedText>
            </>
          ) : null}
          {openExemption && volunteerBasis === openExemption.basis ? (
            <ThemedText
              type="small"
              themeColor={exemptionStatus(openExemption).problem ? 'tint' : 'textSecondary'}>
              {exemptionStatus(openExemption).label}. Recorded by{' '}
              {openExemption.set_by_name ?? 'a former admin'} on {localDay(openExemption.set_at)}
              {openExemption.declared_at
                ? `; declaration accepted ${localDay(openExemption.declared_at)}.`
                : '.'}
            </ThemedText>
          ) : null}
          {volunteerBasis && volunteerBasis !== openExemption?.basis ? (
            <ThemedText type="small" themeColor="textSecondary">
              Once you save, they’ll get a to-do to accept the exemption declaration. Their{' '}
              {rolesLabel(
                roles.filter((r) => wwccRoles.includes(r) || r === 'volunteer'),
              ).toLowerCase()}{' '}
              role starts when they do. It ends by itself{' '}
              {volunteerBasis === 'parent_volunteer'
                ? 'when their child turns 18 or leaves'
                : volunteerBasis === 'under_18_volunteer'
                  ? 'when they turn 18'
                  : 'after its last day'}
              .
            </ThemedText>
          ) : null}
          {exemptable && !(isSelf && !exempt) ? (
            <ChipGroup
              options={[
                { value: 'check', label: 'Needs a check' },
                { value: 'exempt', label: 'Exempt' },
              ]}
              selected={[exempt ? 'exempt' : 'check']}
              onToggle={(choice) => setExempt(choice === 'exempt')}
            />
          ) : null}
          {exemptable && isSelf && !exempt ? (
            <ThemedText type="small" themeColor="textSecondary">
              Another admin needs to exempt you.
            </ThemedText>
          ) : null}
          {isExempt ? (
            <>
              <TextField
                label="Why they don’t need a check"
                value={exemptReason}
                onChangeText={setExemptReason}
                placeholder="For example, treasurer only, never at training or games"
                multiline
                maxLength={500}
              />
              {member.wwcc_exempted_at && exemptReason.trim() === member.wwcc_exempt_reason ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Exempted by{' '}
                  {member.wwcc_exempted_by ? nameOf(member.wwcc_exempted_by) : 'a former admin'} on{' '}
                  {new Date(member.wwcc_exempted_at).toLocaleDateString()}
                </ThemedText>
              ) : null}
            </>
          ) : volunteerBasis ? null : (
            <>
              <TextField
                label="Card number"
                value={wwccNumber}
                onChangeText={setWwccNumber}
                autoCapitalize="characters"
                maxLength={30}
              />
              <TextField
                label="Expires"
                value={wwccExpires}
                onChangeText={setWwccExpires}
                placeholder="DD/MM/YYYY"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              {savedCardCurrent && cardUnchanged ? (
                <WwccValidation
                  member={member}
                  isSelf={isSelf}
                  validatorName={nameOf}
                  onSaved={(changes) =>
                    setMember((current) => current && { ...current, ...changes })
                  }
                />
              ) : wwccNumber.trim() && !cardUnchanged ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Save the new card, then open this page again to validate it.
                </ThemedText>
              ) : null}
            </>
          )}
          {exemptions
            .filter((e) => e.ended_at)
            .map((e) => (
              <ThemedText key={e.id} type="small" themeColor="textSecondary">
                Earlier: {volunteerExemptionLabels[e.basis]}
                {e.child_name ? ` for ${e.child_name}` : ''}
                {e.event_name ? ` for ${e.event_name}` : ''}
                {e.starts_on && e.ends_on
                  ? `, ${formatDate(e.starts_on)} to ${formatDate(e.ends_on)}`
                  : ''}
                , recorded {localDay(e.set_at)}
                {e.declared_at ? `, declared ${localDay(e.declared_at)}` : ''}, ended{' '}
                {localDay(e.ended_at!)} by {e.ended_by_name ?? 'a former admin'}
                {e.end_note ? ` (${e.end_note})` : ''}
              </ThemedText>
            ))}
        </View>
      ) : null}

      {member.status === 'approved' &&
      !isSelf &&
      (member.stood_down_at || hasRole(member, ...standDownRoles, 'guardian')) ? (
        <ScreeningNotices memberId={member.id} onStandDown={() => router.back()} />
      ) : null}

      {member.status === 'approved' &&
      !isSelf &&
      (member.stood_down_at || hasRole(member, ...standDownRoles)) ? (
        <StandDownSection
          memberId={member.id}
          memberName={member.full_name || member.email || 'this member'}
          onChange={() => router.back()}
        />
      ) : null}

      {hasGuardians ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Parents and guardians</ThemedText>
          {myChild ? (
            <ThemedText type="small" themeColor="textSecondary">
              {guardianIds.map(nameOf).join(', ')}. You’re one of their guardians, so another admin
              needs to change who their guardians are.
            </ThemedText>
          ) : guardianIds.length > 0 ? (
            <ChipGroup
              options={guardianIds.map((g) => ({ value: g, label: `${nameOf(g)}  ✕` }))}
              selected={guardianIds}
              onToggle={(g) => setGuardianIds((current) => current.filter((x) => x !== g))}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No guardians linked yet.
            </ThemedText>
          )}
          {myChild ? null : anyGuardians ? (
            <>
              <TextField
                label="Add a guardian"
                value={guardianSearch}
                onChangeText={setGuardianSearch}
                placeholder="Search by name or email"
                autoCapitalize="none"
              />
              <ChipGroup
                options={guardianMatches.map((p) => ({
                  value: p.id,
                  label: p.verified_at ? nameOf(p.id) : `${nameOf(p.id)} (not verified)`,
                }))}
                selected={[]}
                onToggle={(g) => {
                  if (!isVerified(g)) {
                    setError(
                      `Verify ${nameOf(g)} first, with their code in person or against PlayHQ, from their own page.`,
                    );
                    return;
                  }
                  setError(null);
                  setGuardianIds((current) => [...current, g]);
                  setGuardianSearch('');
                }}
              />
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              No approved guardians yet. Parents and guardians register in the app first, then you
              approve them with the Guardian role.
            </ThemedText>
          )}
          {guardiansChanged ? (
            <>
              <TextField
                label="Reason for the change (optional)"
                value={guardianReason}
                onChangeText={setGuardianReason}
                placeholder="For example, parenting order seen 12/10/2026"
                multiline
                maxLength={500}
              />
              <ThemedText type="small" themeColor="textSecondary">
                Only admins see the reason. When you save, the child’s guardians, and the child if
                they’re 13 or over, get a message saying who was linked or unlinked and by whom.
              </ThemedText>
            </>
          ) : null}
          <GuardianHistory memberId={id} />
        </View>
      ) : null}

      {member.status === 'approved' && isMinor(member.date_of_birth, member.under_17) ? (
        <PressableCard
          onPress={() =>
            router.push({ pathname: '/records/[id]', params: { id, name: member.full_name ?? '' } })
          }>
          <ThemedText type="smallBold">Who has viewed their records</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Everyone who opened their injuries, check-ins, game goals or member record, apart from
            them and their parents and guardians.
          </ThemedText>
        </PressableCard>
      ) : null}

      {isGuardian && member.status === 'approved' ? (
        <Card>
          <ThemedText type="smallBold">Guardian of</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {guardianOf.length > 0
              ? guardianOf.map(nameOf).join(', ')
              : "No athletes yet. Link them from the athlete's page."}
          </ThemedText>
          <GuardianHistory memberId={id} />
        </Card>
      ) : null}

      {(member.status !== 'approved' || isGuardian) && !member.verified_at ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Verify who they are</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {isGuardian
              ? 'Guardians must be verified before you link them to a child. '
              : ''}
            Ask them to open the app and read you their 6-digit code, in person or over a channel
            you already trust. Or, if their PlayHQ email matches the parent or member on the PlayHQ
            registration, or you’ve seen photo ID, record what you checked.
          </ThemedText>
          <ChipGroup
            label="How you checked"
            options={(['playhq', 'id_sighted'] as const).map((m) => ({
              value: m,
              label: verificationMethodLabels[m],
            }))}
            selected={verifyMethod ? [verifyMethod] : []}
            onToggle={(m) => setVerifyMethod(m === verifyMethod ? null : m)}
          />
          {verifyMethod ? (
            <>
              <TextField
                label="What you checked"
                value={verifyNote}
                onChangeText={setVerifyNote}
                placeholder={
                  verifyMethod === 'playhq'
                    ? 'For example, listed as Sam’s parent in PlayHQ with this email'
                    : 'For example, driver’s licence, name and photo match'
                }
                multiline
                maxLength={500}
              />
              <Button
                title="Record check"
                variant="secondary"
                onPress={recordVerification}
                busy={verifying}
              />
            </>
          ) : null}
          <TextField
            label="Their code"
            value={code}
            onChangeText={setCode}
            placeholder="123 456"
            keyboardType="number-pad"
            maxLength={7}
          />
          <ErrorText>{verifyError}</ErrorText>
          <Button title="Check code" variant="secondary" onPress={verify} busy={verifying} />
        </View>
      ) : null}

      {!isSelf ? (
        <ChipGroup
          label={
            member.status === 'approved' ? 'Reason if removing access' : 'Reason if not approving'
          }
          options={rejectionReasons.map((r) => ({ value: r, label: rejectionReasonLabels[r] }))}
          selected={reason ? [reason] : []}
          onToggle={(r) => setReason(r === reason ? null : r)}
        />
      ) : null}

      <ErrorText>{error}</ErrorText>

      <View style={styles.actions}>
        {member.status === 'approved' ? (
          <>
            <Button
              title="Save changes"
              onPress={() => save('approved')}
              busy={saving === 'approved'}
            />
            {!isSelf ? (
              <Button
                title="Remove access"
                variant="secondary"
                onPress={() => save('rejected')}
                busy={saving === 'rejected'}
              />
            ) : null}
          </>
        ) : (
          <>
            <Button title="Approve" onPress={() => save('approved')} busy={saving === 'approved'} />
            {member.status === 'pending' && isVolunteer ? (
              // A volunteer accepts their exemption before they can be approved.
              <Button
                title="Save for now"
                variant="secondary"
                onPress={() => save('pending')}
                busy={saving === 'pending'}
              />
            ) : null}
            {member.status === 'pending' || member.status === 'rejected' ? (
              <Button
                title={member.status === 'pending' ? "Don't approve" : 'Save reason'}
                variant="secondary"
                onPress={() => save('rejected')}
                busy={saving === 'rejected'}
              />
            ) : null}
          </>
        )}
      </View>

      {!isSelf ? (
        <ConfirmDelete
          title="Delete member"
          warning={`This permanently deletes ${member.full_name || member.email || 'this member'}: their account, squad and team places, guardian links and message receipts. Messages they sent stay, and their injury records are kept for 12 months. It can’t be undone.${member.status === 'approved' ? ' To only stop them using the app, use Remove access instead.' : ''}`}
          confirmTitle="Delete permanently"
          onConfirm={deleteMember}
          busy={deleting}
        />
      ) : null}
    </Screen>
  );
}

/** The WA rules on checks and exemptions, to read at the source. */
function WwcSources() {
  const theme = useTheme();
  return (
    <View style={styles.sources}>
      <ThemedText type="small" themeColor="textSecondary">
        Read the rules at the source:
      </ThemedText>
      {wwcSources.map((source) => (
        <Pressable
          key={source.url}
          accessibilityRole="link"
          onPress={() => Linking.openURL(source.url)}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            {source.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** Who recorded a member's checked date of birth, and when. */
type DobRecord = { recorded_by_name: string | null; recorded_at: string | null };

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.detail}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value || '—'}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
  group: {
    gap: Spacing.two,
  },
  sources: {
    gap: Spacing.one,
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});

/** Today plus three years, as YYYY-MM-DD: the latest expiry a card can have. */
function threeYearsFromToday() {
  const day = new Date();
  day.setFullYear(day.getFullYear() + 3);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`;
}
