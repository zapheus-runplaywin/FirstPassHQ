// Mirrors supabase/migrations. Regenerate with `supabase gen types` once the schema grows.

export type AppRole =
  | 'admin'
  | 'coach'
  | 'manager'
  | 'athlete'
  | 'committee'
  | 'physio'
  | 'guardian'
  | 'guest'
  | 'volunteer'
  | 'statistician'
  | 'studio';

export type MemberStatus = 'pending' | 'approved' | 'rejected';

export type RejectionReason = 'playhq_email_mismatch' | 'not_registered' | 'other';

export type TeamRole = 'coach' | 'manager' | 'physio' | 'athlete' | 'guardian';

export type CoachTitle = 'head_coach' | 'assistant_coach';

/** Members join a squad first; teams are named from a squad at selections. */
export type GroupKind = 'squad' | 'team';

/** 'touring' is shown as "Final team" (Matt, 2026-10-08). */
export type TeamSelection = 'touring' | 'training_partner';

/** A squad or team's captain, or one of its vice captains. */
export type CaptainRole = 'captain' | 'vice_captain';

export type GroupCaptain = {
  team_id: string;
  profile_id: string;
  captain_role: CaptainRole;
};

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
  /** What they like to be called, set by the member. */
  preferred_name: string | null;
  /** Committee members and admins only, e.g. President or Secretary. */
  title: string | null;
  /** Physios only: a Head Physio looks after every athlete, in a team or not. */
  head_physio: boolean;
  playhq_email: string | null;
  role: AppRole;
  /** Roles held as well as the main one, such as a coach who is also a guardian. */
  extra_roles: AppRole[];
  status: MemberStatus;
  requested_role: AppRole | null;
  requested_team_id: string | null;
  join_requested_at: string | null;
  /**
   * Whether an athlete is under 18. Set from their date of birth when an admin
   * saves them; for athletes approved before a date of birth was needed, it is
   * the admin's old choice. Athletes under 18 have parents or guardians linked.
   */
  under_17: boolean;
  /** An athlete who never signs in, run by their parent or guardian (added by an admin). */
  no_sign_in?: boolean;
  /** Checked and recorded by an admin. Decides whether an athlete is under 18. */
  date_of_birth: string | null;
  /** What the member said when asking to join. Not checked, so it decides nothing. */
  declared_date_of_birth: string | null;
  /** A parent's or guardian's email, given by an athlete under 18 when asking to join. */
  guardian_email: string | null;
  /** Working With Children Check, recorded by an admin for coaches, managers, physios, committee members and admins. */
  wwcc_number: string | null;
  wwcc_expires_on: string | null;
  /** Why another admin excused a committee member or admin from the check, who did and when. */
  wwcc_exempt_reason: string | null;
  wwcc_exempted_by: string | null;
  wwcc_exempted_at: string | null;
  /** The name as printed on their card, recorded when an admin validates it. */
  wwcc_card_name?: string | null;
  /** When and by whom the card was last validated, and how. */
  wwcc_validated_at?: string | null;
  wwcc_validated_by?: string | null;
  wwcc_validation_method?: WwccValidationMethod | null;
  /** When an admin recorded the card as registered with the club. */
  wwcc_unit_linked_at?: string | null;
  /** Why an admin didn't approve them, shown to the member. */
  rejection_reason: RejectionReason | null;
  /** When an admin confirmed who they are: with their in-app code, against PlayHQ or by sighting ID. */
  verified_at: string | null;
  /** How they were verified, and what the admin checked. Not recorded before October 2026. */
  verification_method?: VerificationMethod | null;
  verification_note?: string | null;
  /** A temporary helper's task and dates. */
  volunteer_task?: string | null;
  volunteer_from?: string | null;
  volunteer_until?: string | null;
  volunteer_screening?: VolunteerScreening | null;
  /** The card number a volunteer gave at Join, before an admin records it. */
  declared_wwcc_number?: string | null;
  /** Set while an admin has stood them down from child-related roles. */
  stood_down_at: string | null;
};

export type StandDownReason =
  | 'interim_negative_notice'
  | 'negative_notice'
  | 'interstate_decision'
  | 'allegation'
  | 'other';

/** How an admin checked a Working With Children Check card. */
export type WwccValidationMethod = 'online' | 'card_sighted' | 'unit_letter';

