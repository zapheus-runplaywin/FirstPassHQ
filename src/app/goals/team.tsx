import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { AddTeamGoalComment, TeamGoalComments } from '@/components/team-goals';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_GOALS,
  fetchTeamGoalComments,
  fetchTeamGoals,
  gamePhase,
  gameTitle,
  gameWhen,
  outcomeOptions,
} from '@/lib/goals';
import { supabase } from '@/lib/supabase';
import type {
  CoachTeamGame,
  GoalOutcome,
  TeamGameGoal,
  TeamGameGoalComment,
} from '@/lib/types';

/** A coach's goals for the whole squad or team in one game. */
export default function TeamGoalsScreen() {
  const { fixture } = useLocalSearchParams<{ fixture: string }>();
  const [game, setGame] = useState<CoachTeamGame | null>();
  const [goals, setGoals] = useState<TeamGameGoal[]>([]);
  const [comments, setComments] = useState<TeamGameGoalComment[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, list] = await Promise.all([
      supabase.rpc('coach_team_games'),
      fetchTeamGoals(fixture),
    ]);
    setGame(((data as CoachTeamGame[] | null) ?? []).find((g) => g.fixture_id === fixture) ?? null);
    setGoals(list);
    setComments(await fetchTeamGoalComments(list.map((g) => g.id)));
  }, [fixture]);

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

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title: 'Team goals' }} />
      <View style={styles.heading}>
        <ThemedText type="subtitle">{gameTitle(game)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {gameWhen(game)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {phase === 'open'
            ? 'Goals for the whole team. Everyone in it, and their parents or guardians, can see them, and everyone in the team can comment. You can add and change them until the game starts.'
            : phase === 'playing'
              ? 'Game on. You can say how each goal went after the game.'
              : 'How did the team go? Pick how each goal went and add a few words for the team.'}
        </ThemedText>
      </View>

      {goals.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {phase === 'open' ? 'No team goals yet.' : 'No team goals were set for this game.'}
        </ThemedText>
      ) : null}

      {goals.map((goal, index) => (
        <TeamGoalCard
          key={goal.id}
          number={index + 1}
          goal={goal}
          comments={comments.filter((c) => c.goal_id === goal.id)}
          editable={phase === 'open'}
          canReview={phase === 'played'}
          onChanged={load}
        />
      ))}

      {phase === 'open' && goals.length < MAX_GOALS ? (
        <AddTeamGoal fixtureId={fixture} onAdded={load} />
      ) : null}
    </Screen>
  );
}

function AddTeamGoal({ fixtureId, onAdded }: { fixtureId: string; onAdded: () => Promise<void> }) {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_team_game_goal', {
      p_goal_id: null,
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
        label="Add a team goal"
        value={body}
        onChangeText={setBody}
        placeholder="For example, win the third quarter"
        maxLength={300}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Add team goal" onPress={add} busy={saving} disabled={!body.trim()} />
    </View>
  );
}

function TeamGoalCard({
  number,
  goal,
  comments,
  editable,
  canReview,
  onChanged,
}: {
  number: number;
  goal: TeamGameGoal;
  comments: TeamGameGoalComment[];
  editable: boolean;
  canReview: boolean;
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

  return (
    <View style={styles.section}>
      <Card style={styles.card}>
        <ThemedText type="small" themeColor="textSecondary">
          Team goal {number} · set by Coach {goal.set_by_name}
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
                  supabase.rpc('save_team_game_goal', {
                    p_goal_id: goal.id,
                    p_fixture_id: goal.fixture_id,
                    p_body: body,
                  }),
                );
                if (ok) setEditing(false);
              }}
            />
            <ConfirmDelete
              title="Remove goal"
              warning="Remove this team goal from the game?"
              confirmTitle="Remove goal"
              busy={busy}
              onConfirm={() => run(supabase.rpc('delete_team_game_goal', { p_goal_id: goal.id }))}
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
        {/* Coaches can remove any comment on their team's goals. */}
        <TeamGoalComments comments={comments} canRemove={() => true} onChanged={onChanged} />
      </Card>
      <AddTeamGoalComment goalId={goal.id} onAdded={onChanged} />
      {canReview ? <Review goal={goal} onSaved={onChanged} /> : null}
    </View>
  );
}

function Review({ goal, onSaved }: { goal: TeamGameGoal; onSaved: () => Promise<void> }) {
  const [outcome, setOutcome] = useState<GoalOutcome | null>(goal.outcome);
  const [review, setReview] = useState(goal.review ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = goal.outcome !== null || goal.review !== null;
  const changed = outcome !== goal.outcome || review.trim() !== (goal.review ?? '');

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('review_team_game_goal', {
      p_goal_id: goal.id,
      p_outcome: outcome,
      p_review: review,
    });
    setSaving(false);
    if (saveError) setError(saveError.message);
    else await onSaved();
  }

  return (
    <View style={styles.section}>
      <ChipGroup
        label="How did the team go?"
        options={outcomeOptions}
        selected={outcome ? [outcome] : []}
        onToggle={(value) => setOutcome(value === outcome ? null : value)}
      />
      <TextField
        label="A few words for the team"
        value={review}
        onChangeText={setReview}
        placeholder="What worked, and what to work on at training"
        maxLength={1000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button
        title={saved ? 'Update review' : 'Save review'}
        onPress={save}
        busy={saving}
        disabled={!changed || (!outcome && !review.trim())}
      />
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
});
