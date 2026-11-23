import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import {
  MAX_MILESTONE_TITLE,
  MILESTONE_SUGGESTIONS,
  milestoneLine,
  milestoneProblem,
  type Milestone,
} from '@/lib/assessments';
import { clubToday } from '@/lib/club-time';
import { supabase } from '@/lib/supabase';

type Audience = 'shared' | 'panel';

/**
 * Adds a date to a selection round's process (such as "Teams named"), or
 * with an id changes it, marks it done or takes it off. The panel and admins
 * get a to-do as it comes close; athletes and parents see it when it's
 * shared. Done dates and ones taken off can't be changed: the audit report
 * shows them as they were.
 */
export default function MilestoneScreen() {
  const { round, id } = useLocalSearchParams<{ round: string; id?: string }>();
  const [saved, setSaved] = useState<Milestone | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>('shared');
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: loadError } = await supabase.rpc('admin_selection_milestones', { p_round_id: round });
    if (loadError) setError(loadError.message);
    setSaved(((data as Milestone[] | null) ?? []).find((m) => m.id === id) ?? null);
    setLoaded(true);
  }, [round, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Fill the form once, from the date as saved.
  if (saved && !filled) {
    setFilled(true);
    setTitle(saved.title);
    setDueOn(saved.due_on);
    setAudience(saved.shared ? 'shared' : 'panel');
  }

  /** Runs one change, then goes back to the round. */
  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc(fn, args);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.back();
  }

  function save() {
    const problem = milestoneProblem(title, dueOn);
    if (problem) {
      setError(problem);
      return;
    }
    run('admin_save_selection_milestone', {
      p_id: id ?? null,
      p_round_id: round,
      p_title: title.trim(),
      p_due_on: dueOn,
      p_shared: audience === 'shared',
    });
  }

  if (!loaded) return <Screen>{null}</Screen>;
  if (id && !saved) {
    return (
      <Screen>
        <ErrorText>{error ?? 'This date can’t be found.'}</ErrorText>
      </Screen>
    );
  }

  const locked = !!saved && (!!saved.done_at || !!saved.removed_at);

  if (saved && locked) {
    return (
      <Screen>
        <ThemedText type="subtitle">{saved.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {milestoneLine(saved, clubToday())}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {saved.removed_at
            ? 'This date was taken off. It stays in the audit report.'
            : 'A date that is done can’t be changed. Mark it not done first if it was ticked by mistake.'}
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        {saved.removed_at ? null : (
          <Button
            title="Mark as not done"
            variant="secondary"
            busy={busy}
            onPress={() => run('admin_set_selection_milestone_done', { p_id: saved.id, p_done: false })}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        A date in this round’s process. The panel and admins get a to-do from a week before
        until an admin marks it done.
      </ThemedText>
      <TextField
        label="What happens"
        value={title}
        onChangeText={setTitle}
        placeholder="Such as Teams named"
        maxLength={MAX_MILESTONE_TITLE}
      />
      {id ? null : (
        <ChipGroup
          label="Or choose one"
          options={MILESTONE_SUGGESTIONS.map((s) => ({ value: s, label: s }))}
          selected={MILESTONE_SUGGESTIONS.includes(title) ? [title] : []}
          onToggle={setTitle}
        />
      )}
      <MonthDateField label="Date" value={dueOn} onChange={setDueOn} />
      <ChipGroup<Audience>
        label="Who sees it"
        options={[
          { value: 'shared', label: 'Athletes and parents too' },
          { value: 'panel', label: 'Panel and admins only' },
        ]}
        selected={[audience]}
        onToggle={setAudience}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {audience === 'shared'
          ? 'Athletes in the round and the verified parents of those under 18 see this date beside the criteria.'
          : 'Only the panel and admins see this date.'}
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Add date'} onPress={save} busy={busy} />
      {saved ? (
        <>
          <Button
            title="Mark as done"
            variant="secondary"
            busy={busy}
            onPress={() => run('admin_set_selection_milestone_done', { p_id: saved.id, p_done: true })}
          />
          <Button
            title="Take this date off"
            variant="secondary"
            busy={busy}
            onPress={() => run('admin_remove_selection_milestone', { p_id: saved.id })}
          />
          <ThemedText type="small" themeColor="textSecondary">
            A date taken off stops reminding anyone and stays in the audit report.
          </ThemedText>
        </>
      ) : null}
    </Screen>
  );
}
