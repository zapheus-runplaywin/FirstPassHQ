/**
 * Sample members and groups for the report tests (src/lib/reports.ts and the
 * screens under src/app/admin/reports). Sample people only, never club data.
 *
 * Jest treats every file under __tests__ as a suite, so this file checks its
 * own fixtures at the bottom, and only when Jest runs it directly.
 */
import type { Profile, Team } from '@/lib/types';

/** Every report test runs on Sunday 18 October 2026 (CI runs in UTC). */
export const REPORT_DAY = new Date('2026-10-18T02:00:00Z');

/** Midday UTC on a day, so its local day is the same in every Australian time zone. */
export const noon = (day: string) => `${day}T03:00:00Z`;

/** An approved adult with a current, validated check registered with the club. */
export function person(id: string, extra: Partial<Profile> = {}): Profile {
  return {
    id,
    email: `${id}@example.test`,
    full_name: `Sample ${id}`,
    preferred_name: null,
    title: null,
    head_physio: false,
    playhq_email: null,
    role: 'coach',
    extra_roles: [],
    status: 'approved',
    requested_role: null,
    requested_team_id: null,
    join_requested_at: '2026-01-10T00:00:00Z',
    under_17: false,
    rejection_reason: null,
    verified_at: '2026-01-11T00:00:00Z',
    date_of_birth: '1990-05-05',
    declared_date_of_birth: null,
    guardian_email: null,
    wwcc_number: '1234567A',
    wwcc_expires_on: '2029-06-30',
    wwcc_exempt_reason: null,
    wwcc_exempted_by: null,
    wwcc_exempted_at: null,
    wwcc_card_name: null,
    wwcc_validated_at: noon('2026-03-01'),
    wwcc_validated_by: 'admin',
    wwcc_validation_method: 'online',
    wwcc_unit_linked_at: noon('2026-03-02'),
    stood_down_at: null,
    ...extra,
  };
}

/** No check at all, as an athlete or guardian has. */
export const NO_CHECK: Partial<Profile> = {
  wwcc_number: null,
  wwcc_expires_on: null,
  wwcc_validated_at: null,
  wwcc_validated_by: null,
  wwcc_validation_method: null,
  wwcc_unit_linked_at: null,
};

export function team(id: string, name: string, extra: Partial<Team> = {}): Team {
  return {
    id,
    name,
    sort_order: 1,
    kind: 'team',
    season: 2026,
    squad_id: null,
    selections_completed_at: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The fixtures' own checks, run only when Jest runs this file.

if (expect.getState().testPath?.endsWith('/__tests__/helpers/report-fixtures.ts')) {
  describe('report fixtures', () => {
    it('make an approved coach with a current check by default', () => {
      const p = person('x');
      expect(p).toMatchObject({ role: 'coach', status: 'approved', wwcc_number: '1234567A' });
      expect(person('x', { role: 'athlete', ...NO_CHECK }).wwcc_number).toBeNull();
    });

    it('put noon on the same local day', () => {
      expect(new Date(noon('2026-10-07')).getUTCDate()).toBe(7);
      expect(team('t', 'Open A')).toMatchObject({ id: 't', name: 'Open A', season: 2026 });
    });
  });
}
