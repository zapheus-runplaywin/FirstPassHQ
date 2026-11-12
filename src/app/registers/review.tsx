import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { MonthDateField } from '@/components/month-date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { today } from '@/lib/check-ins';
import { formatDateString } from '@/lib/injuries';
import { aYearOn, linkProblem, type RegisterPolicy } from '@/lib/registers';
import { supabase } from '@/lib/supabase';

/**
 * The policy's owner (or an admin) records that they reviewed it: the version
 * and link now, and when it's next due. Recording it clears their to-do.
 */
export default function ReviewPolicyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [policy, setPolicy] = useState<RegisterPolicy | null | undefined>(undefined);
  const [version, setVersion] = useState('');
  const [link, setLink] = useState('');
  const [nextReview, setNextReview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('policy_register_list').then(({ data }) => {
      const p = ((data as RegisterPolicy[] | null) ?? []).find((r) => r.id === id) ?? null;
      if (p) {
        setVersion(p.version ?? '');
        setLink(p.link ?? '');
        setNextReview(aYearOn(today()));
      }
      setPolicy(p);
    });
  }, [id]);

  async function save() {
    if (!nextReview || nextReview <= today()) {
      setError('Choose a next review date after today.');
      return;
    }
    const badLink = linkProblem(link);
    if (badLink) {
      setError(badLink);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('review_policy', {
      p_id: id,
      p_version: version,
      p_link: link,
      p_next_review_on: nextReview,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  if (policy === undefined) return <Screen>{null}</Screen>;
  if (policy === null) {
    return (
      <Screen>
        <ThemedText type="small" themeColor="textSecondary">
          This policy isn’t on the register any more.
        </ThemedText>
      </Screen>
    );
  }

  return (
    <Screen>
      <ThemedText type="subtitle">{policy.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Review due {formatDateString(policy.review_on)}. Read the policy, update it if it needs it,
        then record the version and link here and when it’s next reviewed.
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
        placeholder="https://"
        autoCapitalize="none"
        keyboardType="url"
        maxLength={500}
      />
      <MonthDateField label="Next review" value={nextReview} onChange={setNextReview} />
      <ErrorText>{error}</ErrorText>
      <Button title="Record review" onPress={save} busy={saving} />
    </Screen>
  );
}
