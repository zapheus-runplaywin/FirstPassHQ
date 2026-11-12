import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';

type Answer = 'none' | 'conflict';

/**
 * Whether someone has a conflict of interest this season, and what it is.
 * Used for a member's own declaration and for an admin changing one.
 */
export function ConflictForm({
  hasConflict,
  details: initialDetails,
  saveTitle,
  onSave,
}: {
  hasConflict: boolean | null;
  details: string | null;
  saveTitle: string;
  onSave: (hasConflict: boolean, details: string) => Promise<string | null>;
}) {
  const [answer, setAnswer] = useState<Answer | null>(
    hasConflict === null ? null : hasConflict ? 'conflict' : 'none',
  );
  const [details, setDetails] = useState(initialDetails ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!answer) {
      setError('Say whether you have a conflict of interest.');
      return;
    }
    if (answer === 'conflict' && !details.trim()) {
      setError('Describe the conflict of interest.');
      return;
    }
    setSaving(true);
    setError(null);
    const problem = await onSave(answer === 'conflict', answer === 'conflict' ? details : '');
    setSaving(false);
    setError(problem);
  }

  return (
    <>
      <ChipGroup
        label="This season"
        options={[
          { value: 'none' as const, label: 'No conflicts of interest' },
          { value: 'conflict' as const, label: 'A conflict to declare' },
        ]}
        selected={answer ? [answer] : []}
        onToggle={setAnswer}
      />
      {answer === 'conflict' ? (
        <>
          <TextField
            label="The conflict"
            value={details}
            onChangeText={setDetails}
            placeholder="Such as: my daughter plays in the 17 and under team I select"
            multiline
            maxLength={2000}
          />
          <ThemedText type="small" themeColor="textSecondary">
            The committee and admins read this. Say how it’s managed if you know, such as stepping
            out of that team’s selection.
          </ThemedText>
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button title={saveTitle} onPress={save} busy={saving} />
    </>
  );
}
