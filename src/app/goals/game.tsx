import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GameStatsCard } from '@/components/game-stats-card';
import { Screen } from '@/components/screen';
import { TeamGoals } from '@/components/team-goals';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { fetchGameStats, type GameStats } from '@/lib/game-stats';
import {
  MAX_GOALS,
  fetchGame,
  fetchGoals,
  fetchTeamGoalComments,
  fetchTeamGoals,
  gamePhase,
  gameTitle,
  gameWhen,
  outcomeLabel,
  outcomeOptions,
  useCanCommentOnTeamGoals,
  useIsGoalCoach,
} from '@/lib/goals';
import { logRecordView } from '@/lib/record-access';
import { supabase } from '@/lib/supabase';
import type {
  GameGoal,
  GameGoalComment,
  GoalGame,
  GoalOutcome,
  TeamGameGoal,
  TeamGameGoalComment,
} from '@/lib/types';

/** One athlete's goals for one game: set before it, reflected on after it. */
export default function GameGoalsScreen() {
  const { athlete, fixture, name, view } = useLocalSearchParams<{
    athlete: string;
    fixture: string;
    name?: string;
    /** 'guardian' when a parent or guardian opened it from their home screen. */
    view?: string;
  }>();
  const { session } = useAuth();
  const isCoach = useIsGoalCoach();
  // Only the athlete sets and reflects on their own goals.
  const own = session?.user.id === athlete;
  // Parents and guardians only read them.
  const coach = !own && isCoach && view !== 'guardian';

  const [game, setGame] = useState<GoalGame | null>();
  const [goals, setGoals] = useState<GameGoal[]>([]);
  const [comments, setComments] = useState<GameGoalComment[]>([]);
  const [teamGoals, setTeamGoals] = useState<TeamGameGoal[]>([]);
  const [teamComments, setTeamComments] = useState<TeamGameGoalComment[]>([]);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canCommentOnTeamGoals = useCanCommentOnTeamGoals(game?.team_id);

  const load = useCallback(async () => {
    const [row, lists, team] = await Promise.all([
      fetchGame(athlete, fixture),
      fetchGoals(athlete, fixture),
      fetchTeamGoals(fixture),
    ]);
    setTeamGoals(team);
    setTeamComments(await fetchTeamGoalComments(team.map((g) => g.id)));
    setGame(row);
    setGoals(lists.goals);
    setComments(lists.comments);
    logRecordView(athlete, 'goals');
    // The athlete's own figures, once the game has been played and recorded.
    setStats(row && gamePhase(row) === 'played' ? await fetchGameStats(athlete, fixture) : null);
  }, [athlete, fixture]);

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

  if (game === undefined) return <Screen>{null}</Screen>;
  if (game === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This game isn’t available any more.
        </ThemedText>
      </Screen>
    );
  }

  const phase = gamePhase(game);
  const canEdit = (goal: GameGoal) => phase === 'open' && (goal.set_by_coach ? coach : own);

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: name || 'Game goals' }} />
      <View style={styles.heading}>
        <ThemedText type="subtitle">{gameTitle(game)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {gameWhen(game)}
          {game.venue ? ` · ${[game.venue, game.court].filter(Boolean).join(', ')}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {phase === 'open'
            ? own || coach
              ? 'Goals can be added and changed until the game starts.'
              : 'Your athlete and their coaches can add goals until the game starts.'
            : phase === 'playing'
              ? 'Game on. Reflections open after the game.'
              : own
                ? 'How did it go? Pick how each goal went and add a few words.'
                : coach
                  ? 'Read how the athlete thinks it went and add your comments.'
                  : 'How the athlete thinks it went, and what their coaches said.'}
        </ThemedText>
      </View>

      <TeamGoals
        goals={teamGoals}
        comments={teamComments}
        canComment={canCommentOnTeamGoals}
        userId={session?.user.id}
        onChanged={load}
      />

      {teamGoals.length > 0 ? <ThemedText type="smallBold">Personal goals</ThemedText> : null}

      {goals.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {phase === 'open' ? 'No goals yet.' : 'No goals were set for this game.'}
        </ThemedText>
      ) : null}

      {goals.map((goal, index) => (
        <GoalCard
          key={goal.id}
          number={index + 1}
          goal={goal}
          comments={comments.filter((c) => c.goal_id === goal.id)}
          editable={canEdit(goal)}
          canReflect={phase === 'played' && own}
          canComment={phase === 'played' && coach}
          onChanged={load}
        />
      ))}

      {phase === 'open' && (own || coach) && goals.length < MAX_GOALS ? (
        <AddGoal athleteId={athlete} fixtureId={fixture} asCoach={coach} onAdded={load} />
      ) : null}

      {phase === 'played' && stats ? <GameStatsCard stats={stats} own={own} /> : null}

      {own ? (
        <ThemedText type="small" themeColor="textSecondary">
          Your coaches see your goals and reflections. If you’re under 18, your parents or guardians
          do too.
        </ThemedText>
      ) : null}
    </Screen>
  );
}

function AddGoal({
  athleteId,
  fixtureId,
  asCoach,
  onAdded,
}: {
  athleteId: string;
  fixtureId: string;
  asCoach: boolean;
  onAdded: () => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_game_goal', {
      p_goal_id: null,
      p_athlete_id: athleteId,
      p_fixture_id: fixtureId,
      p_body: body,
    });
    if (saveError) {
      setError(saveError.message);
    } else {
      setBody('');
      await onAdded();
    }
    setSaving(false);
  }

  return (
    <View style={styles.section}>
      <TextField
        label={asCoach ? 'Add a goal for the athlete' : 'Add a goal'}
        value={body}
        onChangeText={setBody}
        placeholder="For example, win 3 centre pass receives"
        maxLength={300}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Add goal" onPress={add} busy={saving} disabled={!body.trim()} />
    </View>
  );
}

function GoalCard({
  number,
  goal,
  comments,
  editable,
  canReflect,
  canComment,
  onChanged,
}: {
  number: number;
  goal: GameGoal;
  comments: GameGoalComment[];
  editable: boolean;
  canReflect: boolean;
  canComment: boolean;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(goal.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: callError } = await call;
    setBusy(false);
    if (callError) {
      setError(callError.message);
      return false;
    }
    await onChanged();
    return true;
  }

  const setBy = goal.set_by_coach ? `Coach ${goal.set_by_name}` : goal.set_by_name;

  return (
    <View style={styles.section}>
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Goal {number} · set by {setBy}
        </ThemedText>

        {editing ? (
          <>
            <TextField label="Goal" value={body} onChangeText={setBody} maxLength={300} multiline />
            <ErrorText>{error}</ErrorText>
            <Button
              title="Save"
              busy={busy}
              disabled={!body.trim()}
              onPress={async () => {
                const ok = await run(
                  supabase.rpc('save_game_goal', {
                    p_goal_id: goal.id,
                    p_athlete_id: goal.athlete_id,
                    p_fixture_id: goal.fixture_id,
                    p_body: body,
                  }),
                );
                if (ok) setEditing(false);
              }}
            />
            <ConfirmDelete
              title="Remove goal"
              warning="Remove this goal from the game?"
              confirmTitle="Remove goal"
              busy={busy}
              onConfirm={() => run(supabase.rpc('delete_game_goal', { p_goal_id: goal.id }))}
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => {
                setBody(goal.body);
                setEditing(false);
              }}
            />
          </>
        ) : (
          <>
            <ThemedText>{goal.body}</ThemedText>
            {editable ? (
              <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} />
            ) : null}
          </>
        )}

        {!canReflect && (goal.outcome || goal.reflection) ? (
          <View style={styles.reflection}>
            <ThemedText type="smallBold">{outcomeLabel(goal.outcome) ?? 'Reflection'}</ThemedText>
            {goal.reflection ? <ThemedText type="small">{goal.reflection}</ThemedText> : null}
          </View>
        ) : null}

        {comments.map((c) => (
          <View key={c.id} style={styles.comment}>
            <ThemedText type="small" themeColor="textSecondary">
              Coach {c.author_name}
            </ThemedText>
            <ThemedText type="small">{c.body}</ThemedText>
          </View>
        ))}
      </Card>
      {canReflect ? <Reflect goal={goal} onSaved={onChanged} /> : null}
      {canComment ? <AddComment goalId={goal.id} onAdded={onChanged} /> : null}
    </View>
  );
}

function Reflect({ goal, onSaved }: { goal: GameGoal; onSaved: () => Promise<void> }) {
  const [outcome, setOutcome] = useState<GoalOutcome | null>(goal.outcome);
  const [reflection, setReflection] = useState(goal.reflection ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = goal.outcome !== null || goal.reflection !== null;
  const changed = outcome !== goal.outcome || reflection.trim() !== (goal.reflection ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('reflect_on_game_goal', {
      p_goal_id: goal.id,
      p_outcome: outcome,
      p_reflection: reflection,
    });
    setSaving(false);
    if (saveError) setError(saveError.message);
    else await onSaved();
  }

  return (
    <View style={styles.section}>
      <ChipGroup
        label="How did it go?"
        options={outcomeOptions}
        selected={outcome ? [outcome] : []}
        onToggle={(value) => setOutcome(value === outcome ? null : value)}
      />
      <TextField
        label="Your reflection"
        value={reflection}
        onChangeText={setReflection}
        placeholder="What worked, and what will you try next time?"
        maxLength={1000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={saved ? 'Update reflection' : 'Save reflection'}
        onPress={save}
        busy={saving}
        disabled={!changed || (!outcome && !reflection.trim())}
      />
    </View>
  );
}

function AddComment({ goalId, onAdded }: { goalId: string; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('add_game_goal_comment', {
      p_goal_id: goalId,
      p_body: body,
    });
    if (saveError) {
      setError(saveError.message);
    } else {
      setBody('');
      setOpen(false);
      await onAdded();
    }
    setSaving(false);
  }

  if (!open) {
    return (
      <Button title="Comment on this goal" variant="secondary" onPress={() => setOpen(true)} />
    );
  }

  return (
    <View style={styles.section}>
      <TextField
        label="Your comment"
        value={body}
        onChangeText={setBody}
        placeholder="Feedback for the athlete"
        maxLength={1000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Add comment" onPress={add} busy={saving} disabled={!body.trim()} />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  reflection: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  comment: {
    gap: Spacing.half,
    marginTop: Spacing.one,
  },
});
