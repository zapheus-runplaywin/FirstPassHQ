# Test and live

The app talks to one of two Supabase projects:

|                                | Test project                                          | Live project                                         |
| ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------- |
| Used by                        | Expo Go on your computer (`npx expo start`)           | Preview builds shared with testers, and store builds |
| People in it                   | You, plus sample people from `supabase/test-data.sql` | Real club members                                    |
| Sign-in returns to             | `exp://…/--/auth-callback` (your computer)            | `thunderapp://auth-callback` (the installed app)     |
| Where the app gets its address | Your `.env`                                           | The EAS `preview` and `production` environments      |

Both are free Supabase projects. Never copy real members into the test project, and never run
`supabase/test-data.sql` on the live one (it refuses if the database has more than three real
accounts).

Database changes reach both automatically. When a pull request with a migration merges, the **Deploy
migrations** workflow applies it to the test project first and then, only if that worked, to the
live project. The data-loss check and the **Allow data loss** rule are the same for both.

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
   `thunderapp://auth-callback`. You can remove `exp://**` from **Redirect URLs**.
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

## Trying a feature as another role

`supabase/test-data.sql` makes your own accounts admins and fills the squads with sample people
who can't sign in. To see a screen as an athlete, coach or guardian:

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
