import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { type Affiliation, type Registration } from '@/lib/affiliation';
import { localDay } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

type Filter = 'check' | 'not' | 'registered' | 'all';

const roleLabels: Record<string, string> = {
  athlete: 'Athlete',
  coach: 'Coach',
  manager: 'Manager',
};

/**
 * Each athlete, coach and manager in this season's squads and teams, for an
 * admin to mark registered or not after looking them up in PlayHQ.
 */
export default function RegistrationsScreen() {
  const [season, setSeason] = useState<number | null>(null);
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [filter, setFilter] = useState<Filter>('check');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Marked since the screen opened. They stay in view, so a mis-tap can be undone. */
  const [justMarked, setJustMarked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_affiliation').maybeSingle();
    const current = (data as Affiliation | null)?.season ?? null;
    setSeason(current);
    if (current === null) {
      setRows([]);
      return;
    }
    const { data: list, error: listError } = await supabase.rpc('admin_playhq_registrations', {
      p_season: current,
    });
    if (listError) setError(listError.message);
    setRows((list as Registration[] | null) ?? []);
    setJustMarked(new Set());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function mark(row: Registration, registered: boolean) {
    if (season === null || row.registered === registered) return;
    setSaving(row.profile_id);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_set_playhq_registration', {
      p_profile_id: row.profile_id,
      p_season: season,
      p_registered: registered,
    });
    setSaving(null);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setJustMarked(new Set(justMarked).add(row.profile_id));
    setRows(
      (rows ?? []).map((r) =>
        r.profile_id === row.profile_id
          ? { ...r, registered, checked_at: new Date().toISOString(), checked_by_name: null }
          : r,
      ),
    );
  }

  const all = rows ?? [];
  const counts = {
    check: all.filter((r) => r.registered === null).length,
    not: all.filter((r) => r.registered === false).length,
    registered: all.filter((r) => r.registered === true).length,
    all: all.length,
  };
  const query = search.trim().toLowerCase();
  const shown = all.filter(
    (r) =>
      (filter === 'all' ||
        (filter === 'check' && r.registered === null) ||
        (filter === 'not' && r.registered === false) ||
        (filter === 'registered' && r.registered === true) ||
        justMarked.has(r.profile_id)) &&
      (!query ||
        [r.name, r.email, r.playhq_email].some((v) => v?.toLowerCase().includes(query))),
  );

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {season === null
          ? 'Add squads or teams for the season first.'
          : `Look each person up in PlayHQ and mark whether they’re registered for ${seasonLabel(season)}. Everyone in a squad or team as an athlete, coach or manager is listed.`}
      </ThemedText>
      <ChipGroup
        options={[
          { value: 'check', label: `To check (${counts.check})` },
          { value: 'not', label: `Not registered (${counts.not})` },
          { value: 'registered', label: `Registered (${counts.registered})` },
          { value: 'all', label: `All (${counts.all})` },
        ]}
        selected={[filter]}
        onToggle={(value) => {
          setFilter(value);
          setJustMarked(new Set());
        }}
      />
      <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Name or email" />
      <ErrorText>{error}</ErrorText>
      {rows && shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {filter === 'check' && all.length > 0 ? 'Everyone has been checked.' : 'Nobody here.'}
        </ThemedText>
      ) : null}
      {shown.map((r) => (
        <Card key={r.profile_id} style={styles.card}>
          <ThemedText type="smallBold">{r.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {[r.team_roles.map((role) => roleLabels[role] ?? role).join(', '), r.groups.join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </ThemedText>
          {r.playhq_email || r.email ? (
            <ThemedText type="small" themeColor="textSecondary">
              PlayHQ email: {r.playhq_email ?? r.email}
            </ThemedText>
          ) : null}
          <ChipGroup
            options={[
              { value: 'yes', label: 'Registered' },
              { value: 'no', label: 'Not registered' },
            ]}
            selected={r.registered === null ? [] : [r.registered ? 'yes' : 'no']}
            onToggle={(value) => saving !== r.profile_id && mark(r, value === 'yes')}
          />
          {r.checked_at ? (
            <ThemedText type="small" themeColor="textSecondary">
              Checked {localDay(r.checked_at)}
              {r.checked_by_name ? ` by ${r.checked_by_name}` : ''}
            </ThemedText>
          ) : null}
        </Card>
      ))}
      <View style={styles.footer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  footer: { height: Spacing.two },
});
