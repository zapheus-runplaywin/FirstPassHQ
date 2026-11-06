import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * Affiliation records for a club that reports to its member association. The
 * criteria follow section 4 of Netball WA's Membership Policy (NWA-POL-07),
 * for affiliated clubs. Association records (section 3) were taken out on
 * 6 November 2026, to be designed properly later.
 */

/** The club's affiliation record, from `admin_affiliation`. */
export type Affiliation = {
  incorporation_number: string | null;
  affiliated_with: string | null;
  registered_on: string | null;
  primary_contact_1_id: string | null;
  primary_contact_1_name: string | null;
  primary_contact_2_id: string | null;
  primary_contact_2_name: string | null;
  /** Criteria the admin ticks by hand, by key. */
  checks: Record<string, boolean>;
  notes: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
  /** The newest season with squads or teams, which registrations are checked for. */
  season: number | null;
  team_count: number;
  /** Athletes, coaches and managers in the season's squads and teams. */
  registrations_total: number;
  registered: number;
  not_registered: number;
};

/** Where affiliation returns go and when the last one went, from `admin_affiliation_return`. */
export type ReturnInfo = {
  return_email: string | null;
  last_sent_at: string | null;
  last_sent_to: string | null;
  last_sent_by_name: string | null;
};

/** A return is due once a year, after the club has said where returns go. */
export function returnDue(info: ReturnInfo | null, today = new Date()) {
  if (!info?.return_email) return false;
  return !isThisYear(info.last_sent_at ? toDateString(new Date(info.last_sent_at)) : null, today);
}

/** A member's PlayHQ registration for a season, from `admin_playhq_registrations`. */
export type Registration = {
  profile_id: string;
  name: string;
  playhq_email: string | null;
  email: string | null;
  team_roles: string[];
  groups: string[];
  /** Null until an admin checks. */
  registered: boolean | null;
  checked_at: string | null;
  checked_by_name: string | null;
};

/** Registrations are yearly. */
const RENEWAL_DAYS = 365;

export type Need = 'required' | 'recommended';

export type Criterion = {
  key: string;
  label: string;
  detail: string;
  need: Need;
  /** Ticked by an admin, rather than worked out from what's recorded. */
  manual: boolean;
  met: boolean;
};

/** Whether a date is within the last year. */
export function isThisYear(day: string | null, today = new Date()) {
  if (!day) return false;
  const since = new Date(today);
  since.setDate(since.getDate() - RENEWAL_DAYS);
  return day >= toDateString(since);
}

/** Every criterion that applies to the club, with whether it's met. */
export function affiliationCriteria(
  affiliation: Pick<
    Affiliation,
    | 'incorporation_number'
    | 'affiliated_with'
    | 'registered_on'
    | 'primary_contact_1_id'
    | 'primary_contact_2_id'
    | 'checks'
    | 'team_count'
  >,
  today = new Date(),
): Criterion[] {
  const ticked = (key: string) => affiliation.checks?.[key] === true;
  const manual = (key: string, label: string, detail: string, need: Need = 'required'): Criterion => ({
    key,
    label,
    detail,
    need,
    manual: true,
    met: ticked(key),
  });
  const incorporated = !!affiliation.incorporation_number?.trim();
  const renewed = isThisYear(affiliation.registered_on, today);

  const teams = affiliation.team_count;
  return [
    {
      key: 'incorporated',
      label: 'Incorporated',
      detail:
        teams >= 5
          ? `Required for clubs with 5 or more teams. You have ${teams} this season.`
          : `Highly recommended. Required once the club has 5 or more teams (you have ${teams}).`,
      need: teams >= 5 ? 'required' : 'recommended',
      manual: false,
      met: incorporated,
    },
    {
      key: 'registered',
      label: 'Registered with your member association this year',
      detail: 'Name the association and the day the club last registered with it',
      need: 'required',
      manual: false,
      met: !!affiliation.affiliated_with?.trim() && renewed,
    },
    manual(
      'compliance',
      'Follows Netball Australia and Netball WA policies',
      'All policies, statements and guidelines',
    ),
    {
      key: 'contacts',
      label: 'Two primary contacts',
      detail: 'Given to the association and Netball WA',
      need: 'required',
      manual: false,
      met: !!affiliation.primary_contact_1_id && !!affiliation.primary_contact_2_id,
    },
    manual(
      'competition',
      'Plays in the member association’s competition',
      'At least one team in the association’s competition',
    ),
    manual(
      'playhq',
      'Members register online through PlayHQ',
      'Every player, coach and official registers through PlayHQ',
    ),
  ];
}

/** Members in the season's squads and teams nobody has checked in PlayHQ yet. */
export function registrationsToCheck(affiliation: Affiliation) {
  return Math.max(
    0,
    affiliation.registrations_total - affiliation.registered - affiliation.not_registered,
  );
}

/** Affiliation follow-ups for the admin's to-do list. */
export type AffiliationTodos = {
  /** Required criteria not met yet. */
  missing: number;
  toCheck: number;
  notRegistered: number;
  season: number | null;
  /** No return sent to the governing body in the last year. */
  returnDue: boolean;
};

/** Affiliation follow-ups for admins, when the club keeps affiliation records. */
export function useAffiliationTodos() {
  const { isAdmin } = useAuth();
  const { affiliation: on } = useClub();
  const [todos, setTodos] = useState<AffiliationTodos | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin || !on) return;
    const [settingsResult, returnResult] = await Promise.all([
      supabase.rpc('admin_affiliation').maybeSingle(),
      supabase.rpc('admin_affiliation_return').maybeSingle(),
    ]);
    const affiliation = settingsResult.data as Affiliation | null;
    if (!affiliation) return;
    setTodos({
      missing: affiliationCriteria(affiliation).filter(
        (c) => c.need === 'required' && !c.met,
      ).length,
      toCheck: registrationsToCheck(affiliation),
      notRegistered: affiliation.not_registered,
      season: affiliation.season,
      returnDue: returnDue(returnResult.data as ReturnInfo | null),
    });
  }, [isAdmin, on]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { affiliationTodos: isAdmin && on ? todos : null, reloadAffiliationTodos: load };
}
