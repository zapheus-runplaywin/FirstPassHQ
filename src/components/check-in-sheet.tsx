/**
 * The daily check-in as a sheet over Today: four taps, and the last answer
 * saves it. It is the same check-in as the full page (src/app/check-in.tsx)
 * and saves through the same `save_check_in`, so who sees the answers doesn't
 * change. The note, the last two weeks and the training log stay on the full
 * page, one tap from here, with the answers already given carried over, and
 * "Something worrying you?" is on both.
 *
 * A check-in can't be removed once saved, only corrected: opened again for
 * today's check-in ("Change" on Today), each tap saves the new answer.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckInScale } from '@/components/check-in-scale';
import { Icon } from '@/components/icon';
import { RaiseConcernLink } from '@/components/safeguarding';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText } from '@/components/ui';
import { BrandFonts, Spacing } from '@/constants/theme';
import { useWideLayout } from '@/hooks/use-layout';
import { useTheme } from '@/hooks/use-theme';
import {
  allAnswered,
  answeredCount,
  answersToParams,
  checkInPrivacy,
  checkInQuestions,
  noAnswers,
  today,
  type CheckInAnswers,
} from '@/lib/check-ins';
import { supabase } from '@/lib/supabase';
import type { CheckIn, CheckInScores } from '@/lib/types';

/** The sheet is never taller than this share of the screen; its questions scroll past that. */
const MAX_HEIGHT = 0.9;

/** As wide as a phone, when it sits in the middle of a tablet. */
const CARD_WIDTH = 480;

export function CheckInSheet({
  existing,
  minor,
  onSaved,
  onClose,
}: {
  /** Today's check-in, when it is already saved and is being changed. */
  existing: CheckIn | null;
  /** The athlete is under 18. */
  minor: boolean;
  /** A save went through: Today reloads, and the sheet waits for it. */
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const wide = useWideLayout();
  // Changing today's saved check-in, or doing it for the first time: decided as the sheet opens.
  const [changing] = useState(existing !== null);
  const [answers, setAnswers] = useState<CheckInAnswers>(() =>
    existing
      ? { sleep: existing.sleep, soreness: existing.soreness, stress: existing.stress, mood: existing.mood }
      : noAnswers,
  );
  const [saving, setSaving] = useState(false);
  const [savedHere, setSavedHere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(scores: CheckInScores) {
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc('save_check_in', {
      p_day: today(),
      p_sleep: scores.sleep,
      p_soreness: scores.soreness,
      p_stress: scores.stress,
      p_mood: scores.mood,
      // The sheet has no note of its own, so a note already saved today is kept.
      p_note: existing?.note ?? '',
    });
    if (saveError) {
      setSaving(false);
      setError(saveError.message);
      return;
    }
    await onSaved();
    setSaving(false);
    // The first check-in of the day is done: back to Today. A change stays open for another.
    if (changing) setSavedHere(true);
    else onClose();
  }

  function answer(key: keyof CheckInScores, value: number) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    setSavedHere(false);
    // The last answer saves it.
    if (allAnswered(next)) save(next);
  }

  function openFull() {
    onClose();
    router.push({ pathname: '/check-in', params: changing ? {} : answersToParams(answers) });
  }

  const status = saving
    ? 'Saving…'
    : savedHere
      ? 'Saved.'
      : changing
        ? 'Tap an answer to change it. Each change saves.'
        : 'Saves when you answer the last one.';

  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent>
      <View style={[styles.fill, wide && styles.fillWide]}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          testID="check-in-backdrop"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.dim]}
        />
        <View
          testID="check-in-sheet"
          accessibilityViewIsModal
          style={[
            styles.sheet,
            wide ? styles.card : { paddingBottom: Math.max(insets.bottom, Spacing.three) },
            {
              backgroundColor: theme.background,
              borderColor: theme.backgroundSelected,
              maxHeight: height * MAX_HEIGHT,
            },
          ]}>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" numberOfLines={1} style={styles.title}>
              Daily check-in
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" testID="check-in-progress">
              {answeredCount(answers)} of {checkInQuestions.length}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
              onPress={onClose}
              style={styles.close}>
              <Icon name="x" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled">
            <ThemedText type="small" themeColor="textSecondary">
              {checkInPrivacy(minor)}
            </ThemedText>

            {/* Above the questions, so it is in view on a short phone: how it saves, that it saved, or why not. */}
            {error ? (
              <>
                <ErrorText>{error}</ErrorText>
                {allAnswered(answers) ? (
                  <Button title="Try again" onPress={() => save(answers)} busy={saving} />
                ) : null}
              </>
            ) : (
              <View style={styles.status} accessibilityLiveRegion="polite">
                {savedHere && !saving ? <Icon name="check" size={16} color={theme.positive} /> : null}
                <ThemedText type="small" themeColor="textSecondary" testID="check-in-status">
                  {status}
                </ThemedText>
              </View>
            )}

            {checkInQuestions.map((q) => (
              <CheckInScale
                key={q.key}
                question={q.question}
                answers={q.answers}
                value={answers[q.key]}
                onChange={(value) => answer(q.key, value)}
                disabled={saving}
              />
            ))}

            {changing ? <Button title="Done" variant="secondary" onPress={onClose} /> : null}

            <View style={styles.links}>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={openFull}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  {existing?.note ? 'Change your note' : 'Add a note'}
                </ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={openFull}>
                <ThemedText type="smallBold" style={{ color: theme.tint }}>
                  Last two weeks
                </ThemedText>
              </Pressable>
            </View>
            <RaiseConcernLink
              context="Daily check-in"
              label="Something worrying you? Tell the club safely"
              onOpen={onClose}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // On a tablet the sheet is a card in the middle.
  fillWide: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  dim: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingTop: Spacing.three,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 20,
    borderWidth: 1,
    paddingBottom: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: BrandFonts.extraBold,
    fontSize: 20,
    lineHeight: 26,
  },
  close: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  content: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  links: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.one,
  },
});
