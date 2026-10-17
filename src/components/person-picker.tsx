import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipGroup, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { memberName } from '@/lib/reports';
import type { Profile } from '@/lib/types';

/** How many people to offer while searching. */
const MATCHES = 5;

/** Chooses one person from a list by searching their name or email. */
export function PersonPicker({
  label,
  people,
  selected,
  onChange,
}: {
  label: string;
  people: Profile[];
  selected: string | null;
  onChange: (id: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const chosen = people.find((p) => p.id === selected);
  const matches = query
    ? people
        .filter(
          (p) =>
            p.id !== selected &&
            [p.full_name, p.preferred_name, p.email].some((v) => v?.toLowerCase().includes(query)),
        )
        .slice(0, MATCHES)
    : [];
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {chosen ? (
        <ChipGroup
          options={[{ value: chosen.id, label: `${memberName(chosen)}  ✕` }]}
          selected={[chosen.id]}
          onToggle={() => onChange(null)}
        />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Nobody chosen.
        </ThemedText>
      )}
      <TextField label="Search" value={search} onChangeText={setSearch} placeholder="Name or email" />
      {matches.length > 0 ? (
        <ChipGroup
          options={matches.map((p) => ({ value: p.id, label: memberName(p) }))}
          selected={[]}
          onToggle={(id) => {
            onChange(id);
            setSearch('');
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
