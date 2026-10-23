import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ChipGroup, ErrorText } from '@/components/ui';
import type { MedicalComplianceRow } from '@/lib/medical';
import { fetchAll, medicalCheckReport, type Placement } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { teamLabel, teamsIn, topGroups, useTeams } from '@/lib/use-teams';

const ALL = 'all';

/**
 * Admins: who has checked their medical and emergency details this year,
 * for the whole club or chosen squads and teams.
 */
export default function MedicalCheckReportScreen() {
  const teams = useTeams();
  const [rows, setRows] = useState<MedicalComplianceRow[] | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string[]>([ALL]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [result, athletes] = await Promise.all([
        supabase.rpc('medical_review_compliance'),
        fetchAll<Placement>((from, to) =>
          supabase
            .from('team_members')
            .select('team_id, profile_id, team_role')
            .eq('team_role', 'athlete')
            .range(from, to),
        ),
      ]);
      if (result.error) throw new Error(result.error.message);
      setRows((result.data as MedicalComplianceRow[] | null) ?? []);
      setPlacements(athletes);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The report didn’t load. Try again.');
    }
  }, []);

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

  function toggle(value: string) {
    if (value === ALL) {
      setSelected([ALL]);
      return;
    }
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected.filter((v) => v !== ALL), value];
    setSelected(next.length ? next : [ALL]);
  }

  // Squads (or teams, without squads) with their teams under them.
  const groups = topGroups(teams).flatMap((g) => [g, ...teamsIn(teams, g.id)]);
  const groupOptions = [
    { value: ALL, label: 'All' },
    ...groups.map((g) => ({ value: g.id, label: teamLabel(g, teams) })),
  ];

  // A squad includes the athletes of the teams named from it.
  const all = selected.includes(ALL);
  const teamIds = new Set(selected.flatMap((id) => [id, ...teamsIn(teams, id).map((t) => t.id)]));
  const inGroups = new Set(placements.filter((p) => teamIds.has(p.team_id)).map((p) => p.profile_id));
  const shown = rows?.filter((r) => all || inGroups.has(r.athlete_id)) ?? [];
  const groupsLabel = all
    ? undefined
    : groupOptions
        .filter((o) => selected.includes(o.value))
        .map((o) => o.label)
        .join(', ');

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ChipGroup label="Squads and teams" options={groupOptions} selected={selected} onToggle={toggle} />
      <ErrorText>{error}</ErrorText>
      {rows ? <ReportView report={medicalCheckReport(shown, new Date(), groupsLabel)} /> : null}
    </Screen>
  );
}
