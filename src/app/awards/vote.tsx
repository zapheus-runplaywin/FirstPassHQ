import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ballotLabel, closesLabel, slotTitle } from '@/lib/awards';
import { supabase } from '@/lib/supabase';
import type { AwardNominee, AwardSlot } from '@/lib/types';

/**
 * A ballot: tap nominees in order, first place first. Tapping a picked
 * nominee takes them off, and the places after them move up.
 */
export default function VoteScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{
    award: string;
    team?: string;
    fixture?: string;
    preseason?: string;
  }>();
  const teamId = params.team || null;
  const fixtureId = params.fixture || null;
  const preseason = params.preseason === '1';

  const [slot, setSlot] = useState<AwardSlot | null | undefined>(undefined);
  const [nominees, setNominees] = useState<AwardNominee[] | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    (async () => {
      const [slots, list, ballot] = await Promise.all([
        supabase.rpc('award_slots'),
        supabase.rpc('award_nominees', { p_award_id: params.award, p_team_id: teamId }),
        myBallot(params.award, teamId, fixtureId, preseason),
      ]);
      if (!current) return;
      const found = ((slots.data as AwardSlot[] | null) ?? []).find(
        (s) =>
          s.award_id === params.award &&
          s.team_id === teamId &&
          s.fixture_id === fixtureId &&
          s.preseason === preseason,
      );
      setSlot(found ?? null);
      setNominees((list.data as AwardNominee[] | null) ?? []);
      setPicks(ballot);
    })();
    return () => {
      current = false;
    };
  }, [params.award, teamId, fixtureId, preseason]);

  if (slot === undefined || nominees === null) return <Screen>{null}</Screen>;

  if (slot === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This vote has closed, or isn’t open to you.
        </ThemedText>
      </Screen>
    );
  }

  const places = Math.min(slot.points.length, nominees.length);
  const detail = slotTitle(slot);

  function toggle(id: string) {
    setError(null);
    setPicks((current) =>
      current.includes(id)
        ? current.filter((p) => p !== id)
        : current.length < places
          ? [...current, id]
          : current,
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_award_ballot', {
      p_award_id: params.award,
      p_team_id: teamId,
      p_fixture_id: fixtureId,
      p_preseason: preseason,
      p_picks: picks,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: slot.award_name }} />
      <Card>
        <ThemedText type="smallBold">{slot.award_name}</ThemedText>
        {detail ? <ThemedText type="small">{detail}</ThemedText> : null}
        {slot.description ? (
          <ThemedText type="small" themeColor="textSecondary">
            {slot.description}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          {ballotLabel(slot.points)} · {closesLabel(slot.closes_at)}
        </ThemedText>
      </Card>

      {nominees.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There’s nobody to vote for yet.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {places === 1
              ? 'Tap who you’re voting for.'
              : `Tap ${places} people in order, first place first. ${slot.points
                  .slice(0, places)
                  .map((p, i) => `${ordinal(i + 1)} gets ${p}`)
                  .join(', ')}.`}
          </ThemedText>
          <View style={styles.list}>
            {nominees.map((n) => {
              const place = picks.indexOf(n.id);
              const picked = place >= 0;
              return (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked }}
                  accessibilityLabel={picked ? `${n.name}, ${ordinal(place + 1)}` : n.name}
                  onPress={() => toggle(n.id)}
                  style={({ pressed }) => [
                    styles.nominee,
                    {
                      backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                      borderColor: picked ? theme.accent : 'transparent',
                    },
                  ]}>
                  <ThemedText style={styles.flex}>{n.name}</ThemedText>
                  {picked ? (
                    <View style={[styles.place, { backgroundColor: theme.accent }]}>
                      <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                        {places === 1 ? '✓' : `${ordinal(place + 1)} · ${slot.points[place]}`}
                      </ThemedText>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <ErrorText>{error}</ErrorText>
          <Button
            title={slot.voted ? 'Change my vote' : 'Vote'}
            onPress={save}
            busy={saving}
            disabled={picks.length !== places}
          />
        </>
      )}
    </Screen>
  );
}

/** The member's current picks for this vote, first place first. */
async function myBallot(
  awardId: string,
  teamId: string | null,
  fixtureId: string | null,
  preseason: boolean,
) {
  let query = supabase
    .from('award_ballots')
    .select('award_votes (rank, nominee_id, candidate_id)')
    .eq('award_id', awardId)
    .eq('preseason', preseason);
  query = teamId ? query.eq('team_id', teamId) : query.is('team_id', null);
  query = fixtureId ? query.eq('fixture_id', fixtureId) : query.is('fixture_id', null);
  const { data } = await query.maybeSingle();
  const votes =
    (data?.award_votes as
      | { rank: number; nominee_id: string | null; candidate_id: string | null }[]
      | undefined) ?? [];
  return [...votes]
    .sort((a, b) => a.rank - b.rank)
    .map((v) => v.nominee_id ?? v.candidate_id)
    .filter((id): id is string => id !== null);
}

function ordinal(n: number) {
  return ['1st', '2nd', '3rd', '4th', '5th'][n - 1] ?? `${n}th`;
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  nominee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    borderWidth: 2,
  },
  place: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: 999,
  },
  flex: {
    flex: 1,
  },
});
