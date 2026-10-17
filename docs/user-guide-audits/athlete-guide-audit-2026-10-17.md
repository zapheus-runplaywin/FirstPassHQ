# Athlete guide audit — 17 October 2026

Scope: everything in the athlete role guide (`docs/user-guide.md` sections 2, 3, 4, the "Raising a concern" and "For children and young people" parts of section 12), plus the Athlete column of the section 1 table and the athlete rows of section 11. Every claim was checked against the current main branch (`ac88d39`): screens in `src/app`, logic in `src/lib`, and the database rules (RLS policies and functions) in `supabase/migrations`. Where the guide says who can see something, the database rule was checked, not just the screen.

**Result:** the guide is in good shape. No claim is badly wrong, and nothing an athlete is told they can do is missing from the app. There are 6 findings that matter (section A), 3 small code fixes where the app's own wording has fallen behind (section B), a batch of wording nits (section C), things the app does for athletes that the guide leaves out (section D), and 2 questions for Matt (section E).

## A. Discrepancies that matter (fix the guide)

| # | Guide says | The app does | Evidence | Recommendation |
|---|---|---|---|---|
| A1 | **Reporting an injury:** "Your coaches and the committee can see it straight away." | For an athlete under 18, coaches, physios and the committee see the injury only once a parent or guardian has given consent for injuries. Until then only the athlete, their guardians and admins see it, and only an admin can clear them. The report form itself says so. | `20261013010000_consents.sql:372-377`; `src/app/injuries/new.tsx:143-147` | Add the under-18 rule to the athlete section (the guardian section already has it) and say "coaches, physios and the committee". |
| A2 | **Your season KPIs:** "Your coaches see your KPIs and, if you're under 18, so do your parents or guardians. Your teammates can't." | Club admins also read an athlete's KPIs, progress, reviews and own view (as a viewer, and the view is logged). The general Season KPIs section and section 11 say this correctly; the athlete section and the in-app line both omit admins. | `20261016000000_season_kpis.sql:204-233`; `src/lib/kpis.ts:262-267` | Add "and the club's admins" to the athlete section, and to `whoSeesLabel` in the app (see B3). |
| A3 | **Game goals, team goal comments:** "everyone in the team, their parents or guardians and the coaches can read it." | Club admins, and a physio or manager placed in the team, can also read team-goal comments, which carry the child's name. Also, coaches can remove any athlete's comment (the coach section says this; the athlete section only mentions removing your own). | `20261008200000_game_goals.sql:606-627`; `20261011221000_team_goal_comments.sql:30-37, 95-118` | Say "everyone in the team (including its manager or physio), their parents or guardians, the coaches and the club's admins", and add "Your coaches can remove any comment." |
| A4 | **Home screen:** "Cards for the features your role uses: Messages, Daily check-in, Check-ins, Injuries, Attendance, Awards, Integrity training and Administration." And the to-do list names check-in, award vote, training, "an injury clearance to sign off" and absences. | Athletes also get **Session plans**, **My attendance** and **Season KPIs** cards, and **Raise a concern** sits above the footer for everyone. Athlete to-dos also include **Accept the code of conduct**, **Set your goals for …**, **Reflect on …**, **Update your … injury** (past expected return) and **Confirm your KPI review was done**. "An injury clearance to sign off" never applies to an athlete's own injury; it is a coach, physio or committee item. | `src/app/index.tsx:337-370, 396-404, 587-593`; `src/lib/todos.ts:161-172, 220-267, 548-555`; `consents.sql:432-438` | Rewrite the two lists so they are complete, and attribute the clearance sign-off to coaches, physios and the committee. |
| A5 | **Your attendance and absences:** "Your coaches and managers see it when they take attendance." | The committee and admins see reported absences too, with the reason and details; the absence form says "Coaches, managers, the committee and admins see the reason and details." Section 11 already has this right. | `src/app/attendance/absence.tsx:97-101`; `20261015220000_absence_categories.sql:214-239` | Match the form's wording. |
| A6 | **Club awards:** "Match awards … stay open for a day or two after it." | The window is set per award by an admin (1 hour to 14 days, default 48 hours) and never runs past the award's own closing date. | `20261008010000_fixtures_and_awards.sql:254`; `20261008030000_award_slots_need_nominees.sql:59-66` | "…stay open for the time the club set for that award (two days unless changed), never past its closing date. Each vote shows when it closes." |

## B. Code fixes (the app's own wording is behind the guide or the behaviour)

