import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  attendanceLine,
  buildPicture,
  contextLabels,
  feedbackStatusLine,
  releaseStatusLine,
  ratingLines,
  roundGameLine,
  roundGameTitle,
  tallyLabel,
  type AthleteAssessment,
  type AthleteFeedback,
  type AthleteRelease,
  type Observation,
  type RoundAttendance,
  type RoundGame,
} from '@/lib/assessments';
import {
  fetchGameEvidence,
  momentChips,
  momentEvidence,
  momentLabel,
  momentTime,
  statLines,
  type GameMoment,
  type GameStats,
  type MomentKind,
} from '@/lib/game-stats';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * One athlete's assessment in a round, for the panel: what has been seen
 * against each of the criteria so far, then every observation, newest first.
 * There is no total or score. Opening an under 18's is recorded by the
 * database in their record views.
 */
export default function AthleteAssessmentScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const [assessment, setAssessment] = useState<AthleteAssessment | null>(null);
  const [attendance, setAttendance] = useState<RoundAttendance | null>(null);
  const [feedback, setFeedback] = useState<AthleteFeedback | null>(null);
  const [release, setRelease] = useState<AthleteRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [games, setGames] = useState<RoundGame[]>([]);
  // The game that is open on the Games tab, and its figures once fetched (null when there are none).
  const [openGame, setOpenGame] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, GameStats | null>>({});
  const [moments, setMoments] = useState<Record<string, GameMoment[]>>({});
  // The kind of moment listed for the open game: none until a chip is tapped, so the card stays short.
  const [momentKind, setMomentKind] = useState<MomentKind | null>(null);
  const [tab, setTab] = useState<'picture' | 'observations' | 'games'>('picture');

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('athlete_assessment', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    // Two counts from attendance, and nothing else: never an absence or its reason.
    const { data: counts } = await supabase
      .rpc('athlete_round_attendance', { p_round_id: round, p_athlete_id: athlete })
      .maybeSingle();
    // Feedback for the athlete: the head coach writes it, the panel reads it once shared.
    const { data: shared } = await supabase.rpc('athlete_feedback', { p_round_id: round, p_athlete_id: athlete });
    // The games the athlete played during the round: which and when. Figures are fetched for one game when it is opened.
    const { data: played } = await supabase.rpc('selection_round_games', { p_round_id: round, p_athlete_id: athlete });
    // What the head coach released to the athlete (part 5): status only here.
    const { data: released } = await supabase.rpc('athlete_release', { p_round_id: round, p_athlete_id: athlete });
    setError(null);
    setRelease((released as AthleteRelease | null) ?? null);
    setGames((played as RoundGame[] | null) ?? []);
    setFeedback((shared as AthleteFeedback | null) ?? null);
    setAttendance((counts as RoundAttendance | null) ?? null);
    setAssessment(data as AthleteAssessment);
  }, [round, athlete]);

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

  if (!assessment) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const picture = buildPicture(assessment.criteria, assessment.observations);
  const attended = attendanceLine(attendance);

  async function toggleGame(game: RoundGame) {
    const opening = openGame !== game.fixture_id;
    setOpenGame(opening ? game.fixture_id : null);
    setMomentKind(null);
    if (opening && game.recorded && !(game.fixture_id in stats)) {
      const fetched = await fetchGameEvidence(athlete, game.fixture_id);
      setStats((known) => ({ ...known, [game.fixture_id]: fetched.stats }));
      setMoments((known) => ({ ...known, [game.fixture_id]: fetched.moments }));
    }
  }

  function observe(params: { id?: string; corrects?: string; context?: string; on?: string; about?: string } = {}) {
    router.push({ pathname: '/assessments/observe', params: { round, athlete, ...params } });
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ThemedText type="subtitle">{assessment.athlete_name ?? 'Athlete'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {assessment.round_name}
        {assessment.closed ? ' · closed' : ''} ·{' '}
        {picture.observations === 0
          ? 'nothing written yet'
          : `${picture.observations} ${picture.observations === 1 ? 'observation' : 'observations'} from ${
              picture.selectors
            } ${picture.selectors === 1 ? 'selector' : 'selectors'}`}
      </ThemedText>
      {attended ? (
        <ThemedText type="small" themeColor="textSecondary">
          {attended}
        </ThemedText>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {assessment.closed ? null : <Button title="Add an observation" onPress={() => observe()} />}
      <Button
        title="My summary"
        variant="secondary"
        onPress={() => router.push({ pathname: '/assessments/summary', params: { round, athlete } })}
      />

      {feedback && (feedback.can_write || feedback.feedback) ? (
        <Button
          title={
            feedback.feedback
              ? (feedbackStatusLine({
                  state: feedback.feedback.shared_at ? 'shared' : 'draft',
                  seen: feedback.feedback.seen_at !== null,
                }) ?? 'Feedback')
              : 'Write feedback'
          }
          variant="secondary"
          onPress={() => router.push({ pathname: '/assessments/feedback', params: { round, athlete } })}
        />
      ) : null}
      {release && (release.can_release || release.release?.released_at) ? (
        <Button
          title={
            release.release?.released_at
              ? (releaseStatusLine({ seen: release.release.seen_at !== null }) ?? 'Assessment released')
              : 'Release assessment'
          }
          variant="secondary"
          onPress={() => router.push({ pathname: '/assessments/release', params: { round, athlete } })}
        />
      ) : null}

      {picture.observations > 0 || games.length > 0 ? (
        <>
          <ChipGroup
            options={[
              { value: 'picture' as const, label: 'The picture so far' },
              { value: 'observations' as const, label: `Observations (${picture.observations})` },
              ...(games.length > 0 ? [{ value: 'games' as const, label: `Games (${games.length})` }] : []),
            ]}
            selected={[tab]}
            onToggle={setTab}
          />
          {tab === 'games' ? (
            <>
              <CardGrid gap={Spacing.four}>
                {games.map((game) => {
                  const isOpen = openGame === game.fixture_id;
                  const figures = stats[game.fixture_id];
                  const listed = moments[game.fixture_id] ?? [];
                  return (
                    <PressableCard key={game.fixture_id} onPress={() => toggleGame(game)}>
                      <ThemedText type="smallBold">{roundGameTitle(game)}</ThemedText>
                      {!isOpen ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {roundGameLine(game)}
                        </ThemedText>
                      ) : (
                        <>
                          {!game.recorded ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              This game wasn’t recorded in FirstPass Vantage, so there are no stats.
                            </ThemedText>
                          ) : figures === undefined ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              Getting the stats…
                            </ThemedText>
                          ) : figures === null ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              No stats for this athlete in this game.
                            </ThemedText>
                          ) : (
                            statLines(figures).map((line) => (
                              <View key={line.label} style={styles.stat}>
                                <ThemedText type="small" themeColor="textSecondary">
                                  {line.label}
                                </ThemedText>
                                <ThemedText type="small" style={styles.statValue}>
                                  {line.value}
                                </ThemedText>
                              </View>
                            ))
                          )}
                          {figures && listed.length > 0 ? (
                            <View style={styles.moments}>
                              <ChipGroup
                                label="Moments"
                                options={momentChips(listed).map((k) => ({
                                  value: k.kind,
                                  label: `${k.label} (${k.count})`,
                                }))}
                                selected={momentKind ? [momentKind] : []}
                                onToggle={(kind) => setMomentKind((now) => (now === kind ? null : kind))}
                              />
                              {momentKind === null ? (
                                <ThemedText type="small" themeColor="textSecondary">
                                  Tap a kind for each one’s quarter and time on the game clock, to find it
                                  in the video.
                                </ThemedText>
                              ) : (
                                listed
                                  .filter((m) => m.kind === momentKind)
                                  .map((m, n) => (
                                    <Pressable
                                      key={n}
                                      accessibilityRole={assessment.closed ? undefined : 'button'}
                                      disabled={assessment.closed}
                                      onPress={() =>
                                        observe({
                                          context: 'game',
                                          on: game.played_on,
                                          about: momentEvidence(game.opponent, m),
                                        })
                                      }
                                      style={styles.moment}>
                                      <ThemedText type="small">{momentTime(m)}</ThemedText>
                                      <ThemedText type="small" themeColor="textSecondary" style={styles.statValue}>
                                        {momentLabel(m)}
                                      </ThemedText>
                                    </Pressable>
                                  ))
                              )}
                              {momentKind !== null && !assessment.closed ? (
                                <ThemedText type="small" themeColor="textSecondary">
                                  Tap a moment to write about it.
                                </ThemedText>
                              ) : null}
                            </View>
                          ) : null}
                          {assessment.closed ? null : (
                            <Button
                              title="Write about this game"
                              variant="secondary"
                              onPress={() => observe({ context: 'game', on: game.played_on })}
                            />
                          )}
                        </>
                      )}
                    </PressableCard>
                  );
                })}
              </CardGrid>
              <ThemedText type="small" themeColor="textSecondary">
                Stats are this athlete’s own, from games recorded during the round. Only their
                coaches and this panel see them.
              </ThemedText>
            </>
          ) : picture.observations === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing written yet. A line after training or a game is enough.
            </ThemedText>
          ) : tab === 'picture' ? (
            <>
          {picture.groups
            .filter((group) => group.count > 0)
            .map((group) => {
              const unseen = group.items.filter((item) => item.count === 0);
              return (
                <Card key={group.key} style={styles.card}>
                  <ThemedText type="smallBold">{group.name}</ThemedText>
                  {group.items
                    .filter((item) => item.count > 0)
                    .map((item) => (
                      <View key={item.key}>
                        <ThemedText type="small">{item.name}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {tallyLabel(group.scale, item.tally)} · seen {item.count}{' '}
                          {item.count === 1 ? 'time' : 'times'} by {item.selectors}{' '}
                          {item.selectors === 1 ? 'selector' : 'selectors'}
                        </ThemedText>
                      </View>
                    ))}
                  {unseen.length > 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      Nothing yet on: {unseen.map((item) => item.name).join(', ')}
                    </ThemedText>
                  ) : null}
                </Card>
              );
            })}
          {picture.missing.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing yet on: {picture.missing.join(', ')}
            </ThemedText>
          ) : null}
            </>
          ) : (
            assessment.observations.map((o) => (
              <ObservationCard
                key={o.id}
                observation={o}
                assessment={assessment}
                onChange={() => observe({ id: o.id })}
                onCorrect={() => observe({ corrects: o.id })}
              />
            ))
          )}
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          A line after training or a game is enough. Over the round they add up to a picture of
          the athlete against each of the criteria.
        </ThemedText>
      )}
    </Screen>
  );
}

