// Mirrors supabase/migrations. Regenerate with `supabase gen types` once the schema grows.

export type AppRole =
  | 'admin'
  | 'coach'
  | 'manager'
  | 'athlete'
  | 'committee'
  | 'physio'
  | 'guardian'
  | 'guest';

export type MemberStatus = 'pending' | 'approved' | 'rejected';

export type RejectionReason = 'playhq_email_mismatch' | 'not_registered' | 'other';

export type TeamRole = 'coach' | 'manager' | 'athlete' | 'guardian';

export type CoachTitle = 'head_coach' | 'assistant_coach';

/** Members join a squad first; teams are named from a squad at selections. */
export type GroupKind = 'squad' | 'team';

/** 'touring' is shown as "Final team" (Matt, 2026-10-08). */
export type TeamSelection = 'touring' | 'training_partner';

/** A squad or a team. Both live in the `teams` table. */
export type Team = {
  id: string;
  name: string;
  sort_order: number;
  kind: GroupKind;
  season: number;
  squad_id: string | null;
  /** Squads only: when admins marked the squad phase complete. */
  selections_completed_at: string | null;
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
  /**
   * The admin's choice that an athlete is under 18, used when no date of birth
   * is recorded. Athletes under 18 have parents or guardians linked to them.
   */
  under_17: boolean;
  /** Recorded by an admin. Decides whether an athlete is under 18. */
  date_of_birth: string | null;
  /** Working With Children Check, recorded by an admin for coaches and managers. */
  wwcc_number: string | null;
  wwcc_expires_on: string | null;
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
  /** Messages sent before the Partner role was removed can say 'partner'. */
  audience_role: AppRole | 'partner' | null;
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

/** Where an injury is in its return-to-play sign-off. */
export type InjuryStatus = 'injured' | 'clearance_requested' | 'coach_endorsed' | 'cleared';

export type InjuryUpdateKind =
  | 'reported'
  | 'physio_update'
  | 'clearance_requested'
  | 'coach_endorsed'
  | 'sent_back'
  | 'cleared';

/** An injury the member can see, from `visible_injuries`. */
export type Injury = {
  id: string;
  athlete_id: string;
  athlete_name: string | null;
  body_area: string;
  description: string;
  injured_on: string;
  restrictions: string | null;
  expected_return: string | null;
  status: InjuryStatus;
  coach_endorsed_by: string | null;
  cleared_at: string | null;
  created_at: string;
  last_update_at: string | null;
  /** The member is the athlete or their guardian, so can add updates. */
  can_report: boolean;
  /** The member needs to endorse or accept it. */
  waiting_for_me: boolean;
};

export type InjuryUpdate = {
  id: string;
  author_name: string | null;
  kind: InjuryUpdateKind;
  notes: string | null;
  restrictions: string | null;
  expected_return: string | null;
  document_path: string | null;
  document_name: string | null;
  created_at: string;
};

/** A row in the admin injury report. */
export type InjuryReportRow = {
  id: string;
  athlete_name: string | null;
  athlete_email: string | null;
  /** When the athlete's account was deleted; their record is kept for 12 months. */
  athlete_left_at: string | null;
  body_area: string;
  injured_on: string;
  reported_at: string;
  status: InjuryStatus;
  restrictions: string | null;
  expected_return: string | null;
  coach_endorsed_by_name: string | null;
  cleared_by_name: string | null;
  cleared_at: string | null;
  update_count: number;
  document_count: number;
};

/** A session's attendance record, from `attendance_sessions_list`. */
export type AttendanceSession = {
  id: string;
  /** A club event, with every athlete in the club on the register. */
  club_wide: boolean;
  team_id: string | null;
  team_name: string;
  name: string;
  held_at: string;
  taken_by_name: string | null;
  present_count: number;
  marked_count: number;
  /** The member coaches or manages the group, so can correct it. */
  can_edit: boolean;
};

/** One athlete on a register. `present` is null until they're marked. */
export type AttendanceMark = {
  profile_id: string;
  full_name: string | null;
  present: boolean | null;
};

export type AthleteAttendanceSummary = {
  profile_id: string;
  full_name: string | null;
  session_count: number;
  present_count: number;
  last_present_at: string | null;
};

export type AthleteAttendance = {
  session_id: string;
  team_name: string;
  name: string;
  held_at: string;
  present: boolean;
};

/** A daily check-in. Each score is 1 (bad) to 5 (good). */
export type CheckIn = {
  id: string;
  athlete_id: string;
  day: string;
  sleep: number;
  soreness: number;
  stress: number;
  mood: number;
  note: string | null;
  updated_at: string;
};

export type CheckInScores = Pick<CheckIn, 'sleep' | 'soreness' | 'stress' | 'mood'>;

/** One athlete on a coach's board. Scores are null until they check in. */
export type CheckInBoardRow = {
  athlete_id: string;
  full_name: string | null;
  sleep: number | null;
  soreness: number | null;
  stress: number | null;
  mood: number | null;
  note: string | null;
  checked_in_at: string | null;
};

/** A squad or team the member coaches, with today's check-in counts. */
export type CheckInSummary = {
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  athlete_count: number;
  checked_in_count: number;
  flagged_count: number;
};

/**
 * A squad (until its selections are complete) or team in the committee's
 * check-in overview. Scores and the flagged count are null until at least 3
 * athletes have checked in, so they can't point at one athlete.
 */
export type CheckInOverviewRow = {
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  season: number;
  athlete_count: number;
  checked_in_count: number;
  flagged_count: number | null;
  avg_sleep: number | null;
  avg_soreness: number | null;
  avg_stress: number | null;
  avg_mood: number | null;
};

/** One day of a group's check-in averages. Scores are null below 3 check-ins. */
export type CheckInTrendDay = {
  day: string;
  checked_in_count: number;
  flagged_count: number | null;
  avg_sleep: number | null;
  avg_soreness: number | null;
  avg_stress: number | null;
  avg_mood: number | null;
};

/** Who can be voted for in an award. */
export type AwardNominees = 'athletes' | 'coaches' | 'members' | 'listed';

/** Roles that can vote in an award; `member` is everyone. */
export type AwardVoterRole =
  | 'athlete'
  | 'coach'
  | 'manager'
  | 'guardian'
  | 'committee'
  | 'admin'
  | 'member';

export type Award = {
  id: string;
  season: number;
  name: string;
  description: string;
  closes_at: string;
  club_wide: boolean;
  per_group: boolean;
  voter_roles: AwardVoterRole[];
  nominees: AwardNominees;
  points: number[];
  by_match: boolean;
  match_vote_hours: number;
  preseason_weight: number;
  preseason_closes_at: string | null;
  annual: boolean;
  copied_from: string | null;
  award_groups: { team_id: string }[];
  award_candidates: { id: string; name: string }[];
};

/** A vote open to the member: an award, in one group, for one match or the preseason. */
export type AwardSlot = {
  award_id: string;
  award_name: string;
  description: string;
  points: number[];
  nominees: AwardNominees;
  team_id: string | null;
  team_name: string | null;
  fixture_id: string | null;
  fixture_label: string | null;
  preseason: boolean;
  closes_at: string;
  voted: boolean;
};

export type AwardNominee = { id: string; is_candidate: boolean; name: string };

export type AwardResult = {
  team_id: string | null;
  team_name: string | null;
  nominee_name: string;
  preseason_points: number;
  match_points: number;
  votes: number;
  score: number;
};

export type AwardTurnout = {
  team_id: string | null;
  team_name: string | null;
  fixture_id: string | null;
  fixture_label: string | null;
  starts_at: string | null;
  preseason: boolean;
  ballots: number;
  voters: number;
};

export type Fixture = {
  id: string;
  team_id: string | null;
  team_name: string;
  opponent: string | null;
  round_name: string | null;
  grade_name: string | null;
  starts_at: string;
  time_tbc: boolean;
  venue: string | null;
  court: string | null;
  is_home: boolean | null;
  status: string | null;
};

/** A PlayHQ competition season the club imports fixtures from. */
export type PlayhqSeason = {
  playhq_season_id: string;
  name: string;
  url: string;
  season: number;
  imported_at: string | null;
  playhq_teams: { playhq_team_id: string; playhq_name: string; team_id: string | null }[];
};

/** How a game goal went, in the athlete's own view. */
export type GoalOutcome = 'achieved' | 'partly' | 'not_yet';

/** A PlayHQ game an athlete can set goals for, with their goal counts. */
export type GoalGame = {
  fixture_id: string;
  team_name: string;
  round_name: string | null;
  opponent: string | null;
  starts_at: string;
  time_tbc: boolean;
  venue: string | null;
  court: string | null;
  is_home: boolean | null;
  /** Goals can be added and changed until then (the game's start). */
  goals_close_at: string;
  /** The game counts as played, and reflections open. */
  played_at: string;
  goal_count: number;
  reflected_count: number;
  comment_count: number;
};

export type GameGoal = {
  id: string;
  athlete_id: string;
  fixture_id: string;
  body: string;
  set_by: string | null;
  set_by_name: string;
  set_by_coach: boolean;
  outcome: GoalOutcome | null;
  reflection: string | null;
  reflected_at: string | null;
  created_at: string;
};

/** A coach's comment on a goal after the game. */
export type GameGoalComment = {
  id: string;
  goal_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
};

/** One athlete in a squad or team the member coaches, for the coach's goals list. */
export type GoalBoardRow = {
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  athlete_id: string;
  athlete_name: string;
  next_fixture_id: string | null;
  next_label: string | null;
  next_starts_at: string | null;
  next_goal_count: number;
  reflections_to_answer: number;
};
