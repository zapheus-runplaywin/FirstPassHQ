import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CardGrid } from '@/components/columns';
import { ReportView } from '@/components/report-view';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ConfirmDelete, ErrorText, PressableCard, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  MAX_SUMMARY_TEXT,
  myObservationsLine,
  nextToSign,
  setSummaryRating,
  summaryComparison,
  summaryCoverage,
  summaryProblem,
  summarySheetReport,
  summaryStart,
  type AssessmentSummary,
  type RoundSheet,
  type SheetAthlete,
  type SummaryStatus,
  type SummaryDraft,
} from '@/lib/assessments';
import { formatDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * A selector's own summary of an athlete at the end of a round: a step for
 * each of the criteria they choose, a recommendation, and a few words. It
 * starts from the steps in their own observations. They write it without
 * seeing anyone else's; once they sign it, it locks and the screen shows
 * every signed summary side by side, with a PDF of the sheet. There is no
 * total or score.
 */
export default function SummaryScreen() {
  const { round, athlete } = useLocalSearchParams<{ round: string; athlete: string }>();
  const [summary, setSummary] = useState<AssessmentSummary | null>(null);
  const [draft, setDraft] = useState<SummaryDraft | null>(null);
  const [next, setNext] = useState<SheetAthlete | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('my_assessment_summary', {
      p_round_id: round,
      p_athlete_id: athlete,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    const loaded = data as AssessmentSummary;
    setError(null);
    setSummary(loaded);
    setDraft(summaryStart(loaded));
    // The next athlete whose summary is still to sign, to move on without going back.
    const { data: sheet } = await supabase.rpc('selection_round_sheet', { p_round_id: round });
    const { data: statuses } = await supabase.rpc('selection_round_summaries', { p_round_id: round });
    setNext(
      nextToSign((sheet as RoundSheet | null)?.athletes ?? [], (statuses as SummaryStatus[] | null) ?? [], athlete),
    );
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

  if (!summary || !draft) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }

  const criteria = summary.criteria;
  const recommendations = criteria.recommendations ?? [];
  const signedAt = summary.mine?.signed_at ?? null;

  async function save(sign: boolean) {
    if (!draft) return;
    const problem = summaryProblem(draft, criteria, sign);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: saveError } = await supabase.rpc('save_assessment_summary', {
      p_round_id: round,
      p_athlete_id: athlete,
      p_ratings: draft.ratings,
      p_recommendation: draft.recommendation,
      p_strengths: draft.strengths.trim(),
      p_priorities: draft.priorities.trim(),
      p_comments: draft.comments.trim(),
      p_sign: sign,
    });
    if (saveError) {
      setBusy(false);
      setError(saveError.message);
      return;
    }
    await load();
    setBusy(false);
    setSaved(!sign);
  }

  async function reopen(id: string) {
    setBusy(true);
    setError(null);
    const { error: reopenError } = await supabase.rpc('reopen_assessment_summary', { p_summary_id: id });
    if (reopenError) setError(reopenError.message);
    else await load();
    setBusy(false);
  }

  const onwards =
    next && !summary.closed ? (
      <Button
        title={`Next: ${next.name ?? 'Athlete'}`}
        variant="secondary"
        onPress={() => router.replace({ pathname: '/assessments/summary', params: { round, athlete: next.id } })}
      />
    ) : null;

  const heading = (
    <>
      <ThemedText type="subtitle">{summary.athlete_name ?? 'Athlete'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {summary.round_name}
        {summary.closed ? ' · closed' : ''} · {myObservationsLine(summary.my_observations)}
      </ThemedText>
    </>
  );

  // Signed: locked, and the whole sheet shows.
  if (signedAt && summary.mine) {
    const mine = summary.mine;
    const compared = summaryComparison(summary);
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        {heading}
        <ThemedText type="small" themeColor="textSecondary">
          You signed your summary on {formatDateString(signedAt.slice(0, 10))}, so it can’t be changed.{' '}
          {summary.others.length === 0
            ? 'No other selector has signed one for this athlete yet.'
            : `${summary.others.length} other ${summary.others.length === 1 ? 'selector has' : 'selectors have'} signed one.`}{' '}
          The PDF is for the panel only.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        {onwards}
        <ReportView report={summarySheetReport(summary)} buttonOnly />
        <CardGrid gap={Spacing.four}>
        {compared.selectors.map((s) => (
          <Card key={s.name} style={styles.card}>
            <ThemedText type="smallBold">
              {s.name}
              {s.recommendation ? `: ${s.recommendation}` : ''}
            </ThemedText>
            {s.strengths ? <ThemedText type="small">Strengths: {s.strengths}</ThemedText> : null}
            {s.priorities ? <ThemedText type="small">Development priorities: {s.priorities}</ThemedText> : null}
            {s.comments ? <ThemedText type="small">Comments: {s.comments}</ThemedText> : null}
            <ThemedText type="small" themeColor="textSecondary">
              Signed {s.signedOn}
            </ThemedText>
          </Card>
        ))}
        </CardGrid>
        <ThemedText type="smallBold">Against the criteria</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tap a group to see each selector’s step. Only criteria someone gave a step are listed.
        </ThemedText>
        {compared.groups.map((group) => {
          const isOpen = open.includes(group.key);
          return (
            <PressableCard
              key={group.key}
              onPress={() => setOpen((keys) => (isOpen ? keys.filter((k) => k !== group.key) : [...keys, group.key]))}>
              <ThemedText type="smallBold">
                {group.name} ({group.rated.length} of {group.rated.length + group.unrated.length})
              </ThemedText>
              {isOpen ? (
                <>
                  {group.rated.map((item) => (
                    <View key={item.key}>
                      <ThemedText type="small">{item.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {item.steps}
                      </ThemedText>
                    </View>
                  ))}
                  {group.unrated.length > 0 ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      No step from anyone: {group.unrated.join(', ')}
                    </ThemedText>
                  ) : null}
                </>
              ) : null}
            </PressableCard>
          );
        })}
        {summary.can_reopen ? (
          <>
            <ThemedText type="smallBold">Reopen a summary</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              As head coach you can reopen a signed summary so its selector can change it and sign
              again. Each reopening is kept in the audit report.
            </ThemedText>
            <ConfirmDelete
              title="Reopen my summary"
              warning="Your summary opens for changes until you sign it again. Until then you won’t see the other selectors’ summaries."
              confirmTitle="Reopen my summary"
              onConfirm={() => reopen(mine.id)}
              busy={busy}
            />
            {summary.others.map((other) => (
              <ConfirmDelete
                key={other.id}
                title={`Reopen ${other.author_name}’s summary`}
                warning={`${other.author_name} can change their summary and must sign it again.`}
                confirmTitle={`Reopen ${other.author_name}’s summary`}
                onConfirm={() => reopen(other.id)}
                busy={busy}
              />
            ))}
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {summary.closed
              ? 'This round is closed.'
              : 'Signed by mistake? The head coach or an admin can reopen it for you.'}
          </ThemedText>
        )}
      </Screen>
    );
  }

  // Not signed, and the round is closed: nothing more can be written.
  if (summary.closed) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        {heading}
        <ErrorText>{error}</ErrorText>
        <ThemedText type="small" themeColor="textSecondary">
          This round is closed and you didn’t sign a summary for this athlete, so there is nothing
          to show. An admin can open the round again.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {heading}
      <ThemedText type="small" themeColor="textSecondary">
        Your own view across the round. You see the other selectors’ summaries once you sign yours.
        {summary.others_signed > 0
          ? ` ${summary.others_signed} other ${summary.others_signed === 1 ? 'selector has' : 'selectors have'} signed.`
          : ''}
      </ThemedText>
      {summary.last_reopened ? (
        <ThemedText type="smallBold">
          Reopened by {summary.last_reopened.by_name} on {formatDateString(summary.last_reopened.at.slice(0, 10))}.
          Check it and sign again.
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold">Against the criteria</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {summary.mine
          ? 'Open a group to change a step. Tap a step again to take it off.'
          : 'Each step starts as the latest one in your own observations. Open a group to check or change it; tap a step again to take it off.'}{' '}
        Leave out anything you haven’t seen: {summaryCoverage(criteria, draft.ratings)} so far.
      </ThemedText>
      {criteria.groups.map((group) => {
        const chosen = draft.ratings.filter((r) => group.items.some((i) => i.key === r.item_key)).length;
        const isOpen = open.includes(group.key);
        return (
          <View key={group.key} style={styles.group}>
            <PressableCard
              onPress={() => setOpen((keys) => (isOpen ? keys.filter((k) => k !== group.key) : [...keys, group.key]))}>
              <ThemedText type="smallBold">
                {group.name} ({chosen} of {group.items.length})
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isOpen ? 'Tap to close' : group.items.map((i) => i.name).join(', ')}
              </ThemedText>
            </PressableCard>
            {isOpen
              ? group.items.map((item) => {
                  const current = draft.ratings.find((r) => r.item_key === item.key);
                  const value = current ? String(current.rating) : null;
                  return (
                    <ChipGroup
                      key={item.key}
                      label={item.name}
                      options={group.scale.map((step, index) => ({ value: String(index + 1), label: step }))}
                      selected={value ? [value] : []}
                      onToggle={(step) =>
                        setDraft({
                          ...draft,
                          ratings: setSummaryRating(draft.ratings, item.key, step === value ? undefined : Number(step)),
                        })
                      }
                    />
                  );
                })
              : null}
          </View>
        );
      })}

      {recommendations.length > 0 ? (
        <ChipGroup
          label="Your recommendation"
          options={recommendations.map((r) => ({ value: r, label: r }))}
          selected={draft.recommendation ? [draft.recommendation] : []}
          onToggle={(r) => setDraft({ ...draft, recommendation: r === draft.recommendation ? null : r })}
        />
      ) : null}
      <TextField
        label="Strengths"
        value={draft.strengths}
        onChangeText={(strengths) => setDraft({ ...draft, strengths })}
        multiline
        maxLength={MAX_SUMMARY_TEXT}
      />
      <TextField
        label="Development priorities"
        value={draft.priorities}
        onChangeText={(priorities) => setDraft({ ...draft, priorities })}
        multiline
        maxLength={MAX_SUMMARY_TEXT}
      />
      <TextField
        label="Comments"
        value={draft.comments}
        onChangeText={(comments) => setDraft({ ...draft, comments })}
        multiline
        maxLength={MAX_SUMMARY_TEXT}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Write as if the athlete may read it one day. Nothing about health, injuries or wellbeing
        goes here, and a worry about a child’s safety is raised as a concern from Home instead.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      {saved ? (
        <ThemedText type="small" themeColor="textSecondary">
          Draft saved. Only you can see it until you sign.
        </ThemedText>
      ) : null}
      <Button title="Save draft" variant="secondary" onPress={() => save(false)} busy={busy} />
      <ConfirmDelete
        title="Sign my summary"
        warning="Signing locks your summary and shows it to the other selectors who have signed theirs. Only the head coach or an admin can reopen it."
        confirmTitle="Sign and lock"
        onConfirm={() => save(true)}
        busy={busy}
      />
      {onwards}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  card: { gap: Spacing.one },
});
