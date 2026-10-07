import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export function Screen({
  children,
  refreshing,
  onRefresh,
  withTopInset = false,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Set on screens without a navigation header. */
  withTopInset?: boolean;
}) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={withTopInset ? undefined : ['bottom', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} />
            ) : undefined
          }>
          {children}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
});
