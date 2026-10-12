# Thunder app security review

Reviewed 7 October 2026 against `main` at `eb24d0b` (after PR #29, attendance). This covers all 14 migrations, the app source in `src/`, both GitHub workflows, the deploy and check scripts, and the full git history. The live Supabase dashboard settings were not visible to the review, so findings that depend on them are marked **verify**.

> **Update 7 Oct:** findings 1, 2 and 4 are fixed in [PR #32](https://github.com/zapheus-runplaywin/thunderapp/pull/32). Matt chose to keep injury records for 12 months after someone leaves.

## Summary

The database is in good shape. Every table has row level security, every privileged function sets an empty `search_path` and is closed to anonymous callers, members can't change their own role, and injury documents sit in a private bucket that can't be edited after upload. Nothing secret has ever been committed.

The real risks are around the edges: what happens to health records when someone deletes their account, how much the migration safety check actually catches, and settings that live in the Supabase dashboard rather than the repo.

| # | Severity | Finding |
|---|---|---|
| 1 | High | Deleting an account erases injury and attendance records and leaves health documents orphaned in storage |
| 2 | High | The migration safety check misses several ways to lose data, and checks nothing about security |
| 3 | Medium (verify) | "Google only" sign-in depends on dashboard settings that aren't recorded anywhere |
| 4 | Medium | The deploy workflow exposes an account-wide Supabase token to a third-party action, and "Allow data loss" isn't limited to Matt |
| 5 | Medium | Admin accounts hold everything, with one factor and no audit trail |
| 6 | Low | Join requests can be repeated to spam admins' phones, and the club password can be guessed without limit |
| 7 | Low | Any admin can endorse a clearance, skipping the athlete's coach |
| 8 | Low | Members can rename themselves and change their PlayHQ email after approval |
| 9 | Low | Sign-in tokens are stored unencrypted on the phone |
| 10 | Low | Shared injury documents stay in the phone's cache |
| 11 | Low | Any coach or manager can list every athlete in the club, with emails for those who have no name |

---

## 1. High: deleting an account erases governance records and orphans health documents

**Where:** `supabase/migrations/20261007120000_injuries.sql:103` (`athlete_id ... on delete cascade`), `:130`; `supabase/migrations/20261007130000_attendance.sql:40`; `supabase/migrations/20261007110000_delete_members.sql:33,62-77`.

`delete_my_account()` lets any member delete themselves, and `admin_delete_member()` lets an admin do it. Both delete the `auth.users` row, which cascades through `profiles` to `injuries`, `injury_updates` and `attendance_marks`. So an athlete (or an admin by mistake) can wipe the whole injury history, including the two sign-offs that the club wanted kept "as a record that can't be altered".

The proof documents themselves are not deleted, because `storage.objects` has no link to `profiles`. Once the injury row is gone, `injury_document_injury()` returns null, so nobody can see or remove those files from the app. They stay in the bucket indefinitely: private medical letters, often about minors, with no owner and no way to find them except the Supabase dashboard.

**Why it matters:** both directions are a problem. The club loses the clearance record it needs for governance, and it keeps health data it can no longer account for, which conflicts with Australian Privacy Principle 11 (destroy or de-identify personal information no longer needed) and with Apple's rule that in-app account deletion deletes the person's data.

**Fix (needs Matt's decision on policy):**
- Decide what the club keeps when someone leaves. A common answer: keep injury and clearance records for a set period (for example 7 years for minors' incident records, per the club's insurer or state sport body), de-identified or with the name kept as text, then purge.
- Change the foreign keys from `on delete cascade` to `on delete set null` (with the athlete's name kept as text, like `sender_name` on messages) in a new migration. This is additive: no rows are lost.
- When records are finally purged, delete the matching files under `<athlete>/` in `injury-documents` in the same step (a Supabase Edge Function or a scheduled job using the storage API).

## 2. High: the migration safety check is easy to slip past

**Where:** `scripts/check-migrations.py:14-36`, `.github/workflows/check-migrations.yml`, `.github/workflows/deploy-migrations.yml`.

Migrations run on the live database as the `postgres` superuser the moment they merge. The only automatic guard is `check-migrations.py`. I ran it against this file and it passed everything:

```sql
do $$ begin delete from public.injuries; end $$;          -- skipped: $$ bodies are ignored
update only public.profiles set role = 'guest';           -- "update only" isn't matched
alter table public.injuries disable row level security;   -- not checked at all
grant all on public.injuries to anon;                     -- not checked at all
drop extension pg_net cascade;                            -- "drop extension" isn't matched
```

Result: `No statements that can lose data.`

The `$$` skip exists so that deletes inside functions don't trip the check, but `do $$ ... $$` blocks run immediately, and they're the natural way to write a one-off backfill. Also missed: `insert ... on conflict do update` (overwrites rows), `alter type ... rename value`, and dynamic `execute '...'`.

The check also looks only for data loss. Nothing stops a migration from turning off row level security, granting tables to `anon`, adding a `using (true)` policy on a private table, or creating a `security definer` function without `set search_path` or without revoking it from `anon`. Those are the mistakes that would expose injury data.

**Fix:**
- Treat `do` blocks as top-level statements (strip only `$$` bodies that follow `as` in `create function`/`create procedure`), and add patterns for `update only`, `on conflict ... do update`, `drop extension`, `rename value`, and `execute`.
- Add a second check for security: every `create table` in `public` must be followed by `enable row level security`; flag `disable row level security`, `grant ... to anon`, `force row level security` removal, and any `security definer` function missing `set search_path` or a `revoke ... from public, anon`. Running `supabase db lint` against the fresh database the CI job already starts would catch more.
- Turn on branch protection for `main` so "Check migrations" must pass before merging.

## 3. Medium (verify): "Google only" depends on dashboard settings

**Where:** no `supabase/config.toml` in the repo; `supabase/migrations/20261007000000_init.sql:87-102`; `src/app/admin/[id].tsx:252`.

The app only offers Google, but Supabase also accepts sign-ups straight to its API with the public key that ships in the app. Whether that works depends on dashboard settings. `handle_new_user()` copies whatever email the new account has into `profiles.email`, and the admin screen shows it as "Sign-in email", which admins use to match people to PlayHQ.

Please check in **Authentication > Providers** and **Authentication > Settings**:
- **Email** provider: turn it off, or at least keep "Confirm email" on. With email sign-up on and confirmation off, anyone can create an account under a real athlete's or parent's email address and it will look genuine to an admin.
- **Anonymous sign-ins**: off. Anonymous users get the same `authenticated` role as members.
- **Phone** provider: off.
- **URL Configuration**: the Site URL is currently the Expo Go address `exp://192.168.4.144:8081/--/auth-callback` (set for testing). Change it to `thunderapp://auth-callback` before release, and keep the Redirect URLs list to exact addresses rather than wildcards.

Sign-in itself is done well: PKCE with a SHA-256 challenge from a secure random source (`src/lib/crypto-polyfill.ts`), so another app claiming the `thunderapp://` scheme can't use an intercepted code.

**Fix:** once confirmed, record these settings in a `supabase/config.toml` (or a README checklist) so they're reviewed with code. Optionally make `handle_new_user()` store the email only when `email_confirmed_at` is set.

## 4. Medium: the deploy workflow's secrets

**Where:** `.github/workflows/deploy-migrations.yml:26-38`.

- `SUPABASE_ACCESS_TOKEN` is a personal access token, which can manage every project in Matt's Supabase account, not just this one. It's set as a job-level environment variable, so every step can read it, including the third-party `supabase/setup-cli@v3` action, which is pinned to a moving tag rather than a commit. If that action were ever compromised, it would get the token and the database password.
- There's no `permissions:` block, so the job's GitHub token gets the repository default.
- "Allow data loss (Matt only)" is enforced only by the label in the description. Anyone who can run workflows can tick it. Today Matt is the only collaborator, but the Claude GitHub app can also act on the repo.

**Fix:** pin `supabase/setup-cli` to a full commit SHA; move the three secrets from `jobs.deploy.env` onto the two steps that need them; add `permissions: contents: read`; make data-loss runs check that Matt started them (required reviewers on environments need a paid GitHub plan for private repositories). If Supabase offers a project-scoped token or a database-URL-only deploy (`supabase db push --db-url`), use that instead of the account token.

## 5. Medium: admin accounts are the keys to everything

**Where:** `public.is_admin()` (`20261007000000_init.sql:74-85`) and every function that checks it.

An admin can read every injury, every proof document and every message, change any member's role, and delete accounts. An admin is a Google account and nothing else. There is also no record of who changed a member's role or status, or who deleted someone: `admin_save_member()` and `admin_delete_member()` leave no trace.

**Fix:** require 2-Step Verification on every admin and committee Google account (and turn on MFA for the Supabase and GitHub accounts). Keep the number of admins small. Add an `audit_log` table written by `admin_save_member`, `admin_delete_member`, `admin_set_join_password` and the clearance functions, readable by admins and never editable.

## 6. Low: join-request spam and password guessing

**Where:** `20261007060000_guardians.sql:168-211` (`submit_join_request`), `20261007090000_push_notifications.sql:104-112`.

A pending member can call `submit_join_request` over and over. Each call updates `join_requested_at`, and each update sends a push to every admin's phone. If no club password is set, anyone with a Google account can do this. The club password itself can be guessed online without limit (bcrypt at the default cost), although passing it only gets someone into the queue for an admin to approve.

**Fix:** only notify when the status changes to pending or when the last request was more than a day ago; count failed password attempts per member and lock after a handful.

## 7. Low: admins can endorse clearances that belong to the coach

**Where:** `20261007120000_injuries.sql:520-521`.

The comment says admins can endorse "for athletes who have no coach yet", but the check is `coaches_athlete(...) or is_admin()`, so any admin can endorse any clearance. Two admins can then clear an athlete without their coach ever seeing it. Two different people still sign, so the two-person rule holds, but the coach step can be skipped.

**Fix:** allow the admin path only when the athlete has no current coach, matching the `waiting_for_me` logic in `visible_injuries()` (`:664-670`).

## 8. Low: names and PlayHQ emails can change after approval

**Where:** `20261007000000_init.sql:148-149`.

Approved members can still update `full_name` and `playhq_email` directly. A member could rename themselves to look like a coach or committee member; that name is copied into injury histories and attendance records. When the planned PlayHQ CSV matching arrives, an editable `playhq_email` would also let someone claim another person's registration after approval.

**Fix:** let members edit these only while pending, or reset `verified_at` and flag the change for an admin when they do.

## 9. Low: sign-in tokens are stored unencrypted

**Where:** `src/lib/supabase.ts:20`.

The session (including the long-lived refresh token) is in AsyncStorage, which is plain files on the phone and can be included in Android device backups. This is Supabase's default suggestion, so it's common, but this app holds minors' health data.

**Fix:** store the session encrypted with `expo-secure-store` (Supabase's "LargeSecureStore" pattern: an AES key in SecureStore, the encrypted session in AsyncStorage), and set `android.allowBackup: false` in `app.json`.

## 10. Low: shared documents stay in the cache

**Where:** `src/lib/injuries.ts:151-161`.

"View or share" downloads the proof document into the app's cache and leaves it there. The signed link only lasts 60 seconds, which is good, but the copy on the phone stays until the system clears the cache.

**Fix:** delete the cached file after `Sharing.shareAsync` returns, and clear the cache on sign-out.

## 11. Low: coaches and managers can list every athlete

**Where:** `20261007130000_attendance.sql:78-97` (`is_attendance_taker`), `:378-397` (`attendance_roster`).

Anyone with the coach or manager role, even one not attached to a squad, can call `attendance_roster(null)` and get every approved athlete in the club, falling back to their email address when no name is set. This follows the agreed rule that any coach can take whole-club attendance, so it may be intended. If so, drop the email fallback so addresses aren't shown to people who otherwise can't see them.

---

## What's done well

- Row level security is on for all 14 tables, and every write goes through a function that checks the caller.
- All 44 `security definer` functions use `set search_path = ''`, and execute rights are revoked from `public` and `anon`. Internal helpers (`delete_member_now`, `injury_document_injury`, `check_injury_document`) are closed to signed-in users too.
- Members can only update their own `full_name` and `playhq_email`; role and status changes go through `admin_save_member()`, which also stops an admin removing their own access and requested roles can never be `admin`.
- Injury documents are in a private bucket with type and size limits, reachable only through 60-second signed links, with no update or delete policies, and paths are checked against the injury before they're attached.
- Coaches see injuries only for athletes in their own current squads and teams; managers don't see them; guardians see only the athletes linked to them by an admin.
- The CSV export escapes values that a spreadsheet would run as formulas.
- Links in calendar events open only `http` and `https` addresses.
- Push messages are built with `jsonb_build_object`, so names can't break the payload.
- No keys, passwords or tokens appear anywhere in the git history; `.env` is ignored and only the public key is used in the app.
