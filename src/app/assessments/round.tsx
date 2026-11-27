import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ChipGroup, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  SEARCH_FROM,
  athleteFilters,
  athleteLine,
  dueLabel,
  feedbackStatusLine,
  filterAthletes,
  isOverdue,
  nextRoundDate,
  roundTitle,
  shortDate,
  shortRange,
  summariesDue,
  summaryStatusLine,
  type AthleteFilter,
  type FeedbackStatus,
  type RoundDate,
  type RoundSheet,
  type SummaryStatus,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * A round's athletes for a panel member, built to be quick at training: the
 * next date on one line, a filter for who has nothing written or a summary to
 * sign, a search on a long list, and beside each athlete a button that goes
 * straight to a new observation. Tapping an athlete opens their assessment.
 */
export default function RoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [sheet, setSheet] = useState<RoundSheet | null>(null);
  const [dates, setDates] = useState<RoundDate[]>([]);
  const [summaries, setSummaries] = useState<SummaryStatus[]>([]);
  const [feedback, setFeedback] = useState<FeedbackStatus[]>([]);
  const [showDates, setShowDates] = useState(false);
  const [filter, setFilter] = useState<AthleteFilter>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('selection_round_sheet', { p_round_id: id });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const { data: dateRows } = await supabase.rpc('selection_round_dates', { p_round_id: id });
    // Where each athlete's summaries stand: the member's own, and a count.
    const { data: summaryRows } = await supabase.rpc('selection_round_summaries', { p_round_id: id });
    // Where each athlete's feedback stands; a draft shows to the head coach only.
    const { data: feedbackRows } = await supabase.rpc('selection_round_feedback', { p_round_id: id });
    setError(null);
    setFeedback((feedbackRows as FeedbackStatus[] | null) ?? []);
    setDates((dateRows as RoundDate[] | null) ?? []);
    setSummaries((summaryRows as SummaryStatus[] | null) ?? []);
    setSheet(data as RoundSheet);
  }, [id]);

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

  if (!sheet) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const groups = sheet.criteria.groups.length;
  const next = nextRoundDate(dates);
  const filters = athleteFilters(sheet.athletes, summaries, summariesDue(sheet, sheet.today));
  // A filter that has emptied since it was chosen falls back to everyone.
  const chosen = filters.some((f) => f.value === filter) ? filter : 'all';
  const shown = filterAthletes(sheet.athletes, summaries, chosen, search);
  const params = (athlete: string) => ({ round: sheet.id, athlete });
  // Observations are dated inside the round, so nothing can be added before it starts.
  const notStarted = !sheet.closed && sheet.starts_on > sheet.today;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="subtitle">{roundTitle(sheet)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {[sheet.team_name, shortRange(sheet), sheet.criteria_set_name].filter(Boolean).join(' · ')}
        {sheet.closed ? ' · closed, so nothing more can be added' : ''}
      </ThemedText>
      {notStarted ? <ThemedText type="smallBold">Starts {shortDate(sheet.starts_on, true)}</ThemedText> : null}
      <ErrorText>{error}</ErrorText>
      {dates.length > 0 ? (
        <PressableCard onPress={() => setShowDates((on) => !on)}>
          {showDates ? (
            <>
              <ThemedText type="smallBold">Dates</ThemedText>
              {dates.map((date) => {
                const late = isOverdue(date, sheet.today);
                return (
                  <ThemedText key={date.id} type={late ? 'smallBold' : 'small'} themeColor={late ? 'text' : 'textSecondary'}>
                    {formatDateString(date.due_on)} · {date.title} · {dueLabel(date, sheet.today)}
                  </ThemedText>
                );
              })}
            </>
          ) : (
            <>
              <ThemedText type="smallBold">
                {next ? `Next: ${next.title} · ${dueLabel(next, sheet.today)}` : 'Every date is done'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Tap to see all {dates.length} dates
              </ThemedText>
            </>
          )}
        </PressableCard>
      ) : null}

      {filters.length > 0 ? <ChipGroup options={filters} selected={[chosen]} onToggle={setFilter} /> : null}
      {sheet.athletes.length > SEARCH_FROM ? (
        <TextField label="Find an athlete" value={search} onChangeText={setSearch} placeholder="Type part of a name" />
      ) : null}

      {sheet.athletes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are no athletes in {sheet.team_name} for you to assess.
        </ThemedText>
      ) : shown.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No athlete matches.
        </ThemedText>
      ) : (
        // One athlete a row on a phone, two or three across on a tablet.
        <CardGrid gap={Spacing.four}>
          {shown.map((athlete) => {
          const line = athleteLine(athlete, groups, sheet.today, sheet.closed);
          // One line for the summaries and the feedback, so a row stays short.
          const summary =
            [
              summaryStatusLine(summaries.find((s) => s.athlete_id === athlete.id)),
              feedbackStatusLine(feedback.find((f) => f.athlete_id === athlete.id)),
            ]
              .filter(Boolean)
              .join(' · ') || null;
          const name = athlete.name ?? 'Athlete';
          return (
            <View key={athlete.id} style={styles.row}>
              <View style={styles.main}>
                <PressableCard onPress={() => router.push({ pathname: '/assessments/athlete', params: params(athlete.id) })}>
                  <ThemedText type="smallBold">{name}</ThemedText>
                  <ThemedText type={line.nudge ? 'smallBold' : 'small'} themeColor={line.nudge ? 'text' : 'textSecondary'}>
                    {line.text}
                  </ThemedText>
                  {summary ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {summary}
                    </ThemedText>
                  ) : null}
                </PressableCard>
              </View>
              {sheet.closed || notStarted ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add an observation about ${name}`}
                  onPress={() => router.push({ pathname: '/assessments/observe', params: params(athlete.id) })}
                  style={[styles.add, { backgroundColor: theme.accent }]}>
                  <ThemedText type="subtitle" style={{ color: theme.onAccent }}>
                    +
                  </ThemedText>
                </Pressable>
              )}
            </View>
          );
          })}
        </CardGrid>
      )}
      {sheet.hidden > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {sheet.hidden === 1 ? '1 athlete isn’t' : `${sheet.hidden} athletes aren’t`} listed because
          you are their parent or guardian. The rest of the panel assesses them.
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        {sheet.closed ? '' : 'Tap + to add an observation, or a name to read the assessment. '}There is
        no score or ranking.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two },
  main: { flex: 1 },
  add: { width: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
