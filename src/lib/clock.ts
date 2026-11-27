/**
 * Clock times as members type and read them. No imports, so anything can use it.
 */

/** "18:00:00" as "6:00 pm". */
export function formatTime(time: string | null) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** A typed time such as "6pm", "18:00" or "6.30 pm" as "18:30", or null when it isn't one. */
export function parseTime(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3];
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    if (half === 'pm' && hour < 12) hour += 12;
    if (half === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** A Date's local time as "18:30". */
export function timeOf(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
