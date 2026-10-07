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

/** Members join a squad first; teams are named from a squad at selections. */
export type GroupKind = 'squad' | 'team';

export type TeamSelection = 'touring' | 'training_partner';

/** A squad or a team. Both live in the `teams` table. */
export type Team = {
  id: string;
  name: string;
  sort_order: number;
  kind: GroupKind;
  season: number;
  squad_id: string | null;
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  playhq_email: string | null;
  role: AppRole;
  status: MemberStatus;
  requested_role: AppRole | null;
  requested_team_id: string | null;
  join_requested_at: string | null;
};

export type TeamMembership = {
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  selection: TeamSelection | null;
  team: Team;
};

export type RosterEntry = {
  profile_id: string;
  full_name: string | null;
  team_role: TeamRole;
  coach_title: CoachTitle | null;
  selection: TeamSelection | null;
};
