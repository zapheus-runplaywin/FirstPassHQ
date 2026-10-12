import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useClubChoice } from '@/lib/club-choice';
import { unregisterForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  GroupCaptain,
  MyVolunteerExemption,
  Profile,
  TeamMembership,
} from '@/lib/types';
import { TEAM_COLUMNS } from '@/lib/use-teams';
import { hasRole } from '@/lib/roles';
import { pausedRoles } from '@/lib/safety';

type AuthState = {
  loading: boolean;
  session: Session | null;
  /**
   * The signed-in member, with only the roles they can use right now: roles
   * paused by an expired check or a stand-down are left out (a member left
   * with none shows as a guest). The database applies the same rule.
   */
  profile: Profile | null;
  /** Roles the member holds but can't use right now, and why. */
  paused: {
    roles: AppRole[];
    stoodDown: boolean;
    exemption: MyVolunteerExemption | null;
  } | null;
  /**
   * The member's volunteer exemption from the Working With Children Check, if
   * an admin recorded one: they accept its declaration from a to-do.
   */
  exemption: MyVolunteerExemption | null;
  memberships: TeamMembership[];
  /** Squads and teams the member captains or vice captains, from any season. */
  captaincies: GroupCaptain[];
  /** A club captain for a current season. */
  isClubCaptain: boolean;
  isAdmin: boolean;
  /** The Child Safety Officer or Complaints Manager, able to act as one now. */
  isSafeguardingOfficer: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const PROFILE_COLUMNS =
  'id, email, full_name, preferred_name, title, head_physio, playhq_email, role, extra_roles, status, requested_role, requested_team_id, join_requested_at, under_17, rejection_reason, verified_at, date_of_birth, declared_date_of_birth, guardian_email, wwcc_number, wwcc_expires_on, wwcc_exempt_reason, wwcc_exempted_by, wwcc_exempted_at, wwcc_card_name, wwcc_validated_at, wwcc_validated_by, wwcc_validation_method, wwcc_unit_linked_at, stood_down_at, verification_method, verification_note';

const AuthContext = createContext<AuthState | null>(null);

/**
 * The member signed in to the chosen club. Mounted again whenever the club
 * changes (see the root layout), so it only ever sees one club's sign-in.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { club } = useClubChoice();
  // Nobody is signed in until a club is picked.
  const [loading, setLoading] = useState(!!club);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [captaincies, setCaptaincies] = useState<GroupCaptain[]>([]);
  const [isClubCaptain, setIsClubCaptain] = useState(false);
  const [exemption, setExemption] = useState<MyVolunteerExemption | null>(null);
  const [isSafeguardingOfficer, setIsSafeguardingOfficer] = useState(false);

  const loadMember = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setMemberships([]);
      setCaptaincies([]);
      setIsClubCaptain(false);
      setExemption(null);
      setIsSafeguardingOfficer(false);
      return;
    }
    const [
      profileResult,
      membershipResult,
      captainResult,
      clubCaptainResult,
      exemptionResult,
      officerResult,
    ] = await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single(),
      supabase
        .from('team_members')
        .select(`team_role, coach_title, selection, team:teams!inner (${TEAM_COLUMNS})`)
        .eq('profile_id', userId)
        // Past seasons are archived and left out.
        .eq('team.archived', false),
      supabase.from('team_captains').select('team_id, profile_id, captain_role').eq('profile_id', userId),
      supabase.rpc('is_club_captain'),
      supabase.rpc('my_volunteer_exemption').maybeSingle(),
      supabase.rpc('is_safeguarding_officer'),
    ]);
    setProfile((profileResult.data as Profile | null) ?? null);
    setMemberships((membershipResult.data as unknown as TeamMembership[] | null) ?? []);
    setCaptaincies((captainResult.data as GroupCaptain[] | null) ?? []);
    setIsClubCaptain(clubCaptainResult.data === true);
    setExemption((exemptionResult.data as MyVolunteerExemption | null) ?? null);
    setIsSafeguardingOfficer(officerResult.data === true);
  }, []);

  useEffect(() => {
    if (!club) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadMember(data.session?.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // Supabase warns against awaiting its own calls inside this callback.
      setTimeout(() => loadMember(newSession?.user.id), 0);
    });
    return () => listener.subscription.unsubscribe();
  }, [club, loadMember]);

  const refresh = useCallback(() => loadMember(session?.user.id), [loadMember, session]);

  const signOut = useCallback(async () => {
    await unregisterForPush().catch(() => {});
    await supabase.auth.signOut();
  }, []);

  const { usable, paused } = useMemo(
    () => usableProfile(profile, !!exemption?.valid),
    [profile, exemption],
  );
  const usableMemberships = useMemo(
    () =>
      paused.length === 0
        ? memberships
        : memberships.filter((m) => !paused.includes(m.team_role as AppRole)),
    [memberships, paused],
  );

  const isAdmin = hasRole(usable, 'admin') && usable?.status === 'approved';

  return (
    <AuthContext
      value={{
        loading,
        session,
        profile: usable,
        paused:
          paused.length > 0
            ? { roles: paused, stoodDown: !!profile?.stood_down_at, exemption }
            : null,
        exemption,
        memberships: usableMemberships,
        captaincies,
        isClubCaptain,
        isAdmin,
        isSafeguardingOfficer,
        refresh,
        signOut,
      }}>
      {children}
    </AuthContext>
  );
}

/** The member with only the roles they can use now, and the roles left out. */
function usableProfile(profile: Profile | null, exempt: boolean) {
  const paused = profile ? pausedRoles(profile, exempt) : [];
  if (!profile || paused.length === 0) return { usable: profile, paused };
  const [main = 'guest', ...extra] = [profile.role, ...profile.extra_roles].filter(
    (r) => !paused.includes(r),
  );
  return { usable: { ...profile, role: main, extra_roles: extra }, paused };
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
