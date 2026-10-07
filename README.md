# Thunder

The club app for iOS and Android. Members sign in with Google or Apple, an admin approves them
and adds them to a team, and the home screen shows their team.

Built with [Expo](https://expo.dev) (React Native) and [Supabase](https://supabase.com) on the
free tier.

## What's here

| Path | What it is |
| --- | --- |
| `src/app/` | Screens (Expo Router): sign-in, home, join request, team roster, and `admin/` for approving members. |
| `src/lib/` | Supabase client, sign-in, and the signed-in member's profile and teams. |
| `supabase/migrations/` | Database schema: roles, profiles, the six teams, team membership, join requests, security rules. Run them in filename order. |

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

- `thunderapp://auth-callback` (the installed app)
- `exp://**` (testing in Expo Go)

### 3. Turn on Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth
   client of type **Web application**.
2. Add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI.
3. In Supabase **Authentication > Providers > Google**, enable it and paste the client ID and secret.

### 4. Turn on Apple sign-in

Needs an Apple Developer account.

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources),
   enable **Sign in with Apple** on the App ID `au.com.wcmmna.thunder`.
2. Create a **Services ID** (used by Android and the browser flow) with the return URL
   `https://<your-project-ref>.supabase.co/auth/v1/callback`.
3. Create a **Sign in with Apple** key and download the `.p8` file.
4. In Supabase **Authentication > Providers > Apple**, enable it. Under client IDs add both the
   Services ID and `au.com.wcmmna.thunder`, and fill in the secret from the key.

### 5. Make yourself an admin

The first admin has to be set by hand. Sign in to the app once, then run this in the SQL Editor
with your sign-in email. After that you can approve everyone else, including other admins, from
**Members** on the home screen.

### 6. Add the club calendar

In Outlook, publish the club calendar (Settings > Calendar > Shared calendars > Publish a
calendar) and copy the ICS link. In the app, open **Calendars** from the home screen, paste it
in and choose **Everyone**. Team calendars work the same way: pick the team instead.

```sql
update public.profiles set role = 'admin', status = 'approved'
where email = 'you@example.com';
```

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with the Expo Go app on your phone.

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