| # | Where | Problem | Recommendation |
|---|---|---|---|
| B1 | Delete account screen, `src/app/delete-account.tsx:38-39` | Says "The club keeps your injury records and clearance documents for 12 months after you leave … and then deletes them." Since PR #115/#135 the files of a cleared injury can go sooner, after the club's keep period for injury documents (default 1 year, or 90 days / 3 years), while the injury record keeps the 12-month rule. The guide is right; the screen is stale. | Add the guide's sentence "Clearance documents may go sooner, after the club's keep period for injury documents." |
| B2 | Delete account screen, `src/app/delete-account.tsx:33-35` | Lists what is deleted but omits personal tasks, which are deleted (cascade, `20261015210000_personal_tasks.sql:15`). The guide includes them. | Add "your personal tasks" to the screen. |
| B3 | Season KPIs sheet, `src/lib/kpis.ts:262-267` | "Your coaches [and your parents or guardians] can see them. Your teammates can't." omits club admins, who can read them. The app should tell a child exactly who sees what. | Add "and the club's admins". Same PR as A2. |

One behaviour worth a code decision rather than a doc fix (**E1** below): the "Reflect on …" to-do is built only for the athlete's most recent played game (`src/lib/goals.ts:201-207`, `src/lib/todos.ts:254-267`). An athlete who plays twice in a week, or for two teams, is reminded only about the newest game; the older game's unreflected goals drop off the to-do list silently while still showing on the team page. The guide says "for a week after the game, 'Reflect on …' stays in your to-do list until every goal has a reflection", which is only true for the latest game.

## C. Wording nits (guide only, all low priority)

