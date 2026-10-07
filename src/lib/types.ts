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

export type RejectionReason = 'playhq_email_mismatch' | 'not_registered' | 'other';

export type TeamRole = 'coach' | 'manager' | 'athlete' | 'guardian';

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
  /** Athletes under 17 have parents or guardians linked to them. */
  under_17: boolean;
  /** Why an admin didn't approve them, shown to the member. */
  rejection_reason: RejectionReason | null;
  /** When an admin confirmed who they are with their in-app code. */
  verified_at: string | null;
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

/** Who a group message went to: everyone, one role, or a squad or team. */
export type MessageAudience = 'club' | 'role' | 'group';

export type Message = {
  id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  audience: MessageAudience;
  audience_role: AppRole | null;
  audience_label: string | null;
  created_at: string;
};

/** A message in the member's inbox. */
export type InboxMessage = {
  read_at: string | null;
  message: Message;
};

/** A message the member sent, with how many people have read it. */
export type SentMessage = Pick<
  Message,
  'id' | 'body' | 'audience' | 'audience_role' | 'audience_label' | 'created_at'
> & {
  recipient_count: number;
  read_count: number;
};

export type MessageReceipt = {
  profile_id: string;
  full_name: string | null;
  read_at: string | null;
};
