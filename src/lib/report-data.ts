import { fetchAll, type Acknowledgement, type CourseProgress, type Placement } from '@/lib/reports';
import { supabase } from '@/lib/supabase';
import { namesLine } from '@/lib/people-picker';
import {
  REQUIREMENT_COLUMNS,
  type TrainingMember,
  type TrainingRequirement,
} from '@/lib/training';
import type {
  Profile,
  ScreeningNotice,
  StandDown,
  VolunteerExemption,
  WwccApplication,
} from '@/lib/types';

/** Everything the Working With Children Checks report is built from. */
export type WwccData = {
  members: Profile[];
  placements: Placement[];
  standDowns: StandDown[];
  exemptions: VolunteerExemption[];
  notices: ScreeningNotice[];
  officerName: string | null;
  acknowledgements: Acknowledgement[];
  /** Lodged check applications, open or ended in the last year. */
  applications: WwccApplication[];
};

export async function loadWwccData(): Promise<WwccData> {
  const [
    members,
    placements,
    standDowns,
    exemptions,
    notices,
    officer,
    acknowledgements,
    applications,
  ] = await Promise.all([
    // Approved members without contact details, for admins and checked
    // committee members alike (public.report_members).
    fetchAll<Profile>((from, to) => supabase.rpc('report_members').range(from, to)),
    fetchAll<Placement>((from, to) =>
      supabase
        .from('team_members')
        .select('team_id, profile_id, team_role')
        .in('team_role', ['coach', 'manager', 'physio'])
        .range(from, to),
    ),
    fetchAll<StandDown>((from, to) =>
      supabase
        .from('stand_downs')
        .select('*')
        .order('started_at', { ascending: false })
        .range(from, to),
    ),
    fetchAll<VolunteerExemption>((from, to) =>
      supabase.rpc('admin_volunteer_exemptions').range(from, to),
    ),
    fetchAll<ScreeningNotice>((from, to) =>
      supabase
        .from('screening_notices')
        .select('*')
        .order('received_on', { ascending: false })
        .range(from, to),
    ),
    supabase.rpc('admin_wwc_officers'),
    fetchAll<Acknowledgement>((from, to) =>
      supabase
        .from('policy_acknowledgements')
        .select('profile_id, policy_version, acknowledged_at')
        .order('acknowledged_at', { ascending: false })
        .range(from, to),
    ),
    fetchAll<WwccApplication>((from, to) =>
      supabase.rpc('admin_wwcc_applications').range(from, to),
    ),
  ]);
  // Every WWC Registration Officer, by name (a club can name up to 5).
  const officerNames = ((officer.data as { officer_name: string }[] | null) ?? []).map(
    (o) => o.officer_name,
  );
  const officerName = officerNames.length > 0 ? namesLine(officerNames) : null;
  return {
    members,
    placements,
    standDowns,
    exemptions,
    notices,
    officerName,
    acknowledgements,
    applications,
  };
}

/**
 * The Integrity training courses for a season and who has finished each, plus
 * every season that has courses.
 */
export async function loadCourses(season: number) {
  const { data, error } = await supabase
    .from('training_requirements')
    .select(REQUIREMENT_COLUMNS)
    .eq('archived', false)
    .order('due_on')
    .order('name');
  if (error) throw new Error(error.message);
  const requirements = (data as TrainingRequirement[] | null) ?? [];
  const shown = requirements.filter((r) => r.season === season);
  const members = await Promise.all(
    shown.map((r) => supabase.rpc('training_requirement_members', { p_requirement_id: r.id })),
  );
  const failed = members.find((m) => m.error);
  const courses: CourseProgress[] = shown.map((r, i) => ({
    name: r.name,
    due_on: r.due_on,
    members: (members[i].data as TrainingMember[] | null) ?? [],
  }));
  return {
    seasons: [...new Set(requirements.map((r) => r.season))],
    courses,
    error: failed?.error?.message ?? null,
  };
}
