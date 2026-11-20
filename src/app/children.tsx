import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ChildCodeCard } from '@/components/guardian-link';
import { NoAppChildCard } from '@/components/no-app-child';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import type { ChildConsent } from '@/lib/consents';
import { guardianOfText } from '@/lib/guardian-links';
import { supabase } from '@/lib/supabase';

/**
 * A parent or guardian's children, and the two ways to add another: their
 * child's link code, or asking the club to add a child who won't use the app.
 * Opened from the Guardian of card on Home, so Home stays short.
 */
export default function ChildrenScreen() {
  const [names, setNames] = useState<string[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Remounts the cards on pull to refresh, so their requests reload too.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_child_consents');
    setNames(((data as ChildConsent[] | null) ?? []).map((c) => c.full_name ?? 'Unnamed athlete'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    setVersion((v) => v + 1);
    await load();
    setRefreshing(false);
  }

  const count = names?.length ?? 0;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Card>
        <ThemedText type="smallBold">Guardian of</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {names === null ? 'Loading…' : guardianOfText(names)}
        </ThemedText>
      </Card>
      <ChildCodeCard
        key={`code-${version}`}
        title={count > 0 ? 'Add another child' : 'Enter your child’s code'}
      />
      <NoAppChildCard key={`no-app-${version}`} />
    </Screen>
  );
}
