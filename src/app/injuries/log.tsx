import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  emptyInjuryDraft,
  InjuryFields,
  injuryDraftProblem,
  type InjuryDraft,
} from '@/components/injury-fields';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { InjuryLoggerRole } from '@/lib/types';

type LoggableAthlete = { athlete_id: string; athlete_name: string | null; logged_as: InjuryLoggerRole };

/**
 * A coach, manager or physio logs an injury for one of their athletes at the
 * time it happens, at training or a game. It becomes the athlete's record:
 * the athlete and their parents or guardians are told and take it from there.
 */
export default function LogInjuryScreen() {
  const [athletes, setAthletes] = useState<LoggableAthlete[] | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InjuryDraft>(emptyInjuryDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('injury_loggable_athletes');
    setAthletes((data as LoggableAthlete[] | null) ?? []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const selected = athleteId ?? (athletes?.length === 1 ? athletes[0].athlete_id : null);

  async function save() {
    if (!selected) {
      setError('Choose which athlete is injured.');
      return;
    }
    const problem = injuryDraftProblem(draft, false);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('log_injury', {
      p_athlete_id: selected,
      p_body_area: draft.bodyArea,
      p_description: draft.description,
      p_injured_on: draft.injuredOn,
      p_restrictions: draft.restrictions,
      p_expected_return: draft.expectedReturn,
      p_concussion: draft.concussion,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setLogged(athletes?.find((a) => a.athlete_id === selected)?.athlete_name ?? 'The athlete');
  }

  if (logged) {
    return (
      <Screen>
        <Card>
          <ThemedText type="smallBold">Injury logged</ThemedText>
          <ThemedText type="small">
            {logged} and their parents or guardians have been told. It’s on their injury record
            now, and they add the physio’s updates and ask for clearance from there.
          </ThemedText>
        </Card>
        <Button
          title="Log another"
          variant="secondary"
          onPress={() => {
            setLogged(null);
            setAthleteId(null);
            setDraft(emptyInjuryDraft());
          }}
        />
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (athletes === null) return null;

  return (
    <Screen>
      {athletes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          You can log an injury for the athletes in the squads and teams you coach, manage or
          look after as a physio. There aren’t any right now.
        </ThemedText>
      ) : (
        <>
          <ChipGroup
            label="Athlete"
            options={athletes.map((a) => ({
              value: a.athlete_id,
              label: a.athlete_name ?? 'Unnamed athlete',
            }))}
            selected={selected ? [selected] : []}
            onToggle={setAthleteId}
          />
          <InjuryFields
            draft={draft}
            onChange={setDraft}
            describePlaceholder="What happened, where and when, and what first aid was given"
          />
          <ThemedText type="small" themeColor="textSecondary">
            The athlete and their parents or guardians are told straight away. Logging it doesn’t
            change who sees the record: the athlete’s coaches, physios and committee see it as
            usual, an under 18’s only once a parent consents, and managers never do.
          </ThemedText>
          <ErrorText>{error}</ErrorText>
          <Button title="Log injury" onPress={save} busy={saving} />
        </>
      )}
    </Screen>
  );
}