1. "Unread messages have a **yellow** dot" and "a **yellow** number means something new": the colour is the club's hero colour from Club settings. Thunder's is yellow (#FFCD00), so the Thunder edition is right, but the Warriors and generic editions of the role guides are built from the same text and are wrong there. Say "a dot in the club's colour" (or keep "yellow" and accept it only in the Thunder edition). `src/app/messages/index.tsx:92`, `src/constants/theme.ts:27`.
2. "Guests don't get messages": temporary helpers don't either (`20261013060000_temporary_volunteers.sql:742-760`). Add "and temporary helpers".
3. "Messages from your coaches, managers, captains and the club": committee members can also message the whole club. Add "committee".
4. Message text removal: the keep period is longer when a child sent or received the message (`20261016030000_retention_choices.sql:269-285, 344-352`). Keeping records already says this; add "(longer when a child sent or received it)".
5. Calendar chips: a chip appears only for a squad or team (or fixtures list) with an event in the loaded range; there is also a committee chip for committee members. `src/app/calendar.tsx:105-111`.
6. "Pick a club leader by name": the name list is coaches, managers, physios, committee, admins and temporary helpers; anyone else is described in words. `temporary_volunteers.sql:1181-1192`.
7. Integrity training to-do: with more than two outstanding courses the list collapses to one item, "Complete N integrity training courses", with the soonest due date. `src/lib/todos.ts:316-324`.
8. Awards and Integrity training are features the club can switch off; open each section with "If the club has turned on …" as the Code of conduct section does.
9. "Set your goals for …" stays in the to-do until the game has a goal from anyone, including a coach-set one, not "until you've set a goal". `src/lib/todos.ts:244-252`.
10. Goals close "when the game starts", or at the end of that day if PlayHQ had no start time. `20261008200000_game_goals.sql:107-116`.
11. Endorsement: "one of your coaches or a club physio" should be "one of your coaches, or a physio who looks after your squad or team (or the Head Physio)". `20261013055000_security_follow_ups.sql:17-28`.
12. "If either of them sends it back": a coach, a physio who looks after you or any committee member can send a clearance back, the committee even before a coach has looked. `20261012001000_team_physios.sql:170-177`.
13. Expected return date is required when reporting an injury (the form will not submit without it), so "a best guess is fine" should sit after "(required)". `src/app/injuries/new.tsx:53-56`.
14. The document log also lists photo declarations ("Confirmed as a photo of the letter by …"), not only views and shares. `20261013000000_injury_documents.sql:441-450`.
15. "No photos of your injuries" (children bullets): true for the child, but a verified parent or guardian can attach a photo of the injury with recorded consent if the club has turned that on (`injury_documents.sql:134-165`). Add a half-sentence so the bullet is exact.
16. Join form: physios pick a squad or team too, not only "athletes, coaches, managers and guardians". `src/lib/labels.ts:97-102`.
17. "Switch to this club?" is really "Switch to <club name>?" with "Switch to <name>" / "Stay with <current club>" buttons. `src/app/club/[code].tsx:30-43`.
18. "You're all caught up." is shown as "✓ You're all caught up." Trivial.
19. Section 1 table: "Anyone but a guest or temporary helper can also be a statistician, including an athlete …" conflicts with "Athletes under 18 can only add Coach": an under-18 athlete cannot be a statistician (`role_combination_problem`, `20261013060000_temporary_volunteers.sql`). Add "(18 or over, for athletes)".
20. Season KPIs, reviews bullet: "once **you've** talked it through" should be "once they've".
21. Deleting your account: the screen has a two-step confirm ("Delete my account" then "Delete my account permanently") and says "If you sign in again later, you'll need to ask to join again." Neither is in the guide. Same for "Delete task" and "Delete done tasks", which each ask you to confirm.

## D. Things an athlete can do that the guide doesn't mention

Worth adding (they help an athlete find information):
- **Edit request** while waiting for approval (`src/app/index.tsx:849-851`).
- Injuries list has a **Current / Including cleared** filter; the clearance form has an optional note "Anything the coach or committee should know"; physio updates can't be added while a clearance is waiting.
- My attendance shows "At X of Y sessions · N%" and marks sessions covered by a reported absence as "Absent, reported"; only upcoming absences are listed as cards.
- Session plans show a **New** badge, "Run by" and "Last changed … by …"; Word files open in the phone's own viewer.
- Awards: 5-4-3-2-1 ballots exist as well as 3-2-1; a preseason vote slot exists for match awards.
- Training: **View certificate** opens what you sent; "Choose a different file" before sending.
- Calendar: tapping a day in the week strip jumps the list to it; the list loads 3 months ahead and each Load more adds 3; event notes show round, grade and home/away for matches; ICS calendars are cached so the last copy shows offline.
- Check-in: each score has a word label (e.g. "Very sore" to "Fresh"); history shows each day's note; the home card reads "✓ Done for today" / "Not done yet today".
- Season KPIs: "Mark as not done" reverses a done measure; "Clear" removes your own view; each KPI shows "Set by <coach>".
- Captains: 4,000-character limit; one group pre-selected if you captain only one.
- Raise a concern: "Thank you for telling us" confirmation; up to 10 concerns a day.

Not worth adding: verification code regenerates weekly if unused; inbox shows the latest 100 messages; task title 200 characters.

## E. Questions for Matt

- **E1. Reflect to-do for more than one game.** Fix the code so the to-do covers every unreflected game in the last 7 days (recommended, it fits "timely and centralised"), or change the guide to "for your most recent game"?
- **E2. Under-18 athlete with only an unverified guardian linked.** Nobody can accept the code of conduct for them: the child is not asked, and the unverified guardian is refused (`20261013140000_code_of_conduct.sql:155-250`). They sit as outstanding on the admin's list until the guardian is verified. Leave as is (verification is the gate), or show "waiting for your parent or guardian to be verified" to the child and admin? Not an athlete-guide error.

## F. Confirmed as accurate

Everything else checked out, including: Google-only sign-in; club code and QR/link flow; join fields, under-18 parent email and 5-tries/15-minute lockout; 6-digit code; the four check-in questions and exact note wording, 1-5 scale, flag at 2 or less, two-week history, once a day; game goals (7 days before, max 5, closes at start, played at +90 min or next day, Achieved/Partly/Not yet, 10 per page, byes left out, who sees them); KPIs (5 key results, 10 per group, Lower is better, review a week before, re-confirm on change, archived read only, teammates and committee never see athletes'); injury fields, 10 MB, PDF/photo, "photo of the letter" switch for under 18s, status strings, endorse then accept by different people, nobody for self or own child, proof required, no document removal, 1 year / 90 days / 3 years retention, "Viewed by X (role)" log visible to athlete, guardians and admins; "Injured, back <date>" on the register regardless of consent; attendance ranges 4 weeks/3 months/12 months, own marks only, guardians the same; absences 12 months ahead, 14 days back, 3 months span, reasons list, Withdraw including guardian-reported ones; session plans card with unread count, read only, no push for non-admins; awards voting rules, secret ballots, admin-only results, no self-vote; training flow, statuses, send-back note, no removal; code of conduct words, Accepted list, guardian accepts for a child; concern contacts and numbers, form fields, anonymity, statuses, who sees it; the "For children and young people" bullets (no DMs or replies, guardian copied, from 13 told of guardian changes, tasks private); personal tasks (100 cap, last 30 done, owner-only RLS); preferred name and titles; captains' sending rights and guardian copies; calendar 12 months each way; 6 upcoming events; roster positions and captain marks; and the Athlete column of the section 1 table and section 11 rows.
