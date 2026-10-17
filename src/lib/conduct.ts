import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/** Someone the signed-in member still has to accept the code of conduct for this season. */
export type ConductTodo = {
  profile_id: string;
  full_name: string | null;
  /** A parent or guardian accepting for their child under 18. */
  for_child: boolean;
  /** The words they accept. */
  statement: string;
  code_of_conduct_url: string | null;
};

/** One season's acceptance of the code of conduct. */
export type ConductAcceptance = {
  season: number;
  accepted_by_name: string | null;
  accepted_as: 'self' | 'guardian';
  policy_version: string;
  statement: string;
  accepted_at: string;
};

/** For admins: a member who must accept the code, and whether they have this season. */
export type ConductStatus = {
  profile_id: string;
  full_name: string | null;
  role: string;
  under_18: boolean;
  accepted_at: string | null;
  accepted_by_name: string | null;
  /** Under 18 with a parent or guardian linked, none of them verified yet. */
  waiting_for_guardian: boolean;
};

/**
 * The code of conduct acceptances the signed-in member owes this season, for
 * themselves and their children under 18. Empty until the club links its
 * code of conduct.
 */
export function useConductTodos() {
  const { profile } = useAuth();
  const approved = profile?.status === 'approved';
  const [todos, setTodos] = useState<ConductTodo[]>([]);

  const load = useCallback(async () => {
    if (!approved) return;
    const { data } = await supabase.rpc('my_conduct_todos');
    setTodos((data as ConductTodo[] | null) ?? []);
  }, [approved]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { conductTodos: approved ? todos : [], reloadConductTodos: load };
}
