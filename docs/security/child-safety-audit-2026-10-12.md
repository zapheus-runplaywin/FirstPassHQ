# FirstPass HQ child-safety and governance audit

Audited 12 October 2026 against `main` at `36fcc99` (after PR #89). This audit looks at how the app handles members under 18, from the point of view of a WA government auditor (Working with Children Screening Unit, Ombudsman WA) and a netball governing body (Netball WA / Netball Australia integrity staff). It follows the child-safety review of 8 October 2026 and sits beside the security review of 12 October 2026 (both in the project's shared files under `thunder/security/`), which covers the general security model; items that review already raises are referenced here, not repeated.

The legal and policy research behind this audit, with the sources read on 12 October 2026 and what could not be verified, is in [child-safety-legal-research-2026-10-12.md](child-safety-legal-research-2026-10-12.md). Nothing here is legal advice; the two places where a lawyer's view is needed are marked.

## Summary

The app is built on the right model and would pass the parts of an audit that most club apps fail. There is no private adult-to-child channel: every message is to a group, every message to an under-18 is copied to their guardians, every message a minor captain sends is copied to the captain's guardians, and admins can read everything. Minority is worked out from a date of birth on the day, an under-18 can't be approved without a verified guardian, coaches, managers, physios and committee members can't be approved without a Working With Children Check, children's health records are confined to the child, their guardians, their coaches and physios, and the committee only sees check-in averages. The admin to-do list and the WWCC and under-18 PDF reports give an auditor something to look at.

The gaps are what an auditor would find next: the app stops checking an adult once they are approved, it has no exemption path for the volunteers WA law says can't get a card, it has no complaints pathway, no named safeguarding contact, no policies, no consent record and no log of who looked at a child's record. Parents can see a lot, but are not told when something changes.

Severity: **Critical** means a child could be harmed or the club could be prosecuted today; **High** means a breach of law or Netball Australia policy an auditor would record as a finding; **Medium** means a governance expectation (National Principles, Netball WA audit, Children's Online Privacy Code baseline) not met; **Low** means worth doing.

| # | Finding | Severity |
|---|---|---|
| 1 | A coach, manager or physio keeps full access to children after their check expires, is cancelled, or the club is told to stand them down | High |
| 2 | The app demands a Working With Children Check from people WA law makes ineligible to apply: parent volunteers and under-18 volunteers | High |
| 3 | No complaints pathway, no Complaints Manager, no safeguarding contact anywhere in the app | High |
| 4 | Photos of a child's injury are accepted, seen by every coach, physio and committee member of that child, can be copied out of the app, and nobody records who looked | High |
| 5 | No privacy policy, no child-friendly notice, no record of guardian consent for a child's data or images | High |
| 6 | Who is a child depends on an admin typing a date of birth; nothing asks the child or checks PlayHQ, and the fallback defaults to "18 or over" | High |
| 7 | A check is recorded as a number and a date with no record of who validated it, how, or when; no WWC Registration Officer; no handling of Screening Unit notices | Medium |
| 8 | Admins hold no screening record yet see every child's injuries, documents, date of birth and messages | Medium |
| 9 | Guardian verification can be a single tap with no evidence recorded; nothing records who linked a guardian or tells the other guardians | Medium |
| 10 | No access log for children's records; parents can't see who has read their child's injury or check-in | Medium |
| 11 | Children's data has no retention limits apart from injuries | Medium |
| 12 | Guardians can't see their child's attendance | Medium |
| 13 | Guardians aren't told when a new adult gets access to their child (a new coach, manager or physio in the squad) or when their child's record is shared out of the app | Medium |
| 14 | Guardianship doesn't end at 18 (security review finding 4) and check-in averages can be differenced (security review finding 5) | Medium |
| 15 | No record that coaches and volunteers have accepted the Code of Conduct, and no default safeguarding induction course | Low |
| 16 | Committee members approved before PR #80 keep access with no check or exemption, indefinitely | Low |
| 17 | The Privacy Act and the Social Media Minimum Age law probably don't bind the club, but nothing records that assessment | Low |

Nothing is rated Critical. Finding 1 would become Critical the day a club receives an Interim Negative Notice for a coach and the app keeps that coach's access.

## What the law and the governing body actually require (October 2026)

Short version; detail and sources in the research file.

- **WA Working with Children (Screening) Act 2004.** Amended 1 July 2023 and again on **17 September 2026** (adverse interstate decisions now bar a WA card). Coaches, assistant coaches, team managers and umpires of junior teams are in child-related work (category 12, club with significant involvement of children). A card lasts **three years**. There is **no statutory duty** on a club to validate or register cards, but the Screening Unit recommends keeping a list with card number, expiry and copies of validations, and registering as an employer so the Unit notifies the club if a cardholder becomes ineligible. **Parents volunteering at the club their own child is involved in are exempt, and exempt people are ineligible to apply**; so are volunteers under 18. The exemption doesn't cover overnight camps, grandparents or adult siblings. A club that keeps someone in child-related work after learning of a Negative Notice, Interim Negative Notice or adverse interstate decision commits an offence (maximum $60,000 and five years). The organisation must remove them "immediately".
- **WA reportable conduct scheme.** It sits in the Parliamentary Commissioner Act 1971 (not the Children and Community Services Act as the brief said) and **does not cover community sporting clubs** as at March 2026. No feature is legally required for it. What is coming instead: on 24 October 2025 WA named Ombudsman WA to regulate compliance with the **National Principles for Child Safe Organisations** for "organisations in child-related work"; no bill or date yet, so build to the Principles now.
- **National Principles for Child Safe Organisations.** Guidance in WA today, regulation soon. The ones an app touches: 6 (child-focused complaints handling), 8 (safe online environment, monitoring of online interactions), 10 (documented policies and records), 3 (families informed and involved).
- **Netball Australia / Netball WA.** Binding on the club by affiliation. *INT004 Safeguarding Children & Young People Policy* (1 Feb 2025), *INT001 Complaints & Disciplinary Policy v3* and the *Code of Conduct for Community Netball* (both 1 Feb 2026; the Code expressly covers online conduct). Key rules: the **two-deep rule** (no one-to-one electronic contact between a person in authority and a child; copy a parent or the club; health professionals may communicate only about care); written parental **consent for images**, no distribution outside the organisation, delete when no longer needed, not kept on personal devices; **every club must appoint a Complaints Manager**; child abuse or serious criminal conduct must be referred **immediately to Netball WA and Police** and not resolved within the club (Netball WA NWA-GUI-41); each club must have a **WWC Registration Officer**, keep records of everyone's card status, check validity periodically, and tell Netball WA in writing of any Negative or Interim Negative Notice (NWA-POL-27).
- **Sport Integrity Australia.** The National Integrity Framework was reissued on 24 July 2026 (adopt by 30 April 2027): a single "allegation" intake, independent Complaint Managers, and an obligation on sports to run education plans. The *Child Safeguarding in Sport Induction* and *Play by the Rules Child Protection* courses are the ones netball bodies point to.
- **Privacy.** A club with turnover of $3 million or less is outside the Privacy Act **unless it is a health service provider**; a club that stores physio treatment notes and injury records for children should get a lawyer's view on that (marked *legal advice* below). The *Children's Online Privacy Code* must be registered by 10 December 2026; it binds Privacy Act entities only, but its standards (age assurance, parental consent under 15, data minimisation, child-friendly notice, deletion rights) are the defensible baseline for any app used by children. The Social Media Minimum Age law (10 Dec 2025) targets platforms whose significant purpose is social interaction; a club administration app with group notices is unlikely to be in scope, but the assessment should be written down.
- **Apple and Google** require a privacy policy URL for any app, and more for apps used by children, regardless of what Australian law requires.

## What the app does today (verified in code)

- Minor = under 18 by `profiles.date_of_birth`, with the admin's "Under 18 / 18 or over" chip as the fallback when there is no date (`is_minor`, `20261008000000_child_safety.sql`; `isMinor`, `src/lib/age.ts`). Only admins enter a date (`src/app/admin/[id].tsx:587`); the join screen doesn't ask (`src/app/join.tsx`); PlayHQ imports don't carry it. The fallback chip starts at "18 or over" (`src/app/admin/[id].tsx:75`).
- An approved under-18 athlete needs at least one guardian; a *newly* linked guardian must be verified (`admin_save_member`, `20261012001000_team_physios.sql:488-500`). Verification is either a 6-digit code read out in person (`admin_verify_member`) or an admin tapping "checked against PlayHQ" (`admin_mark_verified`), which records only a time and who tapped.
- `guardianships` holds guardian, athlete and `created_at`. Every save deletes and re-inserts the links, so there is no history and no record of who linked whom.
- Working With Children Checks: coaches, managers and physios always need one; committee members unless an admin exempts them with a reason (`needs_wwcc`; `src/lib/safety.ts`). Admins don't. The check is enforced **only** in `admin_save_member` at approval (`20261012001000_team_physios.sql:503-512`); `has_current_wwcc` is used nowhere in a read or write policy. Expiry produces a to-do and a "Needs checking" line, nothing else. The record is a card number and an expiry date (`admin_set_member_details`), nothing about validation.
- Messages: group-only, guardians of minor recipients and of a minor sender are copied once each (`send_group_message`, latest in `20261012001000_team_physios.sql:393-414`), admins see every message. This meets the two-deep rule.
- Guardians see their child's injuries and documents, check-ins including the note, game goals (read only), team goals and comments, integrity training, and the calendar and roster of any squad they're placed in. They don't see attendance (`20261007130000_attendance.sql`: coaches, managers, committee, admins). They are not notified of anything other than message copies.
- Injury proof: the private bucket accepts PDF, JPEG, PNG and HEIC (`20261007120000_injuries.sql:169-172`); the upload screen says "A PDF or photo, up to 10 MB" (`src/app/injuries/[id].tsx:372`). Documents are viewed in-app with no save, except that committee members and admins have a **Share** button that sends the file to OneDrive, email or any app on the phone (`src/app/injuries/[id].tsx:394-465`, `src/lib/injuries.ts:169-178`). Nothing records a view or a share.
- No audit table of any kind exists (no `create table` for audit, log or history in `supabase/migrations/`).
- The check-in note is labelled "Anything your coach should know?" with the line "Your coaches and your parents or guardians can read this note." for minors (`src/app/check-in.tsx:103-114`). There is no safeguarding contact or "what to do if a child discloses something" anywhere.
- No privacy policy, terms, safeguarding policy, Child Safety Officer, Complaints Manager or consent capture exists in the app, `app.json`, the repo or the user guide.
- Retention: injuries and documents are purged 12 months after the athlete leaves (`purge_expired_injuries`). Check-ins, messages, goals, attendance and training certificates are kept indefinitely.
- Admin to-dos count members needing a check, checks expiring in 30 days, under-18s with no guardian and athletes turning 18 in 30 days (`admin_safety_todos`); the Members screen names them (`safetyIssues`, `src/lib/safety.ts`). Admin PDF reports cover WWCC status and under-18s with guardians (PR #78).
- Integrity training (PR #77) can already carry Sport Integrity Australia courses per season and role, with certificate review.

---

## 1. High: access doesn't end when a check does

**Where:** `has_current_wwcc` is only called from `admin_save_member` and `admin_safety_todos`. Every access function (`coaches_athlete`, `can_view_athlete_injuries`, `can_view_check_ins`, `can_message_group`, attendance, goals) asks only whether the person is an approved member placed in the group.

A coach whose card expired yesterday still reads children's injuries and check-in notes and messages the squad. More seriously, if the Screening Unit issues an Interim Negative Notice or Negative Notice, or (since 17 September 2026) an adverse interstate decision, the club must remove the person from child-related work *immediately*; the only tool an admin has today is to set the member to "not approved" and remember to do it, and nothing records that it was done or why. Netball WA also requires an expired card to mean no child-related activity until renewed.

**Fix:**
- Add a **stand-down** to profiles: `stood_down_at`, `stood_down_by`, `stood_down_reason` (enum: check expired, interim negative notice, negative notice, adverse interstate decision, allegation under investigation, other) and a note. A stood-down member keeps their account and sees the club calendar only; every coach, manager, physio, committee and captain right is off while it's set. Lifting it records who and when.
- Derive a single `cleared_for_children(profile)` function: approved, not stood down, and (holds a current check, or holds a recorded exemption basis, or holds no role that needs one). Use it inside `coaches_athlete`, `can_message_group`, `is_attendance_taker`, `can_view_athlete_injuries`, physio access and `is_committee`-based reads, so expiry removes access by itself the day it happens, without an admin doing anything.
- Expiry grace: none for access, but the to-do appears 60 and 30 days before so the person renews in time (a WA renewal takes weeks).
- Admin "Stand down now" button on the member screen, one tap, reason required, recorded. Tell the person by in-app message and push that their access is paused and why (wording generic, no allegation details).
- Report: a "Screening notices and stand-downs" section in the WWCC PDF.

## 2. High: the app demands a card from people who can't get one

**Where:** `needs_wwcc` (`20261009140000_committee_wwcc.sql`, `src/lib/safety.ts`) requires a card for every coach, manager and physio; the only exemption is for committee members.

In WA a parent volunteering at the club their own child is involved in is **exempt and ineligible to apply**, and so is any volunteer under 18. A parent who manages their child's team, or a 17-year-old athlete who helps coach a younger squad (the app allows athlete + coach for minors), cannot be approved in the app at all, or the admin types in a card that doesn't exist. Netball Australia's policy lets a club mandate a card only "where state law permits", so the app's rule is stricter than the club is allowed to be, and Netball WA still wants a record of the exemption.

Note the parent exemption has edges: it ends when the child turns 18 or leaves the club, doesn't apply to overnight camps, doesn't cover grandparents or adult siblings, and can't be used by anyone with a Negative or Interim Negative Notice (who doesn't have to tell the club why). The Screening Unit's volunteer declaration (template ORG04, August 2026) is how clubs record that.

**Fix:**
- Replace the committee-only exemption with an **exemption basis** per member: `wwcc_exemption` enum (`none`, `committee_no_contact`, `parent_volunteer`, `under_18_volunteer`), with reason text, the linked child for `parent_volunteer` (must be an approved under-18 athlete in the club), `declared_at` and a copy of the declaration wording the person accepted in-app (the ORG04 statements: no notice, no adverse interstate decision, will tell the club if that changes).
- `needs_wwcc` becomes: needs a card unless an exemption basis applies and is still valid. `parent_volunteer` lapses automatically when the linked child turns 18 or leaves; `under_18_volunteer` lapses at the volunteer's 18th birthday (so volunteers need a date of birth too). A lapsed exemption behaves like an expired card under finding 1 and raises a to-do 60 days ahead.
- Admins can't set their own exemption (same rule as today).
- WWCC report gains "Exempt volunteers" with basis, child, declaration date; this matches the Screening Unit's record-keeping spreadsheet.
- Keep the wording generic: "exempt under the WA parent volunteer rule" is fine for every WA club; make the rule set a club setting if a non-WA club ever joins.

## 3. High: nowhere to raise a concern

**Where:** nothing in the app. The check-in note invites a child to write to their coach with no guidance on what happens if they disclose harm (`src/app/check-in.tsx:103`).

Netball Australia's complaints policy (1 Feb 2026) requires every club to appoint a Complaints Manager; the safeguarding policy expects a Child Safety Officer; Netball WA says child abuse and serious criminal matters go to Netball WA and Police immediately and are not to be resolved in the club. National Principle 6 asks for a complaints process children and families can find and use. Today a parent, child or coach who sees something has no path in the app and no name to call, and the club has no record that a concern was raised and what happened to it.

**Fix (the biggest new feature; design in Plan, package D):**
- Club settings: **Safeguarding contacts**: Child Safety Officer and Complaints Manager (members of the club, chosen from approved adults with a current check), plus the fixed external numbers shown to everyone (Police 000, Netball Speak Up 1800 955 900, Safe Sport Hotline 1800 161 361, Kids Helpline 1800 55 1800, Netball WA complaints form link). An admin can't make themselves the only contact.
- **Raise a concern** on the home screen for every role, on the check-in screen, and on every message and injury record ("Report this"). A child-friendly short form: what happened, who, when, can we contact you; optional anonymous. A clear line: "If a child is in danger now, call 000."
- **Concerns register**, visible to the Child Safety Officer, Complaints Manager and admins only, with the person the concern is about excluded from seeing it even if they're an admin. Status: received, referred to Netball WA/Police, under review, closed, with who did what and when, and a prompt on every child-safety concern to refer externally immediately. Export as PDF for an auditor.
- The register doubles as the record Netball WA's "reporting flow chart" and any future Ombudsman WA scheme will ask for.

## 4. High: photos of children's injuries

**Where:** `20261007120000_injuries.sql:169-172`, `src/app/injuries/[id].tsx:372`, Share at `src/app/injuries/[id].tsx:394-465`. Unchanged since the 8 October review (risk 6).

Netball Australia's image rules: written parental consent, context related to netball, not distributed outside the organisation, not kept on personal devices, deleted when no longer needed. A photo of a bruised thigh uploaded by a 15-year-old is seen by every coach of the child, every physio who looks after them, the whole committee and every admin, and any committee member can Share it to their personal OneDrive or email. There is no record of who opened it. The security review (finding 12) has removed the cached copy on the phone, which helps but doesn't change who can take a copy.

**Fix:**
- For athletes under 18: accept **PDF only** by default (letters and reports from a physio or doctor), with wording "Attach the letter or report, not a photo of the injury". If a club wants photos, a club setting turns them on and a photo of a minor can only be uploaded by a verified guardian, who confirms consent on upload.
- **Share** limited to the committee member or admin who is accepting that clearance, for that injury, and only while it's awaiting acceptance; every share recorded (who, when, document) and shown to the athlete's guardians.
- Every document open recorded (finding 10), visible to the guardians.
- Delete documents when the clearance is accepted plus a short period (say 90 days), keeping the record that a document was seen and accepted; this follows "delete when no longer required". Needs Matt's decision because it shortens the current 12-month rule for documents (the injury record itself stays 12 months).

## 5. High: no policies, no consent

**Where:** nothing in the app, `app.json` or the repo.

Apple and Google require a privacy policy URL; the National Principles require documented policies (10); Netball Australia requires written parental consent for images and expects clubs to have a safeguarding policy; the Children's Online Privacy Code baseline expects a child-friendly privacy notice and parental consent for under-15s. Today a parent is linked to their child by an admin and nothing is ever put in front of them to agree to, and a child gives the club health information with no notice of who will read it.

**Fix:**
- Club settings: links to the club's **privacy policy**, **child safeguarding policy** and **code of conduct** (hosted documents; the app only stores URLs). Shown on sign-in, on Join, in **Your details**, and in the stores' listing fields. Ship a plain-English template for each in `docs/` that clubs adapt; the privacy policy template says what is collected about children (name, date of birth, injuries and documents, daily check-ins, goals, attendance, messages), who sees each, and how long it's kept, matching user guide section 11.
- **Consent records**: a `consents` table (member, consented for whom, kind, policy version, given by, given at, withdrawn at). Kinds: app use and data for a child (given by a verified guardian when linked, before the child's record is shown to anyone beyond admins), images of the child, health information (injury records and physio access). A guardian gives consent in the app on their first open after linking; until the data consent exists, the child's injuries and check-ins are visible to the child and guardians only. Withdrawal is one tap and recorded.
- Child-friendly notice: a short "who can see what you write here" line already exists on the check-in; add the same to injury reporting, goals and the join screen for under-18s.
- The under-18 report lists consent status per child.

## 6. High: who is a child is an admin's guess

**Where:** `src/app/admin/[id].tsx:75,587-608`, `src/app/join.tsx`, `is_minor`.

A 14-year-old can sign in with Google, ask to join as an athlete, and nothing asks their age. The admin screen asks for a date of birth, but if the admin leaves it blank the fallback chip sits at "18 or over", so one missed field approves a child as an adult: no guardian, no message copies, no consent, and a coach can message a squad that contains them one-to-one in effect. The 8 October review fixed the "under 17" tick; this is the remaining hole. The security review (finding 9) also notes admins can self-attest their own details.

**Fix:**
- Ask date of birth on **Join** for everyone (self-declared), stored as `declared_date_of_birth`; the admin confirms it (against PlayHQ or ID) into `date_of_birth`. The join screen tells under-18s that a parent or guardian will need to join too, and tells the admin which guardian email the child gave.
- Remove the fallback: an athlete can't be approved without a confirmed date of birth; the "Under 18 / 18 or over" chip goes, and the `under_17` column stays only for old rows (additive, nothing dropped).
- Under-18s who have requested to join but aren't approved see a "Ask your parent or guardian to join" screen with the club's safeguarding contacts.
- To-do: "Athletes with no date of birth" for existing members.
- *Legal advice*: whether the club wants to adopt the Code's under-15 parental-consent rule before any account is created, which would mean a guardian must join first for under-15s. The design above supports it (the child's data is locked until consent) without blocking the sign-up.

## 7. Medium: the check record wouldn't satisfy a Screening Unit or Netball WA audit

**Where:** `admin_set_member_details` stores `wwcc_number` and `wwcc_expires_on`.

The Screening Unit recommends, and Netball WA requires, records of validation: the name on the card, how it was checked (online validation, card sighted), by whom and when, periodic re-validation, employer registration so the Unit notifies the club of changes, and a nominated WWC Registration Officer. The current record can't show any of that. The three-year validity isn't enforced (an admin can type any expiry).

**Fix:**
- Add `wwcc_card_name`, `wwcc_validated_at`, `wwcc_validated_by`, `wwcc_validation_method` (online validation / card sighted / Unit letter), `wwcc_unit_registered_at`; expiry must be within three years of today.
- Club setting: **WWC Registration Officer** (an admin or committee member), shown on the WWCC report.
- To-do: re-validate every card at least yearly (Netball WA's "periodically"), and re-register with the Unit when a card is renewed.
- A **Screening Unit notices** log (date, kind of notice, action taken) under finding 1, and a prompt to notify Netball WA in writing when a Negative or Interim Negative Notice arrives.
- The WWCC report becomes the Screening Unit compliance spreadsheet: season, name as on card, date of birth, role, card number, expiry, status, validation date; exempt volunteers with basis.

## 8. Medium: admins are unscreened

**Where:** `needs_wwcc` leaves out `admin`.

Admins read every child's injury record and document, date of birth, every message and the check-in averages, and can link guardians, change roles and stand people down. Legally an administrator with no contact with children isn't in child-related work, but Netball WA wants a record for committee members and administrators, and most WA club admins are also at training. Treat admins like committee members: a current check or a recorded exemption basis (finding 2), set by another admin.

## 9. Medium: a guardian link rests on one tap and leaves no trail

**Where:** `admin_mark_verified` (`20261008000000_child_safety.sql`), `guardianships`, `admin_save_member`.

"Checked against PlayHQ" records nothing about what was checked. A guardian, once linked, reads a child's health records for years. Other guardians of the same child aren't told when a new one is added (the 8 October review's risk 5 fix was built without this part), the child isn't told, and because each save deletes and re-inserts the links there is no history of who linked or unlinked whom. Separated parents and court orders make this the record a club most needs when challenged.

**Fix:**
- `verification_method` (code in person, PlayHQ guardian email match, ID sighted) and `verification_note` on the profile; the PlayHQ match can be automated when the import includes guardian emails.
- `guardianship_history` (guardian, athlete, linked/unlinked, by whom, when, reason) written by a trigger; the admin screen shows it.
- When a guardian is linked or unlinked: tell the child's other guardians and the child (if 13 or over) by in-app message, naming the guardian.
- An admin who is the guardian of a child can't link or unlink that child's guardians (same spirit as the clearance rules).

## 10. Medium: nobody knows who has read a child's record

**Where:** no log anywhere; the security review's earlier finding 5 ("no audit trail") is still open.

National Principle 8 asks organisations to monitor online interactions with children; Netball Australia asks that one-to-one situations be "identified and recorded". A parent asking "who has seen my daughter's physio letter?" can't be answered.

**Fix:**
- `record_access_log` (who, whose record, kind: injury, document open, document share, check-in detail, goals, consent, date of birth; when). Written by the RPCs that return the detail (`my_injuries`/injury detail, `injury_document_url`, check-in history for a coach, guardian views) and by the storage URL function. Not written for the child's own or their guardians' views.
- Guardians see "Who has viewed [child]'s records" per child; admins see it per member; the under-18 report summarises it.
- Keep the log 7 years (what a dispute or an Ombudsman inquiry would ask for), separate from the data it describes.

## 11. Medium: children's data is kept forever

**Where:** only injuries have a purge (`purge_expired_injuries`).

Daily mood, sleep and stress scores with free-text notes, goals and reflections, attendance and messages for a child are kept with no end date, and keep sitting there after the child leaves. Data minimisation is the first thing the Children's Online Privacy Code and the National Principles ask for.

**Fix (needs Matt's decision on periods, all deletions so this is a data-loss migration under the project rules):** check-ins 24 months after the entry (coaches use trends, not history), goals and reflections 24 months after the fixture, messages 24 months after sending (admins keep a count and sender/recipient records for complaints), attendance 7 years (it's the record of who was with which children), training certificates 7 years, access log 7 years, concerns register permanent. Each purge in the same daily function as injuries, each period a club setting with these defaults, and the privacy policy template states them.

## 12. Medium: parents can't see their child's attendance

**Where:** `20261007130000_attendance.sql`; user guide section 11 "Athletes and guardians don't see attendance".

A parent who drops a 13-year-old at training is entitled to know whether the coach marked them present, and an unexplained absence is a safety signal, not just a selection one. National Principle 3 (families informed). Give guardians read access to their own child's attendance history and absences, and let a guardian submit an absence for their child (the original brief asked for advance absences from athletes; guardians were left out).

## 13. Medium: parents aren't told when something changes

**Where:** guardians receive message copies and nothing else.

A new coach or physio placed in a child's squad is a new adult with access to the child's health records; a committee member sharing the child's document out of the app; a stand-down of the child's coach; a change to the child's roles; a new guardian (finding 9). None of this reaches the parent.

**Fix:** a guardian **activity feed** per child on the home screen, fed by the access log and the admin actions above, with push notifications (through the existing to-do push mirror) for: new adult with access, document shared, guardian linked or unlinked, consent asked for, stand-down affecting the child's group. The wording stays factual and generic ("A new coach, Sam Lee, was added to Lightning Academy").

## 14. Medium: two items from the security review

Both are the security review's to decide, listed here because they are child-safety decisions:

- **Guardianship after 18** (security review finding 4). Message copies stop at 18 because `send_group_message` checks `is_minor`, but every other guardian right is "is there a link", so a parent keeps reading an adult's injuries and check-ins until an admin re-saves the member. Recommendation: make every guardian right test `is_minor` as the message copy does, so it ends on the birthday automatically; tell the athlete and the guardian 30 days ahead (the to-do already counts them); keep the link row for history. Nothing is deleted, so it's an ordinary migration.
- **Differencing check-in averages** (security review finding 5). Recommendation: show the committee and physios squad-level averages only, suppressed below five athletes, and never a team nested inside a squad; coaches of the team already see individuals.

## 15. Low: code of conduct and induction

Netball Australia's Code of Conduct for Community Netball (1 Feb 2026) covers online behaviour and binds coaches, volunteers, parents and players; the 2026 National Integrity Framework expects sports to direct members to education. Record acceptance of the club's code of conduct once a season for every adult role (a tick on first open after the season starts, stored with the version). Add a default integrity training requirement template, "Child Safeguarding in Sport Induction (Sport Integrity Australia)", for coaches, managers, physios and committee each season, so a club turning on integrity training gets it without setting it up.

## 16. Low: grandfathered committee members

PR #80 lets committee members approved before the rule keep access with no check or exemption; the to-do asks forever. Give it a date: a club setting "committee checks required from", default 90 days after the migration, after which finding 1's `cleared_for_children` applies to them too.

## 17. Low: write down the privacy and social-media assessments

The club is probably outside the Privacy Act (turnover) and the app is probably not an age-restricted social media platform (its purpose is administration; messages are club notices with no replies, feeds or profiles). Both should be recorded as decisions with reasons in `docs/` and the privacy policy, because each could change: storing physio notes may make the club a health service provider (*legal advice*), and adding any reply, feed or profile-picture feature would reopen the social-media question. The design rule that follows: **no replies, no feeds, no profile pictures, no following** in this app, ever, for members under 18.

---

## What the app does well (for the auditor's file)

Worth writing into the club's self-assessment, because these are the things an auditor will ask for first:

- Two-deep electronic communication is enforced by the database, not by policy: no direct messages, no replies, guardians copied on everything to and from a minor, admins see all.
- No images of members anywhere except injury proof (finding 4).
- Minority from date of birth on the day, guardians required before approval, guardian verification required before linking.
- Working With Children Checks required before approval for every role that coaches, manages or treats children, committee included.
- Nobody signs off their own or their own child's clearance; a coach who is a parent can't endorse their child.
- Children's health information confined to the child, guardians, coaches and physios; committee sees averages; managers see none.
- Admin to-do list and PDF reports already surface the compliance work.
- Injury records purged 12 months after leaving; shared-document cache fixed in PR #90.
- One Supabase project per club, so one club's children are never in another club's database.

---

## Design and plan

Six packages, each one or two pull requests, all additive migrations unless marked. Ordered by severity and by what each one unblocks. No code until Matt chooses; everything keeps wording generic for any club.

### Package A: Screening that keeps working (findings 1, 2, 7, 8, 16)

**Data.** On `profiles`: `wwcc_card_name`, `wwcc_validated_at`, `wwcc_validated_by`, `wwcc_validation_method`, `wwcc_unit_registered_at`, `wwcc_exemption` (enum), `wwcc_exemption_child_id`, `wwcc_declared_at`, `wwcc_declaration_text`, `stood_down_at`, `stood_down_by`, `stood_down_reason`, `stood_down_note`. New table `screening_notices` (member, kind, received_on, action, recorded_by). Club settings: `wwc_officer_id`, `committee_checks_required_from`, `admins_need_wwcc` (default on).

**Rules.** `needs_wwcc(roles, exemption, …)` replaces today's; `cleared_for_children(profile_id)` is the single gate and is called inside `coaches_athlete`, `can_message_group`, `is_attendance_taker`, `can_view_athlete_injuries`, `physio_looks_after`, `is_committee` and `is_admin` reads of children's data; `admin_save_member` keeps refusing approval without clearance; `admin_stand_down(member, reason, note)` and `admin_lift_stand_down`. Exemptions lapse by date (child's 18th, volunteer's 18th) through the same function, no cron needed.

**Screens.** Member screen: exemption basis picker with the declaration the person must accept on their own device (a to-do for them until accepted), validation fields, Stand down button. Home: a stood-down member sees a plain card saying their club roles are paused and who to contact. Admin to-dos: expiring in 60/30 days, re-validate yearly, exemption lapsing, notices awaiting Netball WA notification. WWCC report: Screening Unit spreadsheet layout plus exempt volunteers, notices and stand-downs.

**Guide.** Sections 1, 10 (Approving members, Reports) and 11.

### Package B: Who is a child, who is a guardian (findings 6, 9, 14a)

**Data.** `profiles.declared_date_of_birth`, `verification_method`, `verification_note`; `guardianship_history` with a trigger on `guardianships`. `is_guardian_of` gains the `is_minor` test; a new `was_guardian_of` keeps read access to historic records the guardian already saw if Matt wants it (default: no).

**Rules.** Join requires date of birth; `admin_save_member` refuses an athlete without a confirmed `date_of_birth`; linking and unlinking notify the child's other guardians and the child (13+); an admin who is a guardian of the child can't change that child's guardians.

**Screens.** Join: date of birth, under-18 wording and guardian email; "Ask your parent or guardian to join" waiting screen. Member screen: history of guardian links; verification method. To-do: no date of birth.

### Package C: Children's records (findings 4, 10, 11, 14b)

**Data.** `record_access_log` (viewer, subject, kind, record_id, at); `document_shares`; club settings `minor_photos_allowed` (default off) and retention periods. The storage URL RPC and the detail RPCs insert log rows. Retention purge extends `purge_expired_injuries` into `purge_expired_records`.

**Rules.** PDF-only uploads for minors unless the club setting is on and the uploader is a verified guardian confirming consent; Share only for the accepting committee member on an injury awaiting acceptance; check-in trend shown at squad level only, five or more athletes.

**Screens.** Injury document viewer shows "Viewed by" to guardians and admins; guardian "Who has viewed" per child; admin per member. Upload wording changes. Retention periods in Club settings with the defaults above.

**Data loss.** Only the new purges (Matt's permission, `data-loss-approved` label, exact statement of what is deleted). Everything else is additive.

### Package D: Safeguarding contacts and concerns (finding 3)

**Data.** Club settings: `child_safety_officer_id`, `complaints_manager_id`, `safeguarding_policy_url`, `complaints_form_url`. Tables `concerns` (raised_by nullable for anonymous, about_member nullable, about_text, happened_on, body, contact_ok, status, created_at), `concern_events` (concern, by, kind: referred_nwa, referred_police, note, status_change, closed; at; note). RLS: only the two officers and admins, minus anyone named in `about_member`; a concern about an officer is visible to the other officer and admins only.

**Screens.** Home card "Raise a concern" for everyone (including guests and pending members, since a parent not yet approved must still be able to report); check-in screen and injury screens link to it; "Report this" on messages. Concerns register for officers with the external referral prompt pinned at the top of every child-safety concern; PDF export. Club settings section "Safeguarding". Fixed external numbers in `src/constants`, with Netball WA's shown when the club is in WA (club setting for state).

**Guide.** New section "Safeguarding and raising a concern" for every role; sections 8 and 10.

### Package E: Policies, consent and acknowledgements (findings 5, 15, 17)

**Data.** Club settings: `privacy_policy_url`, `code_of_conduct_url`, policy versions. `consents` (subject, given_by, kind, policy_version, given_at, withdrawn_at). `acknowledgements` (member, kind: code_of_conduct, season, at). Default integrity training template.

**Rules.** A child's injuries, documents and check-in details are visible only to the child and their guardians until a verified guardian has given data consent; images consent gates photo upload (Package C); code of conduct acknowledgement is a to-do for every adult each season.

**Screens.** Policy links on sign-in, Join, Your details and the store listings. Guardian "Consent for [child]" screen on first open after linking, and under Guardian of. Templates in `docs/policies/` (privacy policy, safeguarding policy, code of conduct) written for any club.

### Package F: Guardian transparency (findings 12, 13)

**Data.** Nothing new beyond Packages B and C; a `guardian_feed(child)` RPC reads the access log, guardianship history, team placements and stand-downs. Push through the existing to-do mirror.

**Rules.** Guardians read their child's attendance and can submit an absence for them.

**Screens.** Home "Guardian of" card expands to attendance, activity feed and consent per child.

### Order and dependencies

1. **D** (concerns and contacts) and **A** (screening): the two High findings an auditor would write up first, independent of each other.
2. **B** (date of birth and guardians): A's parent-volunteer exemption needs the linked child's date of birth, so B's join change should land before A is switched on for exemptions, or in the same release.
3. **E** (policies and consent): needs the club to write its policies, so the templates should go out early even if the consent gate ships later.
4. **C** (records, access log, retention): the access log is needed by F; retention needs Matt's data-loss permission.
5. **F** (guardian feed and attendance): last, because it reads from C.

Each package updates `docs/user-guide.md` and screenshots in the same pull request, keeps migrations additive except where marked, and keeps wording generic across clubs.

### Decisions needed from Matt

1. Which packages to build, and in what order (recommendation: D and A first).
2. Finding 4: PDF-only injury proof for minors (recommended), and whether to delete documents 90 days after acceptance.
3. Finding 11: retention periods for check-ins, goals, messages and attendance (all data-loss).
4. Finding 14: end guardian access at 18 automatically (recommended), and the check-in averages rule.
5. Finding 6 and 17: whether to get legal advice on the Privacy Act health-service question and the under-15 consent rule.
6. Finding 8: require a check or exemption for admins (recommended).

### Not technical, for the club

- Appoint and publish the Child Safety Officer, Complaints Manager and WWC Registration Officer; register with the Screening Unit as an employer and re-register on each renewal.
- Adopt the Netball Australia policies as the club's own, publish a privacy policy and a child safeguarding policy (templates from Package E), and run the CITS child-safe self-assessment yearly, as Netball WA asks.
- Ask the committee to complete the Sport Integrity Australia Child Safeguarding in Sport Induction and record it through integrity training.
- Confirm the operating entity's turnover and whether storing injury and physio records makes the club a health service provider under the Privacy Act (legal advice).
- Keep an eye on the Ombudsman WA Child Safe Standards scheme and the Children's Online Privacy Code (registration due 10 December 2026); both are likely to make Packages D and E formal requirements.

---

## Addendum: what was done (13 October 2026)

Every finding has been addressed in the app. Each one was built as its own pull request in audit order, tested against a local copy of the database, and merged into the app on 12 or 13 October 2026. The user guide (`docs/user-guide.md`, section 12 "Child safety and safeguarding") describes each protection for parents, children, volunteers, committees, admins and the governing body.

| # | Finding | What was done | Pull request |
| --- | --- | --- | --- |
| 1 | Access doesn't end when a check does | A coach's, manager's or physio's rights pause the day their check lapses, and their home screen says so. Admins can stand a person down with a reason; that pauses their roles, removes them from the groups they lead and is kept in a history. Warnings start 60 days before expiry. The checks report lists stand-downs. | #92 |
| 2 | The app demands a card from people who can't get one | Admins can record a **Parent volunteer** (with their child) or **Under-18 volunteer** exemption. The volunteer accepts the WA declaration in the app before their role starts. The exemption ends by itself when the child or volunteer turns 18, or the child leaves or is unlinked. Later work added temporary helpers and the short-term visitor and national event exemptions, with links to the Screening Unit's fact sheets. | #93 (and #102 to #104) |
| 3 | Nowhere to raise a concern | Admins name a Child Safety Officer and a Complaints Manager and add the governing body's contacts and safeguarding policy. Anyone can **Raise a concern**, anonymously if they wish, from home, check-ins, injuries and messages, with 000 and helplines always shown. A concerns register records referrals to Police or the governing body, exports to PDF, and hides a concern from the person it's about. | #94 |
| 4 | Photos of children's injuries | Under 18s attach the letter, as a PDF or a photo confirmed to show the letter. Photos of the injury need an admin to allow them, and then only a verified guardian can add one, with recorded consent. Only the person accepting a clearance can share its documents. Every view and share is recorded. Once the club switches on **Remove old records**, a cleared injury's files are removed 90 days after clearance (or 30, 60 or 180 days) or when its season is archived, keeping the record of each document and who viewed it. | #95, #115 |
| 5 | No policies, no consent | A verified guardian gives, and can withdraw, consent for check-ins and for injury details, kept with the policy version. Until they do, only the child, their guardians and admins see the child's check-ins and injuries. Clubs link their privacy policy, safeguarding policy and code of conduct; templates are in `docs/policies/`. Children are told who reads what they write. | #96 |
| 6 | Who is a child is an admin's guess | Everyone gives a date of birth at Join; an under-18 athlete also gives a guardian's email. An admin checks the date against PlayHQ or ID before approval, and the "18 or over" fallback is gone. Existing athletes without a date are listed for admins. | #97 |
| 7 | The check record wouldn't satisfy an audit | Admins record each card's validation: name on the card, method, who and when, yearly and on renewal, and whether the card is registered with the club. Expiry can't be more than 3 years away. A **Screening Unit notices** log stands the member down on a barring notice and tracks when the governing body was told. The club names a WWC Registration Officer. The checks report follows the Screening Unit's record layout. | #98, #116 |
| 8 | Admins are unscreened | Admins need a current check or an exemption with a reason recorded by another admin. An expired check doesn't pause the admin role, so a club can't lock itself out; it stays on every admin's to-do list and an admin can still be stood down (Matt's decision). | #99 |
| 9 | A guardian link rests on one tap and leaves no trail | Verification records how (code, PlayHQ match, ID sighted) and what was checked. Every link and unlink is kept with who and why. The child's guardians, and the child if 13 or over, are told. An admin can't change their own child's guardians. | #100 |
| 10 | Nobody knows who has read a child's record | Every time someone other than the child or their guardians opens a child's injuries, documents, check-ins, game goals or member record, the app records who, their role, what and when. Guardians and admins can read the list. | #105 |
| 11 | Children's data is kept forever | **Keeping records** in Club settings sets how long each kind of record is kept. Check-ins, game goals and message text are kept 2 years. Attendance, training certificates and record views are kept 7 years, and concerns are never removed. Removal runs nightly once an admin switches on **Remove old records**. Until then, every admin's to-do list says old records are kept forever. | #107, #117 |
| 12 | Parents can't see their child's attendance | Athletes and their guardians see the athlete's own attendance, never anyone else's, and can report an absence. Coaches see who is away. | #109 |
| 13 | Parents aren't told when something changes | A **What's changed** list for each child shows adults joining or leaving the child's groups, guardian changes, consents and documents shared out of the app. Push notifications for it wait on the push notification work (#84). | #110 |
| 14 | Two items from the security review | Guardian access ends on the child's 18th birthday. Check-in averages only show once 5 athletes have checked in, and are hidden whenever comparing two groups would reveal one athlete's scores. | #90 |
| 15 | Code of conduct and induction | An optional **Code of conduct each season** switch (off by default, because some clubs collect it through PlayHQ). When it's on, every member accepts the code once a season, with a guardian accepting for a child. One tap adds the Child Safeguarding in Sport Induction to integrity training. | #112 |
| 16 | Grandfathered committee members | **Committee checks required from** sets the date, 90 days after release by default. From then, a committee member with no check or exemption has the role paused. Admins can bring the date forward but never push it back. | #113 |
| 17 | Write down the privacy and social media assessments | `docs/security/privacy-and-social-media-assessment-2026-10-13.md` records both decisions and their reasons. The rule "no replies, direct messages, feeds, profile pictures, following or likes for under 18s" is in `AGENTS.md`, so every change to the app is checked against it. The privacy policy template and the user guide say the same. | #114 |

### Where the build differs from the recommendation

- **Finding 4:** the recommendation was PDF only for under 18s. At Matt's request, a photo of the paper letter is also accepted, with a recorded confirmation that it shows the letter, because families photograph the letter.
- **Findings 4 and 11:** all removal of records is controlled by **Remove old records** and is off until a club's admin switches it on, so nothing was deleted when the changes went live.
- **Finding 8:** an expired admin check doesn't pause the admin role (see the table).
- **Finding 15:** code of conduct acceptance is optional for each club.
- **Finding 6:** the Children's Online Privacy Code's under-15 rule (a guardian joins before the child's account exists) was not adopted. A child's check-ins and injuries stay hidden from coaches until a guardian consents, which covers the data side of the rule.

### Still for the club

- **Get legal advice** on whether keeping injury and physio records makes the club a health service provider under the Privacy Act, and whether to adopt the under-15 consent rule. Until then, treat injury records as covered by the Act. This is highlighted in the user guide's section for committees, boards and admins.
- **Switch on Remove old records** in Club settings once the club is happy with the keep periods.
- **Fill in Safeguarding:** name the Child Safety Officer, Complaints Manager and WWC Registration Officer, and link the privacy policy, safeguarding policy and code of conduct.
- **Outside the app:** register cards with the Screening Unit, adopt the Netball Australia policies, run the CITS self-assessment each year, and have the committee complete the Child Safeguarding in Sport Induction.
