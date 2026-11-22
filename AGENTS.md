This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

Building a new FirstPass app, or changing how sign-in, club lookup or access works across products? Follow `docs/new-app-conventions.md`, the one copy of the conventions guideline for every FirstPass repo.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npm test                    # Jest unit tests
scripts/run-sql-tests.sh    # database tests (needs a local Postgres 16, see "Tests")
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint, typecheck and the tests before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

`.easignore` decides what a build copies up to Expo, and EAS reads it instead of `.gitignore`: repeat every new `.gitignore` line in it, and keep `.git` and `/docs` in it so builds stay small (`scripts/test-build-upload.py`; `docs/beta-builds.md`, "What goes up to Expo").

Every EAS build first runs `scripts/check-build-settings.js` (the `eas-build-pre-install` script in `package.json`). It stops a build whose EAS environment lacks the live club's address and key, or has a wrong one: an app built without them stops the moment it opens, and the build stays green. It runs before packages are installed, so keep it to Node's own modules, and keep it in the upload (`scripts/test-check-build-settings.py`; `docs/beta-builds.md`, "What a build checks first").

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Database migrations (Supabase)

RULE: migrations must be safe to run on the production database and must never throw away data without Matt's explicit permission.

- Migrations are additive by default: new tables, new nullable columns or columns with defaults, new functions, new policies.
- Every new table in `public` grants its own access in the migration that creates it, next to `enable row level security` and its policies. Since 30 October 2026 Supabase gives new tables no access at all, so a table nobody grants can't be reached from the app. Grant `authenticated` what the app needs (usually `select, insert, update, delete`; never `truncate`), `service_role` `all`, and never `anon`; grant `usage` on the sequence of any `serial` column to the same roles (prefer `generated always as identity`, which needs no sequence grant); or `revoke all ... from public, anon, authenticated` when the app reaches the table only through functions. `scripts/check-migration-security.py` refuses a new table or sequence that no grant or revoke names, and `supabase/tests/table-grants.sql` lists the tables reached only through functions.
- Never write any of these without Matt saying yes to that specific change first: `drop table`, `drop column`, `drop schema`, `truncate`, a `delete` or `update` that removes or overwrites existing rows, or a column type change that can lose values.
- When a change needs one of those, move or copy the data first, say in the PR exactly what would be lost, and wait for permission before merging.
- Never edit a migration that has already been merged. Fix things with a new migration.
- Give every migration its own version number (the digits before the first `_`): check main and every open pull request first. "Check migrations" stops a version that main or another open pull request already uses (`scripts/check-migration-clashes.py`), because two files with one number stop every deploy after them (#246 and #247, 19 November 2026).
- Write migrations so they can be re-run or fail cleanly: run them in one transaction, and use `if not exists` / `create or replace` where it fits.
- Test every migration against a local Postgres loaded with realistic data before opening the PR, and confirm row counts are unchanged: `scripts/check-row-counts.sh` does this on the sample data, and "Check migrations" runs it on every pull request. Add or update its tests in `supabase/tests/` (see "Tests").
- Migrations deploy automatically: `.github/workflows/deploy-migrations.yml` runs `supabase db push` after a merge to main. It and the pull request check run `scripts/check-migrations.py`, which stops anything that can lose data.
- Only Matt gives permission for data loss: he adds the `data-loss-approved` label to the PR before merging it. After the merge, the deploy goes ahead when `scripts/check-data-loss-approval.py` confirms Matt added that label to the PR that added each flagged migration and it was still there when the PR merged. Otherwise he runs "Deploy migrations" by hand with "Allow data loss" ticked. Never add that label, tick that box, or weaken either check yourself.

## Tests

RULE: every change includes tests that cover it well enough to make a strong regression suite, and CI runs them (Matt, 2026-10-18). A failure should show on the branch, before merge.

The test strategy, layers and the kinds of member every access test considers are in `docs/testing-strategy.md`. Role-based access is the priority: a new access rule is tested for every kind of member, both ways.

- The "Tests" workflow runs on every push to every branch: lint, typecheck, Jest (`npm test`, with a coverage floor in `package.json` that may only go up), the database tests (`scripts/run-sql-tests.sh`) and the browser smoke tests; keep `scripts/test-workflow-triggers.py` passing. Tests whose first line is `-- Manual test` (the 200-member club in `large-club.sql` and two saves at once in `concurrency.sql`) are skipped there and run by hand: `scripts/run-sql-tests.sh large-club concurrency`, or the "Scale tests" workflow. Run them before merging a change to the access rules or to a save function they cover. Never make that workflow run on its own without Matt's yes.
- App logic goes in tests next to it, such as `src/lib/__tests__/<module>.test.ts`. Pin today's date in any test that depends on it; CI runs in UTC.
- Database changes get a file in `supabase/tests/`, named for the feature: who may call each function and who is refused, the rows it changes, and the child-safety and visibility rules. Copy the PASS/FAIL style of `record-access.sql`, and catch expected errors with `pg_temp.fails`, because any `ERROR` fails the run. Add sample people to `supabase/tests/setup/seed-members.sql` only when no existing one fits, and keep the existing ones working.
- Run them locally against Postgres 16: `PGHOST=localhost PGUSER=postgres PGPASSWORD=... scripts/run-sql-tests.sh [name ...]`.
- A change to the child-safety and access rules covered by the mutation tests (`mutate` in `stryker.config.json`) runs `npm run test:mutation` first (locally, or the "Mutation tests" workflow by hand) and reaches 95% or more. Never make that workflow run on its own (on push, pull request or a schedule) without Matt's yes: Actions minutes are limited.
- When a change alters a rule a test checks, update that test in the same pull request and say in the pull request which expectations changed and why. Never skip, delete or weaken a test to get green.
- The "Security audit" workflow (`scripts/check-cves.py`) checks npm packages for known vulnerabilities after every merge to main, weekly, and on pull requests that change packages. It fails on any high or critical advisory not in `.github/known-vulnerabilities.json`. Only add an advisory there when no fixed release exists, with the reason it can wait, and remove it once a fix ships.

## Supabase CLI version

RULE: always run the newest Supabase CLI release (Matt, 2026-10-15).

- The workflows pin the CLI with `version:` on each `supabase/setup-cli` step (Deploy migrations, PlayHQ function, Purge expired injuries, Apple revoke function, Game stats function, Reset demo club). When a newer release is out (the CLI prints "A new version of Supabase CLI is available", or check https://github.com/supabase/cli/releases), bump every pin to it in one pull request.
- `scripts/deploy-migrations.sh` reads the JSON from `supabase db push --dry-run --output-format json`. Before bumping, run that dry run with the new version against a local Postgres and confirm it still lists `migrations`.
- Update any local or session copy of the CLI to the same release before using it.

## No social media features for children

RULE: the app is a club administration tool, not social media (see `docs/security/privacy-and-social-media-assessment-2026-10-13.md`). For members under 18 it must never have replies to messages (written answers of any kind) or direct messages, feeds, profile pictures or browsable profiles, following or friends, likes or sharing, or posts visible outside their own squads and teams.

- A message may ask one question with answers the sender sets: members pick one, once, with no free text; only the sender, the group's coaches and managers and the member's own parents see who answered what (assessment section 2, "Questions on messages").
- Any comment feature sits inside a coach-led squad or team, is about a coaching item, is readable by parents and guardians, and can be removed by coaches.
- A change that would break this rule needs Matt's explicit yes first, and the assessment is redone before it is built.

## User guide

RULE: `docs/user-guide.md` is the club's user guide, organised by role, with screenshots in `docs/user-guide/`. It must always match the app.

- Any pull request that adds, removes or changes something a member can see or do updates the matching guide sections, the role tables in sections 1 and 11, and any screenshot that no longer matches, in the same pull request.
- Child safety is critically important to club admins, boards, committees, parents and the sport's governing body. Any pull request that changes how the app protects children also updates section 12, "Child safety and safeguarding", which summarises every protection for those readers.
- Make screenshots with the tooling in the project's shared files (`thunder/screenshots/`: `shoot.mjs`, `serve.py`, fixtures; `fixtures/user-guide.mjs` covers screens only the guide uses). Use sample people only, never real club data.
- Keep images as relative paths and `<img width="210">` tags so the guide prints to PDF cleanly. Crop screenshots to at most 1400 px tall.
- Describe what is merged, not what is planned.
