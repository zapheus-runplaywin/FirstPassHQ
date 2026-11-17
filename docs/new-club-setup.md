# Adding another club

There is one FirstPass HQ app in the stores, and every club gets **its own Supabase project**
(database, sign-in and file storage), so clubs never share member data. The app connects to one
club at a time, picked by its **club code**:

- The first open shows **Find your club**, where members type their club's code. A link such as
  `firstpasshq://club/HAWKS` fills it in. The app remembers the club after that.
- **Change club** on the sign-in screen and **Switch club** at the foot of the home screen go back
  to the code screen. Every club's sign-in stays saved on the device, so people in two clubs
  switch without signing in again.
- Each club's look (Club settings) is saved on the device per club, so one club never opens in
  another's colours and logo.

The club the build is made with comes from the build's Supabase settings
(`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`), with code `THUNDER` and name
West Coast Thunder unless `EXPO_PUBLIC_CLUB_CODE` and `EXPO_PUBLIC_CLUB_NAME` say otherwise.
Every other club is listed in `src/constants/clubs.ts`.

## 1. Create the club's Supabase project

A free Supabase account has 2 active free projects, and West Coast Thunder uses both (test and
live). So either:

- the club creates a free project under its own Supabase account and invites you to its
  organisation, so the club owns its data; or
- you create it under your account, which needs the Pro plan.

Then follow steps 1 to 3 of the [README's one-time setup](../README.md#one-time-setup): pick the
Sydney region, allow the sign-in redirects and turn on Google sign-in. Use the same Google client
as the other clubs, and add this project's callback address to it. Then turn on Sign in with Apple
as step 3 describes: **Authentication > Providers > Apple**, enabled, with `au.pivt.firstpass.hq` in
**Client IDs** (and `host.exp.Exponent` too on a test project). It needs no secret key. Without it,
iPhone members who tap **Continue with Apple** see an error.

When a member who signed in with Apple deletes their account, the app also revokes their Apple
sign-in through the `revoke-apple` edge function, as Apple asks. Give that function the developer
team's Sign in with Apple key (the same key serves every club) and deploy it:

```bash
npx supabase secrets set --project-ref <the club's project id> \
  APPLE_TEAM_ID=<Team ID> APPLE_KEY_ID=<Key ID> APPLE_PRIVATE_KEY="$(cat AuthKey_<Key ID>.p8)"
npx supabase functions deploy revoke-apple --project-ref <the club's project id> --use-api
```

The key comes from the Apple Developer site: **Certificates, Identifiers & Profiles > Keys**, a new
key with **Sign in with Apple** ticked and the app's App ID chosen as its primary App ID. Apple
lets you download the `.p8` file once, so keep it somewhere safe. Until the secrets are set the
function answers 503 and the account is still deleted; only the Apple revoke is skipped.

## 2. Bring its database up to date

The **Deploy migrations** workflow only deploys to West Coast Thunder's projects so far. For a new
club, apply the migrations with the Supabase CLI from a copy of the repository:

```bash
supabase link --project-ref <the club's project id>
FIRST_RUN_OK=true scripts/deploy-migrations.sh
```

A new club starts with no squads or teams. The first time the club's admin opens **Squads and
teams** (step 5), they choose a starting setup: **AMMNA State Teams** (West Coast Thunder's five
squads, squads on), **WA Netball League** (Mens, Opens, 21 & Under and Futures teams, squads off) or
**Blank**. Nothing needs setting in the app or its environment for this.

## 3. Add the club to the app

In `src/constants/clubs.ts`, add the club to `OtherClubs`:

```ts
{
  code: 'HAWKS', // what members type: capitals and digits
  name: 'Hawks Netball Club',
  supabaseUrl: 'https://<project id>.supabase.co',
  anonKey: '<Project Settings > API: the anon public key>',
},
```

The public key is meant to be public: it only reaches what the database's security rules allow.
Merge it and publish an update (`scripts/publish-update.sh production "Add Hawks"`). No new store
build is needed.

## 4. Make the first admin

Nobody can approve the first admin from inside the app, so this one step is done in the database.

1. The admin opens the app, enters the club code and signs in once with Google. That creates
   their profile.
2. In the club's Supabase dashboard, open **SQL Editor** and run this with their sign-in email:

   ```sql
   update public.profiles set role = 'admin', status = 'approved'
   where email = 'admin@yourclub.com';
   ```

3. Pull down on the home screen. **Administration** appears.

From then on the admin approves everyone else, including other admins, from **Members**.

## 5. Set up the club in the app

The admin opens **Administration > Club settings** and sets:

- **Club name** and **short name**. The short name finds the club's teams in PlayHQ fixtures and
  names exported files.
- **Logo**: a square PNG with a see-through background.
- **Colours**: background, hero colour (buttons, links and highlights) and light or dark text.
  The preview shows how they look together and warns when they're hard to read.
- **Squads**: the starting setup in **Squads and teams** sets this, so it only needs changing for
  a Blank club. Switch off **Members join a squad first** if the club selects straight into teams,
  with final team athletes and training partners from the start. Squads and teams then becomes
  **Teams**.
- **Features**: turn off anything the club doesn't use. Messages, Calendar, Daily check-ins,
  Injuries, Attendance and Awards can each be switched off. Nothing is deleted when a feature is
  off.

Then, still in **Administration**: set a **Club password**, open **Squads and teams** and choose a starting setup, add
**Calendars**, check **Absence reasons** (the starting list includes **West Coast Fever**, Western
Australia's Super Netball team: switch it off, or any other reason that isn't the club's, and add
the club's own), and approve members as they ask to join. **Administration > Invite members** shows
the club's QR code, code and link to share. Members scan it or enter the code, sign in, and ask to
join with the club password.

The "Powered by" FirstPass HQ logo at the foot of every screen, the app icon, splash screen and app name are the same for every club.
