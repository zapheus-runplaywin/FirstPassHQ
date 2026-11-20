import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { pluralRoleLabels } from '@/lib/labels';
import { isMinor } from '@/lib/age';
import {
  answersFor,
  answersProblem,
  MAX_ANSWER_LENGTH,
  MAX_ANSWERS,
  QUESTION_PRESETS,
  type QuestionChoice,
} from '@/lib/message-questions';
import { useCanMessageClub, useMessageGroups } from '@/lib/messages';
import { supabase } from '@/lib/supabase';
import type { AppRole, MessageAudience } from '@/lib/types';
import { teamLabel, useTeams } from '@/lib/use-teams';
import { hasRole } from '@/lib/roles';

const MAX_LENGTH = 4000;

/** Roles an admin can message, in the order they're shown. */
const messageableRoles: AppRole[] = [
  'athlete',
  'guardian',
  'coach',
  'manager',
  'committee',
  'physio',
  'admin',
];

export default function NewMessageScreen() {
  const { isAdmin, profile } = useAuth();
  const teams = useTeams();
  const groups = useMessageGroups(teams);
  // The committee and club captains can message the whole club, and any
  // groups they coach, manage or captain.
  const canMessageClub = useCanMessageClub();
  const messagesClubOnly = !isAdmin && canMessageClub;
  // Captains and junior coaches can be under 18; their parents or guardians get a copy.
  const copiesGuardians =
    !!profile && hasRole(profile, 'athlete') && isMinor(profile.date_of_birth, profile.under_17);
  const [audience, setAudience] = useState<MessageAudience>(canMessageClub ? 'club' : 'group');
  const [role, setRole] = useState<AppRole | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [question, setQuestion] = useState<QuestionChoice>('none');
  const [ownAnswers, setOwnAnswers] = useState<string[]>(['', '', '', '']);
  const [shareTotals, setShareTotals] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coaches and managers who lead one group don't need to pick it.
  const selectedTeamId = teamId ?? (groups.length === 1 ? groups[0].id : null);

  async function send() {
    if (!body.trim()) {
      setError('Write a message first.');
      return;
    }
    if (audience === 'role' && !role) {
      setError('Choose who to send it to.');
      return;
    }
    if (audience === 'group' && !selectedTeamId) {
      setError('Choose a squad or team.');
      return;
    }
    const answers = answersFor(question, ownAnswers);
    const problem = answers ? answersProblem(answers) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    const to = {
      p_body: body,
      p_audience: audience,
      p_role: audience === 'role' ? role : null,
      p_team_id: audience === 'group' ? selectedTeamId : null,
    };
    const { data, error: sendError } = answers
      ? await supabase.rpc('send_group_question', { ...to, p_options: answers, p_share_totals: shareTotals })
      : await supabase.rpc('send_group_message', to);
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    router.replace({ pathname: '/messages/[id]', params: { id: data as string } });
  }

  return (
    <Screen>
      {isAdmin ? (
        <ChipGroup
          label="Send to"
          options={[
            { value: 'club', label: 'Everyone' },
            { value: 'role', label: 'A role' },
            { value: 'group', label: 'A squad or team' },
          ]}
          selected={[audience]}
          onToggle={(value) => {
            setAudience(value);
            setError(null);
          }}
        />
      ) : messagesClubOnly && groups.length > 0 ? (
        <ChipGroup
          label="Send to"
          options={[
            { value: 'club', label: 'Everyone' },
            { value: 'group', label: 'A squad or team' },
          ]}
          selected={[audience]}
          onToggle={(value) => {
            setAudience(value);
            setError(null);
          }}
        />
      ) : messagesClubOnly ? (
        <ThemedText type="small" themeColor="textSecondary">
          This goes to everyone in the club.
        </ThemedText>
      ) : null}

      {audience === 'role' ? (
        <ChipGroup
          label="Role"
          options={messageableRoles.map((r) => ({ value: r, label: pluralRoleLabels[r] }))}
          selected={role ? [role] : []}
          onToggle={setRole}
        />
      ) : null}

      {audience === 'group' ? (
        groups.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            You can message the squads and teams you coach, manage or captain once an admin adds you to one.
          </ThemedText>
        ) : (
          <ChipGroup
            label={isAdmin || messagesClubOnly ? 'Squad or team' : 'Send to'}
            options={groups.map((t) => ({ value: t.id, label: teamLabel(t, teams) }))}
            selected={selectedTeamId ? [selectedTeamId] : []}
            onToggle={setTeamId}
          />
        )
      ) : null}

      <View style={styles.field}>
        <TextField
          label="Message"
          value={body}
          onChangeText={setBody}
          placeholder="Write your message"
          multiline
          maxLength={MAX_LENGTH}
        />
        {body.length > MAX_LENGTH - 200 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {MAX_LENGTH - body.length} characters left
          </ThemedText>
        ) : null}
      </View>

      <ChipGroup
        label="Ask a question"
        options={[
          { value: 'none' as QuestionChoice, label: 'No question' },
          ...QUESTION_PRESETS.map((p) => ({ value: p.value as QuestionChoice, label: p.label })),
          { value: 'own' as QuestionChoice, label: 'My own answers' },
        ]}
        selected={[question]}
        onToggle={(value) => {
          setQuestion(value);
          setError(null);
        }}
      />

      {question === 'own' ? (
        <View style={styles.field}>
          {ownAnswers.slice(0, MAX_ANSWERS).map((answer, i) => (
            <TextField
              key={i}
              label={i < 2 ? `Answer ${i + 1}` : `Answer ${i + 1} (optional)`}
              value={answer}
              onChangeText={(text) =>
                setOwnAnswers((all) => all.map((a, j) => (j === i ? text : a)))
              }
              maxLength={MAX_ANSWER_LENGTH}
            />
          ))}
        </View>
      ) : null}

      {question !== 'none' ? (
        <>
          <ChipGroup
            label="Share the totals with everyone it goes to"
            options={[
              { value: 'no', label: 'No, just me' },
              { value: 'yes', label: 'Yes, the totals' },
            ]}
            selected={[shareTotals ? 'yes' : 'no']}
            onToggle={(value) => setShareTotals(value === 'yes')}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Everyone taps one answer, once, and can’t write anything else. Parents and guardians
            can answer for their child. You, the squad or team’s coaches and managers, and admins see
            who gave which answer. Nobody else sees names.
          </ThemedText>
        </>
      ) : null}

      <ThemedText type="small" themeColor="textSecondary">
        You’ll see who has read it. Club admins can read every message.
        {copiesGuardians ? ' Your parents or guardians get a copy too.' : ''}
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title="Send" onPress={send} busy={sending} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
});