/** A notice from the Working with Children Screening Unit about a member. */
export type ScreeningNoticeKind =
  | 'interim_negative_notice'
  | 'negative_notice'
  | 'interstate_decision'
  | 'card_cancelled'
  | 'other';

export type VerificationMethod = 'code' | 'playhq' | 'id_sighted';

/** A guardian linked to or unlinked from an athlete, kept for the record. Admins only. */
export type GuardianshipChange = {
  id: string;
  guardian_id: string;
  guardian_name: string | null;
  athlete_id: string;
  athlete_name: string | null;
  change: 'linked' | 'unlinked';
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: string;
};

export type ScreeningNotice = {
  id: string;
  profile_id: string | null;
  member_name: string;
  kind: ScreeningNoticeKind;
  received_on: string;
  action: string;
  governing_body_told_on: string | null;
  governing_body_told_by_name: string | null;
  recorded_at: string;
  recorded_by_name: string | null;
};

export type StandDown = {
  id: string;
  profile_id: string | null;
  member_name: string;
  reason: StandDownReason;
  note: string | null;
  started_at: string;
  started_by_name: string | null;
  lifted_at: string | null;
  lifted_by_name: string | null;
  lift_note: string | null;
};

/** Why a volunteer doesn't need a Working With Children Check (WA rules). */
export type VolunteerExemptionBasis =
  | 'parent_volunteer'
  | 'under_18_volunteer'
  | 'short_term_visitor'
  | 'national_event';

/** How a temporary helper said they're screened when they asked to join. */
export type VolunteerScreening =
  | 'card'
  | 'visitor'
  | 'national_event'
  | 'parent'
  | 'under_18'
  | 'none';

/** The signed-in member's own exemption, from `my_volunteer_exemption`. */
export type MyVolunteerExemption = {
  basis: VolunteerExemptionBasis;
  child_name: string | null;
  /** When they accepted the declaration; null while it's waiting for them. */
  declared_at: string | null;
  /** The words they accepted, or will accept. */
  declaration_text: string;
  /** Accepted, and the child or volunteer is still under 18 and linked. */
  valid: boolean;
  /** The day it ends by itself, when known. */
  ends_on: string | null;
  /** First day a visitor or national event exemption covers. */
  starts_on: string | null;
  event_name: string | null;
  organiser: string | null;
};

/** Any member's exemption, open or ended, from `admin_volunteer_exemptions`. */
export type VolunteerExemption = {
  id: string;
  profile_id: string;
  basis: VolunteerExemptionBasis;
  child_id: string | null;
  child_name: string | null;
  set_by_name: string | null;
  set_at: string;
  declared_at: string | null;
  declaration_text: string | null;
  ended_at: string | null;
  ended_by_name: string | null;
  end_note: string | null;
  valid: boolean;
  ends_on: string | null;
  /** First day a visitor or national event exemption covers. */
  starts_on: string | null;
  event_name: string | null;
  organiser: string | null;
};

/**
 * Where a lodged Working With Children Check application is up to:
 * waiting for the member's declaration, in force (it counts as screening),
 * lapsed (no admin confirmed it for 90 days), stopped (a barring Screening
 * Unit notice since it was lodged) or ended.
 */
export type WwccApplicationStatus =
  | 'waiting_for_declaration'
  | 'in_force'
  | 'lapsed'
  | 'stopped'
  | 'ended';

export type WwccApplicationKind = 'new' | 'renewal';

export type WwccApplicationEndReason = 'card_recorded' | 'withdrawn' | 'refused' | 'replaced' | 'other';

/** The member's own open application, from `my_wwcc_application`. */
export type MyWwccApplication = {
  id: string;
  application_number: string;
  lodged_on: string;
  kind: WwccApplicationKind;
  /** The words they accepted, or will accept. */
  declaration_text: string;
  declared_at: string | null;
  /** The day it lapses unless an admin confirms it's still being assessed. */
  lapses_on: string;
  status: WwccApplicationStatus;
  /** It counts as screening today. */
  valid: boolean;
};

/** Where a card a member sent in is: waiting for an admin, or sent back with a note. */
export type WwccSubmissionStatus = 'waiting' | 'returned';

/** The member's own card sent in for an admin to check, from `my_wwcc_submission`. */
export type MyWwccSubmission = {
  id: string;
  card_number: string;
  expires_on: string;
  card_name: string;
  submitted_at: string;
  status: WwccSubmissionStatus;
  decided_at: string | null;
  /** Why an admin sent it back. */
  return_note: string | null;
};

