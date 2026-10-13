import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { presentLabel } from '@/lib/attendance';
import type { AttendanceMark } from '@/lib/types';

const ABSENT = '#FF8A8A';

/**
 * Each athlete with Present and Absent buttons. Read-only when `onChange` is
 * left out. `away` notes athletes reported away that day, by profile id.
 */
export function AttendanceRegister({
  register,
  onChange,
  away = {},
}: {
  register: AttendanceMark[];
  onChange?: (profileId: string, present: boolean) => void;
  away?: Record<string, string>;
}) {
  const theme = useTheme();
  const marked = register.filter((m) => m.present !== null);
  const present = marked.filter((m) => m.present).length;

  return (
    <View style={styles.list}>
      <ThemedText type="smallBold">
        {presentLabel(present, register.length)}
        {marked.length < register.length ? ` · ${register.length - marked.length} not marked` : ''}
      </ThemedText>
      {register.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          There are no athletes in this squad or team yet.
        </ThemedText>
      ) : null}
      {register.map((mark) => (
        <View
          key={mark.profile_id}
          style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.name}>
            <ThemedText type="small" numberOfLines={1}>
              {mark.full_name ?? 'Unnamed athlete'}
            </ThemedText>
            {away[mark.profile_id] ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                {away[mark.profile_id]}
              </ThemedText>
            ) : null}
          </View>
          {onChange ? (
            <View style={styles.toggle}>
              <Choice
                label="Present"
                selected={mark.present === true}
                colour={theme.accent}
                textColour={theme.onAccent}
                onPress={() => onChange(mark.profile_id, true)}
              />
              <Choice
                label="Absent"
                selected={mark.present === false}
                colour={ABSENT}
                textColour="#000000"
                onPress={() => onChange(mark.profile_id, false)}
              />
            </View>
          ) : (
            <ThemedText
              type="small"
              style={{
                color:
                  mark.present === null ? theme.textSecondary : mark.present ? theme.tint : ABSENT,
              }}>
              {mark.present === null ? 'Not marked' : mark.present ? 'Present' : 'Absent'}
            </ThemedText>
          )}
        </View>
      ))}
    </View>
  );
}

function Choice({
  label,
  selected,
  colour,
  textColour,
  onPress,
}: {
  label: string;
  selected: boolean;
  colour: string;
  textColour: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, { backgroundColor: selected ? colour : theme.backgroundSelected }]}>
      <ThemedText type="small" style={selected ? { color: textColour } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    paddingVertical: Spacing.two,
    minHeight: 56,
  },
  name: {
    flex: 1,
  },
  toggle: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  choice: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
