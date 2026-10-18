# Test strategy

FirstPass HQ holds records about children, so its tests protect two things above all: **who can see and do what**, and **the features members rely on**. Every change ships with tests that CI runs, and a failure shows on the branch before anything is merged (AGENTS.md, "Tests").

## The layers

Most of the protection lives in the database, because row level security and database functions are what actually stop a member reading or changing something. The app tests check that screens and buttons match those rules, so members aren't shown things they can't use.

| Layer | What it proves | Where | Runs with |
|---|---|---|---|
| Database access guards | Rules that hold for the whole schema: every table has row level security, every security definer function sets its search path, the anonymous role can't run functions or read rows, clean-up functions are service-role only, and storage buckets are private | `supabase/tests/access-guards.sql` | `scripts/run-sql-tests.sh` |
| Database access matrix | For each kind of member and each sensitive table, which rows they can read, and that direct writes are refused where the app must go through a function | `supabase/tests/role-table-access.sql` | `scripts/run-sql-tests.sh` |
| Database features | Each feature's functions: who may call them and who is refused, the rows they change, validation, and the child-safety rules in the migration comments | `supabase/tests/<feature>.sql` | `scripts/run-sql-tests.sh` |
| App role rules | Every `use…` access hook in `src/lib` (for example `useCanSeeInjuries` and `useCanSendMessages`) gives the right answer for each kind of member. Also covers `AuthProvider`'s paused and stood-down roles and `isAdmin` | `src/lib/__tests__/role-access.test.tsx`, `auth.test.tsx` | `npm test` |
| App logic | Pure rules and formatting: under-18 age, role combinations, Working With Children Check status and exemptions, to-dos and due dates, calendar parsing, PlayHQ links, surveys, awards, goals and more | `src/lib/__tests__/<module>.test.ts` | `npm test` |
| Routes and screens | Through the real `src/app/_layout.tsx`: who can open each screen by deep link (admin screens only for admins, nothing for signed-out members, and feature switches), and which cards each kind of member sees on Home and Administration | `src/__tests__/*.test.tsx` | `npm test` |
| Static checks | Lint and TypeScript | `eslint.config.js`, `tsconfig.json` | `npx expo lint`, `npx tsc --noEmit` |
| Migration safety | Merged migrations stay unchanged, versions are unique, nothing exposes or loses data, and migrations apply to a fresh Supabase database | `scripts/check-migrations.py`, `scripts/check-migration-security.py` | "Check migrations" workflow |
| Known vulnerabilities | Fails on any high or critical npm advisory not in `.github/known-vulnerabilities.json` | `scripts/check-cves.py` | "Security audit" workflow |

## The kinds of member every access test considers

Admin, committee, head coach, assistant coach, manager, physio (squad physio and Head Physio), adult athlete, under-18 athlete, guardian (and a guardian whose child has turned 18), guest, temporary helper, pending and signed-out members.

Each test also covers members whose rights have stopped: a coach or committee member whose check has lapsed, a committee member past the club's checks date, and a stood-down coach or admin. It covers members with more than one role, such as coach and guardian, athlete and coach, or admin and guardian.

A new access rule is tested for every one of these, both ways: who gets it and who doesn't.

## When CI runs

| Workflow | When | What |
|---|---|---|
| Tests | Every push to every branch | Lint, typecheck, Jest with a coverage floor, every database test against every migration |
| Check migrations | Pull requests that touch migrations | The migration safety checks above |
| Security audit | Every merge to main, weekly, and pull requests that change packages | `scripts/check-cves.py` |

The Jest coverage floor is set in `package.json` (`jest.coverageThreshold`). Raise it when coverage goes up; never lower it to get a change through.

## Writing tests for a change

1. **Database change:** add or update `supabase/tests/<feature>.sql`.
   - Cover who may call each function, who is refused, the rows it changes, and the child-safety and visibility rules.
   - Copy the PASS/FAIL style of `record-access.sql`. Catch expected refusals with `pg_temp.fails`, because any `ERROR` fails the run.
   - If the change adds a table, add it to `role-table-access.sql`. `access-guards.sql` picks it up automatically.
2. **New or changed role rule in the app:** add rows for every kind of member to `role-access.test.tsx`.
3. **New screen:** put it behind the right guard in `src/app/_layout.tsx`. The route tests sweep every file under `src/app/admin`, so an admin screen outside the admin guard fails them.
   - If the screen adds a Home or Administration card, add it to `home-by-role.test.tsx` or `administration-by-feature.test.tsx`.
4. **New pure logic in `src/lib`:** add tests in `src/lib/__tests__/<module>.test.ts`.
5. **Dates:** fix "today" in any test that depends on it (`jest.useFakeTimers().setSystemTime(...)`), because CI runs in UTC.
6. **Bugs:** when a test finds a bug, fix it with that test, in the same pull request or the next one. The test must fail before the fix and pass after it.
7. **Changing what a test expects:** only when the rule itself changes. Say in the pull request which expectations changed and why. Never skip, delete or weaken a test to get green.

## Running the tests locally

```bash
npm ci
npx expo lint
npx tsc --noEmit                    # needs expo-env.d.ts: /// <reference types="expo/types" />
npm test                            # Jest; add -- --coverage for the coverage summary
PGHOST=localhost PGUSER=postgres PGPASSWORD=... scripts/run-sql-tests.sh            # every database test
PGHOST=localhost PGUSER=postgres PGPASSWORD=... scripts/run-sql-tests.sh surveys    # one file
python3 scripts/check-cves.py
```

The database tests need Postgres 16 and a user that can create databases. `supabase/tests/setup/supabase-stubs.sql` stands in for the parts of Supabase that plain Postgres lacks: the auth, storage, realtime and pg_net pieces.

## What isn't covered yet

- **Screens beyond Home and Administration:** the route tests prove who can open a screen, not what each screen shows inside. Outside the admin screens, routes are guarded only by sign-in and feature switches. A screen's own checks and the database decide what a member sees there.
- **Supabase edge functions** (`supabase/functions/playhq`, `purge-expired-injuries`).
- **End-to-end tests on a phone or in a browser:** the screenshot fixtures in the project's shared files drive the web build with sample data for the user guide, but they don't assert anything.
- **The real Supabase platform:** the database tests run on plain Postgres with stubs. "Check migrations" separately confirms that migrations apply to a real Supabase database.
