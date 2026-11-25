/**
 * Fixed colours for "done" and "all good", whatever the club's colours, so a
 * finished state looks the same in every club (as the red and amber warnings
 * in src/components/todo-alert.tsx do). The green passes 3:1 against both a
 * white and a deep navy background, enough for a drawn tick.
 */
export const StatusColours = {
  good: '#17935F',
  onGood: '#FFFFFF',
} as const;
