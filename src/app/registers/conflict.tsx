import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ConflictForm } from '@/components/conflict-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import type { ConflictRow } from '@/lib/registers';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

/**
 * An admin changes someone's conflict-of-interest entry for a season, or
 * records one they gave on paper. The register shows the admin changed it.
 */
export default function EditConflictScreen() {
  const params = useLocalSearchParams<{ profile: string; season: string; name?: string }>();
  const season = Number(params.season);
  const [row, setRow] = useState<ConflictRow | null | undefined>(undefined);

  useEffect(() => {
    supabase.rpc('conflict_register', { p_season: season }).then(({ data }) => {
      setRow(((data as ConflictRow[] | null) ?? []).find((r) => r.profile_id === params.profile) ?? null);
    });
  }, [season, params.profile]);

  async function save(hasConflict: boolean, details: string) {
    const { error } = await supabase.rpc('admin_set_conflict_declaration', {
      p_profile_id: params.profile,
      p_season: season,
      p_has_conflict: hasConflict,
      p_details: details,
    });
    if (error) return error.message;
    router.back();
    return null;
  }

  if (row === undefined) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <ThemedText type="subtitle">{row?.name ?? params.name ?? 'Member'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {seasonLabel(season)} season. Use this to correct an entry or record a declaration given on
        paper. The register shows you changed it.
      </ThemedText>
      <ConflictForm
        hasConflict={row?.declared ? row.has_conflict : null}
        details={row?.details ?? null}
        saveTitle="Save"
        onSave={save}
      />
    </Screen>
  );
}
