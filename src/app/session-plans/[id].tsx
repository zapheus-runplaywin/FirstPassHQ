import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDelete, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { formatDateString } from '@/lib/injuries';
import {
  deletePlan,
  formatTimes,
  isImageFile,
  isWordFile,
  PLAN_COLUMNS,
  planFileUrl,
  type SessionPlan,
  type SessionPlanFile,
  useSessionPlanSummary,
} from '@/lib/session-plans';
import { canWorkWithChildren } from '@/lib/safety';
import { supabase } from '@/lib/supabase';

/**
 * One session plan. The author and admins can change it, anyone who can add
 * plans can use it again, and admins can delete it.
 */
export default function SessionPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, isAdmin, profile, exemption } = useAuth();
  const { canAdd } = useSessionPlanSummary();
  const [plan, setPlan] = useState<SessionPlan | null | undefined>(undefined);
  const [files, setFiles] = useState<SessionPlanFile[]>([]);
  const [sharedNames, setSharedNames] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [planResult, fileResult, shareResult] = await Promise.all([
      supabase.from('session_plans').select(PLAN_COLUMNS).eq('id', id).maybeSingle(),
      supabase
        .from('session_plan_files')
        .select('id, plan_id, path, name, content_type, size_bytes, added_by_name, created_at')
        .eq('plan_id', id)
        .order('created_at'),
      // Only the author and admins get these rows.
      supabase.from('session_plan_shares').select('profile_id').eq('plan_id', id),
    ]);
    setPlan((planResult.data as SessionPlan | null) ?? null);
    setFiles((fileResult.data as SessionPlanFile[] | null) ?? []);
    const ids = ((shareResult.data as { profile_id: string }[] | null) ?? []).map(
      (s) => s.profile_id,
    );
    if (ids.length > 0) {
      const { data: coaches } = await supabase.rpc('session_plan_coaches');
      const names = new Map(
        ((coaches as { profile_id: string; full_name: string }[] | null) ?? []).map((c) => [
          c.profile_id,
          c.full_name,
        ]),
      );
      setSharedNames(ids.map((p) => names.get(p) ?? 'A former coach'));
    } else {
      setSharedNames([]);
    }
    if (planResult.data) supabase.rpc('mark_session_plan_seen', { p_plan_id: id });
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function openFile(file: SessionPlanFile) {
    setError(null);
    if (isImageFile(file.content_type) || file.content_type === 'application/pdf') {
      router.push({ pathname: '/session-plans/file', params: { path: file.path, name: file.name } });
      return;
    }
    // Word documents open in the phone's viewer.
    try {
      await WebBrowser.openBrowserAsync(await planFileUrl(file.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file couldn’t be opened. Try again.');
    }
  }

  async function remove() {
    if (!plan) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePlan(plan.id, files);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The plan wasn’t deleted. Try again.');
      setDeleting(false);
    }
  }

  if (plan === undefined) return <Screen>{null}</Screen>;
  if (plan === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This plan isn’t shared with you, or it has been removed.
        </ThemedText>
      </Screen>
    );
  }

  const mine = plan.author_id === session?.user.id;
  // As can_edit_session_plan: the author only while they can work with children.
  const canEdit = isAdmin || (mine && canWorkWithChildren(profile, !!exemption?.valid));
  const times = formatTimes(plan.starts_at, plan.ends_at);
  const sharedWith = [
    plan.share_team_coaches ? `the other coaches of ${plan.team_name}` : '',
    plan.share_athletes ? `its athletes and their parents and guardians` : '',
    ...sharedNames,
  ].filter(Boolean);

  return (
    <Screen>
      <View style={styles.header}>
        <ThemedText type="subtitle">{plan.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateString(plan.session_on)}
          {times ? ` · ${times}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {plan.team_name}
          {plan.location ? ` · ${plan.location}` : ''}
        </ThemedText>
      </View>

      <Card>
        <ThemedText type="small">
          Added by {plan.author_name} ({plan.author_position.toLowerCase()}),{' '}
          {formatDateTime(new Date(plan.created_at))}
        </ThemedText>
        {plan.run_by ? <ThemedText type="small">Run by {plan.run_by}</ThemedText> : null}
        {plan.edited_at ? (
          <ThemedText type="small" themeColor="textSecondary">
            Last changed {formatDateTime(new Date(plan.edited_at))}
            {plan.edited_by_name ? ` by ${plan.edited_by_name}` : ''}
          </ThemedText>
        ) : null}
      </Card>

      {plan.notes ? (
        <Card>
          <ThemedText type="small" selectable>
            {plan.notes}
          </ThemedText>
        </Card>
      ) : null}

      {files.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Photos and files</ThemedText>
          {files.map((file) => (
            <PressableCard key={file.id} onPress={() => openFile(file)}>
              <ThemedText type="small" numberOfLines={1}>
                {isImageFile(file.content_type) ? '🖼️' : isWordFile(file.content_type) ? '📝' : '📄'}{' '}
                {file.name}
              </ThemedText>
            </PressableCard>
          ))}
        </View>
      ) : null}

      {canEdit ? (
        <ThemedText type="small" themeColor="textSecondary">
          {sharedWith.length > 0
            ? `Shared with ${sharedWith.join(', ')}.`
            : 'Not shared. Only you and the club’s admins can see it.'}
        </ThemedText>
      ) : null}

      <ErrorText>{error}</ErrorText>

      {canEdit ? (
        <Button
          title="Change this plan"
          onPress={() => router.push({ pathname: '/session-plans/edit', params: { id: plan.id } })}
        />
      ) : null}
      {canAdd ? (
        <Button
          title="Use again for another session"
          variant="secondary"
          onPress={() => router.push({ pathname: '/session-plans/edit', params: { copy: plan.id } })}
        />
      ) : null}
      {isAdmin ? (
        <ConfirmDelete
          title="Delete this plan"
          warning="The plan and its photos and files will be removed for everyone, and it will no longer count in the session plans report. This can’t be undone."
          confirmTitle="Delete for good"
          onConfirm={remove}
          busy={deleting}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
});
