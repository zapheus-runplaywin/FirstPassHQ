import {
  cleanContacts,
  contactsError,
  emptyContact,
  hasHealthNotes,
  MAX_EMERGENCY_CONTACTS,
  medicalSections,
  teamMedicalLine,
  telLink,
  type TeamMedicalRow,
} from '@/lib/medical';

const contact = (name: string, phone: string, relationship = '') => ({ name, relationship, phone });

describe('cleanContacts', () => {
  it('trims each contact and leaves out blank ones', () => {
    expect(
      cleanContacts([contact(' Sam ', ' 0400 000 000 ', ' Aunt '), emptyContact(), contact(' ', ' ')]),
    ).toEqual([contact('Sam', '0400 000 000', 'Aunt')]);
  });

  it('keeps a contact with only a relationship, so it can be refused', () => {
    expect(cleanContacts([contact('', '', 'Mum')])).toEqual([contact('', '', 'Mum')]);
  });
});

describe('contactsError', () => {
  it('accepts no contacts, and blank rows', () => {
    expect(contactsError([])).toBeNull();
    expect(contactsError([emptyContact()])).toBeNull();
  });

  it('accepts Australian and international numbers', () => {
    expect(contactsError([contact('Sam', '0400 000 000'), contact('Ali', '+61 (8) 9000-0000')])).toBeNull();
  });

  it('needs a name and a phone number', () => {
    expect(contactsError([contact('Sam', '')])).toBe('Each emergency contact needs a name and a phone number');
    expect(contactsError([contact('', '0400 000 000')])).toBe(
      'Each emergency contact needs a name and a phone number',
    );
    expect(contactsError([contact('', '', 'Mum')])).toBe('Each emergency contact needs a name and a phone number');
  });

  it('checks the phone number looks like one, with at least 6 digits', () => {
    expect(contactsError([contact('Sam', 'call me')])).toBe('Check the phone number for Sam');
    expect(contactsError([contact('Sam', '12345')])).toBe('Check the phone number for Sam');
    expect(contactsError([contact('Sam', '123456')])).toBeNull();
    expect(contactsError([contact('Sam', '0400 000 000 x')])).toBe('Check the phone number for Sam');
  });

  it('allows at most three', () => {
    expect(MAX_EMERGENCY_CONTACTS).toBe(3);
    const three = [1, 2, 3].map((n) => contact(`C${n}`, `040000000${n}`));
    expect(contactsError(three)).toBeNull();
    expect(contactsError([...three, contact('C4', '0400000004')])).toBe('Add up to 3 emergency contacts');
  });
});

describe('telLink', () => {
  it('keeps only digits and a plus', () => {
    expect(telLink('+61 (400) 000-001')).toBe('tel:+61400000001');
    expect(telLink('0400 000 000')).toBe('tel:0400000000');
  });
});

describe('hasHealthNotes', () => {
  const blank = { conditions: '', allergies: '', medications: '', action_plan: '' };
  it('is false when every section is blank or spaces', () => {
    expect(hasHealthNotes(blank)).toBe(false);
    expect(hasHealthNotes({ ...blank, allergies: '  ' })).toBe(false);
  });
  it.each(medicalSections.map((s) => s.key))('is true with %s', (key) => {
    expect(hasHealthNotes({ ...blank, [key]: 'Something' })).toBe(true);
  });
});

describe('medicalSections', () => {
  it('lists allergies first, then conditions, medications and the action plan', () => {
    expect(medicalSections.map((s) => s.label)).toEqual(['Allergies', 'Conditions', 'Medications', 'Action plan']);
  });
});

describe('teamMedicalLine', () => {
  const row = (extra: Partial<TeamMedicalRow>): TeamMedicalRow => ({
    athlete_id: 'a',
    athlete_name: 'A',
    can_open: true,
    has_contacts: true,
    needs_consent: false,
    ...extra,
  });
  it('says whether an athlete the member can open has contacts', () => {
    expect(teamMedicalLine(row({}))).toBe('Emergency contacts added');
    expect(teamMedicalLine(row({ has_contacts: false }))).toBe('No emergency contacts yet');
  });
  it('says a child is waiting for health consent', () => {
    expect(teamMedicalLine(row({ can_open: false, has_contacts: false, needs_consent: true }))).toBe(
      'Waiting for a parent’s health consent',
    );
  });
  it('otherwise says they can’t see them', () => {
    expect(teamMedicalLine(row({ can_open: false, has_contacts: false }))).toBe('You can’t see their details');
  });
});
