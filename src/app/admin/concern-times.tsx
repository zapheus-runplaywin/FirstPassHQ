import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PeoplePicker } from '@/components/people-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import {
  canAddPerson,
  type ChainRow,
  type ChainStep,
  chainPayload,
  chainProblem,
  chainsFrom,
  chainSummary,
  type ConcernTimes,
  DEFAULT_CONCERN_TIMES,
  type LeadPost,
  POST_LABELS,
  postsForNextStep,
  type StepPost,
  TIME_FIELDS,
  timesFrom,
  timesProblem,
  timesText,
} from '@/lib/concern-times';
import type { PickablePerson } from '@/lib/people-picker';
import { supabase } from '@/lib/supabase';

type Tab = 'times' | LeadPost;

const LEAD_LABELS: Record<LeadPost, string> = {
  complaints_manager: 'Complaints Manager',
  child_safety_officer: 'Child Safety Officer',
};

/**
 * How long concerns, requests to read messages and injury clearances can wait
 * before they're marked Important, then Urgent, and who an Urgent concern
 * goes to next. Admins only. Three short tabs: the times, and each lead post's
 * escalation chain.
 */
export default function ConcernTimesScreen() {
  const [tab, setTab] = useState<Tab>('times');
  const [times, setTimes] = useState<ConcernTimes>(DEFAULT_CONCERN_TIMES);
  const [text, setText] = useState(timesText(DEFAULT_CONCERN_TIMES));
  const [chains, setChains] = useState<Record<LeadPost, ChainStep[]>>({
    complaints_manager: [],
    child_safety_officer: [],
  });
  const [people, setPeople] = useState<PickablePerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [timesResult, chainsResult, peopleResult] = await Promise.all([
      supabase.rpc('club_concern_times').maybeSingle(),
      supabase.rpc('admin_escalation_chains'),
      supabase.rpc('admin_escalation_people'),
    ]);
    const loaded = timesFrom(timesResult.data);
    setTimes(loaded);
    setText(timesText(loaded));
    setChains(chainsFrom((chainsResult.data as ChainRow[] | null) ?? []));
    setPeople((peopleResult.data as PickablePerson[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openTab(next: Tab) {
    setTab(next);
    setError(null);
    setSaved(null);
  }

  async function saveTimes() {
    const problem = timesProblem(text);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const n = (k: keyof ConcernTimes) => Number(text[k]);
    const { error: rpcError } = await supabase.rpc('admin_set_concern_times', {
      p_first_action_hours: n('concern_first_action_hours'),
      p_refer_hours: n('concern_refer_hours'),
      p_important_days: n('concern_important_days'),
      p_urgent_days: n('concern_urgent_days'),
      p_escalate_days: n('concern_escalate_days'),
      p_request_important_hours: n('request_important_hours'),
      p_request_urgent_hours: n('request_urgent_hours'),
      p_clearance_important_days: n('clearance_important_days'),
      p_clearance_urgent_days: n('clearance_urgent_days'),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSaved('Times saved.');
    load();
  }

  async function saveChain(lead: LeadPost, steps: ChainStep[]) {
    const problem = chainProblem(lead, steps);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    const { error: rpcError } = await supabase.rpc('admin_set_escalation_chain', {
      p_lead_post: lead,
      p_steps: chainPayload(steps),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      load();
      return;
    }
    setSaved('Chain saved.');
    load();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Every concern has a clock. Nothing recorded for too long marks it Important, then Urgent,
        and an Urgent concern goes to the next person in its lead post’s chain. Recording any step
        starts the clock again. Admins are always the last stop.
      </ThemedText>
      <ChipGroup
        options={[
          { value: 'times' as const, label: 'Times' },
          { value: 'complaints_manager' as const, label: 'Complaints Manager chain' },
          { value: 'child_safety_officer' as const, label: 'Child Safety Officer chain' },
        ]}
        selected={[tab]}
        onToggle={openTab}
      />
      <ErrorText>{error}</ErrorText>
      {saved ? (
        <ThemedText type="small" themeColor="textSecondary">
          {saved}
        </ThemedText>
      ) : null}

      {tab === 'times' ? (
        <View style={styles.group}>
          {TIME_FIELDS.map((f) => (
            <TextField
              key={f.key}
              label={`${f.label} (${f.unit})`}
              value={text[f.key]}
              onChangeText={(v) => setText((t) => ({ ...t, [f.key]: v }))}
              keyboardType="number-pad"
              maxLength={3}
            />
          ))}
          <Button title="Save times" onPress={saveTimes} busy={busy} />
        </View>
      ) : (
        <ChainEditor
          key={tab}
          lead={tab}
          steps={chains[tab]}
          escalateDays={times.concern_escalate_days}
          people={people}
          busy={busy}
          onSave={(steps) => saveChain(tab, steps)}
        />
      )}
    </Screen>
  );
}

/** One lead post's chain: its steps in order, a way to add the next, and Save. */
function ChainEditor({
  lead,
  steps: savedSteps,
  escalateDays,
  people,
  busy,
  onSave,
}: {
  lead: LeadPost;
  steps: ChainStep[];
  escalateDays: number;
  people: PickablePerson[];
  busy: boolean;
  onSave: (steps: ChainStep[]) => void;
}) {
  const [steps, setSteps] = useState<ChainStep[]>(savedSteps);
  const [next, setNext] = useState<StepPost | 'person' | null>(null);
  const [person, setPerson] = useState<PickablePerson | null>(null);
  const [wait, setWait] = useState('7');
  const [lastSaved, setLastSaved] = useState(savedSteps);
  // A fresh load replaces any unsaved edits.
  if (savedSteps !== lastSaved) {
    setLastSaved(savedSteps);
    setSteps(savedSteps);
  }

  const posts = postsForNextStep(lead, steps);
  const personOk = canAddPerson(steps);
  const waitDays = /^\d+$/.test(wait.trim()) ? Number(wait) : NaN;
  const changed = JSON.stringify(chainPayload(steps)) !== JSON.stringify(chainPayload(savedSteps));

  function add() {
    if (next === null || !(waitDays >= 1 && waitDays <= 30)) return;
    if (next === 'person') {
      if (!person) return;
      setSteps((s) => [...s, { person: person.id, name: person.name, wait_days: waitDays }]);
    } else {
      setSteps((s) => [...s, { post: next, name: POST_LABELS[next], wait_days: waitDays }]);
    }
    setNext(null);
    setPerson(null);
    setWait('7');
  }

  const inChain = new Set(steps.flatMap((s) => (s.person ? [s.person] : [])));

  return (
    <View style={styles.group}>
      <ThemedText type="small">
        {`A concern the ${LEAD_LABELS[lead]} leads, once Urgent: ${chainSummary(steps, escalateDays)}.`}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Each wait counts from the step before, the first from when the concern turned Urgent. A step
        whose people are all named in the concern, or can’t act, is passed over straight away and
        noted on the concern. A chain never comes back to its own post or to anyone already in it.
      </ThemedText>

      {steps.map((s, i) => (
        <Card key={`${s.post ?? s.person}`} testID={`chain-step-${i + 1}`}>
          <ThemedText type="smallBold">
            {`Step ${i + 1} · after ${s.wait_days} ${s.wait_days === 1 ? 'day' : 'days'}`}
          </ThemedText>
          <ThemedText type="small">
            {s.name}
            {s.can_act === false ? ' · can’t act: no current check, so passed over' : ''}
          </ThemedText>
          <Button
            title="Take off"
            variant="secondary"
            onPress={() => setSteps((all) => all.filter((_, j) => j !== i))}
          />
        </Card>
      ))}

      {posts.length > 0 || personOk ? (
        <Card>
          <ChipGroup
            label={`Add step ${steps.length + 1}`}
            options={[
              ...posts.map((p) => ({ value: p, label: POST_LABELS[p] })),
              ...(personOk ? [{ value: 'person' as const, label: 'A person' }] : []),
            ]}
            selected={next ? [next] : []}
            onToggle={(v) => setNext(v === next ? null : v)}
          />
          {next === 'person' ? (
            <PeoplePicker
              label="Who"
              hint="An adult with a current check. Not someone who holds this chain’s own post."
              people={people.filter((p) => !inChain.has(p.id))}
              selected={person ? [person] : []}
              onAdd={setPerson}
              onRemove={() => setPerson(null)}
              max={1}
              searchLabel="Search members"
            />
          ) : null}
          {next ? (
            <>
              <TextField
                label="Wait (days, 1 to 30)"
                value={wait}
                onChangeText={setWait}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Button
                title="Add step"
                variant="secondary"
                onPress={add}
                disabled={!(waitDays >= 1 && waitDays <= 30) || (next === 'person' && !person)}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Button title="Save chain" onPress={() => onSave(steps)} busy={busy} disabled={!changed} />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.three },
});
