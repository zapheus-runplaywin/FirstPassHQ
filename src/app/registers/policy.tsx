import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { MonthDateField } from '@/components/month-date-field';
import { PersonPicker } from '@/components/person-picker';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ConfirmDelete, ErrorText, TextField } from '@/components/ui';
import { isMinor } from '@/lib/age';
import { PROFILE_COLUMNS } from '@/lib/auth';
import { canOwnPolicy, linkProblem, type RegisterPolicy } from '@/lib/registers';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

/**
 * Adds a policy to the register, or changes or removes one when opened with
 * an id: its name, owner, version, link, next review date and notes.
 */
export default function EditPolicyScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [loaded, setLoaded] = useState(!id);
  const [people, setPeople] = useState<Profile[]>([]);
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [link, setLink] = useState('');
  const [reviewOn, setReviewOn] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('status', 'approved')
      .order('full_name')
      .then(({ data }) =>
        // The same rule as the database: approved adult club officials.
        setPeople(
          ((data as Profile[] | null) ?? []).filter(
            (p) => canOwnPolicy(p) && !isMinor(p.date_of_birth, p.under_17),
          ),
        ),
      );
  }, []);

  useEffect(() => {
    if (!id) return;
    supabase.rpc('policy_register_list').then(({ data }) => {
      const p = ((data as RegisterPolicy[] | null) ?? []).find((r) => r.id === id);
      if (p) {
        setTitle(p.title);
        setOwnerId(p.owner_id);
        setVersion(p.version ?? '');
        setLink(p.link ?? '');
        setReviewOn(p.review_on);
        setNotes(p.notes ?? '');
      }
      setLoaded(true);
    });
  }, [id]);

  async function save() {
    const missing = [!title.trim() && 'a name', !reviewOn && 'a review date'].filter(Boolean);
    if (missing.length > 0) {
      setError(`Add ${missing.join(' and ')}.`);
      return;
    }
    const badLink = linkProblem(link);
    if (badLink) {
      setError(badLink);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('admin_save_policy', {
      p_id: id ?? null,
      p_title: title,
      p_owner_id: ownerId,
      p_version: version,
      p_link: link,
      p_review_on: reviewOn,
      p_notes: notes,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  async function remove() {
    if (!id) return;
    setBusy(true);
    const { error: deleteError } = await supabase.rpc('admin_delete_policy', { p_id: id });
    setBusy(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.back();
  }

  if (!loaded) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <TextField
        label="Policy"
        value={title}
        onChangeText={setTitle}
        placeholder="Such as Child Safeguarding Policy"
        maxLength={120}
      />
      <PersonPicker label="Owner" people={people} selected={ownerId} onChange={setOwnerId} />
      <ThemedText type="small" themeColor="textSecondary">
        The owner reviews the policy. They get a to-do 30 days before the review date. Any adult
        club official can be the owner.
      </ThemedText>
      <TextField
        label="Version (optional)"
        value={version}
        onChangeText={setVersion}
        placeholder="Such as 2.1 or March 2026"
        maxLength={30}
      />
      <TextField
        label="Link (optional)"
        value={link}
        onChangeText={setLink}
        placeholder="https:// on the club website or shared drive"
        autoCapitalize="none"
        keyboardType="url"
        maxLength={500}
      />
      <MonthDateField label="Next review" value={reviewOn} onChange={setReviewOn} />
      <TextField
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Such as who approved it"
        multiline
        maxLength={1000}
      />

      <ErrorText>{error}</ErrorText>
      <Button title={id ? 'Save' : 'Add policy'} onPress={save} busy={saving} />

      {id ? (
        <ConfirmDelete
          title="Remove"
          warning="This removes the policy and its review history from the register."
          confirmTitle="Remove policy"
          onConfirm={remove}
          busy={busy}
        />
      ) : null}
    </Screen>
  );
}
