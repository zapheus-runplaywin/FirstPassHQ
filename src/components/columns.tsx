import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  use,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { COLUMNS_MIN_WIDTH, gridColumns, toRows, useWideLayout } from '@/hooks/use-layout';

const InCardGrid = createContext(false);

/**
 * True for a card inside a CardGrid with more than one column, so it can
 * stretch to the height of the tallest card in its row.
 */
export function useInCardGrid() {
  return use(InCardGrid);
}

/**
 * Two columns side by side on a wide tablet window (COLUMNS_MIN_WIDTH); otherwise `first` and then `second`
 * stacked in the screen as if Columns weren't there. Keeps tablet screens short
 * by putting what someone came for on the left and the rest on the right.
 */
export function Columns({
  first,
  second,
  gap = Spacing.four,
  firstFlex = 1,
  secondFlex = 1,
}: {
  first: ReactNode;
  second: ReactNode;
  /** Space between the columns and between the things in each. */
  gap?: number;
  /** How wide each column is compared with the other. */
  firstFlex?: number;
  secondFlex?: number;
}) {
  const wide = useWideLayout(COLUMNS_MIN_WIDTH);
  if (!wide) {
    return (
      <>
        {first}
        {second}
      </>
    );
  }
  return (
    <View style={[styles.columns, { gap }]} testID="columns">
      <View style={[styles.column, { gap, flex: firstFlex }]}>{first}</View>
      <View style={[styles.column, { gap, flex: secondFlex }]}>{second}</View>
    </View>
  );
}

/**
 * Cards in a grid: one column on a phone, two or three on a tablet, as many as
 * fit at least CARD_MIN_WIDTH wide. Cards in a row share its height. Nothing
 * (null, false) is left out, and fragments count as the cards in them.
 */
export function CardGrid({ children, gap = Spacing.two }: { children: ReactNode; gap?: number }) {
  const [width, setWidth] = useState(0);
  const items = flattenChildren(children);
  const columns = gridColumns(width, gap);
  const measure = (w: number) => setWidth((old) => (Math.abs(old - w) < 1 ? old : w));

  if (columns === 1) {
    return (
      <View
        style={{ gap }}
        onLayout={(e) => measure(e.nativeEvent.layout.width)}
        testID="card-grid-1">
        {items}
      </View>
    );
  }
  return (
    <View
      style={{ gap }}
      onLayout={(e) => measure(e.nativeEvent.layout.width)}
      testID={`card-grid-${columns}`}>
      <InCardGrid value>
        {toRows(items, columns).map((row, r) => (
          <View key={r} style={[styles.row, { gap }]}>
            {row.map((item, c) => (
              <View key={c} style={styles.cell}>
                {item}
              </View>
            ))}
            {/* Empty cells keep the last row's cards the same width as the rest. */}
            {Array.from({ length: columns - row.length }, (_, i) => (
              <View key={`empty-${i}`} style={styles.cell} />
            ))}
          </View>
        ))}
      </InCardGrid>
    </View>
  );
}

/** The things in `children`, with fragments opened up and nothing left out. */
export function flattenChildren(children: ReactNode, prefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) {
      out.push(child);
    } else if (child.type === Fragment) {
      // Keys from inside a fragment start again, so they carry the fragment's key.
      const inner = (child as ReactElement<{ children?: ReactNode }>).props.children;
      out.push(...flattenChildren(inner, `${prefix}${String(child.key)}`));
    } else {
      out.push(prefix ? cloneElement(child, { key: `${prefix}${String(child.key)}` }) : child);
    }
  }
  return out;
}

const styles = StyleSheet.create({
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
});
