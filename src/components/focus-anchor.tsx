import { createContext, use, useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';

import { useScrollToY } from '@/components/screen';
import { Spacing } from '@/constants/theme';

/** How long after it first appears the anchor keeps up with content loading above it. */
const SETTLE_MS = 1500;

/** How far down the screen the block an anchor sits in starts. */
const Offset = createContext(0);

/**
 * For anchors inside a block of their own within a `Screen`, such as one tab
 * of a page in tabs: says where that block starts (`y`, from its own
 * `onLayout`), so an anchor in it still scrolls to the right place.
 */
export function FocusOffset({ y, children }: { y: number; children: ReactNode }) {
  return <Offset value={y}>{children}</Offset>;
}

/**
 * Scrolls the screen to this point when it appears, so a page opened for one
 * job shows that job first, with `children` (such as what to do) at the top.
 * Put it straight inside a `Screen`, or straight inside a block that a
 * `FocusOffset` describes, just above the part to show. Content that loads
 * above it in the first moments moves it, so it follows for a short while,
 * then leaves the scrolling to the person.
 */
export function FocusAnchor({ active, children }: { active: boolean; children?: ReactNode }) {
  const scrollToY = useScrollToY();
  const offset = use(Offset);
  const settleBy = useRef(0);
  // Where it sits in its block, once laid out.
  const own = useRef<number | null>(null);

  // The block it sits in was laid out after it, or moved: follow, for the same short while.
  useEffect(() => {
    if (!active || own.current === null || Date.now() > settleBy.current) return;
    scrollToY(offset + own.current - Spacing.three);
  }, [active, offset, scrollToY]);

  if (!active) return null;
  return (
    <View
      testID="focus-anchor"
      onLayout={(event) => {
        const now = Date.now();
        if (!settleBy.current) settleBy.current = now + SETTLE_MS;
        own.current = event.nativeEvent.layout.y;
        if (now <= settleBy.current) scrollToY(offset + own.current - Spacing.three);
      }}>
      {children}
    </View>
  );
}