/** A card a member sent in that is waiting for an admin, from `admin_wwcc_submissions`. */
export type WwccSubmission = {
  id: string;
  profile_id: string;
  member_name: string;
  card_number: string;
  expires_on: string;
  card_name: string;
  submitted_at: string;
};

/** Any member's application, open or ended in the last year, from `admin_wwcc_applications`. */
export type WwccApplication = {
  id: string;
  profile_id: string;
  member_name: string;
  application_number: string;
  lodged_on: string;
  kind: WwccApplicationKind;
  receipt_path: string;
  receipt_name: string | null;
  recorded_at: string;
  recorded_by_name: string | null;
  declared_at: string | null;
  checked_at: string | null;
  checked_by_name: string | null;
  /** When an admin should next confirm it's still being assessed. */
  check_due_on: string;
  lapses_on: string;
  status: WwccApplicationStatus;
  ended_at: string | null;
  ended_reason: WwccApplicationEndReason | null;
  ended_by_name: string | null;
  end_note: string | null;
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
/** 'notice' is the club telling a family about a change, such as a guardian linked. */
/** 'chat' is a post in a chat group; audience_label names the group. */
export type MessageAudience = 'club' | 'role' | 'group' | 'notice' | 'chat';

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
  /** The answers to the question it asks, or null when it asks none. */
  answer_options?: string[] | null;
  /** A chat group post one of the group's coaches removed. Its text isn't shown. */
  removed_at?: string | null;
  removed_by_name?: string | null;
};

/** A message in the member's inbox. */
export type InboxMessage = {
  /** When the member first opened it: the sender's read receipt. */
  read_at: string | null;
  /**
   * Whether it shows as unread in the member's own inbox. Follows `read_at`
   * unless the member used "Mark all read" or "Mark as unread".
   */
  unread?: boolean;
  /** The member's own answer to its question, if it asks one. */
  answer?: number | null;
  /** When the member archived their copy. Null while it's in their inbox. */
  archived_at?: string | null;
  /** For a guardian's copy: the children it was sent for. Null when it's the member's own. */
  for_children: string[] | null;
  for_child_names: string[] | null;
  /** Set on a member's own copy of a chat group post, which lives in Groups. */
  chat_group_id?: string | null;
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
  /** A suspected concussion, with its own clearance rules. */
  concussion?: boolean;
  /** For a concussion, the first day clearance can be asked for. */
  earliest_clearance?: string | null;
  /** Only a physio can endorse its clearance (a concussion, or the club's rule). */
  needs_physio?: boolean;
  /** The member can add physio updates: the athlete, a guardian or their physio. */
  can_update?: boolean;
  /** Who logged it for the athlete, when it wasn't the athlete or a guardian. */
  logged_by_role?: InjuryLoggerRole | null;
};

/** The roles that can log an injury for an athlete. */
export type InjuryLoggerRole = 'coach' | 'manager' | 'physio';

export type InjuryUpdate = {
  id: string;
  author_name: string | null;
  kind: InjuryUpdateKind;
  notes: string | null;
  restrictions: string | null;
  expected_return: string | null;
  document_path: string | null;
  document_name: string | null;
  /** When the file was removed after the club's keep period; the record stays. */
  document_removed_at: string | null;
  created_at: string;
  /** Written by a coach, manager or physio rather than the athlete or a guardian. */
  author_role?: InjuryLoggerRole | null;
  /** This update marked (true) or ruled out (false) a suspected concussion. */
  concussion?: boolean | null;
  /** The proof sent with a clearance request was confirmed as a doctor's. */
  doctor_clearance?: boolean;
};

/**
 * A view, share or photo declaration on an injury document, for the athlete,
 * guardians and admins.
 */
