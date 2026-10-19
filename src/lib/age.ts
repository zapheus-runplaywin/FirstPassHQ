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
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC reads years 0 to 99 as 1900 to 1999, so check the year too.
  // Stryker disable next-line ConditionalExpression: a day or month that rolls over changes both, so either check alone catches it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Whether someone is under 18 today: by date of birth when recorded, otherwise
 * by the admin's choice. Same rule as `public.is_minor` in the database.
 */
export function isMinor(dateOfBirth: string | null | undefined, under18: boolean) {
  if (!dateOfBirth) return under18;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const today = new Date();
  const eighteenth = new Date(year + 18, month - 1, day);
  return eighteenth > new Date(today.getFullYear(), today.getMonth(), today.getDate());
}
