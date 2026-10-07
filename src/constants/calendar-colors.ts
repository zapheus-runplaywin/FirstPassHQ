/**
 * Bright colours for calendars, chosen to stand out on the black background.
 * Keys are stored in `calendars.color`; keep them in step with the migration.
 */
export const CalendarColors = {
  yellow: { label: 'Yellow', hex: '#FFCD00' },
  blue: { label: 'Blue', hex: '#1E90FF' },
  green: { label: 'Green', hex: '#2EE86B' },
  pink: { label: 'Pink', hex: '#FF3EA5' },
  orange: { label: 'Orange', hex: '#FF7A00' },
  violet: { label: 'Violet', hex: '#A259FF' },
  light_blue: { label: 'Light blue', hex: '#5CE1FF' },
  dark_blue: { label: 'Dark blue', hex: '#3D4EFF' },
} as const;

export type CalendarColor = keyof typeof CalendarColors;

export const calendarColorKeys = Object.keys(CalendarColors) as CalendarColor[];

/** Who a calendar is for, which decides its colour until an admin picks one. */
export type CalendarAudience = 'club' | 'committee' | 'squad' | 'team';

const defaults: Record<CalendarAudience, CalendarColor> = {
  club: 'yellow',
  committee: 'pink',
  squad: 'blue',
  team: 'green',
};

/** The colour key a calendar shows in: the one picked, or its audience's default. */
export function calendarColorKey(color: string | null, audience: CalendarAudience): CalendarColor {
  return color && color in CalendarColors ? (color as CalendarColor) : defaults[audience];
}

export function calendarColorHex(color: string | null, audience: CalendarAudience) {
  return CalendarColors[calendarColorKey(color, audience)].hex;
}
