# Guest guide audit — 18 October 2026

Scope: the guest role guide (`docs/user-guide.md` section 9 intro and "Guests", the Guest row and column of the section 1 tables, every section 11 row as it applies to guests, section 12 "Raising a concern"), plus sections 2 and 3 read as a guest, since the guest PDF carries all of section 3. Every claim was checked against PR #143's branch at `f6367fc`: screens in `src/app`, logic in `src/lib`, and the database rules in `supabase/migrations`, always the last definition of each function. The question for a guest is what they can reach at the database at all.

**Result:** the guide's one substantive guest sentence is wrong. Guests cannot see squads and teams: a guest can never be placed in one (`admin_save_member` refuses any role but coach, manager, physio, athlete and guardian), and rosters, team calendars, fixtures and captains all need a placement. What a guest gets is the club calendar, their own tasks, a preferred name and Raise a concern. Everything the guide says guests don't get (messages, votes, training, the code of conduct, a check) is right at the database. The guest PDF also carries whole chapters of section 3 that never apply to a guest, because the PDF builder trims nothing for guests.

## A. Findings that matter

| # | Guide says | The app does | Evidence | Recommendation |
|---|---|---|---|---|
| A1 | **Section 9:** "Physios and guests see the squads and teams and the club calendar"; "Guests … can only look: squads and teams, and the club calendar." **Section 1 table:** My squads and teams ✓ for guests. | A guest is never in a squad or team and can't see any: placement is refused for guests, `team_roster` needs `is_team_member` or admin, the calendars policy gives a guest only the club calendar, fixtures need a placement. The home screen shows the **My squads and teams** heading with "You are not in a squad yet." for ever. | `20261013080000_temporary_helper_wording.sql:417`; `20261012001000_team_physios.sql:244, 726`; `20261007040000_committee_calendars.sql:27`; `src/app/index.tsx:228, 590-594` | **Guide (built):** guests see the club calendar only; the table cell becomes "Heading only"; section 9 says the heading reads "You are not in a squad yet." |
| A2 | **Section 11, Your profile and squads:** "Your name also shows to anyone choosing who a concern is about". | Not a guest's: the concern picker offers only coaches, managers, physios, committee, admins and temporary helpers. For a guest the row is "You and admins". | `20261013060000_temporary_volunteers.sql:1181-1190` | **Guide (built):** "…if you're a coach, manager, physio, committee member, admin or temporary helper". |
| A3 | **Section 3, Delete account:** what the club keeps. | Concerns a member raised stay, with the stored name (unless raised anonymously), after the account is deleted. Neither the guide nor the delete screen says so, for any role. | `20261012235000_concerns.sql:205, 263` | **Guide and screen (built):** add "concerns you raised" to what the club keeps. |
| A4 | **Section 12:** safeguarding contacts are cleared adults. | At the database a guest with a recorded card could be named Child Safety Officer or Complaints Manager: `can_be_safeguarding_contact` checks only approved, adult, not stood down and cleared, and the admin picker applies the same filter. | `20261012235000_concerns.sql:46-58`; `src/app/admin/safeguarding.tsx:91-100` | **Code (built):** guests and temporary helpers can't be safeguarding contacts, in the function and the picker. |
| A5 | **Section 2:** everyone gives a date of birth and it decides whether the under-18 rules apply. | Nothing stops a child being approved as a guest, and no under-18 rule then applies (no guardian link, no copies, no consent). Guests get nothing, so little is at stake, but the guide doesn't say guests are expected to be adults. | `admin_save_member` (date of birth required for athletes only); `role_combination_problem` | **Decided by Matt (19 October): code.** `admin_save_member` (in `20261019000000_role_audit_decisions.sql`) needs a date of birth to approve a guest and refuses anyone under 18; sections 1 and 9 say the role is for adults. |

## B. Code and in-app text fixes

| # | Where | Problem | Done |
|---|---|---|---|
| B1 | `can_be_safeguarding_contact`, `src/app/admin/safeguarding.tsx` | Guests and helpers eligible as officers (A4). | Yes, in `20261018220000_committee_guide_audit.sql`'s follow-up migration on this PR. |
| B2 | `src/app/delete-account.tsx` | Doesn't say concerns raised are kept. | Yes. |
| B3 | `20261017020000_guardians_no_award_votes.sql:14` | Still names a `partner` role the app removed. Harmless. | Left. |
| B4 | `/mnt/project-files/thunder/user-guide/manual/build-role-guide.py` | The guest edition keeps all of section 3 (Messages, Squads and teams, Club awards, Integrity training, Code of conduct, Season KPIs) and the roster and inbox screenshots, and its cover uses the inbox; the guardian trim strings no longer match the guide, so the guardian edition can't build. | Yes: guests get a section-3 subsection list (home screen, tasks, preferred name, calendar, raising a concern, deleting your account), the cover uses the calendar, and the guardian trim strings are updated. |

## C. Wording slips (guide only)

1. Section 1 Guest row: say what a guest gets: the club calendar, personal tasks, a preferred name and Raise a concern; no messages, no votes, no training, no code of conduct, no check needed, can't be stood down.
2. Section 3 "Your preferred name": the Title and team title paragraphs don't apply to guests (the Your details screen is Preferred name and Save).
3. Section 3 "Calendar": the squad and team chips and PlayHQ matches never apply to a guest; the chip row is All and Club.
4. Section 11 "Match fixtures" and "Absence reasons": guests see no fixtures; the absence reasons list is readable by every approved member including guests, though no guest screen shows it.
5. Section 3 awards: guests can't be nominated in "Any member" awards either (`award_nominee_pool`).

## D. Things a guest can do that the guide doesn't mention

- The header reads "Guest"; the to-do list only ever holds personal tasks ("✓ You're all caught up.", + Add a task, Your tasks).
- Guests can't be stood down and can't be messaged by an admin ("Guests and temporary helpers don't get messages").

## E. Questions for Matt

1. **A5 guests under 18: Matt chose the code rule (19 October).** Built on this PR.

## F. Confirmed as accurate

- Guests can raise a concern, see its status, and the helplines (`raise_concern`, `my_concerns`).
- Guests can't hold another role, including statistician (`role_combination_problem`).
- No messages to or from guests (`is_message_recipient`, `send_group_message`, `useGetsMessages`).
- No votes and no Awards card (`award_voters` excludes view-only members).
- No code of conduct (`conduct_required`), no integrity training (`admin_save_training_requirement` refuses Guests).
- To-do list, personal tasks, preferred name, Coming up and Full calendar, Switch club, Delete account, join flow and policies, safeguarding contacts and policies readable by everyone signed in.
- `guest-home.png` still matches (reshot on this PR with the current build).
