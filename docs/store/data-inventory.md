# Data inventory

The single source for every store answer and the public privacy policy. Each row says what the
data is, where it lives in the code, why the app keeps it, who can see it, how long it's kept and
whether it leaves the club's own Supabase project. The other files in `docs/store/` quote from
this one. If they disagree, this file wins, and this file must match the code.

Checked against `main` at commit `7ceb1aa` (17 Nov 2026, after #217), and row 1 again at
`ba4c638` (18 Nov, after Sign in with Apple #219 and its revoke on delete #221). A row for crash
reports (W2) is added only after it merges, because the pack describes what is merged.

## Where the data is

- **Each club has its own Supabase project** (database, file storage and sign-in), picked by the
  club code (`src/constants/clubs.ts`). No other club's data is in it.
- **Region:** Amazon Web Services, Sydney (`ap-southeast-2`) for live clubs
  ([data-handling.md](../data-handling.md), section 13 of the user guide). **To confirm:** the
  region of the test project, which the demo club (W7) uses. It holds sample people only.
- **Encrypted** in transit (HTTPS/TLS to Supabase) and at rest (Supabase encrypts disk and
  storage).
- **Who runs it:** FirstPass owns each club's project and can read everything in it; it opens a
  club's data only to fix a fault, make a copy the club asked for, or when the law requires it
  ([data-handling.md](../data-handling.md), "Who can read it").
- **No advertising, analytics or tracking library** is in `package.json`, and the app does not
  read the advertising ID. **To confirm in W8:** the merged Android manifest of the first store
  build has no `com.google.android.gms.permission.AD_ID` permission.

## Keep periods

Nothing is removed until an admin switches on **Remove old records** in Club settings (off by
default, `20261013100000_record_retention.sql`, `20261016030000_retention_choices.sql`,
`20261017120000_retention_gaps.sql`). The periods below are the recommended defaults the app
starts on; each club can choose others from the lists in the user guide,
[Keeping records](../user-guide.md#keeping-records). Concerns are never removed, and nothing
about a member named in a concern is removed while it names them (legal hold,
`20261023130000_legal_hold.sql`).

## What the app holds

| # | Data | Where in the code | Why | Who can see it | Kept for (default) | Leaves the club's project? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sign-in account: the Google or Apple account's email (with Apple's Hide My Email, a private relay address), the name Apple gives on the first sign-in, and the Supabase user id | Supabase Auth, `profiles.email` (`20261007000000_init.sql`), `src/lib/sign-in.ts` (#219) | Sign in | The member; admins | Until the account is deleted | Google or Apple handles the sign-in itself. When a member who used Apple deletes their account, the `revoke-apple` edge function sends Apple a one-time code to revoke the app's access, and stores nothing (#221) |
| 2 | Name, preferred name, role, title, squads and teams | `profiles` (`init`, `20261009100000_preferred_name_and_title.sql`, `20261009110000_multiple_roles.sql`), `team_members` | Run the club, address messages | Club members, by role (user guide section 11) | Until the account is deleted | Names can appear in push notification text (row 19) |
| 3 | Date of birth | `profiles.date_of_birth` (`20261013020000_date_of_birth_at_join.sql`) | Decide whether the under-18 rules apply | The member, their guardians, admins | Until the account is deleted | No |
| 4 | PlayHQ email (when it differs from the sign-in email; optional after Hide My Email, except for parents and guardians) | `profiles.playhq_email` (`init`) | Match the member to the club's PlayHQ registrations | The member, admins | Until the account is deleted | No |
| 5 | Guardian links, link codes and their history | `guardianships`, `guardian_link_codes`, `guardianship_history` (`20261007060000_guardians.sql`, `20261101000000_parent_link_codes.sql`, `20261013050000_guardian_history.sql`) | Let a verified parent see and approve their child's use | The child, their guardians, admins | Links: until deleted. History: safeguarding period, 30 years | No |
| 6 | Working With Children Check number, card name, expiry, application receipts, exemptions | `profiles.wwcc_*` (`20261013030000_wwcc_records.sql`), `wwcc_applications` and the `wwcc-receipts` bucket (`20261023100000_wwcc_applications.sql`), `volunteer_exemptions` | WA law requires screening of people working with children | The member, admins, the club's WWC officer | Until the account is deleted; exemptions and notices for the safeguarding period, 30 years | No (admins check cards on the Screening Unit's own site) |
| 7 | Injury records, physio updates, clearances, and injury documents (letters, reports, photos of letters) | `injuries`, `injury_updates`, `injury_document_events` (`20261007120000_injuries.sql`, `20261013000000_injury_documents.sql`, `20261022100000_injury_records.sql`) | Keep injured athletes safe and clear them to play | The athlete, their guardians, their coaches and physios (for under 18s only with a verified parent's consent), admins | Documents: 1 year after clearance. Injuries: 7 years after clearance, or after the athlete leaves | No |
| 8 | Medical and emergency details: emergency contacts (name, relationship, phone), conditions, allergies, medications, action plan | `medical_profiles` (`20261023140000_medical_profiles.sql`) | Emergencies at training and games | The athlete (or their guardians), their coaches and physios, admins | 2 years without the yearly check | No |
| 9 | Daily check-ins: sleep, soreness, stress and mood (1 to 5) and a note | `check_ins` (`20261007150000_check_ins.sql`) | Athlete wellbeing | The athlete, their guardians, coaches and physios (for under 18s only with consent) | 1 year | No |
| 10 | Training sessions logged by athletes (kind, minutes, effort 1 to 10) and training load reviews | `session_logs` (`20261023210000_session_logs.sql`), `load_flag_reviews` (`20261028000000_load_monitoring.sql`) | Training load monitoring | The athlete, their guardians, their coaches | 1 year, with check-ins | No |
| 11 | Attendance and absences (with reasons) | `attendance_sessions`, `attendance_marks`, `attendance_absences`, `absence_reviews` (`20261007130000_attendance.sql`, `20261015235000_absence_reviews.sql`) | Run training and selections; a record of who was with which children | The athlete, their guardians, coaches and managers, admins | 1 year | No |
| 12 | Group messages and read receipts | `messages`, `message_recipients.read_at` (`20261007100000_group_messages.sql`) | Club communication. No direct messages or replies | Sender and recipients; guardians get a copy of every message to or from their child | Text: 3 years (7 years when a child sent or received it). Who sent it, to whom and who read it stay | Push notifications say a message arrived (row 19) |
| 13 | Surveys and polls, and answers | `surveys`, `survey_questions`, `survey_answers`, `survey_responses` (`20261017100000_surveys.sql`) | Club and team feedback | By survey: anonymous surveys never show who answered | 3 years (committee), 2 years (shared team surveys), 6 months (team polls) | No |
| 14 | Game goals, reflections, comments, season KPIs | `game_goals`, `game_goal_comments`, `team_game_goals`, `season_kpis` (`20261008200000_game_goals.sql`, `20261016000000_season_kpis.sql`) | Coaching | The athlete, their guardians, their coaches | 1 year | No |
| 15 | Session plans and their photos and files | `session_plans`, `session_plan_files` (`20261016010000_session_plans.sql`), `src/app/session-plans/edit.tsx` | A record of what was coached | The team's coaches and athletes, admins | 1 year, with attendance | No |
| 16 | Integrity training certificates (PDF or photo) | `training_certificates` (`20261009120000_integrity_training.sql`), `src/app/training/submit.tsx` | The sport requires the training | The member, admins | 1 year | No |
| 17 | Safeguarding records: concerns, stand-downs, Screening Unit notices, consents, code of conduct acceptances, policy acknowledgements, conflict declarations | `concerns`, `concern_events` (`20261012235000_concerns.sql`), `stand_downs`, `screening_notices`, `child_consents` (`20261013010000_consents.sql`), `conduct_acceptances`, `policy_acknowledgements`, `conflict_declarations` | Keep children safe; governance | Concerns: the Child Safety Officer, Complaints Manager and admins, never the person named. Others: the member and admins | Concerns: never removed. Others: 30 years after each ended | No |
| 18 | Who opened a child's records, and when | `record_access_log` (`20261013090000_record_access_log.sql`) | Parents see who looked at their child's information | The child, their guardians, admins | 7 years. Deleted with the child's account (`on delete cascade`) | No |
| 19 | Push notification token and notification settings | `push_tokens`, `push_settings` (`20261007090000_push_notifications.sql`, `20261112050000_todo_push_notifications.sql`), `src/lib/push.ts` | Send to-do and join-request notifications | Nobody in the app | Until the account is deleted or the phone stops using it | **Yes.** The token and the notification's title and text go to Expo's push service, then Apple or Google, to reach the phone. Titles can name a person (for example a join request shows the new member's name, or their email if they gave no name). They never include injury details |
| 20 | Awards votes | `award_votes` (`20261008010000_fixtures_and_awards.sql`) | Club awards | Results: members. Who voted for whom: admins | Who voted: 1 year after the award closes. Awards: 10 years | No |
| 21 | Game stats recorded in FirstPass Vantage (not this app) | `games`, `game_events` (`20261015000100_game_stats.sql`) | Coaching; live stream graphics | Coaches and statisticians; Studio operators for live or final games | Not in the keep periods today | **Yes, if the club streams games:** FirstPass Studio shows an athlete by name with their stats only with a publish consent, given by a verified parent for an under 18 (`20261113010100_studio_access.sql`, `20261115000600_publish_consent_needs_guardian.sql`) |
| 22 | On the phone only: the sign-in session, the club codes used, the cached club look, and the app's own log | `src/lib/secure-session-store.ts` (encrypted), AsyncStorage, `src/lib/log.ts` (at most 200 MB, names, emails, health and tokens redacted) | Stay signed in; switch clubs; find faults | Nobody else. The log never leaves the phone | Until the app is removed. `android.allowBackup` is `false` in `app.json`, so none of it goes into Android backups | No |

## What the app reads from elsewhere, sending no member data

- **The club calendar:** the phone downloads the club's published calendar files (ICS, usually
  from Microsoft 365) straight from their address (`src/lib/use-events.ts`). No member data goes
  with the request.
- **PlayHQ fixtures:** an admin's request goes through the `playhq` edge function to PlayHQ's
  public API (`supabase/functions/playhq/`). It sends competition and season ids only.
- **App updates:** `expo-updates` downloads new versions of the app from Expo
  (`app.json` `updates.url`). No member data goes with it.

## Phone permissions

| Permission | Why | Where |
| --- | --- | --- |
| Notifications | To-do and join-request notifications, asked the first time | `src/lib/push.ts`, `app.json` `expo-notifications` |
| Camera | Take a photo of a session plan (for example a whiteboard) | `src/app/session-plans/edit.tsx`, `app.json` `cameraPermission` |
| Photo library | Choose photos of a session plan | `src/app/session-plans/edit.tsx`, `app.json` `photosPermission` |
| Files (system picker, no permission) | Attach injury letters, certificates, check receipts, session plan files, the club logo | `expo-document-picker` in `src/app/injuries/[id].tsx`, `src/app/training/submit.tsx`, `src/components/wwcc-application.tsx`, `src/app/admin/club.tsx` |

The microphone is not used (`microphonePermission: false`). The app does not use location,
contacts, the calendar on the phone, health platforms (Apple Health, Health Connect) or Strava.

## Deleting an account

**Delete account** at the bottom of the home screen (`src/app/index.tsx`) opens
`src/app/delete-account.tsx`, which calls `delete_my_account`
(`20261007110000_delete_members.sql`) and so `delete_member_now`
(`20261023130000_legal_hold.sql`). It deletes the sign-in account and the profile. 46 tables
delete the member's rows with it (`on delete cascade`) and 73 keep the row with the member's
name in place of the link (`on delete set null`). What stays is what the delete screen says:

- injury records, seen only by the committee and admins, for the injury keep period (7 years by
  default) from when the member leaves, with documents possibly going sooner;
- code of conduct acceptances, concerns the member raised (unless they hid their name), and a
  coach's or manager's season KPIs and reviews;
- group messages they sent stay with the people who received them, for the message keep period.

It refuses when a concern names the member (legal hold; they are asked to contact a club admin)
or when they are the club's only admin. It does not change PlayHQ, club membership or their
account at any other club.

**Open question (security audit run 1):** whether the record of who opened a child's records
should stay after the child's account is deleted. Today it is deleted with the account (row 18).

## Ages

- The join flow asks everyone for a date of birth (`src/app/join.tsx`).
- An athlete under 18 stays locked, seeing only a link code, until an admin links a verified
  parent or guardian (`20261101000000_parent_link_codes.sql`, #201).
- Guests must be 18 or over (user guide section 1).
- **13 and over this year** (Matt, 18 Nov). The join step refuses a date of birth under 13 and
  saves nothing, and admins can't approve anyone under 13 (#225,
  `20261118100000_join_age_13.sql`). Members approved before it are unchanged.
