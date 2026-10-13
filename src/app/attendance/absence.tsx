import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateField } from '@/components/date-field';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, TextField } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/** An athlete, or their parent or guardian, tells the club they'll be away. */
export default function ReportAbsenceScreen() {
  const { session } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const today = toDateString(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const self = id === session?.user.id;

  async function save() {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('report_absence', {
      p_athlete_id: id,
      p_from: from,
      p_to: to < from ? from : to,
      p_reason: reason,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        {self
          ? 'Tell your coaches and managers you’ll be away, or were away. Your parents or guardians see it too.'
          : `Tell ${name || 'your athlete'}’s coaches and managers they’ll be away, or were away. ${
              name || 'They'
            } and their other parents or guardians see it too.`}
      </ThemedText>
      <DateField
        label="First day away"
        value={from}
        onChange={(value) => {
          const next = value ?? today;
          setFrom(next);
          if (to < next) setTo(next);
        }}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Tomorrow', days: 1 },
          { label: 'Yesterday', days: -1 },
        ]}
      />
      <DateField
        label="Last day away"
        value={to}
        onChange={(value) => setTo(value ?? from)}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Tomorrow', days: 1 },
          { label: 'In a week', days: 7 },
        ]}
      />
      <TextField
        label="Reason (optional)"
        value={reason}
        onChangeText={setReason}
        placeholder="For example, school camp"
        maxLength={200}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Coaches, managers, the committee and admins see the reason. Leave out medical details: an
        injury is better reported under Injuries.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <Button title="Report absence" onPress={save} busy={saving} />
    </Screen>
  );
}
