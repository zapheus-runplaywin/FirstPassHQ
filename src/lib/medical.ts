/** One emergency contact on an athlete's medical and emergency details. */
export type EmergencyContact = { name: string; relationship: string; phone: string };

/** How the signed-in member sees an athlete's medical details. */
export type MedicalRole = 'self' | 'guardian' | 'physio' | 'coach' | 'manager';

/** An athlete's medical and emergency details, as `medical_profile` returns them. */
export type MedicalProfile = {
  athlete_id: string;
  athlete_name: string | null;
  role: MedicalRole;
  can_edit: boolean;
  saved: boolean;
  emergency_contacts: EmergencyContact[];
  conditions: string;
  allergies: string;
  medications: string;
  action_plan: string;
  updated_at: string | null;
  updated_by_name: string | null;
};

/** One time someone other than the athlete or their guardians opened them. */
export type MedicalView = { viewer_name: string; viewer_role: string | null; viewed_at: string };

/** A squad or team's athletes, for its coaches, managers and physios. */
export type TeamMedicalRow = {
  athlete_id: string;
  athlete_name: string;
  can_open: boolean;
  has_contacts: boolean;
  needs_consent: boolean;
};

export const MAX_EMERGENCY_CONTACTS = 3;

/** The four free-text sections, in the order they're shown. */
export const medicalSections = [
  { key: 'allergies', label: 'Allergies', placeholder: 'Peanuts (anaphylaxis), bee stings…' },
  { key: 'conditions', label: 'Conditions', placeholder: 'Asthma, diabetes, epilepsy…' },
  { key: 'medications', label: 'Medications', placeholder: 'Ventolin, EpiPen, insulin…' },
  {
    key: 'action_plan',
    label: 'Action plan',
    placeholder: 'What to do and who to call, such as: two puffs of Ventolin, call 000 if no better',
  },
] as const;

export type MedicalSectionKey = (typeof medicalSections)[number]['key'];

export const emptyContact = (): EmergencyContact => ({ name: '', relationship: '', phone: '' });

/** Contacts as they're saved: trimmed, and leaving out any left completely blank. */
export function cleanContacts(contacts: EmergencyContact[]): EmergencyContact[] {
  return contacts
    .map((c) => ({ name: c.name.trim(), relationship: c.relationship.trim(), phone: c.phone.trim() }))
    .filter((c) => c.name || c.relationship || c.phone);
}

/** What's wrong with the contacts before saving, or null; the database checks the same. */
export function contactsError(contacts: EmergencyContact[]): string | null {
  const cleaned = cleanContacts(contacts);
  if (cleaned.length > MAX_EMERGENCY_CONTACTS) return `Add up to ${MAX_EMERGENCY_CONTACTS} emergency contacts`;
  for (const c of cleaned) {
    if (!c.name || !c.phone) return 'Each emergency contact needs a name and a phone number';
    if (!/^[0-9 +()-]+$/.test(c.phone) || c.phone.replace(/[^0-9]/g, '').length < 6) {
      return `Check the phone number for ${c.name}`;
    }
  }
  return null;
}

/** A phone number as a link the phone can call. */
export function telLink(phone: string) {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

/** Whether anything beyond the contacts has been written down. */
export function hasHealthNotes(profile: Pick<MedicalProfile, MedicalSectionKey>) {
  return medicalSections.some((s) => profile[s.key].trim() !== '');
}

/** The line under an athlete's name in a squad or team's list. */
export function teamMedicalLine(row: TeamMedicalRow) {
  if (row.can_open) return row.has_contacts ? 'Emergency contacts added' : 'No emergency contacts yet';
  if (row.needs_consent) return 'Waiting for a parent’s health consent';
  return 'You can’t see their details';
}
