import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { ConfirmDelete, ErrorText } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { hasRole } from '@/lib/roles';
import { revokeAppleSignIn, usesAppleSignIn } from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export default function DeleteAccountScreen() {
  const club = useClub();
  const { session, profile, signOut } = useAuth();
  // Apple can only be asked on an iPhone or iPad; elsewhere the revoke is
  // skipped and the note would be wrong.
  const apple = Platform.OS === 'ios' && usesAppleSignIn(session?.user);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardian = !!profile && hasRole(profile, 'guardian');
  // A parent's children who don't use the app: they have no app to lock, so
  // the parent is told what leaving means for them instead.
  const [children, setChildren] = useState<{ name: string; noApp: boolean }[] | null>(null);

  useEffect(() => {
    if (!guardian || !profile) return;
    let live = true;
    (async () => {
      const { data: links } = await supabase
        .from('guardianships')
        .select('athlete_id')
        .eq('guardian_id', profile.id);
      const ids = ((links as { athlete_id: string }[] | null) ?? []).map((l) => l.athlete_id);
      if (ids.length === 0) {
        if (live) setChildren([]);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, preferred_name, no_sign_in')
        .in('id', ids);
      if (!live) return;
      const rows =
        (data as Pick<Profile, 'id' | 'full_name' | 'preferred_name' | 'no_sign_in'>[] | null) ??
        [];
      setChildren(
        rows.map((c) => ({
          name: c.preferred_name || c.full_name || 'Your child',
          noApp: !!c.no_sign_in,
        })),
      );
    })();
    return () => {
      live = false;
    };
  }, [guardian, profile]);

  const noAppNames = (children ?? [])
    .filter((c) => c.noApp)
    .map((c) => c.name)
    .sort();
  // Until the children load, or with none linked, a parent sees the usual note.
  const anyWithApp = children === null || children.length === 0 || children.some((c) => !c.noApp);


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
      {guardian && anyWithApp ? (
        <ThemedText type="small" themeColor="textSecondary">
          If you’re the only verified parent or guardian linked to a child under 18, their app locks
          again until another parent or guardian is linked: they’ll see only a new link code to
          share, and the club’s admins are told.
        </ThemedText>
      ) : null}
      {guardian && noAppNames.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {listNames(noAppNames)} {noAppNames.length === 1 ? 'doesn’t' : 'don’t'} use the app. If
          you’re the only verified parent or guardian linked to{' '}
          {noAppNames.length === 1 ? 'them' : 'any of them'}, nobody can report their absences or
          injuries, give consent or answer surveys for them until the club links another parent or
          guardian, and the club’s admins are told.
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

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
function listNames(names: string[]) {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
