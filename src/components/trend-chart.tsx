import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkInQuestions, FLAG_AT } from '@/lib/check-ins';
import { formatShortDay } from '@/lib/format';
import { parseDateString } from '@/lib/injuries';
import type { CheckInTrendDay } from '@/lib/types';

const PLOT_HEIGHT = 72;
const BAR_PLOT_HEIGHT = 40;
const LINE = 2;
const DOT = 8;
/** Room on the left for the 1, 3 and 5 labels. */
const AXIS_WIDTH = 16;

/**
 * Small multiples of a group's check-in averages: one line per question on the
 * same 1 to 5 scale, each day averaging that day and the two before it, plus
 * how many athletes checked in each day. Tapping a day shows its values in
 * every chart. Days with fewer than 5 athletes checking in over their three
 * days have no scores, so their lines break there.
 */
export function CheckInTrends({ days }: { days: CheckInTrendDay[] }) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - AXIS_WIDTH);

  if (days.length === 0) return null;
  const index = selected ?? lastWithScores(days);
  const day = index === null ? null : days[index];

  return (
    <View
      style={styles.charts}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 2 * Spacing.three)}>
      <ThemedText type="small" themeColor="textSecondary">
        {day
          ? `${formatShortDay(parseDateString(day.day))} · ${day.checked_in_count} checked in · ${
              day.window_count
            } over 3 days${day.flagged_count ? ` · ${day.flagged_count} flagged` : ''}`
          : 'Not enough check-ins yet'}
      </ThemedText>

      {checkInQuestions.map((q) => {
        const values = days.map((d) => d[`avg_${q.key}`]);
        const value = index === null ? null : values[index];
        return (
          <Card key={q.key} style={styles.card}>
            <View style={styles.header}>
              <ThemedText type="smallBold">{q.label}</ThemedText>
              <ThemedText type="smallBold">
                {value === null ? '–' : Number(value).toFixed(1)}
              </ThemedText>
            </View>
            {plotWidth > 0 ? (
              <LinePlot
                values={values.map((v) => (v === null ? null : Number(v)))}
                width={plotWidth}
                selected={index}
                onSelect={(i) => setSelected(i === selected ? null : i)}
              />
            ) : (
              <View style={{ height: PLOT_HEIGHT }} />
            )}
          </Card>
        );
      })}

      <Card style={styles.card}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Checked in</ThemedText>
          <ThemedText type="smallBold">{day ? day.checked_in_count : '–'}</ThemedText>
        </View>
        {plotWidth > 0 ? (
          <BarPlot
            values={days.map((d) => d.checked_in_count)}
            width={plotWidth}
            selected={index}
            onSelect={(i) => setSelected(i === selected ? null : i)}
          />
        ) : (
          <View style={{ height: BAR_PLOT_HEIGHT }} />
        )}
      </Card>

      <ThemedText type="small" themeColor="textSecondary">
        Averages out of 5, each day covering that day and the two before it. The red line is{' '}
        {FLAG_AT}: a score at or below it flags an athlete. Scores show once at least 5 athletes
        checked in over those three days, and hide when a related group is within 4 of this one.
        Tap a day to see its numbers.
      </ThemedText>

      <View style={styles.dates}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatShortDay(parseDateString(days[0].day))}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatShortDay(parseDateString(days[days.length - 1].day))}
        </ThemedText>
      </View>
    </View>
  );
}

function lastWithScores(days: CheckInTrendDay[]) {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].avg_mood !== null) return i;
  return null;
}

