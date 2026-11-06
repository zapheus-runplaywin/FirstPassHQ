# Adding another club or association

There is one FirstPass HQ app in the stores, and every club and every association gets **its own
Supabase project** (database, sign-in and file storage), so they never share member data. The app
connects to one at a time, picked by its **club code**:

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
Up to two more, live clubs or associations, come from the EAS environment
(`EXPO_PUBLIC_CLUB_2_*` and `EXPO_PUBLIC_CLUB_3_*`, read by `src/constants/clubs.ts`).

**An association is set up exactly like a club.** It has its own members, eight roles, squads and
teams (for example its state or representative teams), and everything else a club has. Being a
member, committee member or admin of an association gives no access to any club, and the other way
round: each sign-in only reaches its own project. Someone in both joins each one and is approved by
each one's admin. After setup, the association's admin turns on **Affiliation records** in Club
settings and chooses **Association** and its tier under **Administration > Affiliation**.

For example, WCMMNA (West Coast Men's & Mixed Netball Association) is set up this way as club 2,
with code `WCMMNA`, and West Coast Thunder stays the club the build is made with, keeping its
squads and teams.

## 1. Create the club's Supabase project

A free Supabase account has 2 active free projects, and West Coast Thunder uses both (test and
live). So either:

- the club creates a free project under its own Supabase account and invites you to its
  organisation, so the club owns its data; or
- you create it under your account, which needs the Pro plan.

Then follow steps 1 to 3 of the [README's one-time setup](../README.md#one-time-setup): pick the
Sydney region, allow the sign-in redirects and turn on Google sign-in. Use the same Google client
as the other clubs, and add this project's callback address to it.

## 2. Bring its database up to date

Follow [More clubs and associations](environments.md#more-clubs-and-associations): add its GitHub
secrets as club `2` (or `3`), list it in the `LIVE_CLUBS` repository variable, and run **Deploy
migrations** by hand with **New live project** ticked. From then on every database change and
function deploys to it after the test project, like West Coast Thunder's.

A new club starts with no squads or teams. The first time the club's admin opens **Squads and
teams** (step 5), they choose a starting setup: **AMMNA State Teams** (West Coast Thunder's five
squads, squads on), **WA Netball League** (Mens, Opens, 21 & Under and Futures teams, squads off) or
**Blank**. Nothing needs setting in the app or its environment for this.

## 3. Add the club to the app

Give the EAS `preview` and `production` environments its code, name, URL and public key, with `2`
for the first extra club and `3` for the second:

```bash
for name in CODE:WCMMNA "NAME:West Coast Men's & Mixed Netball Association" \
    URL:https://<project id>.supabase.co "ANON_KEY:<Project Settings > API: the anon public key>"; do
  npx eas-cli@latest env:set --environment preview --environment production \
    --name "EXPO_PUBLIC_CLUB_2_${name%%:*}" --value "${name#*:}" --visibility plaintext
done
```

The code is what members type (capitals and digits). The public key is meant to be public: it only
reaches what the database's security rules allow. Then publish an update
(`scripts/publish-update.sh production "Add WCMMNA"`), which builds these values in and refuses to
publish if one is missing from the result. No code change or new store build is needed.

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
