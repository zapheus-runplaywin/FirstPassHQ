import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Team } from '@/lib/types';

export function useTeams() {
  const [teams, setTeams] = useState<Team[]>([]);

  useEffect(() => {
    supabase
      .from('teams')
      .select('id, name, sort_order')
      .order('sort_order')
      .then(({ data }) => setTeams(data ?? []));
  }, []);

  return teams;
}
