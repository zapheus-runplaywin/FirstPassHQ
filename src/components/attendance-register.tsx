import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardGrid, useInCardGrid } from '@/components/columns';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { presentLabel } from '@/lib/attendance';
import { withNoAppLabel } from '@/lib/no-app-child';
import { supabase } from '@/lib/supabase';
import type { AttendanceMark } from '@/lib/types';

const ABSENT = '#FF8A8A';

/** Which of these members never sign in (a parent runs their record), so the register says so. */
function useNoAppIds(ids: string[]) {
  const [noApp, setNoApp] = useState<Set<string>>(new Set());
  const key = [...ids].sort().join(',');
  useEffect(() => {
    if (!key) return;
    let current = true;
    supabase
      .from('profiles')
      .select('id')
      .eq('no_sign_in', true)
      .in('id', key.split(','))
      .then(({ data }) => {
        if (current) setNoApp(new Set(((data as { id: string }[] | null) ?? []).map((r) => r.id)));
      });
    return () => {
      current = false;
    };
  }, [key]);
  return noApp;
}

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
  const noApp = useNoAppIds(register.map((m) => m.profile_id));
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
      {/* Two or three athletes a row on a tablet, so a whole squad fits on one screen. */}
      <CardGrid>
        {register.map((mark) => (
          <RegisterRow key={mark.profile_id}>
            <View style={styles.name}>
              <ThemedText type="small" numberOfLines={1}>
                {withNoAppLabel(mark.full_name ?? 'Unnamed athlete', noApp.has(mark.profile_id))}
              </ThemedText>
              {away[mark.profile_id] ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
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
                    mark.present === null
                      ? theme.textSecondary
                      : mark.present
                        ? theme.positive
                        : ABSENT,
                }}>
                {mark.present === null ? 'Not marked' : mark.present ? 'Present' : 'Absent'}
              </ThemedText>
            )}
          </RegisterRow>
        ))}
      </CardGrid>
    </View>
  );
}

/** One athlete's line; as tall as the others in its row on a tablet. */
function RegisterRow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const inGrid = useInCardGrid();
  return (
    <View style={[styles.row, inGrid && styles.fill, { backgroundColor: theme.backgroundElement }]}>
      {children}
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
  fill: {
    flexGrow: 1,
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
