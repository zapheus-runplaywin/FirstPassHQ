import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { seasonLabel, useTeams } from '@/lib/use-teams';

type Choice = { profile_id: string; full_name: string | null; is_captain: boolean; is_minor: boolean };

/**
 * Admins choose the season's club captains from its athletes. Club captains
 * can message the whole club while the season is current.
 */
export default function ClubCaptainsScreen() {
  const teams = useTeams();
  const seasons = [...new Set(teams.map((t) => t.season))].sort((a, b) => b - a);
  const [season, setSeason] = useState<number | null>(null);
  const shownSeason = season ?? seasons[0] ?? null;
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shownSeason === null) return;
    supabase.rpc('club_captain_choices', { p_season: shownSeason }).then(({ data }) => {
      const rows = (data as Choice[] | null) ?? [];
      setChoices(rows);
      setSelected(rows.filter((r) => r.is_captain).map((r) => r.profile_id));
    });
  }, [shownSeason]);

  async function save() {
    if (shownSeason === null) return;
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_club_captains', {
      p_season: shownSeason,
      p_profile_ids: selected,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  function toggle(profileId: string) {
    setSelected((current) =>
      current.includes(profileId)
        ? current.filter((p) => p !== profileId)
        : [...current, profileId],
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Club captains can message everyone in the club. Messages from athletes under 18 are copied
        to their parents or guardians.
      </ThemedText>

      {seasons.length > 1 ? (
        <ChipGroup
          label="Season"
          options={seasons.map((s) => ({ value: String(s), label: seasonLabel(s) }))}
          selected={shownSeason === null ? [] : [String(shownSeason)]}
          onToggle={(value) => setSeason(Number(value))}
        />
      ) : null}

      {choices === null ? null : choices.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No athletes are in this season’s squads yet.
        </ThemedText>
      ) : (
        <ChipGroup
          label={`Club captains${shownSeason === null ? '' : ` for ${seasonLabel(shownSeason)}`}`}
          options={choices.map((c) => ({
            value: c.profile_id,
            label: `${c.full_name ?? 'Unnamed member'}${c.is_minor ? ' (under 18)' : ''}`,
          }))}
          selected={selected}
          onToggle={toggle}
        />
      )}

      <ThemedText type="small" themeColor="textSecondary">
        {selected.length === 0
          ? 'No club captains chosen.'
          : `${selected.length} club ${selected.length === 1 ? 'captain' : 'captains'} chosen.`}
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title="Save club captains" onPress={save} busy={saving} />
    </Screen>
  );
}
