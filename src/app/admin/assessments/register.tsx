import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ChipGroup, ErrorText } from '@/components/ui';
import { selectionRegisterReport, type SelectionRegister } from '@/lib/assessments';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

/**
 * The Selection register: a season's rounds, panels, auditors, counts and
 * criteria sets, for admins. Staff names, counts and dates only: no athlete
 * is named and nothing a selector wrote is shown.
 */
export default function SelectionRegisterScreen() {
  const [register, setRegister] = useState<SelectionRegister | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('admin_selection_register', { p_season: season });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setError(null);
    setRegister(data as SelectionRegister);
  }, [season]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ErrorText>{error}</ErrorText>
      {register && register.seasons.length > 1 ? (
        <ChipGroup
          options={register.seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={[String(register.season)]}
          onToggle={(value) => setSeason(Number(value))}
        />
      ) : null}
      {register ? <ReportView folded report={selectionRegisterReport(register, seasonLabel(register.season))} /> : null}
    </Screen>
  );
}
