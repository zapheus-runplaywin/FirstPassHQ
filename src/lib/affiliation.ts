import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { useClub } from '@/lib/club';
import { toDateString } from '@/lib/injuries';
import { supabase } from '@/lib/supabase';

/**
 * Affiliation records for clubs and associations that report to their
 * governing body. The criteria follow Netball WA's Membership Policy
 * (NWA-POL-07): section 3 for associations and section 4 for affiliated clubs.
 */

export type MemberType = 'club' | 'association';
export type Tier = 1 | 2 | 3 | 4;
export type Office = 'president' | 'ado' | 'audo' | 'committee' | 'representative';

/** The club's affiliation record, from `admin_affiliation`. */
export type Affiliation = {
  member_type: MemberType;
  tier: Tier | null;
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

/** Someone named to an office, from `admin_affiliation_officers`. */
export type Officer = {
  office: Office;
  profile_id: string;
  name: string;
  inducted_on: string | null;
};

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

export const memberTypeLabels: Record<MemberType, string> = {
  club: 'Affiliated club',
  association: 'Association',
};

export const officeLabels: Record<Office, string> = {
  president: 'President',
  ado: 'Association Development Officer',
  audo: 'Association Umpire Development Officer',
  committee: 'Another committee member',
  representative: 'Representative',
};

export const tierLabels: Record<Tier, string> = {
  1: 'Tier 1 (450+ members)',
  2: 'Tier 2 (250 to 449)',
  3: 'Tier 3 (1 to 249)',
  4: 'Tier 4 Member Entity',
};

/** Who must complete the safeguarding induction for each tier. */
const INDUCTED: Record<Tier, Office[]> = {
  1: ['president', 'ado', 'audo', 'committee'],
  2: ['president', 'ado', 'audo'],
  3: ['president', 'committee'],
  4: ['representative'],
};

/** Registrations and agreements are yearly. */
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

/** The offices an association of this tier names in the app. */
export function officesFor(tier: Tier | null): Office[] {
  if (!tier) return [];
  if (tier === 4) return ['representative'];
  const offices = new Set<Office>([...INDUCTED[tier], 'ado', 'audo']);
  return (['president', 'ado', 'audo', 'committee'] as Office[]).filter((o) => offices.has(o));
}

/** Whether a date is within the last year. */
export function isThisYear(day: string | null, today = new Date()) {
  if (!day) return false;
  const since = new Date(today);
  since.setDate(since.getDate() - RENEWAL_DAYS);
  return day >= toDateString(since);
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Every criterion that applies to the club, with whether it's met. Criteria
 * that don't apply to the tier are left out.
 */
export function affiliationCriteria(
  affiliation: Pick<
    Affiliation,
    | 'member_type'
    | 'tier'
    | 'incorporation_number'
    | 'affiliated_with'
    | 'registered_on'
    | 'primary_contact_1_id'
    | 'primary_contact_2_id'
    | 'checks'
    | 'team_count'
  >,
  officers: Officer[],
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

  if (affiliation.member_type === 'club') {
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

  const tier = affiliation.tier;
  if (!tier) return [];
  const upTo3 = tier <= 3;
  const inducted = INDUCTED[tier];
  const officerOf = (office: Office) => officers.find((o) => o.office === office);
  const list: (Criterion | null)[] = [
    {
      key: 'incorporated',
      label: 'Incorporated',
      detail:
        tier === 4
          ? 'Under the Associations Incorporation Act 2015 (WA), unless an Independent NetSetGo Centre'
          : 'Under the Associations Incorporation Act 2015 (WA)',
      need: 'required',
      manual: false,
      met: incorporated,
    },
    manual('board', 'Managed by a board or committee', tier === 4 ? 'Unless an Independent NetSetGo Centre' : ''),
    {
      key: 'agreement',
      label: 'Signed this year’s Annual Affiliation Membership Agreement',
      detail: 'Record the day it was signed',
      need: 'required',
      manual: false,
      met: renewed,
    },
    manual('compliance', 'Follows Netball Australia and Netball WA policies', 'All relevant policies'),
    {
      key: 'induction',
      label: 'Safeguarding induction completed',
      detail: `Sport Integrity Australia’s Safeguarding Children and Young People in Sport Induction: ${joinNames(
        inducted.map((o) => officeLabels[o]),
      )}. Keep the certificates as evidence.`,
      need: 'required',
      manual: false,
      met: inducted.every((o) => !!officerOf(o)?.inducted_on),
    },
    manual(
      'raffle',
      'Takes part in the Netball WA Community Raffle',
      'Promotes the raffle to its clubs and teams',
      tier <= 2 ? 'required' : 'recommended',
    ),
    upTo3
      ? manual(
          'competitions',
          'Runs the minimum competitions for its tier',
          tier === 1
            ? 'A senior, a junior and a NetSetGo competition, plus one other competition or program'
            : tier === 2
              ? 'A senior, a junior and a NetSetGo competition'
              : 'Two of: a senior, a junior or a NetSetGo competition, or a program',
        )
      : null,
    manual(
      'rules',
      'Follows Netball Australia and Netball WA competition frameworks and rules',
      '',
    ),
    upTo3 ? manual('sinkingFund', 'Has a sinking fund for facilities', 'With evidence') : null,
    upTo3
      ? manual(
          'clubs',
          `At least ${tier === 1 ? 5 : tier === 2 ? 4 : 3} affiliated clubs or entity teams`,
          'Competing in Netball WA sanctioned competitions',
        )
      : null,
    manual(
      'playhq',
      'Uses PlayHQ',
      upTo3
        ? 'For individual online registration, competition management and competitions'
        : 'For individual online registration and competition management',
    ),
    upTo3
      ? manual(
          'clubsAffiliated',
          'Every club in its competitions is affiliated',
          'With the association and with Netball WA',
        )
      : null,
    upTo3
      ? {
          key: 'developmentOfficers',
          label: 'Development officers named',
          detail:
            tier === 1
              ? 'An Association Development Officer (Intermediate accreditation at least) and an Association Umpire Development Officer (C Badge at least, B Badge preferred)'
              : tier === 2
                ? 'An Association Development Officer (Development accreditation at least) and an Association Umpire Development Officer (C Badge at least)'
                : 'An Association Development Officer and an Association Umpire Development Officer. No accreditation needed.',
          need: tier <= 2 ? 'required' : 'recommended',
          manual: false,
          met: !!officerOf('ado') && !!officerOf('audo'),
        }
      : null,
    upTo3
      ? manual(
          'pathway',
          'Pathway development for players, coaches and umpires',
          '',
          tier <= 2 ? 'required' : 'recommended',
        )
      : null,
  ];
  return list.filter((c): c is Criterion => !!c);
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
    const [settingsResult, officersResult, returnResult] = await Promise.all([
      supabase.rpc('admin_affiliation').maybeSingle(),
      supabase.rpc('admin_affiliation_officers'),
      supabase.rpc('admin_affiliation_return').maybeSingle(),
    ]);
    const affiliation = settingsResult.data as Affiliation | null;
    if (!affiliation) return;
    const officers = (officersResult.data as Officer[] | null) ?? [];
    setTodos({
      missing: affiliationCriteria(affiliation, officers).filter(
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
