import { useState } from 'react';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ConfirmDelete, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { hasRole } from '@/lib/roles';
import { revokeAppleSignIn, usesAppleSignIn } from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';

export default function DeleteAccountScreen() {
  const club = useClub();
  const { session, profile, signOut } = useAuth();
  const apple = usesAppleSignIn(session?.user);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    // Apple asks apps to revoke Sign in with Apple when an account is
    // deleted. Only cancelling Apple's sheet stops the deletion.
    if (apple && (await revokeAppleSignIn()) === 'cancelled') {
      setDeleting(false);
      return;
    }
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
      <ThemedText type="smallBold">Delete your {club.name} account</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        This permanently deletes your {club.name} app account: your profile, your squad and
        team places, guardian links, your personal tasks and your messages inbox. Messages you
        sent to a group stay with the people who received them.
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        The club keeps your injury records after you leave, where only the committee and admins
        can see them, for its keep period for injuries (7 years unless the club chose 3, 5 or 10),
        counted from when you leave, and then deletes them. Nothing is deleted while the club has
        removing old records switched off. Clearance documents may go sooner, after the club’s
        keep period for injury documents. It also keeps, under your name,
        your code of conduct acceptances, any concerns you raised (unless you hid your name) and,
        if you coach or manage, your season KPIs and their reviews.
      </ThemedText>
      {profile && hasRole(profile, 'guardian') ? (
        <ThemedText type="small" themeColor="textSecondary">
          If you’re the only verified parent or guardian linked to a child under 18, their app locks
          again until another parent or guardian is linked: they’ll see only a new link code to
          share, and the club’s admins are told.
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary">
        It doesn’t change your PlayHQ registration or club membership, or your account at any other
        club in FirstPass HQ. If you sign in again later, you’ll need to ask to join again.
      </ThemedText>
      {apple ? (
        <ThemedText type="small" themeColor="textSecondary">
          You signed in with Apple, so Apple asks you to confirm once more. That also stops this
          app using your Apple sign-in. Your Apple Account itself isn’t changed. If you belong to
          another club in FirstPass HQ, your account there stays: Apple just asks you to agree
          again next time you sign in there.
        </ThemedText>
      ) : null}
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
