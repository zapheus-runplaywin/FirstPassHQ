import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { commentAuthor, outcomeLabel } from '@/lib/goals';
import { supabase } from '@/lib/supabase';
import type { TeamGameGoal, TeamGameGoalComment } from '@/lib/types';

/**
 * The coaches' goals for the whole team in a game, how each went, and the
 * team's comments on them. Members of the team can add comments; everyone
 * else (such as parents and guardians) reads them.
 */
export function TeamGoals({
  goals,
  comments,
  canComment,
  userId,
  onChanged,
}: {
  goals: TeamGameGoal[];
  comments: TeamGameGoalComment[];
  canComment: boolean;
  userId: string | undefined;
  onChanged: () => Promise<void>;
}) {
  if (goals.length === 0) return null;
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Team goals</ThemedText>
      {goals.map((goal) => (
        <View key={goal.id} style={styles.section}>
          <Card style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              Set by Coach {goal.set_by_name}
            </ThemedText>
            <ThemedText>{goal.body}</ThemedText>
            {goal.outcome || goal.review ? (
              <View style={styles.review}>
                <ThemedText type="smallBold">
                  {outcomeLabel(goal.outcome) ?? 'Coach’s review'}
                </ThemedText>
                {goal.review ? <ThemedText type="small">{goal.review}</ThemedText> : null}
                {goal.reviewed_by_name ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Coach {goal.reviewed_by_name}
                  </ThemedText>
                ) : null}
              </View>
            ) : null}
            <TeamGoalComments
              comments={comments.filter((c) => c.goal_id === goal.id)}
              canRemove={(c) => !!userId && c.author_id === userId}
              onChanged={onChanged}
            />
          </Card>
          {canComment ? <AddTeamGoalComment goalId={goal.id} onAdded={onChanged} /> : null}
        </View>
      ))}
    </View>
  );
}

/** The comments on one team goal, oldest first, each with Remove where allowed. */
export function TeamGoalComments({
  comments,
  canRemove,
  onChanged,
}: {
  comments: TeamGameGoalComment[];
  canRemove: (comment: TeamGameGoalComment) => boolean;
  onChanged: () => Promise<void>;
}) {
  if (comments.length === 0) return null;
  return (
    <View style={styles.comments}>
      {comments.map((c) => (
        <TeamGoalComment key={c.id} comment={c} removable={canRemove(c)} onRemoved={onChanged} />
      ))}
    </View>
  );
}

function TeamGoalComment({
  comment,
  removable,
  onRemoved,
}: {
  comment: TeamGameGoalComment;
  removable: boolean;
  onRemoved: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const { error: removeError } = await supabase.rpc('delete_team_game_goal_comment', {
      p_comment_id: comment.id,
    });
    setBusy(false);
    if (removeError) setError(removeError.message);
    else await onRemoved();
  }

  return (
    <View style={styles.comment}>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
          {commentAuthor(comment)}
        </ThemedText>
        {removable && !confirming ? (
          <Pressable accessibilityRole="button" onPress={() => setConfirming(true)}>
            <ThemedText type="small" themeColor="textSecondary">
              Remove
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <ThemedText type="small">{comment.body}</ThemedText>
      {confirming ? (
        <View style={styles.section}>
          <ThemedText type="small">Remove this comment?</ThemedText>
          <Button title="Remove comment" variant="danger" onPress={remove} busy={busy} />
          <Button title="Cancel" variant="secondary" onPress={() => setConfirming(false)} />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

/** A member of the team adds a comment to a team goal. */
export function AddTeamGoalComment({
  goalId,
  onAdded,
}: {
  goalId: string;
  onAdded: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('add_team_game_goal_comment', {
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
    return <Button title="Comment" variant="secondary" onPress={() => setOpen(true)} />;
  }

  return (
    <View style={styles.section}>
      <TextField
        label="Your comment"
        value={body}
        onChangeText={setBody}
        placeholder="What you think, and what you’ll do to help"
        maxLength={1000}
        multiline
      />
      <ErrorText>{error}</ErrorText>
      <Button title="Add comment" onPress={add} busy={saving} disabled={!body.trim()} />
      <Button
        title="Cancel"
        variant="secondary"
        onPress={() => {
          setBody('');
          setOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  review: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  comments: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  comment: {
    gap: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: {
    flex: 1,
  },
});
