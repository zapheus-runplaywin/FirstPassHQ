/**
 * Fixed colours for "done" and "all good", whatever the club's colours, so a
 * finished state looks the same in every club (as the red and amber warnings
 * in src/components/todo-alert.tsx do). The green passes 3:1 against both a
 * white and a deep navy background, enough for a drawn tick. Words that say
 * "done" use the palette's `positive` instead (src/constants/theme.ts), which
 * is chosen to read as text on the club's own panels.
 */
export const StatusColours = {
  good: '#17935F',
  onGood: '#FFFFFF',
} as const;
