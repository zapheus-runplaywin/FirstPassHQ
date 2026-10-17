# Thunder app child-safety review

Reviewed 8 October 2026 against `main` at `e1d1401` (after PR #37, check-in overview). This looks at how the app protects athletes under 18: who can contact them, who can see their information, and how guardians are linked. It complements the [security review](security-review-2026-10-07.md).

## Summary

The app already avoids the biggest child-safety risks in club apps:

- **No private messaging.** Adults can only message whole squads, teams, roles or the club (`send_group_message`, `20261007100000_group_messages.sql:235`). There are no one-to-one chats and no replies, so no adult can talk privately with a child in the app.
- **Admins can read every message**, so the club can review what is sent to children.
- **No photos, profile pictures, phone numbers or addresses.** Members can't read each other's profiles; rosters show names and roles only (`team_roster`).
- **Children's sensitive records stay small.** Injuries and check-ins are limited to the athlete, their guardians and their coaches. Admins and the committee see check-in averages, not individuals (`20261007181000_check_in_overview.sql:18`).
- **Accountability buddies are out of the first release**, which avoids adult-junior pairing.

The gaps are in who counts as a child, how guardians are checked and kept informed, and whether adults with access to children have a Working With Children Check.

| # | Risk | Severity |
|---|---|---|
| 1 | Adults who can see or message children have no Working With Children Check recorded | High |
| 2 | Being a minor is a manual "Under 17" tick: 17-year-olds get no guardian, and a child can be approved with no guardian at all | High |
| 3 | Guardians don't automatically see messages sent to their child | Medium |
| 4 | The check-in note says it's for the coach, but guardians read it too | Medium |
| 5 | A guardian can be linked to a child without being verified | Medium |
| 6 | Injury proof can be photos of a child's body, shared on with no record of who opened it | Medium |
| 7 | Squad calendars show where and when children train to every squad member | Low |

---

## 1. High: no Working With Children Check for adults with access to children

Coaches see children's injuries, daily mood and stress scores and notes, and message their squads. Managers take attendance and message squads. The committee and admins see children's injury records and proof documents.

In Western Australia, people who coach, manage or volunteer with children in a sports club need a valid Working With Children Check. Nothing in the app records one, and an admin can give someone the coach or manager role without it (`admin_save_member`, `20261007170000_seasons.sql:20`).

**Fix:** add WWCC number and expiry date to profiles, admin-only. `admin_save_member` refuses the coach and manager roles (and placing coaches or managers in a squad that has under-18 athletes) without a current check. Admins get a to-do item 30 days before a check expires, and on expiry the person loses access until it's renewed.

## 2. High: who counts as a child is a manual tick

**Where:** `profiles.under_17` (`20261007060000_guardians.sql:11`), set by the "Under 17 / 17 or over" choice in `src/app/admin/[id].tsx:342`.

- Anyone under 18 is a child, but the app only has guardians for under-17s. A 17-year-old is treated as an adult, with no guardian link.
- The tick defaults to "17 or over". If an admin forgets it, a 12-year-old has no guardian oversight.
- Nothing updates it as children get older, and nothing requires a guardian. An admin can approve an under-17 athlete with no guardian linked.
- Anyone can sign in with Google and ask to join as an athlete, so a child can start using the app before a parent knows.

**Fix:** store a date of birth (from the PlayHQ extract where possible). Derive "minor" as under 18 on the day, rather than a tick. `admin_save_member` refuses to approve a minor athlete until at least one verified guardian is linked. When a minor turns 18, admins are told, and the guardian links end unless renewed.

## 3. Medium: guardians don't see messages sent to their child

**Where:** `send_group_message` recipients (`20261007100000_group_messages.sql:295-307`).

A guardian only gets squad messages if an admin also places them in the squad. Messages to "everyone with the Athlete role" never reach guardians. Child-safe sport guidance is that parents are copied on communications to their children.

**Fix:** when a message goes to a minor, also send it to each of their guardians. Make sure nobody gets it twice. Show the guardian which child it was for.

## 4. Medium: check-in notes reach guardians without the child knowing

**Where:** the note field is labelled "Anything your coach should know?" (`src/app/check-in.tsx:102`), but `can_view_check_ins` also lets guardians read it (`20261007181000_check_in_overview.sql:18-29`).

A child who writes something meant for their coach (including a disclosure about home) may have it read by a parent. There's also no guidance for a coach who reads something worrying.

**Fix (needs Matt's decision):** either make notes visible to coaches only (guardians still see the scores), or keep guardian access and change the label to say who reads it. Separately, add the club's safeguarding contact to the check-in screen, and give coaches a short "what to do if a child tells you something worrying" note.

## 5. Medium: guardians are linked without verification

**Where:** `admin_save_member` accepts any approved member with the Guardian role as a guardian (`20261007170000_seasons.sql:54-62`).

The in-person code check (`admin_verify_member`) and the PlayHQ email aren't required. Once linked, a guardian sees the child's injuries, check-ins, squad calendar (training times and places) and squad rosters. Other guardians of the same child aren't told when someone new is linked.

**Fix:** only allow linking a guardian whose `verified_at` is set or whose PlayHQ email matches the child's PlayHQ registration. Tell existing guardians when a new guardian is linked, and keep a record of who linked whom.

## 6. Medium: photos of children's injuries

**Where:** the `injury-documents` bucket accepts JPEG, PNG and HEIC (`20261007120000_injuries.sql:246-250`); "View or share" opens the share sheet (`src/lib/injuries.ts:151`).

Proof meant to be a physio letter can be a photo of a child's body. It's visible to their coaches, the whole committee and admins. Anyone of those can save or forward it, and nothing records who opened it.

**Fix:** ask for letters, not photos of the injury (wording on the upload screen). Consider PDF-only for minors. Record each document view, and limit committee access to the member doing the sign-off.

## 7. Low: squad calendars show training times and places

Every approved squad member, including guardians of other children, sees when and where the squad trains. That's normal for a club and needed for the app to work. It's a reason to keep squad membership tight: remove people promptly when they leave (season rollover does this), and only approve guardians who are verified (risk 5).

---

## Not technical, but needed

- A child safeguarding policy and a named Child Safety Officer, linked from the app (sign-in and Help). Matching the National Principles for Child Safe Organisations, and Play by the Rules templates, is the usual baseline for Australian clubs.
- Guardian consent recorded when a minor joins, including consent for injury and check-in data to be stored.
- A privacy policy that says what children's data is kept, who sees it and for how long. The 12-month injury retention is already decided.
