/**
 * The people picker's search and lists (src/lib/people-picker.ts), and who a
 * concern is about and the safeguarding contacts' names (src/lib/concerns.ts),
 * from "Raise a concern" and "Safeguarding contacts" in docs/user-guide.md.
 */
import { matchPickable, namesLine, withoutPerson, withPerson } from '@/lib/people-picker';
import {
  concernAboutLine,
  concernAboutNames,
  contactNames,
  guardiansByChild,
} from '@/lib/concerns';
import type { SafeguardingContacts } from '@/lib/types';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/club', () => ({ useClub: jest.fn(), useFeature: jest.fn() }));

const people = [
  { id: 'a', name: 'Avery Admin', email: 'avery@club.test' },
  { id: 'b', name: 'Sam Alder', email: 'sam@club.test' },
  { id: 'c', name: 'Casey O’Brien', email: null },
];

describe('matchPickable', () => {
  it('matches the start of any part of a name from one letter', () => {
    expect(matchPickable(people, 'a', 5).map((p) => p.id)).toEqual(['a', 'b']);
    expect(matchPickable(people, 'b', 5).map((p) => p.id)).toEqual(['c']);
  });

  it('matches inside a name or an email from two letters, ignoring case', () => {
    expect(matchPickable(people, 'LDE', 5).map((p) => p.id)).toEqual(['b']);
    expect(matchPickable(people, 'avery@', 5).map((p) => p.id)).toEqual(['a']);
  });

  it('doesn’t match an email from one letter', () => {
    expect(matchPickable(people, '@', 5)).toEqual([]);
  });

  it('matches nobody when nothing is typed, and stops at the most asked for', () => {
    expect(matchPickable(people, '  ', 5)).toEqual([]);
    expect(matchPickable(people, 'a', 1).map((p) => p.id)).toEqual(['a']);
  });
});

describe('choosing people', () => {
  it('adds someone once, in the order chosen', () => {
    const one = withPerson([], people[1]);
    const two = withPerson(one, people[0]);
    expect(two.map((p) => p.id)).toEqual(['b', 'a']);
    expect(withPerson(two, people[1])).toBe(two);
  });

  it('takes someone off', () => {
    expect(withoutPerson(people, 'b').map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('writes names as a sentence', () => {
    expect(namesLine([])).toBe('');
    expect(namesLine(['A'])).toBe('A');
    expect(namesLine(['A', 'B'])).toBe('A and B');
    expect(namesLine(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('who a concern is about', () => {
  it('lists everyone named, in order', () => {
    const c = {
      about_members: [
        { id: 'p1', name: 'Sample Parent' },
        { id: null, name: 'A former coach' },
      ],
      about_member_name: 'Sample Parent',
      about_text: 'Their words',
    };
    expect(concernAboutNames(c)).toEqual(['Sample Parent', 'A former coach']);
    expect(concernAboutLine(c)).toBe('Sample Parent, A former coach');
  });

  it('falls back to the single member from an older server, then the raiser’s words', () => {
    expect(concernAboutNames({ about_member_name: 'Sample Parent' })).toEqual(['Sample Parent']);
    expect(concernAboutLine({ about_members: [], about_member_name: null, about_text: 'A visitor' })).toBe(
      'A visitor',
    );
    expect(concernAboutLine({ about_member_name: null, about_text: null })).toBeNull();
  });

  it('groups parents and guardians by child, keeping the order listed', () => {
    const groups = guardiansByChild([
      { guardian_id: 'g1', name: 'P', email: null, child_id: 'k1', child_name: 'Avery' },
      { guardian_id: 'g2', name: 'Q', email: null, child_id: 'k1', child_name: 'Avery' },
      { guardian_id: 'g1', name: 'P', email: null, child_id: 'k2', child_name: 'Bailey' },
    ]);
    expect(groups.map((g) => [g.childName, g.guardians.length])).toEqual([
      ['Avery', 2],
      ['Bailey', 1],
    ]);
    expect(guardiansByChild([{ guardian_id: 'g1', name: 'P', email: null }])[0].childName).toBeNull();
  });
});

describe('contactNames', () => {
  const base: SafeguardingContacts = {
    child_safety_officer_id: 'o1',
    child_safety_officer_name: 'First Officer',
    complaints_manager_id: null,
    complaints_manager_name: null,
    governing_body_name: null,
    governing_body_phone: null,
    governing_body_url: null,
    policy_url: null,
  };

  it('lists every contact who can act', () => {
    expect(
      contactNames(
        {
          ...base,
          child_safety_officers: [
            { id: 'o1', name: 'First Officer' },
            { id: 'o2', name: 'Second Officer' },
          ],
          complaints_managers: [],
        },
        'officers',
      ),
    ).toEqual(['First Officer', 'Second Officer']);
  });

  it('marks an admin acting in an empty post, and only when the server says so', () => {
    const acting = {
      ...base,
      child_safety_officers: [{ id: 'a1', name: 'Avery Admin', acting: true }],
      complaints_managers: [
        { id: 'm1', name: 'Morgan Manager', acting: false },
        { id: 'm2', name: 'Sam Second' },
      ],
    };
    expect(contactNames(acting, 'officers')).toEqual(['Avery Admin (acting)']);
    expect(contactNames(acting, 'managers')).toEqual(['Morgan Manager', 'Sam Second']);
  });

  it('uses the single name from an older server, and nobody when there are none', () => {
    expect(contactNames(base, 'officers')).toEqual(['First Officer']);
    expect(contactNames(base, 'managers')).toEqual([]);
    expect(contactNames(null, 'officers')).toEqual([]);
  });
});
