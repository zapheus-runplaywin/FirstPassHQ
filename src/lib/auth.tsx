import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import type { Profile, TeamMembership } from '@/lib/types';
import { TEAM_COLUMNS } from '@/lib/use-teams';

type AuthState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: TeamMembership[];
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const PROFILE_COLUMNS =
  'id, email, full_name, playhq_email, role, status, requested_role, requested_team_id, join_requested_at, under_17';

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);

  const loadMember = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setMemberships([]);
      return;
    }
    const [profileResult, membershipResult] = await Promise.all([
      supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single(),
      supabase
        .from('team_members')
        .select(`team_role, coach_title, selection, team:teams (${TEAM_COLUMNS})`)
        .eq('profile_id', userId),
    ]);
    setProfile((profileResult.data as Profile | null) ?? null);
    setMemberships((membershipResult.data as unknown as TeamMembership[] | null) ?? []);
  }, []);

  useEffect(() => {
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
  }, [loadMember]);

  const refresh = useCallback(() => loadMember(session?.user.id), [loadMember, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const isAdmin = profile?.role === 'admin' && profile.status === 'approved';

  return (
    <AuthContext value={{ loading, session, profile, memberships, isAdmin, refresh, signOut }}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
