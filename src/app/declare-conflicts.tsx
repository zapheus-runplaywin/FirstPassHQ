import { router } from 'expo-router';

import { ConflictForm } from '@/components/conflict-form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { formatDateString } from '@/lib/injuries';
import { useMyConflictDeclaration } from '@/lib/registers';
import { supabase } from '@/lib/supabase';
import { seasonLabel } from '@/lib/use-teams';

/**
 * A committee member or coach declares any conflict of interest for this
 * season, or changes what they declared. It goes on the club's register.
 */
export default function DeclareConflictsScreen() {
  const { conflictDeclaration } = useMyConflictDeclaration();

  if (!conflictDeclaration) return <Screen>{null}</Screen>;

  async function save(hasConflict: boolean, details: string) {
    const { error } = await supabase.rpc('declare_conflicts', {
      p_has_conflict: hasConflict,
      p_details: details,
    });
    if (error) return error.message;
    router.back();
    return null;
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        A conflict of interest is anything that could affect, or look like it affects, a decision
        you make for the club: such as a family member in a team you coach or select, or a
        business that sells to the club. Declaring one doesn’t stop you doing your role; it lets
        the committee manage it fairly.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {seasonLabel(conflictDeclaration.season)} season
        {conflictDeclaration.declared_at
          ? ` · declared ${formatDateString(conflictDeclaration.declared_at.slice(0, 10))}`
          : ''}
      </ThemedText>
      <ConflictForm
        hasConflict={conflictDeclaration.has_conflict}
        details={conflictDeclaration.details}
        saveTitle={conflictDeclaration.declared_at ? 'Save changes' : 'Declare'}
        onSave={save}
      />
    </Screen>
  );
}
