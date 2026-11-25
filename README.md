# FirstPass HQ

FirstPass HQ, FirstPass's sports club app for iOS and Android, first built for West Coast Thunder. Members sign in with Google (or Apple on iPhone), an admin approves them
and adds them to a team, and the Team tab shows their team.

Built with [Expo](https://expo.dev) (React Native) and [Supabase](https://supabase.com) on the
free tier.

For how to use the app, role by role, see the [user guide](docs/user-guide.md). To add another
club, each with its own database, see [Adding another club](docs/new-club-setup.md). Security
reviews are in [docs/security](docs/security/).

## What's here

| Path | What it is |
| --- | --- |
| `src/app/` | Screens (Expo Router): sign-in, home, join request, team roster, and `admin/` for approving members. |
| `src/lib/` | Supabase client, sign-in, and the signed-in member's profile and teams. |
| `supabase/migrations/` | Database schema: roles, profiles, squads and the teams named from them each season, membership, join requests, calendars, security rules. Run them in filename order. |

## One-time setup

### 1. Create the Supabase project

1. Create a free project at [supabase.com](https://supabase.com). Pick the Sydney region.
2. Open **SQL Editor** and run each file in `supabase/migrations/` in filename order. When a
   new migration is added later, run just that file.
3. Under **Project Settings > API**, copy the project URL and the `anon` public key.
4. Copy `.env.example` to `.env` and paste both values in. Never commit `.env`.

Free projects pause after a week with no activity. Opening the app, or the dashboard, wakes it up.

### 2. Allow the app's sign-in redirects

In **Authentication > URL Configuration**, add these to **Redirect URLs**:

- `firstpasshq://auth-callback` (the installed app)
- `exp://**` (testing in Expo Go)

Also set **Site URL** to `firstpasshq://auth-callback`. When Supabase doesn't accept an app's
redirect, it sends people to the Site URL instead, and the default (`localhost`) doesn't work on a
phone. Expo Go uses a separate test project whose Site URL is your computer's `exp://` address: see
[Test and live](docs/environments.md).

### 3. Turn on Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth
   client of type **Web application**.
2. Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI.
3. In Supabase **Authentication > Providers > Google**, enable it and paste the client ID and secret.

Then turn on Sign in with Apple, which iPhones offer above Google. In Supabase **Authentication >
Providers > Apple**, enable it and put `au.pivt.firstpass.hq` in **Client IDs**. On a test project
only, also add `host.exp.Exponent`, so it works in Expo Go. No secret key or Services ID is
needed: the app signs in natively and Supabase only checks Apple's token. Android and the web stay
Google only. Apple per club is temporary until the central sign-in in
[docs/new-app-conventions.md](docs/new-app-conventions.md#sign-in) takes it over.

Revoking Apple's sign-in when a member deletes their account does need the developer team's Sign
in with Apple key: set `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` as secrets on the
`revoke-apple` function on both the test and live projects, then run **Actions > Deploy Apple
revoke function** ([docs/new-club-setup.md](docs/new-club-setup.md#1-create-the-clubs-supabase-project)
has the commands and where to make the key). That workflow only runs when pressed, so run it again
after a merge that changes the function. Until then accounts are still deleted, only the revoke is
skipped. The revoke can't succeed in Expo Go, because Apple issues the code to Expo Go
(`host.exp.Exponent`), not to the app, so it is tested on a signed build.

### 4. Make yourself an admin

A club's first admin uses a one-time setup code. Make one with the project's database connection
string, then sign in to the app, tap **Request to join** and enter your name and the code under
**Setting up this club?**. After that you approve everyone else, including other admins, from
**Administration** in the Club tab. The code works once, and only while the club has no admin
([docs/new-club-setup.md](docs/new-club-setup.md#4-make-the-first-admin)).

```bash
CLUB_DB_URL='postgresql://...' scripts/first-admin-code.sh
```

### 5. Add the club calendar

In Outlook, publish the club calendar (Settings > Calendar > Shared calendars > Publish a
calendar) and copy the ICS link. In the app, open **Administration** in the Club tab, then **Calendars**, paste it
in and choose **Everyone**. Team calendars work the same way: pick the team instead.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with the Expo Go app on your phone. Your `.env` should point at the test
Supabase project, so you're working with sample people, not members. See
[Test and live](docs/environments.md).

The app is on Expo SDK 58, and each Expo Go build opens one SDK only. If Expo Go says
"Project is incompatible with this version of Expo Go", install the SDK 58 build: on
Android from [expo.dev/go](https://expo.dev/go) (or Google Play once it has SDK 58), and on
an iPhone with `npx eas-cli@latest go`, which puts a matching Expo Go on TestFlight. After
the next SDK upgrade, update Expo Go the same way.

Before committing, run:

```bash
npx expo lint
npx tsc --noEmit
```

## Installable test builds

`eas.json` has a `preview` profile for builds you can install directly on phones:

```bash
npx eas-cli@latest build --profile preview --platform all
```

To start builds from GitHub instead (Android APK or the Google Play closed test, and iOS to
TestFlight), see [Beta builds from GitHub](docs/beta-builds.md) and
[Google Play closed testing](docs/play-closed-testing.md).

Builds use the live Supabase project, from the EAS environment named after the profile. Publish
over-the-air fixes with `scripts/publish-update.sh`, not `eas update` directly, so they can't pick
up your `.env` test settings.
