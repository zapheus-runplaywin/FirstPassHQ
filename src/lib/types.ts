// Mirrors supabase/migrations. Regenerate with `supabase gen types` once the schema grows.

export type AppRole =
  | 'admin'
  | 'coach'
  | 'manager'
  | 'athlete'
  | 'committee'
  | 'partner'
  | 'guardian'
  | 'guest';

export type MemberStatus = 'pending' | 'approved' | 'rejected';

export type TeamRole = 'coach' | 'manager' | 'athlete';

export type CoachTitle = 'head_coach' | 'assistant_coach';

export type Team = {
  id: string;
  name: string;
  sort_order: number;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  playhq_email: string | null;
  role: AppRole;
  status: MemberStatus;
};

export type TeamMembership = {
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  team: Team;
};
