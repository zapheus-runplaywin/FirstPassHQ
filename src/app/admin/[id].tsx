import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDate, isMinor, parseDate } from '@/lib/age';
import { PROFILE_COLUMNS, useAuth } from '@/lib/auth';
import { useSquads } from '@/lib/club';
import {
  coachTitleLabels,
  isTeamRole,
  rejectionReasonLabels,
  roleLabels,
  selectionLabels,
  statusLabels,
} from '@/lib/labels';
import { wwccRoles } from '@/lib/safety';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  CoachTitle,
  MemberStatus,
  Profile,
  RejectionReason,
  TeamSelection,
} from '@/lib/types';
import { teamLabel, topGroups, useTeams } from '@/lib/use-teams';

const allRoles = Object.keys(roleLabels) as AppRole[];
const coachTitles = Object.keys(coachTitleLabels) as CoachTitle[];
const selections = Object.keys(selectionLabels) as TeamSelection[];
const rejectionReasons = Object.keys(rejectionReasonLabels) as RejectionReason[];

/** A squad or team the member is in: their coach title, or how an athlete was selected. */
type Placement = { coach_title: CoachTitle | null; selection: TeamSelection | null };

/** Squads and teams the member is in, keyed by id. */
type Placements = Record<string, Placement>;

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: AppRole;
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
  const [selection, setSelection] = useState<Placements>({});
  const [under18, setUnder18] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [wwccNumber, setWwccNumber] = useState('');
  const [wwccExpires, setWwccExpires] = useState('');
  const [guardianIds, setGuardianIds] = useState<string[]>([]);
  const [guardianOf, setGuardianOf] = useState<string[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [guardianSearch, setGuardianSearch] = useState('');
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saving, setSaving] = useState<MemberStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [profileResult, teamsResult, linksResult, peopleResult] = await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single(),
        supabase
          .from('team_members')
          .select('team_id, coach_title, selection, team:teams!inner (archived)')
          .eq('profile_id', id)
          // Past seasons are history; only this season's groups are edited here.
          .eq('team.archived', false),
        supabase
          .from('guardianships')
          .select('guardian_id, athlete_id')
          .or(`guardian_id.eq.${id},athlete_id.eq.${id}`),
        supabase
          .from('profiles')
          .select('id, full_name, email, role, verified_at')
          .eq('status', 'approved')
          .order('full_name'),
      ]);
      const profile = profileResult.data as Profile | null;
      if (!profile) {
        setError('Member not found.');
        return;
      }
      setMember(profile);
      setUnder18(profile.under_17);
      setDateOfBirth(formatDate(profile.date_of_birth));
      setWwccNumber(profile.wwcc_number ?? '');
      setWwccExpires(formatDate(profile.wwcc_expires_on));
      setReason(profile.rejection_reason);
      const links = linksResult.data ?? [];
      setGuardianIds(links.filter((l) => l.athlete_id === id).map((l) => l.guardian_id));
      setGuardianOf(links.filter((l) => l.guardian_id === id).map((l) => l.athlete_id));
      setPeople((peopleResult.data as Person[] | null) ?? []);

      const existing = teamsResult.data ?? [];
      if (profile.status === 'approved' || existing.length > 0) {
        setRole(profile.role);
        setSelection(
          Object.fromEntries(
            existing.map((t) => [
              t.team_id,
              { coach_title: t.coach_title, selection: t.selection },
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
              coach_title: requested === 'coach' ? 'head_coach' : null,
              selection: null,
            },
          });
        }
      }
    })();
  }, [id]);

  const inTeams = isTeamRole(role);
  const dob = parseDate(dateOfBirth);
  const minor = isMinor(dob, under18);
  const hasGuardians = role === 'athlete' && minor;
  const needsWwcc = wwccRoles.includes(role);
  const isSelf = id === session?.user.id;

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
        const isTeam = teams.find((t) => t.id === teamId)?.kind === 'team';
        next[teamId] = {
          coach_title: role === 'coach' ? 'head_coach' : null,
          selection: role === 'athlete' && isTeam ? 'touring' : null,
        };
      }
      return next;
    });
  }

  function changeRole(newRole: AppRole) {
    setRole(newRole);
    // Coach titles only apply to coaches.
    setSelection((current) =>
      Object.fromEntries(
        Object.keys(current).map((teamId) => [
          teamId,
          {
            coach_title: newRole === 'coach' ? (current[teamId].coach_title ?? 'head_coach') : null,
            selection:
              newRole === 'athlete' && teams.find((t) => t.id === teamId)?.kind === 'team'
                ? (current[teamId].selection ?? 'touring')
                : null,
          },
        ]),
      ),
    );
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
    setMember((current) => current && { ...current, verified_at: new Date().toISOString() });
  }

  async function markVerified() {
    setVerifying(true);
    setVerifyError(null);
    const { error: rpcError } = await supabase.rpc('admin_mark_verified', { p_profile_id: id });
    setVerifying(false);
    if (rpcError) {
      setVerifyError(rpcError.message);
      return;
    }
    setMember((current) => current && { ...current, verified_at: new Date().toISOString() });
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
    });
    setSaving(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (isSelf) await refresh();
    router.back();
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
        p.role === 'guardian' &&
        p.id !== id &&
        !guardianIds.includes(p.id) &&
        [p.full_name, p.email].some((v) => v?.toLowerCase().includes(search)),
    )
    .slice(0, GUARDIAN_MATCHES);
  const anyGuardians = people.some((p) => p.role === 'guardian' && p.id !== id);
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
        <Detail label="Sign-in email" value={member.email} />
        <Detail label="PlayHQ email" value={member.playhq_email} />
        <Detail
          label="Verified"
          value={
            member.verified_at
              ? `Yes, ${new Date(member.verified_at).toLocaleDateString()}`
              : 'Not yet'
          }
        />
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

      {inTeams ? (
        <ChipGroup
          label={usesSquads ? 'Squads' : 'Teams'}
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

      {role === 'coach'
        ? teams
            .filter((t) => t.id in selection)
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

      {role === 'athlete'
        ? teams
            .filter((t) => t.kind === 'team' && t.id in selection)
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

      {role === 'athlete' ? (
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
            <ChipGroup
              label="Age, until you add their date of birth"
              options={[
                { value: 'under', label: 'Under 18' },
                { value: 'over', label: '18 or over' },
              ]}
              selected={[under18 ? 'under' : 'over']}
              onToggle={(age) => setUnder18(age === 'under')}
            />
          ) : null}
        </View>
      ) : null}

      {needsWwcc ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Working With Children Check</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Coaches, managers and physios need a current check before you can approve them.
          </ThemedText>
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
        </View>
      ) : null}

      {hasGuardians ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Parents and guardians</ThemedText>
          {guardianIds.length > 0 ? (
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
          {anyGuardians ? (
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
        </View>
      ) : null}

      {role === 'guardian' && member.status === 'approved' ? (
        <Card>
          <ThemedText type="smallBold">Guardian of</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {guardianOf.length > 0
              ? guardianOf.map(nameOf).join(', ')
              : "No athletes yet. Link them from the athlete's page."}
          </ThemedText>
        </Card>
      ) : null}

      {(member.status !== 'approved' || role === 'guardian') && !member.verified_at ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">Verify who they are</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {role === 'guardian'
              ? 'Guardians must be verified before you link them to a child. '
              : ''}
            If their PlayHQ email matches the parent or member on the PlayHQ registration, mark
            them as checked. Otherwise ask them to open the app and read you their 6-digit code, in
            person or over a channel you already trust.
          </ThemedText>
          <Button
            title="Checked against PlayHQ"
            variant="secondary"
            onPress={markVerified}
            busy={verifying}
          />
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
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
});
