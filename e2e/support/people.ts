// Sample people and groups for the browser smoke tests. Made up for the tests:
// never real club data. Ids follow the screenshot fixtures' uuid(n) style.

export const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

/**
 * "Now" in every smoke test: 7:30 am on Sunday 18 October 2026 in Perth, where
 * the tests run (playwright.config.ts), which is still Saturday the 17th in UTC.
 */
export const TODAY = new Date('2026-10-17T23:30:00Z');
/** Today in Perth. */
export const TODAY_ISO_DAY = '2026-10-18';

/** Every column the app reads from `profiles` (PROFILE_COLUMNS in src/lib/auth.tsx). */
const blank = {
  preferred_name: null,
  title: null,
  head_physio: false,
  playhq_email: null,
  extra_roles: [] as string[],
  requested_role: null as string | null,
  requested_team_id: null as string | null,
  join_requested_at: null as string | null,
  under_17: false,
  rejection_reason: null,
  verified_at: '2026-08-01T00:00:00Z' as string | null,
  date_of_birth: null as string | null,
  declared_date_of_birth: null,
  guardian_email: null,
  wwcc_number: null as string | null,
  wwcc_expires_on: null as string | null,
  wwcc_exempt_reason: null,
  wwcc_exempted_by: null,
  wwcc_exempted_at: null,
  wwcc_card_name: null,
  wwcc_validated_at: null as string | null,
  wwcc_validated_by: null,
  wwcc_validation_method: null,
  wwcc_unit_linked_at: null as string | null,
  stood_down_at: null as string | null,
  verification_method: null,
  verification_note: null,
  volunteer_task: null,
  volunteer_from: null,
  volunteer_until: null,
  volunteer_screening: null,
  declared_wwcc_number: null,
};

export type SampleProfile = typeof blank & {
  id: string;
  email: string;
  full_name: string;
  role: string;
  status: 'approved' | 'pending' | 'rejected';
};

function person(fields: Partial<SampleProfile> & Pick<SampleProfile, 'id' | 'email' | 'full_name' | 'role'>): SampleProfile {
  return { ...blank, status: 'approved', ...fields };
}

/** A fresh copy of every sample person, so one test's changes never reach another. */
export function samplePeople() {
  return {
    admin: person({
      id: uuid(1),
      email: 'matt@example.com',
      full_name: 'Matt Admin',
      role: 'admin',
      wwcc_number: 'WWC0100001',
      wwcc_expires_on: '2028-03-01',
      wwcc_validated_at: '2026-08-01T00:00:00Z',
      wwcc_unit_linked_at: '2026-08-01T00:00:00Z',
    }),
    coach: person({
      id: uuid(2),
      email: 'cam@example.com',
      full_name: 'Cam Roberts',
      role: 'coach',
      wwcc_number: 'WWC0277341',
      wwcc_expires_on: '2028-05-30',
      wwcc_validated_at: '2026-08-01T00:00:00Z',
      wwcc_unit_linked_at: '2026-08-01T00:00:00Z',
      date_of_birth: '1988-02-14',
    }),
    athlete: person({
      id: uuid(10),
      email: 'alex@example.com',
      full_name: 'Alex Nguyen',
      role: 'athlete',
      date_of_birth: '1999-06-01',
    }),
    /** 16 on TODAY. */
    minor: person({
      id: uuid(11),
      email: 'riley@example.com',
      full_name: 'Riley Evans',
      role: 'athlete',
      date_of_birth: '2010-05-01',
      under_17: true,
    }),
    guest: person({ id: uuid(12), email: 'gus@example.com', full_name: 'Gus Visitor', role: 'guest' }),
    /** Riley Evans's parent, linked to Riley as their guardian. */
    guardian: person({ id: uuid(13), email: 'dana@example.com', full_name: 'Dana Evans', role: 'guardian' }),
    /** Asked to join the Mixed Open Squad as an athlete; not approved yet. */
    pending: person({
      id: uuid(20),
      email: 'jordan@example.com',
      full_name: 'Jordan Park',
      role: 'guest',
      status: 'pending',
      verified_at: null,
      requested_role: 'athlete',
      requested_team_id: uuid(101),
      join_requested_at: '2026-10-15T08:00:00Z',
      date_of_birth: '2001-03-09',
    }),
  };
}

export const openSquad = {
  id: uuid(101),
  name: 'Mixed Open Squad',
  sort_order: 1,
  kind: 'squad',
  season: 2026,
  squad_id: null,
  archived: false,
  selections_completed_at: null,
};

export const u17Squad = { ...openSquad, id: uuid(104), name: '17 & Under Squad', sort_order: 4 };

/** The athletes on the Mixed Open Squad's register. */
export const openSquadAthletes = [
  { profile_id: uuid(500), full_name: 'Bo Tran' },
  { profile_id: uuid(501), full_name: 'Kai Thompson' },
  { profile_id: uuid(502), full_name: 'Lena Ortiz' },
];