/** A 1 to 5 line with gridlines at 1, 3 and 5 and a line where scores flag. */
function LinePlot({
  values,
  width,
  selected,
  onSelect,
}: {
  values: (number | null)[];
  width: number;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const x = (i: number) => (values.length > 1 ? i * step : width / 2);
  const y = (v: number) => PLOT_HEIGHT - ((v - 1) / 4) * PLOT_HEIGHT;

  const segments: { x1: number; y1: number; x2: number; y2: number; key: number }[] = [];
  values.forEach((v, i) => {
    const next = values[i + 1];
    if (v !== null && next !== null && next !== undefined) {
      segments.push({ x1: x(i), y1: y(v), x2: x(i + 1), y2: y(next), key: i });
    }
  });
  const lastIndex = values.reduce<number | null>((last, v, i) => (v === null ? last : i), null);

  return (
    <View style={styles.plotRow}>
      <View style={[styles.axis, { height: PLOT_HEIGHT }]}>
        {[5, 3, 1].map((n) => (
          <ThemedText
            key={n}
            type="small"
            themeColor="textSecondary"
            style={[styles.axisLabel, { top: y(n) - 10 }]}>
            {n}
          </ThemedText>
        ))}
      </View>
      <View style={{ width, height: PLOT_HEIGHT }}>
        {[1, 3, 5].map((n) => (
          <View
            key={n}
            style={[styles.grid, { top: y(n), backgroundColor: theme.backgroundSelected }]}
          />
        ))}
        <View style={[styles.grid, styles.flagLine, { top: y(FLAG_AT) }]} />
        {selected !== null ? (
          <View
            style={[
              styles.crosshair,
              { left: x(selected), height: PLOT_HEIGHT, backgroundColor: theme.textSecondary },
            ]}
          />
        ) : null}
        {segments.map((s) => {
          const dx = s.x2 - s.x1;
          const dy = s.y2 - s.y1;
          // Overlap the next segment slightly so the joins don't show.
          const length = Math.sqrt(dx * dx + dy * dy) + LINE;
          return (
            <View
              key={s.key}
              style={[
                styles.segment,
                {
                  width: length,
                  left: (s.x1 + s.x2) / 2 - length / 2,
                  top: (s.y1 + s.y2) / 2 - LINE / 2,
                  backgroundColor: theme.accent,
                  transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
                },
              ]}
            />
          );
        })}
        {values.map((v, i) =>
          v !== null &&
          (i === selected || (selected === null && i === lastIndex) || isAlone(values, i)) ? (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  left: x(i) - DOT / 2 - 2,
                  top: y(v) - DOT / 2 - 2,
                  backgroundColor: theme.accent,
                  borderColor: theme.backgroundElement,
                },
              ]}
            />
          ) : null,
        )}
        <TapTargets count={values.length} width={width} height={PLOT_HEIGHT} onSelect={onSelect} />
      </View>
    </View>
  );
}

/** A point with no neighbours draws no line, so it gets a dot. */
function isAlone(values: (number | null)[], i: number) {
  return (values[i - 1] ?? null) === null && (values[i + 1] ?? null) === null;
}

/** How many athletes checked in each day. */
function BarPlot({
  values,
  width,
  selected,
  onSelect,
}: {
  values: number[];
  width: number;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...values);
  const slot = width / values.length;
  const barWidth = Math.max(2, Math.min(12, slot - 2));

  return (
    <View style={styles.plotRow}>
      <View style={[styles.axis, { height: BAR_PLOT_HEIGHT }]} />
      <View style={{ width, height: BAR_PLOT_HEIGHT }}>
        <View
          style={[styles.grid, { top: BAR_PLOT_HEIGHT, backgroundColor: theme.backgroundSelected }]}
        />
        {values.map((v, i) => {
          const height = (v / max) * BAR_PLOT_HEIGHT;
          return v > 0 ? (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  left: i * slot + (slot - barWidth) / 2,
                  width: barWidth,
                  height,
                  top: BAR_PLOT_HEIGHT - height,
                  backgroundColor: theme.accent,
                  opacity: selected === null || selected === i ? 1 : 0.45,
                },
              ]}
            />
          ) : null;
        })}
        <TapTargets
          count={values.length}
          width={width}
          height={BAR_PLOT_HEIGHT}
          onSelect={onSelect}
          centred={false}
        />
      </View>
    </View>
  );
}

/** One full-height column per day, wider than the marks, so a day is easy to tap. */
function TapTargets({
  count,
  width,
  height,
  onSelect,
  centred = true,
}: {
  count: number;
  width: number;
  height: number;
  onSelect: (index: number) => void;
  centred?: boolean;
}) {
  // Line points sit on the column edges' midpoints; bars sit in the middle of their slot.
  const slot = centred && count > 1 ? width / (count - 1) : width / count;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Pressable
          key={i}
          accessibilityRole="button"
          accessibilityLabel={`Day ${i + 1} of ${count}`}
          onPress={() => onSelect(i)}
          style={{
            position: 'absolute',
            top: 0,
            height,
            width: slot,
            left: centred && count > 1 ? i * slot - slot / 2 : i * slot,
          }}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  charts: {
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  plotRow: {
    flexDirection: 'row',
  },
  axis: {
    width: AXIS_WIDTH,
  },
  axisLabel: {
    position: 'absolute',
    left: 0,
    fontSize: 11,
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  flagLine: {
    backgroundColor: '#FF5A5A',
    opacity: 0.6,
  },
  crosshair: {
    position: 'absolute',
    top: 0,
    width: 1,
  },
  segment: {
    position: 'absolute',
    height: LINE,
  },
  dot: {
    position: 'absolute',
    width: DOT + 4,
    height: DOT + 4,
    borderRadius: (DOT + 4) / 2,
    borderWidth: 2,
  },
  bar: {
    position: 'absolute',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  dates: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: AXIS_WIDTH + Spacing.three,
  },
});