export type InjuryDocumentEvent = {
  document_path: string;
  viewer_name: string | null;
  viewer_role: string | null;
  kind: 'viewed' | 'shared' | 'consented' | 'letter_declared';
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
  /** The squad a team was named from, so its athletes aren't counted twice. */
  squad_id: string | null;
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
  /** Check-ins on the day itself. */
  checked_in_count: number;
  /** Check-ins over the day and the two before it, which the averages cover. */
  window_count: number;
  /** Null, like the averages, when fewer than 3 athletes checked in over the three days. */
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
  // Nominees must be at least nominee_min_age and under nominee_max_age on
  // nominee_age_on (or the closing day).
  nominee_min_age: number | null;
  nominee_max_age: number | null;
  nominee_age_on: string | null;
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
  /** The squad or team the game is for. */
  team_id: string | null;
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

/** A goal a coach sets for the whole squad or team in a game. */
export type TeamGameGoal = {
  id: string;
  fixture_id: string;
  body: string;
  set_by_name: string;
  outcome: GoalOutcome | null;
  review: string | null;
  reviewed_by_name: string | null;
  created_at: string;
};

/** A team member's comment on a team goal. */
export type TeamGameGoalComment = {
  id: string;
  goal_id: string;
  author_id: string | null;
  author_name: string;
  /** Their part in the team when they wrote it. */
  author_role: TeamRole;
  body: string;
  created_at: string;
};

/** A squad or team the member coaches, with its next or last game, for team goals. */
export type CoachTeamGame = {
  team_id: string;
  team_name: string;
  team_kind: GroupKind;
  fixture_id: string;
  /** The next game in the coming 7 days; otherwise the last one played. */
  is_next: boolean;
  round_name: string | null;
  opponent: string | null;
  starts_at: string;
  time_tbc: boolean;
  goals_close_at: string;
  played_at: string;
  goal_count: number;
  reviewed_count: number;
};

/** One person in a safeguarding post, from `safeguarding_contacts`. */
export type SafeguardingContactPerson = { id: string; name: string; acting?: boolean };

/** Who to talk to about a child's safety, from `safeguarding_contacts`. */
export type SafeguardingContacts = {
  child_safety_officer_id: string | null;
  child_safety_officer_name: string | null;
  complaints_manager_id: string | null;
  complaints_manager_name: string | null;
  governing_body_name: string | null;
  governing_body_phone: string | null;
  governing_body_url: string | null;
  policy_url: string | null;
  /**
   * Every Child Safety Officer who can act now (a club can name up to 5), or,
   * when none can, the admins acting in the post (`acting: true`).
   */
  child_safety_officers?: SafeguardingContactPerson[];
  /** Every Complaints Manager who can act now, or the admins acting. */
  complaints_managers?: SafeguardingContactPerson[];
};

export type ConcernStatus = 'received' | 'referred' | 'under_review' | 'closed';

export type ConcernEventKind =
  | 'note'
  | 'referred_governing_body'
  | 'referred_police'
  | 'status_changed'
  | 'about_changed';

/** Whether a concern is about a child's safety, as the person raising it said. */
export type InvolvesChild = 'yes' | 'no' | 'unsure';

/** A concern in the register, from `concern_register`. */
export type Concern = {
  id: string;
  created_at: string;
  /** Null when they asked for their name not to be shown. */
  raised_by_name: string | null;
  anonymous: boolean;
  contact_ok: boolean;
  contact_details: string | null;
  about_member_id: string | null;
  about_member_name: string | null;
  about_text: string | null;
  happened_on: string | null;
  body: string;
  involves_child: InvolvesChild;
  context: string | null;
  status: ConcernStatus;
  closed_at: string | null;
  last_action_at: string | null;
  /** A copy of the message reported with "Report this message", kept with the concern. */
  reported_message_sender_name?: string | null;
  reported_message_sent_at?: string | null;
  reported_message_body?: string | null;
  /** A short reference such as C-0007, to name it without its details. */
  reference?: string;
  /** Everyone the concern is about, in the order named (id null once their account is gone). */
  about_members?: { id: string | null; name: string }[];
};

/** Something done about a concern, from `concern_history`. */
export type ConcernEvent = {
  id: string;
  created_at: string;
  by_name: string | null;
  kind: ConcernEventKind;
  status: ConcernStatus | null;
  note: string | null;
};

/** A concern the member raised, from `my_concerns`. */
export type MyConcern = {
  id: string;
  created_at: string;
  status: ConcernStatus;
  about_text: string | null;
  anonymous: boolean;
  /** A short reference such as C-0007, to quote to the club. */
  reference?: string;
};

/** A session an athlete logged beside their check-ins (customer review R10). */
export type SessionLog = {
  id: string;
  athlete_id: string;
  day: string;
  kind: SessionKind;
  minutes: number;
  /** Session RPE: how hard it felt, 1 (very easy) to 10 (maximal). */
  rpe: number;
  updated_at: string;
};

export type SessionKind = 'training' | 'game' | 'gym' | 'other';
