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
import { Button, ChipGroup, ErrorText } from '@/components/ui';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { hasRole } from '@/lib/roles';

export default function NewInjuryScreen() {
  const { session, profile } = useAuth();
  const isGuardian = hasRole(profile, 'guardian');
  const [athletes, setAthletes] = useState<{ profile_id: string; full_name: string | null }[]>([]);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<InjuryDraft>(emptyInjuryDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAthletes = useCallback(async () => {
    if (!isGuardian) return;
    const { data } = await supabase.rpc('my_athletes');
    setAthletes((data as { profile_id: string; full_name: string | null }[] | null) ?? []);
  }, [isGuardian]);

  useFocusEffect(
    useCallback(() => {
      loadAthletes();
    }, [loadAthletes]),
  );

  // Guardians of one athlete don't need to pick them.
  const selectedAthleteId = isGuardian
    ? (athleteId ?? (athletes.length === 1 ? athletes[0].profile_id : null))
    : (session?.user.id ?? null);

  async function save() {
    if (!selectedAthleteId) {
      setError('Choose which athlete is injured.');
      return;
    }
    const problem = injuryDraftProblem(draft, true);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('report_injury', {
      p_athlete_id: selectedAthleteId,
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
    router.replace({ pathname: '/injuries/[id]', params: { id: data as string } });
  }

  return (
    <Screen>
      {isGuardian ? (
        athletes.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            A club admin needs to link you to your athlete before you can report an injury for them.
          </ThemedText>
        ) : athletes.length > 1 ? (
          <ChipGroup
            label="Athlete"
            options={athletes.map((a) => ({
              value: a.profile_id,
              label: a.full_name ?? 'Unnamed athlete',
            }))}
            selected={selectedAthleteId ? [selectedAthleteId] : []}
            onToggle={setAthleteId}
          />
        ) : (
          <ThemedText type="smallBold">For {athletes[0].full_name ?? 'your athlete'}</ThemedText>
        )
      ) : null}

      <InjuryFields
        draft={draft}
        onChange={setDraft}
        describePlaceholder="How it happened and what the doctor or physio said"
      />
      <ThemedText type="small" themeColor="textSecondary">
        A best guess is fine. Until cleared, the athlete shows as injured when attendance is taken,
        and is still expected at training to support the team.
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        {profile && isMinor(profile.date_of_birth, profile.under_17)
          ? 'Your parents or guardians and the club’s admins see this. Your coaches, physios and the committee members cleared to work with children see it once a parent or guardian agrees.'
          : hasRole(profile, 'guardian') && !hasRole(profile, 'athlete')
            ? 'Admins see this. For an athlete under 18, their coaches, physios and the committee members cleared to work with children see it once you give consent for injuries.'
            : 'Your coaches, physios and the committee will see this.'}{' '}
        You can add physio updates as it heals.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title="Report injury" onPress={save} busy={saving} />
    </Screen>
  );
}
