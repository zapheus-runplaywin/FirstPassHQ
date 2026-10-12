# FirstPass HQ security review

Reviewed 12 October 2026 against `main` at `36fcc99` (after PR #89). This covers all 47 migrations (effective final state of every table, policy, grant and function), the two Edge Functions, the app source in `src/`, all five GitHub workflows and the deploy scripts, `app.json` and `eas.json`, the docs that describe dashboard settings, the dependency lockfile, and the full git history. The live Supabase dashboards were not visible, so findings that depend on them are marked **verify**. Child-safety specifics (WWCC rules, guardian audit trail, safeguarding content) are in the separate child-safety audit of the same date; this report points at it rather than repeating it.

> **Fixes:** findings 1, 2, 3, 6, 10, 12 and 13 are fixed in [PR #90](https://github.com/zapheus-runplaywin/thunderapp/pull/90) (draft). Matt agreed to the recommendations for 4 and 5 on 12 October; they are in the same PR. He is checking the dashboard settings in 6 and 16 himself. Everything else is a recommendation.

## Summary

The design holds up well. Every club is its own Supabase project, so there is no shared table that a query could cross; a member of one club holds a session for that club's project only, and the app rebuilds every screen when the club changes. In the database all 33 tables have row level security with no `using (true)` on anything sensitive, every one of the 165 functions is `security definer` with an empty `search_path`, all are closed to signed-out visitors (one exception, now fixed), and every write that matters goes through a function that checks who is calling. Nobody can give themselves a role, approve themselves, read another member's profile, injuries, check-ins or messages, or upload into someone else's folder. No secret has ever been committed, the workflows pin every action to a commit and scope secrets to the steps that use them, and the PlayHQ function validates its input and uses only the public key.

What's left is mostly at the edges: the join flow could be hammered, the sign-in token sat unencrypted on the phone, the purge function answered anyone, a few aggregate and "fallback" paths leak more than intended, guardians keep their access after a child turns 18, and some protection depends on dashboard settings that the repo doesn't record.

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | The club password can be guessed without limit, and repeated join requests spam every admin's phone | Fixed in PR #90 |
| 2 | Medium | The daily injury purge is an open endpoint that runs with the service key | Fixed in PR #90 (needs `PURGE_SECRET` set) |
| 3 | Medium | Sign-in sessions are stored unencrypted on the phone and included in Android backups | Fixed in PR #90 (needs a new build) |
| 4 | Medium | Guardians keep full access to an athlete's health records after the athlete turns 18 | Fixed in PR #90 |
| 5 | Medium | Check-in averages let a committee member or physio work out one athlete's scores | Fixed in PR #90 |
| 6 | Medium (verify) | Email/password sign-up is probably still on in the dashboard; the repo can't tell | Dashboard + partly fixed in PR #90 |
| 7 | Low | Any coach or manager can list and mark attendance for every athlete in the club | Decided: leave as is (agreed rule) |
| 8 | Low | A physio with no team placement sees every athlete's injuries | Fixed in the follow-up PR: Head Physio only |
| 9 | Low | Admins can record their own WWCC and verify themselves | Fixed in the follow-up PR: another admin must |
| 10 | Low | Members could change their name and PlayHQ email after approval | Fixed in PR #90 |
| 11 | Low | Email addresses show in place of a blank name in rosters, boards and nominee lists | Fixed in the follow-up PR: a name is needed to approve |
| 12 | Low | The copy of a shared injury document stays in the phone's cache | Fixed in PR #90 |
| 13 | Low | `is_admin()` was callable by signed-out visitors; `touch_updated_at()` had no `search_path` | Fixed in PR #90 |
| 14 | Low | Anyone can re-bind another member's push token to themselves | Fixed in the follow-up PR: refused while another member holds it |
| 15 | Low | A `firstpasshq://club/CODE` link switches the device to another club with no confirmation | Fixed in the follow-up PR: the app asks first |
| 16 | Low | Over-the-air updates aren't code-signed; no 2FA requirement is written down for the accounts that control the app | Dashboard / docs |
| 17 | Low | Any voter can list every approved member through `award_nominees()` | Fixed in the follow-up PR: awards for each team or squad list only its members |
| 18 | Info | Dependencies: one reachable moderate advisory (deep-link query parsing), the rest are build-time tooling | Watch |

### Earlier findings (7 and 8 October)

| Earlier finding | State today |
|---|---|
| 1 Deleting an account erases injury records | Fixed (PR #32): records kept 12 months after leaving, then purged with their documents |
| 2 Migration check easy to slip past | Fixed: `do` blocks checked, more patterns, and a separate security check (`check-migration-security.py`) with no label to skip it |
| 3 "Google only" depends on the dashboard | Still open: see finding 6 |
| 4 Deploy workflow secrets | Fixed: actions pinned to commits, secrets per step, `permissions: contents: read`, data-loss runs check the actor |
| 5 Admins hold everything, no audit trail | Still open: there is still no `audit_log`; see finding 9 and 16 |
| 6 Join spam and password guessing | Fixed now (finding 1) |
| 7 Any admin can endorse a clearance | Fixed (migration `20261008130000_no_admin_endorsement`) |
| 8 Names and PlayHQ emails editable after approval | Fixed now (finding 10) |
| 9 Session tokens unencrypted | Fixed now (finding 3) |
| 10 Shared documents stay in the cache | Fixed now (finding 12) |
| 11 Coaches and managers can list every athlete | Still open, documented as intended: finding 7 |
| Child-safety 1 to 5 | Built in PR #38 and later (WWCC, date of birth, guardian message copies, note wording, verified guardians) |
| Child-safety 6 and 7 | Covered by the child-safety audit of 12 October |

---

## 1. Medium: club password guessing and admin push spam

**Where:** `submit_join_request` (`supabase/migrations/20261007060000_guardians.sql:168-211`), `admin_set_join_password` (`20261008150000_club_settings_save_where.sql:14`), trigger `profiles_notify_admins_of_join_request` (`20261007090000_push_notifications.sql:104-112`).

Anyone who can sign in (any Google account, or any email if finding 6 applies) can call `submit_join_request` as often as they like. A wrong password simply raised an error, so the password, hashed with pgcrypto's default bcrypt cost of 6 (about 5 ms a try), could be guessed online with no lock-out, and the error told the caller wrong from right. With the right password, or no password set, every call updated `join_requested_at`, and the trigger sent a push to every admin's phone each time, with the caller's chosen name in it.

**Fix (PR #90):** five wrong passwords in a row lock that account out of joining for 15 minutes (`join_password_attempts` table; the function now returns the refusal message instead of raising, because an exception would have rolled the count back). The hash uses cost 10 from the next time the password is set. Admins are notified about a member's request at most once an hour. **Matt:** re-save the club password once after merging so it gets the stronger hash.

## 2. Medium: the injury purge is an open endpoint

**Where:** `supabase/functions/purge-expired-injuries/index.ts:30`, `.github/workflows/purge-expired-injuries.yml:31-33, 93-103`.

The function is deployed with `--no-verify-jwt` and the handler ignored the request entirely, so anyone on the internet could POST to it. It can't delete anything early (the 12-month rule is decided in SQL, and the two functions it calls are granted only to `service_role`), but each call ran two service-role queries and a storage delete with no rate limit, returned how many records it purged, and returned raw database error messages.

**Fix (PR #90):** the function checks the `PURGE_SECRET` function secret against the `x-purge-key` header (constant-time compare), rejects anything but POST, logs counts instead of returning them, and returns a generic error. Until the secret exists it still runs and warns in its logs, so the daily job keeps working. **Matt:** `npx supabase secrets set --project-ref <live-ref> PURGE_SECRET=<long random value>` and add the same value as the GitHub secret `PURGE_SECRET` (docs/environments.md, step 3 of "Point the installed apps at the live project"). Do the same for the test project when convenient.

## 3. Medium: session tokens on the phone

**Where:** `src/lib/supabase.ts:20` (storage: AsyncStorage), `app.json` (no `allowBackup`).

The session, including the long-lived refresh token, was in AsyncStorage: plain files, included in Android device backups. This app holds minors' health records, so a copied backup or a rooted phone shouldn't be enough to sign in as someone.

**Fix (PR #90):** `src/lib/secure-session-store.ts` encrypts the session with AES-256-CTR under a key kept in the keychain (`expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), the pattern Supabase documents. Existing plain sessions are re-saved encrypted on first read, so nobody is signed out. `android.allowBackup` is now false. This adds a native module, so it needs a new build, not an update.

## 4. Medium: guardianship doesn't end at 18

**Where:** `is_guardian_of` (`20261007120000_injuries.sql:77`), used by `can_view_athlete_injuries`, `can_view_check_ins`, `can_view_game_goals`, `can_view_training_of`, `can_report_for`, `can_view_team_goals` and both private storage buckets' policies.

A guardian link is a row in `guardianships` that only an admin re-saving the member removes. "Minor" is worked out from the date of birth on the day (`is_minor`), and message copies already stop at 18 (`send_group_message` checks it). But every other guardian right is just "is there a link", so once an athlete turns 18 their parent keeps reading their injury descriptions and physio letters, daily check-ins with notes, goals and reflections, and can still report injuries and request clearances for them. The admin to-do only counts members "turning 18 in 30 days"; nothing unlinks.

**Fix (PR #90, Matt's choice):** `is_guardian_of` and `my_athletes` now also require the athlete to be a minor, so a parent's access ends on the birthday and the athlete drops off the guardian's home screen; the link row stays until an admin removes it. Matches how message copies already behave. The guide's guardian section says so.

## 5. Medium: check-in averages can be differenced

**Where:** `check_in_trend` (`20261008120000_guest_and_physio_access.sql:312`), `check_in_overview` (`20261009000000_optional_squads.sql:458`).

Committee members and physios are kept away from individual check-ins on purpose (`can_view_check_ins`), and only see averages where at least three athletes checked in. But `check_in_trend` takes any team id, including null for the whole club, and the groups nest. A squad of four and one of its teams of three both pass the threshold; `4 × squad average − 3 × team average` is the fourth athlete's exact sleep, soreness, stress and mood, and the flagged count says whether they scored 2 or under. Day by day, as who checks in changes, the same trick works on most athletes. Averages are rounded to one decimal, which blurs it but not enough with these group sizes.

**Fix (PR #90, Matt's choice):** a shared helper, `check_in_visible_days`, decides per day whether a group's averages show: at least 5 checked in, and the group is hidden on any day a related group that also shows (the club, its squad, or one of its teams) differs from it by 1 to 4 check-ins. Both `check_in_trend` and `check_in_overview` use it, so the two views can't be played against each other. Coaches of a team see individuals anyway, so only the committee and physio views change.

## 6. Medium (verify): email sign-up in the dashboard

**Where:** no `supabase/config.toml`; `README.md:46-49`, `docs/environments.md:20-24`, `docs/new-club-setup.md:28-30` describe turning Google on but never turning Email off; `handle_new_user()` (`20261007000000_init.sql:87-102`).

Supabase enables the Email provider with sign-ups by default. The app only offers Google, but the public key that ships in it also works with `POST /auth/v1/signup`, so anyone could create an account under any email with any name, which `handle_new_user()` turns into a pending profile that admins see in Members and may match to PlayHQ. The 7 October review asked for this to be checked; the docs still don't record the answer.

**Fix:** in every project, **Authentication > Providers > Email** off (or at least "Allow new users to sign up" off and "Confirm email" on), Anonymous and Phone off, and write it into the setup docs. PR #90 adds a backstop: `submit_join_request` refuses accounts whose email isn't confirmed, which stops a fake-email account ever reaching the join queue even if the provider is on with confirmation. Also remove `exp://**` from the live project's redirect URLs (the docs call it optional; it should be required).

## 7. Low: any coach or manager can take attendance for the whole club

**Where:** `can_take_attendance` (`20261009000000_optional_squads.sql:441-455`), `is_attendance_taker` (`20261009110000_multiple_roles.sql:193`), `attendance_roster` (`20261007130000_attendance.sql:378-397`), `can_see_attendance_session` (`attendance.sql:163-181`).

Any approved coach or manager, placed anywhere or nowhere, can call `attendance_roster(<any top-level squad or team>)` or `attendance_roster(null)`, create a session for that group with `save_attendance`, and then see and edit it. This is the agreed "any taker can run whole-squad and club events" rule, so it may be intended; it is the one place in the schema where someone in team A can list and act on team B's athletes. Everyone with those roles holds a WWCC. **Decision (Matt, 12 Oct):** leave as is. Keep it in mind when giving out the manager role.

## 8. Low: an unplaced physio sees every athlete's injuries

**Where:** `physio_looks_after` (`20261012001000_team_physios.sql:44`).

A member with the physio role who isn't placed in any team "keeps looking after every athlete, as before", so adding the role to someone without placing them grants every injury record and document in the club. Documented, but easy to do by accident. **Decision and fix (Matt, 12 Oct):** only the Head Physio sees every athlete; a physio in no squad or team sees nobody until placed or made Head Physio. Physios who are unplaced today lose access when this deploys, so check each club has a Head Physio.

## 9. Low: admins can self-attest

**Where:** `admin_set_member_details` (`20261008000000_child_safety.sql:68`), `admin_mark_verified` (`:105`). `admin_set_wwcc_exemption` already refuses `p_profile_id = auth.uid()`; these two don't.

An admin can type their own WWCC number and expiry and mark themselves "checked against PlayHQ". There is still no audit log of admin actions (earlier finding 5). Suggested: refuse self-verification, and record who set a WWCC (a `wwcc_set_by` column, or an `audit_log` table written by the admin functions, readable by admins and never editable). **Decision and fix (Matt, 12 Oct):** another admin must. An admin can no longer change their own date of birth or card details or verify themselves (the exemption and validation functions already refused it). A one-admin club needs a second admin to record the first admin's check. The audit log is still not built.

## 10. Low: names and PlayHQ emails editable after approval (fixed)

**Where:** `20261007000000_init.sql:142-149`.

The column grant and update policy let an approved member change `full_name` and `playhq_email` directly, and `sender_name` / `author_name` snapshots copy the name into messages and records, so a member could appear as "Club President" on a message. The app never used this path (the join form and Your details go through functions). PR #90 drops the policy and the grant.

## 11. Low: email in place of a blank name

**Where:** `coalesce(nullif(full_name, ''), email)` in `award_nominee_pool`, `attendance_roster`, `attendance_register`, `athlete_attendance_summary`, `check_in_board`, `goal_board`, `message_receipts`, `visible_injuries`, `training_to_review`, `send_group_message` (sender name), `notify_admins_of_join_request`.

Profiles are own-row-only, so these fallbacks are the only way one member's email reaches another. A name is required by the join form, so it only happens for accounts created without one (`handle_new_user` with no metadata) that an admin approves anyway. Suggested: require a name in `admin_save_member` on approval, and fall back to "Member" instead of the email in the non-admin functions.

**Decision and fix (Matt, 12 Oct):** show "Member". The join form already requires a name, and `admin_save_member` now refuses to approve a member with no name, so an approved member always has one and the email fallback can't be reached for them.

## 12. Low: shared document copy in the cache (fixed)

**Where:** `src/lib/injuries.ts:171-178`.

"View or share" downloads the document into the cache for the share sheet and left it there. PR #90 deletes it when the share sheet closes. In-app viewing already keeps the file in memory only (`src/lib/pdf-viewer-html.ts`).

## 13. Low: `is_admin()` and `touch_updated_at()` (fixed)

`is_admin()` was the one function never revoked from `public`/`anon` (it returns false for them, but the repo's own security check expects every function closed). `touch_updated_at()` was the only function without `set search_path`. Both tidied in PR #90.

## 14. Low: push tokens can be re-bound

**Where:** `register_push_token` (`20261007090000_push_notifications.sql:27-47`): `on conflict (token) do update set profile_id = excluded.profile_id`.

Anyone who learns an admin's Expo push token can register it as their own, so that admin silently stops getting join-request pushes. Tokens aren't secret by design, and nothing is leaked (non-admins receive nothing). The re-bind exists so a phone that changes hands moves to the new member. Suggested: only move a token when the previous owner's session is gone, or just delete the old row on sign-out (already done) and refuse a token that belongs to a different, still-approved member.

**Decision and fix (Matt, 12 Oct):** refuse it while another member holds it. Signing out releases it.

## 15. Low: club links switch the device silently

**Where:** `src/app/club/[code].tsx`.

Opening `firstpasshq://club/CODE` picks that club and carries on to sign-in or home with no confirmation. Only codes the build knows work, and each club has its own session, so no data crosses; but a link in a message can move someone's app onto another club's sign-in screen, which is confusing at best. Suggested: when the device already has a club chosen and the link names a different one, show "Switch to <club>?" first.

**Decision and fix (Matt, 12 Oct):** the app asks first when the phone already has a club; a first-time open goes straight in.

## 16. Low: updates, builds and the accounts behind them

- **OTA updates aren't code-signed** (`app.json` has `updates.url` but no `codeSigningCertificate`). Anyone with the `EXPO_TOKEN` or access to the Expo project can push JavaScript to every installed app. EAS Update code signing is a one-time setup worth doing for an app with medical documents.
- **No 2FA requirement is written down** for the Supabase organisation, expo.dev, GitHub, and the Apple and Google developer accounts. Those hold the service key, database password, signing keys and the update channel. Add it to the one-time setup docs and turn on branch protection for `main` (the migration check runs but nothing requires it to pass before merging).
- `docs/new-club-setup.md` asks other clubs to invite you to their Supabase organisation; it should say to use the Developer role, not Owner, and to remove it when done.

## 17. Low: `award_nominees()` lists every member

**Where:** `20261008010000_fixtures_and_awards.sql:539-553` → `award_nominee_pool` (`20261008160000_award_age_limit.sql:30-60`).

For an award whose nominees are "members" and whose voters include everyone, every approved member's name is returned to every voter. With a min or max age set, who is in and out also says whether their date of birth falls in that window. Names in a club context are low risk, and admins choose the thresholds; mentioned because it is the broadest member listing in the schema. 

**Decision and fix (Matt, 12 Oct):** the restriction comes from the award, not from the name risk. An award with a winner for each squad or team is voted on, and its "any member" nominees are drawn from, that squad or team only. Club awards stay open to everyone or to the roles chosen.

## 18. Info: dependencies

`npm audit` reports 31 entries from four advisories. Three are build-time only and not reachable on a phone or in the functions: `node-forge` 1.4.0 (via `expo-updates` code-signing tooling and `@expo/cli`), `braces` 3.0.3 (Metro), `uuid` 7.0.3 (config plugins). One is reachable: `decode-uri-component` 0.2.2 via `expo-router`'s `query-string`, where a malformed deep-link query (`firstpasshq://…?x=%…`) can hang the app; client-side only, no data exposure. None has a fix in the SDK 57 line yet; run `npx expo install --fix` when Expo ships patch releases. `@supabase/supabase-js` 2.117.2, `react-native-webview` 13.16.1 and `ical.js` 2.2.1 have no advisories.

---

## What's done well

- **Club separation is structural.** One Supabase project per club; the app holds a client per club keyed by code (`src/lib/supabase.ts`), sessions are stored under the project's own key, and `AuthProvider` is remounted with the club code so no screen, session or cached look survives a switch. Caches are keyed by club (`club-profile:<CODE>`). The only shared thing across clubs is the device's Expo push token, which is registered separately in each club's database. There is no query, function or bucket that could reach another club.
- **The database is closed by default.** 33 tables, all with RLS; no `using (true)` except on `teams`; `club_settings`, `verification_codes`, `push_tokens` and the guardian links have no client write path at all. 165 functions, all `security definer` with `set search_path = ''`, all revoked from `public` and `anon`; helpers that shouldn't be called directly are revoked from `authenticated` too, and the purge functions are `service_role` only. No dynamic SQL anywhere. Role parameters are the `app_role` enum, never free text.
- **Authorization is in the function, not the client.** Join requests can't ask for admin; `admin_save_member` refuses self-demotion, unverified guardians, minors without a guardian, coaches without a WWCC, and partner-role revival; verification codes are six digits from `gen_random_bytes` with a week's expiry; clearances need two different people, never the athlete, their guardian or the endorser; message recipients are resolved server-side and read receipts can only be set on your own row; ballots are one per slot and hidden from everyone but admins; certificate reviewers can't be the owner or their guardian.
- **Storage is tight.** Private buckets accept only PDF and images up to 10 MB, under a `<member>/<uuid>/` path that the policy ties to an injury or member the caller may act for; files can't be overwritten or deleted by any client; viewing goes through 60-second signed links; the in-app PDF viewer is a pinned PDF.js with subresource integrity, in a WebView with no save or print controls.
- **Sign-in is sound.** Google OAuth with PKCE and a SHA-256 challenge from a secure random source (`src/lib/crypto-polyfill.ts`), the redirect scheme matches the docs, and `detectSessionInUrl` is off so a crafted `firstpasshq://auth-callback` link does nothing.
- **The PlayHQ function** verifies the JWT, checks `is_admin()` with the caller's token and the public key, validates `tenant` and `seasonCode` with regexes, passes them as GraphQL variables to a fixed host, and never returns a secret.
- **Workflows** pin every action to a commit, grant `contents: read` only, give each secret to the steps that use it, run the test project before live, and refuse "Allow data loss" from anyone but Matt. `publish-update.sh` proves the bundle points at the live project and contains no test club before publishing. No secret, key or real project reference has ever been committed; `.gitignore` covers keystores and certificates; the sample data uses `@example.com` and refuses to run on a database with real accounts.
- **Logging** redacts personal keys and never writes tokens; links from calendars and training courses are limited to `http(s)`; CSV exports escape formulas; push payloads are built with `jsonb_build_object`.

## Checklist for Matt

1. Review and merge [PR #90](https://github.com/zapheus-runplaywin/thunderapp/pull/90), then make a new build (new native module).
2. Set `PURGE_SECRET` on the live function and in GitHub secrets (finding 2); re-save the club password (finding 1).
3. In each Supabase project: Email provider off (or sign-ups off), Anonymous and Phone off, `exp://**` removed from the live project's redirect URLs (finding 6).
4. Guardians at 18 (finding 4) and the check-in average rule (finding 5) are in PR #90 as agreed.
5. 2FA on the Supabase, Expo, GitHub, Apple and Google accounts; branch protection on `main`; EAS Update code signing (finding 16).
6. Optional follow-ups: audit log and admin self-attest guards (9), "Member" instead of email fallbacks (11), push token re-bind (14), club-link confirmation (15), nominee lists (17).
