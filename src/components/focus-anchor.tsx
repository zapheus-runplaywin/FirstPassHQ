import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';

import { useScrollToY } from '@/components/screen';
import { Spacing } from '@/constants/theme';

/** How long after it first appears the anchor keeps up with content loading above it. */
const SETTLE_MS = 1500;

/**
 * Scrolls the screen to this point when it appears, so a page opened for one
 * job shows that job first, with `children` (such as what to do) at the top.
 * Put it straight inside a `Screen`, just above the part to show. Content that
 * loads above it in the first moments moves it, so it follows for a short
 * while, then leaves the scrolling to the person.
 */
export function FocusAnchor({ active, children }: { active: boolean; children?: ReactNode }) {
  const scrollToY = useScrollToY();
  const settleBy = useRef(0);
  if (!active) return null;
  return (
    <View
      testID="focus-anchor"
      onLayout={(event) => {
        const now = Date.now();
        if (!settleBy.current) settleBy.current = now + SETTLE_MS;
        if (now <= settleBy.current) scrollToY(event.nativeEvent.layout.y - Spacing.three);
      }}>
      {children}
    </View>
  );
}
