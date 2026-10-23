import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime } from '@/lib/format';
import {
  cleanContacts,
  contactsError,
  emptyContact,
  hasHealthNotes,
  MAX_EMERGENCY_CONTACTS,
  medicalSections,
  telLink,
  type EmergencyContact,
  type MedicalProfile,
  type MedicalSectionKey,
  type MedicalView,
} from '@/lib/medical';
import { supabase } from '@/lib/supabase';

type Draft = { contacts: EmergencyContact[] } & Record<MedicalSectionKey, string>;

function draftOf(profile: MedicalProfile): Draft {
  return {
    contacts: profile.emergency_contacts.length > 0 ? profile.emergency_contacts : [emptyContact()],
    conditions: profile.conditions,
    allergies: profile.allergies,
    medications: profile.medications,
    action_plan: profile.action_plan,
  };
}

/**
 * An athlete's medical and emergency details: emergency contacts, allergies,
 * conditions, medications and an action plan. Kept by the athlete (18 or
 * over) or an under 18's parents and guardians; read by the coaches,
 * managers and physios of their squads and teams, each view logged.
 */
export default function MedicalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<MedicalProfile | null>(null);
  const [views, setViews] = useState<MedicalView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('medical_profile', { p_athlete_id: id });
    if (rpcError || !data) {
      setLoadError(rpcError?.message ?? 'You can’t see this athlete’s medical details');
      setProfile(null);
      return;
    }
    const loaded = data as MedicalProfile;
    setLoadError(null);
    setProfile(loaded);
    if (loaded.can_edit) {
      const { data: viewData } = await supabase.rpc('medical_profile_views', { p_athlete_id: id });
      setViews((viewData as MedicalView[] | null) ?? []);
    } else {
      setViews([]);
    }
  }, [id]);

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

  async function save() {
    if (!draft) return;
    const problem = contactsError(draft.contacts);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('save_medical_profile', {
      p_athlete_id: id,
      p_emergency_contacts: cleanContacts(draft.contacts),
      p_conditions: draft.conditions,
      p_allergies: draft.allergies,
      p_medications: draft.medications,
      p_action_plan: draft.action_plan,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setDraft(null);
    await load();
  }

  if (loadError) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <ErrorText>{loadError}.</ErrorText>
      </Screen>
    );
  }
  if (!profile) return <Screen>{null}</Screen>;

  const own = profile.role === 'self';
  const name = profile.athlete_name ?? 'This athlete';
  const title = own ? 'Your medical details' : name;

  if (draft) {
    const setContact = (i: number, change: Partial<EmergencyContact>) =>
      setDraft({
        ...draft,
        contacts: draft.contacts.map((c, j) => (j === i ? { ...c, ...change } : c)),
      });
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ThemedText type="small" themeColor="textSecondary">
          {own
            ? 'Your coaches, managers and physios see these, and you can see each time one of them opens them.'
            : `${name}’s coaches, managers and physios see these once you’ve given health consent, and you can see each time one of them opens them.`}
        </ThemedText>
        <ThemedText type="smallBold">Emergency contacts</ThemedText>
        {draft.contacts.map((c, i) => (
          <Card key={i} style={styles.card}>
            <TextField
              label="Name"
              value={c.name}
              onChangeText={(name) => setContact(i, { name })}
              autoComplete="name"
              maxLength={80}
            />
            <TextField
              label="Relationship"
              value={c.relationship}
              onChangeText={(relationship) => setContact(i, { relationship })}
              placeholder="Mum, partner, grandparent…"
              maxLength={40}
            />
            <TextField
              label="Phone"
              value={c.phone}
              onChangeText={(phone) => setContact(i, { phone })}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={30}
            />
            <Button
              title="Remove contact"
              variant="secondary"
              onPress={() =>
                setDraft({ ...draft, contacts: draft.contacts.filter((_, j) => j !== i) })
              }
            />
          </Card>
        ))}
        {draft.contacts.length < MAX_EMERGENCY_CONTACTS ? (
          <Button
            title="Add a contact"
            variant="secondary"
            onPress={() => setDraft({ ...draft, contacts: [...draft.contacts, emptyContact()] })}
          />
        ) : null}
        {medicalSections.map((s) => (
          <TextField
            key={s.key}
            label={s.label}
            value={draft[s.key]}
            onChangeText={(text) => setDraft({ ...draft, [s.key]: text })}
            placeholder={s.placeholder}
            multiline
            maxLength={s.key === 'action_plan' ? 4000 : 2000}
          />
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          Leave out anything that isn’t needed in an emergency. Doctors’ letters belong with an
          injury.
        </ThemedText>
        <ErrorText>{error}</ErrorText>
        <Button title="Save" onPress={save} busy={saving} />
        <Button
          title="Cancel"
          variant="secondary"
          onPress={() => {
            setDraft(null);
            setError(null);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title }} />
      {profile.role === 'coach' || profile.role === 'manager' || profile.role === 'physio' ? (
        <ThemedText type="small" themeColor="textSecondary">
          These are for {name}’s safety at training and games. Each time you open them it’s
          recorded, and they, or a parent for an under 18, can see that you did.
        </ThemedText>
      ) : null}
      <ThemedText type="smallBold">Emergency contacts</ThemedText>
      {profile.emergency_contacts.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No emergency contacts yet.
        </ThemedText>
      ) : (
        profile.emergency_contacts.map((c, i) => (
          <Card key={i} style={styles.card}>
            <ThemedText type="smallBold">
              {c.name}
              {c.relationship ? ` · ${c.relationship}` : ''}
            </ThemedText>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Call ${c.name}`}
              onPress={() => Linking.openURL(telLink(c.phone))}>
              <ThemedText type="small" themeColor="tint">
                {c.phone}
              </ThemedText>
            </Pressable>
          </Card>
        ))
      )}
      {medicalSections.map((s) => (
        <View key={s.key} style={styles.section}>
          <ThemedText type="smallBold">{s.label}</ThemedText>
          <ThemedText type="small" themeColor={profile[s.key] ? undefined : 'textSecondary'}>
            {profile[s.key] || 'None recorded'}
          </ThemedText>
        </View>
      ))}
      {!hasHealthNotes(profile) && profile.can_edit ? (
        <ThemedText type="small" themeColor="textSecondary">
          Add anything a coach or physio would need to know in an emergency.
        </ThemedText>
      ) : null}
      {profile.updated_at ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last changed by {profile.updated_by_name ?? 'a former member'},{' '}
          {formatDateTime(new Date(profile.updated_at))}.
        </ThemedText>
      ) : null}
      {profile.can_edit ? (
        <Button title="Change details" onPress={() => setDraft(draftOf(profile))} />
      ) : profile.role === 'self' ? (
        <ThemedText type="small" themeColor="textSecondary">
          Your parents or guardians keep these up to date until you turn 18.
        </ThemedText>
      ) : null}
      {profile.can_edit ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Who has opened them</ThemedText>
          {views.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nobody yet.
            </ThemedText>
          ) : (
            views.map((v, i) => (
              <ThemedText key={i} type="small">
                {v.viewer_name}
                {v.viewer_role ? ` (${v.viewer_role})` : ''} · {formatDateTime(new Date(v.viewed_at))}
              </ThemedText>
            ))
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.one },
  section: { gap: Spacing.half },
});
