import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ConfirmDelete, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { supabase } from '@/lib/supabase';

export default function DeleteAccountScreen() {
  const club = useClub();
  const { signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('delete_my_account');
    if (rpcError) {
      setDeleting(false);
      setError(rpcError.message);
      return;
    }
    // The account is gone, so this just clears the session on this phone.
    await signOut();
  }

  return (
    <Screen>
      <ThemedText type="smallBold">Delete your account</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        This permanently deletes your {club.name} app account: your profile, your squad and
        team places, guardian links and your messages inbox. Messages you sent to a group stay with
        the people who received them.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        The club keeps your injury records and clearance documents for 12 months after you leave,
        where only the committee and admins can see them, and then deletes them.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        It doesn’t change your PlayHQ registration or club membership. If you sign in again later,
        you’ll need to ask to join again.
      </ThemedText>
      <ErrorText>{error}</ErrorText>
      <ConfirmDelete
        title="Delete my account"
        warning="Are you sure? This can’t be undone."
        confirmTitle="Delete my account permanently"
        onConfirm={deleteAccount}
        busy={deleting}
      />
    </Screen>
  );
}
