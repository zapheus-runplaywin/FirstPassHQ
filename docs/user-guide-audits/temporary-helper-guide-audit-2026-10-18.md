# Temporary helper guide audit — 18 October 2026

Scope: the temporary helper role guide (`docs/user-guide.md` section 9 "Temporary helpers", the Temporary helper row of the section 1 roles table and the sentence after the feature table, section 6 "Volunteer exemptions" and section 10's helper text as they apply to helpers, every section 11 row that names helpers, and section 12 "Raising a concern", "Who counts as a child" and "For coaches, managers, physios and volunteers"), plus section 2 read as a helper. Every claim was checked against PR #143's branch at `f6367fc`: the join flow in `src/app/join.tsx`, the "Before you help" card in `src/components/volunteer-onboarding.tsx`, the home gates in `src/app/index.tsx`, and the database rules in `supabase/migrations`, always the last definition of each function. The database role is `volunteer`.

**Result:** the join and "Before you help" flow works step by step as section 9 describes, the approval rule, the 14 and 30-day exemptions, the 12-month rule and the declarations all match, and a helper reaches nothing of the club at the database except squad and team names. The audit found one real dead end (A1: the "I'm a parent of an athlete at the club" choice can never be recorded for a helper), a records gap on account deletion (A2), two home-screen bugs after a stand-down and around to-do counts (A3, A4), several overclaims, and two stale screenshots.

## A. Findings that matter

| # | Guide says | The app does | Evidence | Recommendation |
|---|---|---|---|---|
| A1 | **Section 9 (and the join form):** a helper can be screened as "I'm a parent of an athlete at the club", and an admin "records your exemption". | A helper can never get the parent-volunteer exemption: recording it needs a guardianship link to the child, a helper can hold no other role so can't be a Guardian, and the admin page hides the Parent volunteer chip for them. The parent reaches a dead end; the admin must record a card or another exemption, or ask them to join as Guardian plus Coach or Manager. | `20261013060000_temporary_volunteers.sql:312-327`; `20261017040000_coach_guide_audit.sql:432-449`; `src/app/admin/[id].tsx:937-943`; `src/lib/safety.ts:183`; `src/app/join.tsx:305-306` | **Decided by Matt (19 October): name the child.** `admin_set_volunteer_exemption` and `volunteer_exemption_state` (in `20261019000000_role_audit_decisions.sql`) skip the guardian link for a helper; the admin page offers **Parent volunteer** for helpers and a search of the club's athletes under 18. The child's name is stored on the exemption as before. Section 10 says so. |
| A2 | **Section 9:** the club keeps the helper's screening, declaration and policy acceptance "for governance and reporting". **Section 11:** acceptances kept after deletion. | A helper who taps Delete account erases their task, dates, screening answer, policy acceptance and exemption declaration (`policy_acknowledgements` and `volunteer_exemptions` cascade on the profile), and vanishes from the Temporary helpers report. Only stand-downs and Screening Unit notices survive. | `20261013060000_temporary_volunteers.sql:532`; `20261012230000_volunteer_exemptions.sql:42`; `src/lib/reports.ts:166-169` | **Decided by Matt (19 October): keep them.** The policy acceptance and exemption declaration are kept under the name by main's `20261017120000_retention_gaps.sql` (merged after this audit). The task, dates and screening answer live on the profile and still go with it, so a deleted helper leaves the Temporary helpers report; section 11 says so. |
| A3 | **Sections 1, 9:** helpers "see none of the club's features"; **section 10:** a stood-down helper's home says the role is paused. | A stood-down helper's usable profile becomes a guest, so the helper gate on the home screen is bypassed: they see the member home shell (to-do list, "My squads and teams: You are not in a squad yet.") with the "Temporary helper paused" card. Nothing leaks at the database. | `src/lib/auth.tsx:190-199`; `src/app/index.tsx:231-235, 748-760` | **Code (built):** gate the helper home on the role held, not the usable role. |
| A4 | **Section 10:** a helper shows in the checks to-dos "only between their first and last day". | Only the missing-check count skips an upcoming helper; the expiring, to-validate, to-register and people counts include a helper who hasn't started. | `20261016020000_wwcc_todo_people.sql:36-105` | **Code (built):** every count skips helpers whose first day is ahead. |
| A5 | **Sections 6 and 10:** a helper "gets a to-do: Accept the exemption declaration". The admin page says the same. | Helpers have no to-do list; they get a **Read the declaration** button in the Working With Children Check step. Section 9 is right. | `src/app/index.tsx:262-270`; `src/components/volunteer-onboarding.tsx:126-132`; `src/app/admin/[id].tsx:1012-1013` | **Guide and screen (built):** sections 6 and 10 say "a to-do, or for a temporary helper the Read the declaration step"; the admin text branches on the role. |
| A6 | **Section 9:** "paid or unpaid". | True for a card or the national-event exemption only: the parent, under-18 and visitor declarations each say the helper isn't paid. | `20261012230000_volunteer_exemptions.sql:133-160`; `20261013060000_temporary_volunteers.sql:243-244` | **Guide (built):** "paid or unpaid; a paid helper needs a card or the national event exemption". |
| A7 | **Join form:** for "I don't have a check yet", "tell a club admin your application number". | An application number can't be recorded; a check needs a card number and expiry. The home screen says it right ("tell a club admin when it arrives"). | `20261008000000_child_safety.sql:45-56`; `src/app/join.tsx:309` | **Screen (built):** join text matches the home screen. |

## B. Code and in-app text fixes

| # | Where | Problem | Done |
|---|---|---|---|
| B1 | `src/app/index.tsx:231-235` | Stood-down helper sees the member home (A3). | Yes. |
| B2 | `admin_safety_todos` | Upcoming helpers in four counts (A4). | Yes, migration `20261018230000_role_guide_audits.sql`. |
| B3 | `src/app/admin/[id].tsx:1012-1013` | "they'll get a to-do" for a helper. | Yes. |
| B4 | `src/app/join.tsx:309` | "application number" (A7). | Yes. |
| B5 | `src/components/volunteer-onboarding.tsx:101-114` | After approval the Who you are step says a code may be asked for, but no code shows. | Yes: the sentence is dropped once approved. |
| B6 | `src/app/delete-account.tsx` | Says nothing about a helper's screening record. | Yes: one sentence for temporary helpers (what is kept follows Matt's decision). |
| B7 | `src/app/join.tsx:96-124` | Two RPCs in order; if the second fails (dates over 12 months, last day passed) the request is already saved without dates. Recoverable via Edit. | Left; noted. |
| B8 | `set_my_volunteer_details` | A first day in the past is accepted. | Left; harmless. |

