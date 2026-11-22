import { Platform, StyleSheet, Switch, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { ThemedText } from '@/components/themed-text';
import { Card, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clubToday } from '@/lib/club-time';
import { returnQuickPicks } from '@/lib/injuries';

export type InjuryDraft = {
  bodyArea: string;
  description: string;
  injuredOn: string | null;
  restrictions: string;
  expectedReturn: string | null;
  concussion: boolean;
};

export function emptyInjuryDraft(): InjuryDraft {
  return {
    bodyArea: '',
    description: '',
    injuredOn: clubToday(),
    restrictions: '',
    expectedReturn: null,
    concussion: false,
  };
}

/** What the draft is missing, in the words shown to the member, or null. */
export function injuryDraftProblem(draft: InjuryDraft, expectedBackRequired: boolean) {
  if (!draft.bodyArea.trim() || !draft.description.trim()) {
    return 'Say where the injury is and what happened.';
  }
  if (expectedBackRequired && !draft.expectedReturn) {
    return 'Choose when you expect to be back. A physio can change it later.';
  }
  return null;
}

/**
 * The fields for a new injury, used when an athlete or guardian reports one
 * and when a coach, manager or physio logs one at the time.
 */
export function InjuryFields({
  draft,
  onChange,
  describePlaceholder,
}: {
  draft: InjuryDraft;
  onChange: (draft: InjuryDraft) => void;
  describePlaceholder: string;
}) {
  const theme = useTheme();
  const today = clubToday();
  const set = (patch: Partial<InjuryDraft>) => onChange({ ...draft, ...patch });

  return (
    <>
      <TextField
        label="Where is the injury?"
        value={draft.bodyArea}
        onChangeText={(bodyArea) => set({ bodyArea })}
        placeholder="For example, left ankle"
        maxLength={100}
      />
      <TextField
        label="What happened?"
        value={draft.description}
        onChangeText={(description) => set({ description })}
        placeholder={describePlaceholder}
        multiline
        maxLength={4000}
      />
      <DateField
        label="When did it happen?"
        value={draft.injuredOn}
        onChange={(value) => set({ injuredOn: value ?? today })}
        quickPicks={[
          { label: 'Today', days: 0 },
          { label: 'Yesterday', days: -1 },
        ]}
        max={today}
      />
      <TextField
        label="Restrictions (optional)"
        value={draft.restrictions}
        onChangeText={(restrictions) => set({ restrictions })}
        placeholder="For example, no jumping or tumbling"
        maxLength={1000}
      />
      <DateField
        label="Expected back"
        value={draft.expectedReturn}
        onChange={(expectedReturn) => set({ expectedReturn })}
        quickPicks={returnQuickPicks}
      />
      <View style={styles.group}>
        <Card style={styles.switchRow}>
          <ThemedText type="small" style={styles.grow}>
            Possible concussion: a knock to the head, face or neck, or any sign of concussion
          </ThemedText>
          <Switch
            accessibilityLabel="Possible concussion"
            value={draft.concussion}
            onValueChange={(concussion) => set({ concussion })}
            trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
            thumbColor={theme.text}
            {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
          />
        </Card>
        {draft.concussion ? (
          <ThemedText type="small" themeColor="textSecondary">
            If in doubt, sit them out. They need to see a doctor. Clearance needs a doctor’s
            clearance, can’t be asked for until the club’s minimum days have passed, and only a
            physio can endorse it.
          </ThemedText>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  grow: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
});
