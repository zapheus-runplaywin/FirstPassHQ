/**
 * Someone who can be chosen in a `PeoplePicker`: their name, an optional
 * email that searching also matches, and an optional note shown beside them
 * once chosen (for example "can't act now").
 */
export type PickablePerson = { id: string; name: string; email?: string | null; note?: string | null };

/**
 * The people whose name matches what's been typed, at most `max`. One letter
 * matches the start of any part of a name ("A" finds Avery Admin and Sam
 * Alder); two or more also match inside a name or an email. Nothing typed
 * matches nobody.
 */
export function matchPickable<T extends PickablePerson>(people: T[], typed: string, max: number): T[] {
  const search = typed.trim().toLowerCase();
  if (!search) return [];
  const matches = (p: T) => {
    const lower = p.name.toLowerCase();
    if (lower.split(/[\s'’-]+/).some((part) => part.startsWith(search))) return true;
    if (search.length < 2) return false;
    return lower.includes(search) || (p.email?.toLowerCase().includes(search) ?? false);
  };
  return people.filter(matches).slice(0, max);
}

/** Adds a person to a list once, keeping the order chosen. */
export function withPerson<T extends { id: string }>(list: T[], person: T): T[] {
  return list.some((p) => p.id === person.id) ? list : [...list, person];
}

/** Takes a person off a list. */
export function withoutPerson<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((p) => p.id !== id);
}

/** "Casey Coach", "Casey Coach and Finley Physio", "A, B and C". */
export function namesLine(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
