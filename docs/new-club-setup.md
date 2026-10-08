# Setting the app up for another club

The app is built so any club can run its own copy. Each club gets:

- **its own Supabase project** (database, sign-in and file storage), so clubs never share member
  data, and each stays inside Supabase's free tier;
- **its own app build** with the club's app name, icon and store listing;
- **Club settings** in the app, where the club's admin sets the name, colours, logo and which
  features are on, with no new build needed.

Steps 1 to 4 are done once by whoever installs the app for the club. After step 4 the club's admin
does everything else from the app.

## 1. Copy the code

Fork or copy this repository for the club. In the copy:

1. **`src/constants/club.ts`**: the club's name, short name and the three default colours. These
   are what people see before they sign in for the first time, and until the admin changes them.
2. **`app.json`**: `name` (the name under the icon), `slug`, `scheme` (used for sign-in, for
   example `hawksapp`), `ios.bundleIdentifier` and `android.package` (for example
   `au.com.hawks.app`), the splash screen and notification colours, and remove `extra.eas` and
   `updates` so the club gets its own EAS project in step 4.
3. **`assets/images/`**: replace `logo.png`, `icon.png`, `splash-icon.png`, `favicon.png` and the
   three `android-icon-*.png` files with the club's, at the same sizes.
4. **`docs/user-guide.md`**: the guide describes West Coast Thunder's setup. Update the club name
   and squad names, or leave it out.

The app icon, splash screen and app name are part of the build, so they can't change from Club
settings. Everything inside the app can.

## 2. Create the Supabase project

Follow steps 1 to 3 of the [README's one-time setup](../README.md#one-time-setup): create the
project, allow the sign-in redirects (using the club's `scheme` from step 1 instead of
`thunderapp`) and turn on Google sign-in.

To have database changes deploy automatically, add these repository secrets in GitHub
(**Settings > Secrets and variables > Actions**): `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
and `SUPABASE_PROJECT_ID`. Then run the **Deploy migrations** workflow once by hand. It applies
every file in `supabase/migrations/` and later ones as they merge. A second, test project for
trying changes with sample people is optional: see [Test and live](environments.md).

The first migration adds West Coast Thunder's squads (Lightning Academy, 17 & Under and so on).
The admin renames or removes them in **Squads and teams** in step 5; nothing else depends on them.

## 3. Make the first admin

Nobody can approve the first admin from inside the app, so this one step is done in the database.

1. Build or run the app (step 4, or `npx expo start` with Expo Go) and sign in once with the
   admin's Google account. That creates their profile.
2. In the Supabase dashboard, open **SQL Editor** and run this with their sign-in email:

   ```sql
   update public.profiles set role = 'admin', status = 'approved'
   where email = 'admin@yourclub.com';
   ```

3. Pull down on the home screen. **Administration** appears.

From then on the admin approves everyone else, including other admins, from **Members**.

## 4. Build the app

Create a free [Expo](https://expo.dev) account for the club, then:

```bash
npx eas-cli@latest init          # links the copy to a new EAS project
npx eas-cli@latest update:configure
npx eas-cli@latest build --profile preview --platform all
```

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` for the build as EAS
environment variables. See [Installable test builds](../README.md#installable-test-builds) for
TestFlight, the Play Store and push notification keys.

## 5. Set up the club in the app

The admin opens **Administration > Club settings** and sets:

- **Club name** and **short name**. The short name finds the club's teams in PlayHQ fixtures and
  names exported files.
- **Logo**: a square PNG with a see-through background.
- **Colours**: background, hero colour (buttons, links and highlights) and light or dark text.
  The preview shows how they look together and warns when they're hard to read.
- **Features**: turn off anything the club doesn't use. Messages, Calendar, Daily check-ins,
  Injuries, Attendance and Awards can each be switched off. Nothing is deleted when a feature is
  off.

Then, still in **Administration**: set a **Club password**, rename the **Squads and teams**, add
**Calendars**, and approve members as they ask to join.
