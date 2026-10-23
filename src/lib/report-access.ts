import { useAuth } from '@/lib/auth';
import { hasRole } from '@/lib/roles';
import { canWorkWithChildren } from '@/lib/safety';

/**
 * Whether the member reads the governance reports: admins, and committee
 * members screened to work with children (a current check, a volunteer
 * exemption or an application in force), not stood down. Same rule as
 * `public.can_read_reports` in the database. The reports name children, so a
 * committee member exempted with a reason, or still in the committee checks
 * grace period without a check, reads none.
 */
export function useCanReadReports() {
  const { profile, isAdmin, exemption, wwccApplication } = useAuth();
  if (isAdmin) return true;
  // canWorkWithChildren also needs the member approved and not stood down.
  return (
    hasRole(profile, 'committee') &&
    canWorkWithChildren(profile, !!exemption?.valid || !!wwccApplication?.valid)
  );
}
