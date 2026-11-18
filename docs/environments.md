# Test and live

The app talks to one of two Supabase projects:

|                                | Test project                                          | Live project                                         |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------- |
| Used by                        | Expo Go on your computer (`npx expo start`)           | Preview builds shared with testers, and store builds |
| People in it                   | You, plus sample people from `supabase/test-data.sql` | Real club members                                    |
| Sign-in returns to             | `exp://…/--/auth-callback` (your computer)            | `firstpasshq://auth-callback` (the installed app)     |
| Where the app gets its address | Your `.env`                                           | The EAS `preview` and `production` environments      |

Both are free Supabase projects. Never copy real members into the test project, and never run
`supabase/test-data.sql` on the live one (it refuses if the database has more than three real
accounts).

Database changes reach both automatically. When a pull request with a migration merges, the **Deploy
migrations** workflow applies it to the test project first and then, only if that worked, to the
live project. The data-loss check is the same for both: a migration that can lose data goes ahead
only when Matt's `data-loss-approved` label was on its pull request when it merged, or when Matt
runs the workflow by hand with **Allow data loss** ticked.

## One-time setup

### 1. Create the test project

1. Create a second free project at [supabase.com](https://supabase.com), in the Sydney region. Name
   it something like `thunder-test`. Save its database password.
2. In **Authentication > URL Configuration**, set **Site URL** to the address shown under the
   sign-in buttons in Expo Go (for example `exp://192.168.4.144:8081/--/auth-callback`) and add
   `exp://**` to **Redirect URLs**.
3. In **Authentication > Providers > Google**, turn Google on with the same client ID and secret as
   the live project. Then, in
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials), open that OAuth client
   and add `https://<test-project-ref>.supabase.co/auth/v1/callback` as another authorised redirect
   URI.

### 2. Let GitHub deploy to it

In GitHub, **Settings > Secrets and variables > Actions**, add two repository secrets:

- `SUPABASE_TEST_PROJECT_ID`: the test project's reference (the part before `.supabase.co`).
- `SUPABASE_TEST_DB_PASSWORD`: its database password.

If the test project is in the same Supabase organisation as the live one, the existing
`SUPABASE_ACCESS_TOKEN` works for both. If it's in another organisation or account (the deploy fails
with "does not have the necessary privileges"), sign in to Supabase as the test project's owner,
create a token under **Account > Access Tokens**, and add it as a third secret,
`SUPABASE_TEST_ACCESS_TOKEN`. Then open **Actions**, and run **Deploy migrations**, **Deploy PlayHQ
function** and **Purge expired injury records** once each with **Run workflow** (leave the boxes
empty). The first run gives the empty test project every migration.

Until these secrets exist the workflows only warn and carry on updating the live project.

### 3. Point your computer at the test project

1. In the test project, **Project Settings > API**, copy the project URL and the `anon` public key
   into your `.env` (replacing the live ones).
2. Run `npx expo start`, open the app in Expo Go and sign in with Google once.
3. In the test project's **SQL Editor**, run `supabase/test-data.sql`. You become an admin, and the
   squads fill with sample people. Pull down on the home screen to see them.

### 4. Point the installed apps at the live project

1. In the live project's **Authentication > URL Configuration**, set **Site URL** to
   `firstpasshq://auth-callback`. You can remove `exp://**` from **Redirect URLs**.
