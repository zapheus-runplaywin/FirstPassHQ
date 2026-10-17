import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { isMinor } from '@/lib/age';
import { useAuth } from '@/lib/auth';
import { returnQuickPicks, toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';
import { hasRole } from '@/lib/roles';

export default function NewInjuryScreen() {
  const { session, profile } = useAuth();
  const isGuardian = hasRole(profile, 'guardian');
  const [athletes, setAthletes] = useState<{ profile_id: string; full_name: string | null }[]>([]);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [bodyArea, setBodyArea] = useState('');
  const [description, setDescription] = useState('');
  const [injuredOn, setInjuredOn] = useState<string | null>(toDateString(new Date()));
  const [restrictions, setRestrictions] = useState('');
  const [expectedReturn, setExpectedReturn] = useState<string | null>(null);
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
    if (!bodyArea.trim() || !description.trim()) {
      setError('Say where the injury is and what happened.');
      return;
    }
    if (!expectedReturn) {
      setError('Choose when you expect to be back. A physio can change it later.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await supabase.rpc('report_injury', {
      p_athlete_id: selectedAthleteId,
      p_body_area: bodyArea,
      p_description: description,
      p_injured_on: injuredOn,
      p_restrictions: restrictions,
      p_expected_return: expectedReturn,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.replace({ pathname: '/injuries/[id]', params: { id: data as string } });
  }

  const today = toDateString(new Date());

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

      <TextField
        label="Where is the injury?"
        value={bodyArea}
        onChangeText={setBodyArea}
        placeholder="For example, left ankle"
        maxLength={100}
      />
      <TextField
        label="What happened?"
        value={description}
        onChangeText={setDescription}
        placeholder="How it happened and what the doctor or physio said"
        multiline
        maxLength={4000}
      />
      <DateField
        label="When did it happen?"
        value={injuredOn}
        onChange={(value) => setInjuredOn(value ?? today)}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Yesterday', days: -1 },
        ]}
        max={today}
      />
      <TextField
        label="Restrictions (optional)"
        value={restrictions}
        onChangeText={setRestrictions}
        placeholder="For example, no jumping or tumbling"
        maxLength={1000}
      />
      <DateField
        label="Expected back"
        value={expectedReturn}
        onChange={setExpectedReturn}
        quickPicks={returnQuickPicks}
      />
      <ThemedText type="small" themeColor="textSecondary">
        A best guess is fine. Until cleared, the athlete shows as injured when attendance is taken,
        and is still expected at training to support the team.
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        {profile && isMinor(profile.date_of_birth, profile.under_17)
          ? 'Your parents or guardians and the club’s admins see this. Your coaches, physios and the committee see it once a parent or guardian agrees.'
          : hasRole(profile, 'guardian') && !hasRole(profile, 'athlete')
            ? 'Admins see this. For an athlete under 18, their coaches, physios and the committee see it once you give consent for injuries.'
            : 'Your coaches, physios and the committee will see this.'}{' '}
        You can add physio updates as it heals.
      </ThemedText>

      <ErrorText>{error}</ErrorText>
      <Button title="Report injury" onPress={save} busy={saving} />
    </Screen>
  );
}