## C. Wording slips (guide only)

1. Section 9: helpers can see squad and team names (the join form lists them); everything else is closed.
2. Section 9: "their time ends by itself" means the home screen says so, the report shows Finished and to-dos drop them; the account stays approved until an admin removes it, and the helper can still be named in a concern.
3. Section 9: mention the 12-month rule for the visitor and national event choices (section 6 has it).
4. Section 9: the policy record is the one-paragraph statement, the version and the policy links (the privacy policy link is shown too).
5. Section 10: the WWC report flags a helper "Helping now" without a valid check or exemption in red; the approval rule applies only the first time a helper is approved.
6. Section 6: "once in any 12 months" should read "before or after", as section 10 says.
7. Section 2 for the helper edition: no Waiting for approval card (the Before you help card replaces it), Edit is inside Your details, and the rejection reasons mention PlayHQ.

## D. Things a helper sees or does that the guide doesn't mention

- The join form's helper text ("It doesn't make you a member of the club…"), the placeholder "For example, bench helper at the State carnival", the chip group labelled Working With Children Check, and the validation messages.
- "Before you help" texts: "Every adult helping with children needs to be cleared by the club first…", "Your card is recorded. It expires…", "A club admin will check card XXXX online.", "You accepted the club's code of conduct and child safeguarding policy on {date}."
- The statement agreed to ("I've read the club's code of conduct and child safeguarding policy, and I'll follow them…") and the declaration screen texts.
- Your details (preferred name), Sign out, Switch club and Delete account are on every helper home.

## E. Questions for Matt

1. **A1 parent helpers: Matt chose naming the child (19 October).** Built on this PR.

## F. Confirmed as accurate

- Helpers can't combine with any role; no messages to or from them; not asked for the seasonal code of conduct.
- Join flow: the six choices, card number required, up to 12 months, task length; the step titles, Edit before approval, Read the declaration, I agree, the policy record; approved and finished texts; Raise a concern always on the home screen.
- Approval rule: policies accepted and a check or accepted exemption covering every day (`volunteer_covered`); admins change dates and they must stay covered.
- Visitor 14 days and national event 30 days, ending by themselves, one of the two in 12 months; declaration contents for all four bases; the national-event one omits "not paid".
- Helpers can be stood down and a barring notice stands them down; stand-downs kept after deletion.
- WWC report covers helpers while helping; the Temporary helpers list and statuses.
- Exemptions, declarations, task, dates and acceptances visible to the helper and admins only; no purge rule ever removes helper records.
- Screenshots `volunteer-home.png`, `volunteer-policies.png`, `volunteer-approved.png`, `volunteer-declaration.png` still match; `join-volunteer.png` and `member-volunteer.png` lack the Statistician chip and `member-volunteer-exempt.png` shows the old check paragraph, all reshot on this PR.