2. Give the EAS `preview` and `production` environments the live project's URL and `anon` key. The
   `anon` key is public (it ships inside the app), so these can be plain text:

   ```bash
   npx eas-cli@latest env:set --environment preview --environment production \
     --name EXPO_PUBLIC_SUPABASE_URL --value https://<live-project-ref>.supabase.co \
     --visibility plaintext
   npx eas-cli@latest env:set --environment preview --environment production \
     --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <live-anon-key> \
     --visibility plaintext
   ```

   Or add them on [expo.dev](https://expo.dev) under the project's **Environment variables**.
3. Protect the daily injury purge. Make up a long random value, set it on the live project's
   function (`npx supabase secrets set --project-ref <live-project-ref> PURGE_SECRET=<value>`), and
   add the same value as the GitHub repository secret `PURGE_SECRET`. The purge then refuses any
   call without it. Until both are set, the function warns in its logs and anyone who finds its
   address can start a (harmless, but free-plan-quota-eating) purge run.

## Replacing the live project

Only while nothing real is in it, for example to move it to another region. Nothing in the code
names the project, so no code changes:

1. Create the new project in the Sydney region and set it up as in
   [step 4](#4-point-the-installed-apps-at-the-live-project), with Google sign-in on (same client)
   and the Email provider off. Add its `https://<new-ref>.supabase.co/auth/v1/callback` to the
   Google client and remove the old project's.
   Leave **Automatically expose new tables** unticked: since 30 October 2026 Supabase gives new
   tables no access, and the migrations grant each table what the app needs
   (`20261021000000_explicit_table_grants.sql`, then each new table's own grants).
2. Update the GitHub secrets `SUPABASE_PROJECT_ID` and `SUPABASE_DB_PASSWORD` (and
   `SUPABASE_ACCESS_TOKEN` if it's in another organisation), and the EAS `preview` and
   `production` values of `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. In **Actions**, run **Deploy migrations** by hand with **New live project** ticked. The live
   deploy normally refuses a database with no record of any migrations; this lets an empty one take
   them all. Only Matt can tick it, and it does nothing on a project that already has migrations.
4. Run **Deploy PlayHQ function** and **Purge expired injury records** once each. Set the
   `revoke-apple` function's `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` secrets on the
   new project ([docs/new-club-setup.md](new-club-setup.md#1-create-the-clubs-supabase-project))
   and run **Deploy Apple revoke function**, so deleting an Apple member's account revokes their Apple sign-in.
5. Installed apps keep the old address until they get an update (`scripts/publish-update.sh`) or a
   new build.

## More test clubs

To try switching clubs, Expo Go can have up to two more test clubs, each with its own free project.
They only exist on your computer: installed builds and updates never include them.

**Off for now (1 November 2026).** Test clubs 2 and 3 were taken out while Supabase's free plan
kept pausing club 2; they'll come back once FirstPass moves to Supabase Pro. No workflow touches
them unless the `TEST_CLUBS` repository variable lists them, and the app only shows them when your
`.env` has their values. To bring them back, set up the projects and secrets below, then add the
repository variable `TEST_CLUBS` with the value `[2, 3]` (or `[2]` for one) under **Settings >
Secrets and variables > Actions > Variables**, and run the three workflows once each.
`scripts/test-workflow-test-clubs.py` checks in CI that every workflow keeps them behind that
variable.

### 1. Create the projects

1. A Supabase account has two free projects, so use another account (for example a second email).
   Create two projects there in the Sydney region, such as `firstpass-test-2` and
   `firstpass-test-3`. Save each database password.
2. Set up each one like the test project in [step 1](#1-create-the-test-project): the same **Site
   URL** and `exp://**` redirect, and Google sign-in with the same client. Add each project's
   `https://<project-ref>.supabase.co/auth/v1/callback` to the Google client too.
3. Signed in to that account, create a token under **Account > Access Tokens**.

### 2. Let GitHub deploy to them

Add these repository secrets, with `2` for the first project and `3` for the second:

- `SUPABASE_TEST_2_PROJECT_ID`, `SUPABASE_TEST_2_DB_PASSWORD`, `SUPABASE_TEST_2_ACCESS_TOKEN`
- `SUPABASE_TEST_3_PROJECT_ID`, `SUPABASE_TEST_3_DB_PASSWORD`, `SUPABASE_TEST_3_ACCESS_TOKEN`

Both access tokens can be the same token. Add the repository variable `TEST_CLUBS` set to
`[2, 3]`, then run **Deploy migrations**, **Deploy PlayHQ function** and **Purge expired injury
records** once each with **Run workflow**. For Sign in with Apple, turn on the Apple provider on
each (Client IDs `au.pivt.firstpass.hq` and `host.exp.Exponent`) and give the `revoke-apple`
function its three Apple secrets, then run **Deploy Apple revoke function**, as for the test
project. Database changes
reach the test clubs after the test project. The live deploy doesn't wait for them, so a paused
test club never holds it up; its job fails and says so.

### 3. Add them to your `.env`

```bash
EXPO_PUBLIC_TEST_CLUB_2_CODE=HAWKS
EXPO_PUBLIC_TEST_CLUB_2_NAME=Hawks Netball Club
EXPO_PUBLIC_TEST_CLUB_2_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY=<its anon public key>

EXPO_PUBLIC_TEST_CLUB_3_CODE=FALCONS
EXPO_PUBLIC_TEST_CLUB_3_NAME=Falcons Netball Club
EXPO_PUBLIC_TEST_CLUB_3_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_TEST_CLUB_3_ANON_KEY=<its anon public key>
```

Restart `npx expo start`, choose **Switch club**, enter `HAWKS`, and sign in with Google. Then run
`supabase/test-data.sql` in that project's **SQL Editor** to become its admin and add sample
people. In **Administration > Club settings**, give the club its own name, colours and logo so the
clubs are easy to tell apart. Do the same for `FALCONS`.

`scripts/publish-update.sh` leaves these clubs out of every update and checks that it did.

## Day to day

- **Trying a change:** `npx expo start`. You're on test data, so nothing you do reaches members.
- **A build for testers:** `npx eas-cli@latest build --profile preview --platform android`. It uses
  the live project.
- **A fix without a new build:** `scripts/publish-update.sh preview "What changed"` (or `production`
  for store builds). It builds the update with that channel's live settings, checks the update
  doesn't use your `.env` address, and only then publishes it. A change that adds a native library
  needs a new build instead.
- **A database change:** merge the pull request. Test gets it first, then live.

Free projects pause after a week with nobody using them. If the test project is paused, the
migration deploy stops before the live project and says so: restore the test project in the Supabase
dashboard and run **Deploy migrations** again.

## The demo club

The code `DEMO` opens the **FirstPass Demo Club**: 20 sample accounts on the **test** project, one
for each kind of member, for app store reviewers and for anyone trying a screen as another role.
It's the only club that signs in with an email and password. Every account uses the same password,
which lives in the `DEMO_PASSWORD` repository secret and nowhere in the repo.

The accounts are `<name>@demo.firstpass.example`, listed with what each one is for in
`supabase/demo-club.sql`: `admin`, `committee` (the Secretary), `headcoach` (Head Coach of the
20 & Under team), `asstcoach`, `manager`, `physio`, `headphysio`, `athlete19`, `athlete16` (two
verified guardians), `locked15` (locked, with a fresh link code), `guardian`, `openathlete`,
`lapsedcoach` (check expired yesterday), `coachparent`, `guest`, `helper` (temporary helper for
this week), `stats`, `studio`, and `newcomer` and `newparent` (signed in, not yet asked to join).
The 20 & Under team is the pilot: Messages and Calendar are on for the pilot only, and every other
feature is off.

**Setting it up (once):**

1. In the test project only, turn on **Authentication > Sign In / Providers > Email**, with
   **Allow new users to sign up** off. Leave Email **off** in the live project: that's what keeps
   password sign-in away from real members, whatever a build contains.
2. Add a `DEMO_PASSWORD` repository secret of at least 12 characters (GitHub > Settings > Secrets
   and variables > Actions).
3. Run **Reset demo club** (Actions > Reset demo club > Run workflow).
4. Add `EXPO_PUBLIC_DEMO_CLUB_URL` and `EXPO_PUBLIC_DEMO_CLUB_ANON_KEY` (the **test** project's
   address and public key) to the EAS environments whose builds should list the demo club,
   usually `preview` and `production`. A build without them has no demo club.

**Resetting it.** Run **Reset demo club** after each review round or test pass, after changing
`DEMO_PASSWORD`, or when an account was deleted. It puts back every account, password, role,
squad and team place, guardian link and link code, the pilot and the feature switches; removes
messages the demo accounts sent; and returns `newcomer` and `newparent` to signed in with no join
request. Calendars are left alone. It runs by hand only, reads only the test project's secrets,
stops if the test project id is the live one, and the script itself refuses a database with more
than three real accounts. To run it on another database: `psql -v demo_password=... -f
supabase/demo-club.sql <database url>`.

**The guards.** The password box shows only for the entry built from the two EAS variables. The
club a build is made for never gets it, even with the code `DEMO`, and a demo entry pointing at
that club's own project is dropped. `scripts/publish-update.sh` keeps the demo club in an update
only when the channel's EAS environment has it, and refuses one pointing at the live project.

## Trying a feature as another role

Use the demo club: sign in to `DEMO` in a preview build as the account for that role, and run
**Reset demo club** afterwards to put things back. In Expo Go, where the home club is the test
project, the demo club isn't listed, so use the steps below.

`supabase/test-data.sql` makes your own accounts admins and fills the squads with sample people
who can't sign in. To see a screen as an athlete, coach or guardian in Expo Go:

1. Run `supabase/test-data.sql` in the test project's **SQL Editor** (again, if you ran it before).
   Your admin account becomes an assistant coach of the **Open Squad** and its **Open A** team, and
   Open A gets sample PlayHQ games (PlayHQ games belong to teams, not squads): one in 3 days, a bye, and 12 played games with sample goals, reflections,
   coach comments and team goals. Running it again moves the games so one is always coming up.
2. In Expo Go, sign out and sign in with a second Google account. Ask to join as an **Athlete**.
3. Sign back in as yourself, approve the request in **Administration > Members**, put the new
   athlete in the **Open Squad** (current season) and, under **Teams**, in **Open A** as a final
   team athlete.
4. Sign in as the athlete and tap **Open A** under **My squads and teams** to set goals for the next
   game. Sign in as yourself and open **Open A** to see the coach side: its team goals at the top
   and every athlete's goals under **People**.

Accounts you have approved with a role other than admin keep it when you run the script again.
Sample games and goals need the game goals migration, so they appear once its pull request has
merged and the migration has reached the test project.

## A full copy of a club's data

When a club asks for all its data, or leaves, FirstPass makes the copy with
`scripts/export-club-data.sh` (what the club is promised is in [data-handling.md](data-handling.md)).
It runs on your computer, never in GitHub Actions, so the copy doesn't sit in a workflow's logs or
artifacts.

1. In the club's Supabase project, open **Connect** and copy the **Session pooler** connection
   string, with the database password filled in. Copy the project ref and, under **Project
   Settings > API keys**, the secret (service role) key.
2. Use a `pg_dump` of the same major version as the project's Postgres or newer (the dashboard
   shows the version under **Project Settings > Infrastructure**).
3. Run it into a new folder:

   ```bash
   CLUB_DB_URL='postgresql://...' CLUB_PROJECT_REF=abcd... CLUB_SERVICE_KEY=sb_secret_... \
     scripts/export-club-data.sh ~/club-export-THUNDER-2026-10-23
   ```

   It refuses a folder that already exists, makes the folder readable only by you, and stops at
   the first file it can't download. `manifest.txt` lists rows per table and files per bucket:
   check it against the dashboard.
4. Zip the folder with a password, send it to the admin the club names through an encrypted link,
   and send the password another way (a phone call or text).
5. Once the club confirms it has the copy, delete every copy you hold. For a club that's leaving,
   delete its Supabase project too, and tell the club in writing.

`scripts/test-export-club-data.sh` tests the script against a local Postgres; the "Tests" workflow
runs it.