function ObservationCard({
  observation: o,
  assessment,
  onChange,
  onCorrect,
}: {
  observation: Observation;
  assessment: AthleteAssessment;
  onChange: () => void;
  onCorrect: () => void;
}) {
  const corrected = o.corrects_id
    ? assessment.observations.find((other) => other.id === o.corrects_id)
    : null;
  return (
    <Card style={styles.card}>
      <ThemedText type="smallBold">
        {formatDateString(o.observed_on)} · {contextLabels[o.context]} · {o.mine ? 'You' : o.author_name}
      </ThemedText>
      {o.corrects_id ? (
        <ThemedText type="small" themeColor="textSecondary">
          Corrects {corrected ? `the observation of ${formatDateString(corrected.observed_on)}` : 'an earlier observation'}
        </ThemedText>
      ) : null}
      {ratingLines(assessment.criteria, o.ratings).map((line) => (
        <ThemedText key={line} type="small" themeColor="textSecondary">
          {line}
        </ThemedText>
      ))}
      {o.note ? <ThemedText type="small">{o.note}</ThemedText> : null}
      {o.can_change ? <Button title="Change" variant="secondary" onPress={onChange} /> : null}
      {o.mine && !o.can_change && !assessment.closed ? (
        <Button title="Add a correction" variant="secondary" onPress={onCorrect} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  statValue: { flexShrink: 1, textAlign: 'right' },
  moments: { gap: Spacing.one, marginTop: Spacing.two },
  moment: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three, paddingVertical: Spacing.one },
});
