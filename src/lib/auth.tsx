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
import type { LinkCode } from '@/lib/guardian-links';
import { unregisterForPush } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import type {
  AppRole,
  GroupCaptain,
  MyVolunteerExemption,
  MyWwccApplication,
  MyWwccSubmission,
  Profile,
  TeamMembership,
} from '@/lib/types';
import { TEAM_COLUMNS } from '@/lib/use-teams';
import { hasRole } from '@/lib/roles';
import {
  type SafeguardingPost,
  heldOrActing,
  safeguardingPostsFrom,
} from '@/lib/safeguarding-posts';
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
    application: MyWwccApplication | null;
  } | null;
  /**
   * The member's volunteer exemption from the Working With Children Check, if
   * an admin recorded one: they accept its declaration from a to-do.
   */
  exemption: MyVolunteerExemption | null;
  /**
   * The member's lodged Working With Children Check application, if an admin
   * recorded one: it counts as a check once they accept its declaration.
   */
  wwccApplication: MyWwccApplication | null;
  /**
   * A card the member sent in themselves, while it waits for an admin to check
   * it or after an admin sent it back. It counts for nothing until accepted.
   */
  wwccSubmission: MyWwccSubmission | null;
  memberships: TeamMembership[];
  /** Squads and teams the member captains or vice captains, from any season. */
  captaincies: GroupCaptain[];
  /** A club captain for a current season. */
  isClubCaptain: boolean;
  isAdmin: boolean;
  /** The day from which committee members need a check, "2027-01-11" style. */
  committeeChecksFrom: string | null;
  /** The day from which statisticians need a check, "2027-01-21" style. */
  statisticianChecksFrom: string | null;
  /** The Child Safety Officer or Complaints Manager, able to act as one now. */
  isSafeguardingOfficer: boolean;
  /**
   * The safeguarding posts the member holds and can act in now (Child Safety
   * Officer, Complaints Manager, WWC Registration Officer), or acts in as an
   * admin, shown as titles under their roles on the home screen.
   */
  safeguardingPosts: SafeguardingPost[];
  /**
   * Those of `safeguardingPosts` an admin acts in because nobody named in the
   * post can act; shown as "(acting)".
   */
  actingSafeguardingPosts: SafeguardingPost[];
  /**
   * A child under 18 waiting for a parent or guardian: asking to join, or
   * approved with no verified guardian linked (locked). Their link code, to
   * share with a parent or guardian; null for everyone else.
   */
  waitingForGuardian: LinkCode | null;
  /** Approved, but locked until a verified parent or guardian is linked. */
  isLocked: boolean;
  /**
   * Whether the club's choice of who on the committee sees injuries includes
   * this member (true unless the club chose members and left them out). Only
   * matters while they hold the committee role; the database applies it.
   */
  committeeSeesInjuries: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const PROFILE_COLUMNS =
  'id, email, full_name, preferred_name, title, head_physio, playhq_email, role, extra_roles, status, requested_role, requested_team_id, join_requested_at, under_17, no_sign_in, rejection_reason, verified_at, date_of_birth, declared_date_of_birth, guardian_email, wwcc_number, wwcc_expires_on, wwcc_exempt_reason, wwcc_exempted_by, wwcc_exempted_at, wwcc_card_name, wwcc_validated_at, wwcc_validated_by, wwcc_validation_method, wwcc_unit_linked_at, stood_down_at, verification_method, verification_note, volunteer_task, volunteer_from, volunteer_until, volunteer_screening, declared_wwcc_number';

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
  const [wwccApplication, setWwccApplication] = useState<MyWwccApplication | null>(null);
  const [wwccSubmission, setWwccSubmission] = useState<MyWwccSubmission | null>(null);
  const [isSafeguardingOfficer, setIsSafeguardingOfficer] = useState(false);
  const [safeguardingPosts, setSafeguardingPosts] = useState<SafeguardingPost[]>([]);
  const [actingSafeguardingPosts, setActingSafeguardingPosts] = useState<SafeguardingPost[]>([]);
  const [committeeSeesInjuries, setCommitteeSeesInjuries] = useState(true);
  const [committeeChecksFrom, setCommitteeChecksFrom] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [statisticianChecksFrom, setStatisticianChecksFrom] = useState<string | null>(null);

  const loadMember = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setMemberships([]);
      setCaptaincies([]);
      setIsClubCaptain(false);
      setExemption(null);
      setWwccApplication(null);
      setWwccSubmission(null);
      setIsSafeguardingOfficer(false);
      setSafeguardingPosts([]);
      setActingSafeguardingPosts([]);
      setCommitteeSeesInjuries(true);
      setCommitteeChecksFrom(null);
      setLinkCode(null);
      setStatisticianChecksFrom(null);
      return;
    }
    const [
      profileResult,
      membershipResult,
      captainResult,
      clubCaptainResult,
      exemptionResult,
      officerResult,
      committeeChecksResult,
      linkCodeResult,
      applicationResult,
      statisticianChecksResult,
      committeeInjuriesResult,
      submissionResult,
      postsResult,
      actingResult,
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
      supabase.rpc('committee_checks_from'),
      supabase.rpc('my_link_code').maybeSingle(),
      supabase.rpc('my_wwcc_application').maybeSingle(),
      supabase.rpc('statistician_checks_from'),
      supabase.rpc('my_committee_sees_injuries'),
      supabase.rpc('my_wwcc_submission').maybeSingle(),
      supabase.rpc('my_safeguarding_posts').maybeSingle(),
      supabase.rpc('my_acting_safeguarding_posts').maybeSingle(),
    ]);
    setProfile((profileResult.data as Profile | null) ?? null);
    setMemberships((membershipResult.data as unknown as TeamMembership[] | null) ?? []);
    setCaptaincies((captainResult.data as GroupCaptain[] | null) ?? []);
    setIsClubCaptain(clubCaptainResult.data === true);
    setExemption((exemptionResult.data as MyVolunteerExemption | null) ?? null);
    setWwccApplication((applicationResult.data as MyWwccApplication | null) ?? null);
    setWwccSubmission((submissionResult.data as MyWwccSubmission | null) ?? null);
    setIsSafeguardingOfficer(officerResult.data === true);
    const acting = safeguardingPostsFrom(actingResult.data);
    setSafeguardingPosts(heldOrActing(safeguardingPostsFrom(postsResult.data), acting));
    setActingSafeguardingPosts(acting);
    // False only when the club chose committee members and left this one out.
    setCommitteeSeesInjuries(committeeInjuriesResult.data !== false);
    setCommitteeChecksFrom(
      typeof committeeChecksResult.data === 'string' ? committeeChecksResult.data : null,
    );
    setLinkCode((linkCodeResult.data as LinkCode | null) ?? null);
    setStatisticianChecksFrom(
      typeof statisticianChecksResult.data === 'string' ? statisticianChecksResult.data : null,
    );
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

  const waitingForGuardian = linkCode?.waiting ? linkCode : null;
  const { usable, paused } = useMemo(
    () =>
      usableProfile(
        profile,
        !!exemption?.valid,
        committeeChecksFrom,
        !!wwccApplication?.valid,
        statisticianChecksFrom,
        !!waitingForGuardian,
      ),
    [profile, exemption, committeeChecksFrom, wwccApplication, statisticianChecksFrom, waitingForGuardian],
  );
  const usableMemberships = useMemo(
    () =>
      // A locked child has no squads or teams to use until a parent is linked.
      waitingForGuardian
        ? []
        : // Stryker disable next-line ConditionalExpression: a shortcut; filtering with nothing paused keeps every place.
          paused.length === 0
          ? memberships
          : memberships.filter((m) => !paused.includes(m.team_role as AppRole)),
    [memberships, paused, waitingForGuardian],
  );

  // Stryker disable next-line OptionalChaining: hasRole is false for nobody, so usable is set by then.
  const isAdmin = hasRole(usable, 'admin') && usable?.status === 'approved';

  return (
    <AuthContext
      value={{
        loading,
        session,
        profile: usable,
        paused:
          paused.length > 0
            ? // Stryker disable next-line OptionalChaining: roles are only paused for a member.
              {
                roles: paused,
                stoodDown: !!profile?.stood_down_at,
                exemption,
                application: wwccApplication,
              }
            : null,
        exemption,
        wwccApplication,
        wwccSubmission,
        memberships: usableMemberships,
        captaincies,
        isClubCaptain,
        isAdmin,
        isSafeguardingOfficer,
        safeguardingPosts,
        actingSafeguardingPosts,
        committeeSeesInjuries,
        committeeChecksFrom,
        waitingForGuardian,
        isLocked: !!waitingForGuardian && profile?.status === 'approved',
        statisticianChecksFrom,
        refresh,
        signOut,
      }}>
      {children}
    </AuthContext>
  );
}

/**
 * The member with only the roles they can use now, and the roles left out. A
 * locked child (approved, waiting for a parent or guardian) shows as waiting,
 * so no screen treats them as approved; the database locks them the same way.
 */
function usableProfile(
  profile: Profile | null,
  exempt: boolean,
  committeeChecksFrom: string | null,
  applied: boolean,
  statisticianChecksFrom: string | null,
  waitingForGuardian: boolean,
) {
  if (profile && waitingForGuardian && profile.status === 'approved') {
    return { usable: { ...profile, status: 'pending' as const }, paused: [] };
  }
  const paused = profile
    ? pausedRoles(profile, exempt, committeeChecksFrom, applied, statisticianChecksFrom)
    : [];
  // Stryker disable next-line LogicalOperator,ConditionalExpression: a shortcut; nobody has nothing paused, and rebuilding with nothing paused gives the same roles.
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
