/** Dates typed by admins as DD/MM/YYYY, stored as YYYY-MM-DD. */

/** "2010-03-14" → "14/03/2010". */
export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * "14/03/2010" → "2010-03-14". Blank → null. Anything that isn't a real date →
 * undefined.
 */
export function parseDate(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (!match) return undefined;
  const [day, month, year] = match.slice(1).map(Number);
  // Nobody in the club was born, or has a check that ends, outside these years,
  // so 01/01/0500 is a typing slip, not a date.
  if (year < 1900 || year > 2100) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  // A day or month that doesn't exist rolls over into another month.
  // Stryker disable next-line ConditionalExpression: a day that doesn't exist always changes the month too, so the day check alone never decides.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

/** Whether someone born on this date is younger than `years` today, by the device's date. */
function isYoungerThan(dateOfBirth: string, years: number) {
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const today = new Date();
  const birthday = new Date(year + years, month - 1, day);
  return birthday > new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

/**
 * Whether someone is under 18 today: by date of birth when recorded, otherwise
 * by the admin's choice. Same rule as `public.is_minor` in the database.
 */
export function isMinor(dateOfBirth: string | null | undefined, under18: boolean) {
  if (!dateOfBirth) return under18;
  return isYoungerThan(dateOfBirth, 18);
}

/**
 * Whether a date of birth makes someone under 13 today, too young to join
 * this year (Matt, 18 November 2026). No date: not known, so no. Same rule as
 * `public.is_under_13` in the database, which has the final say by its own
 * date (UTC).
 */
export function isUnder13(dateOfBirth: string | null | undefined) {
  if (!dateOfBirth) return false;
  return isYoungerThan(dateOfBirth, 13);
}

/** What someone under 13 is told when they ask to join. The database sends the same words. */
export const under13Message =
  'FirstPass HQ is for members aged 13 and over. If you’re a parent or guardian, enter your own date of birth.';
