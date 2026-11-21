import { useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipGroup, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { matchPickable, type PickablePerson } from '@/lib/people-picker';

/** How many people to offer while searching. */
const MATCHES = 5;

/**
 * Chooses several people by searching their name. The people chosen sit
 * straight under the search box, so a tap on a match shows its result where
 * the finger is, and each has a ✕ to take them off again. Used for who a
 * concern is about and for the safeguarding posts, so both look and work the
 * same.
 */
export function PeoplePicker({
  label,
  hint,
  people,
  selected,
  onAdd,
  onRemove,
  max,
  searchLabel = 'Search',
  placeholder = 'Name',
  noneChosen = 'Nobody chosen.',
  disabled = false,
}: {
  label: string;
  hint?: string;
  /** Who can be found by searching. */
  people: PickablePerson[];
  /** Who is chosen, in order, with a note such as "can't act" when needed. */
  selected: PickablePerson[];
  onAdd: (person: PickablePerson) => void;
  onRemove: (person: PickablePerson) => void;
  /** The most that can be chosen; the search box goes once it's reached. */
  max?: number;
  searchLabel?: string;
  placeholder?: string;
  noneChosen?: string;
  /** While a change is being saved. */
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const chosenIds = new Set(selected.map((p) => p.id));
  const matches = matchPickable(
    people.filter((p) => !chosenIds.has(p.id)),
    search,
    MATCHES,
  );
  const full = max !== undefined && selected.length >= max;

  function add(id: string) {
    const person = people.find((p) => p.id === id);
    if (!person || disabled) return;
    onAdd(person);
    setSearch('');
    AccessibilityInfo.announceForAccessibility?.(`${person.name} added to ${label}`);
  }

  return (
    <View style={styles.group}>
      <View style={styles.heading}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {max !== undefined && selected.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {`${selected.length} of ${max}`}
          </ThemedText>
        ) : null}
      </View>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      {full ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`That’s the most (${max}). Take someone off to add another.`}
        </ThemedText>
      ) : (
        <>
          <TextField
            label={searchLabel}
            value={search}
            onChangeText={setSearch}
            placeholder={placeholder}
          />
          {matches.length > 0 ? (
            <ChipGroup
              options={matches.map((p) => ({ value: p.id, label: `+ ${p.name}` }))}
              selected={[]}
              onToggle={add}
            />
          ) : search.trim() ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`Nobody matches “${search.trim()}”.`}
            </ThemedText>
          ) : null}
        </>
      )}
      <View
        testID={`${label} chosen`}
        style={[styles.chosen, { borderColor: theme.backgroundSelected }]}>
        {selected.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {noneChosen}
          </ThemedText>
        ) : (
          <View style={styles.chips}>
            {selected.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`Take ${p.name} off ${label}`}
                accessibilityState={{ selected: true, disabled }}
                disabled={disabled}
                onPress={() => onRemove(p)}
                style={[styles.chip, { backgroundColor: theme.accent }]}>
                <ThemedText type="small" style={{ color: theme.onAccent }}>
                  {`${p.note ? `${p.name} (${p.note})` : p.name}  ✕`}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  chosen: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
});
