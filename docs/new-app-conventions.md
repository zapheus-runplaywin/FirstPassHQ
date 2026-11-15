# Conventions guideline for new apps

A new FirstPass app adds a screen onto HQ's database and nothing else: no new sign-in code, no new club list, no new way to grant access.

This guideline comes from the [cross-product architecture review](https://claude.ai/artifact/Xyt8sBwj7YDr2FsL4Jw4fR) of 15 November 2026 (HQ at `618aaa9`, FirstPassVisionVantage at `fb340ca`, FirstPassStudio at `4342ee4`). It is written from what the repos did then, keeping the best version of each habit. Where today's products break a rule, the rule says so. It is the one copy: the other FirstPass repos point here from their `AGENTS.md`.

## Default stack

- **Phone and tablet apps use Expo, Expo Router and TypeScript,** on the same Expo version as HQ. Today HQ is on 58 and Vantage and Vision are on 57.
- **The club's HQ project is the only backend.** A new app brings no database, no Supabase project and no server of its own.
- **Every database change is a migration in the HQ repo,** under HQ's migration rules. The Vantage and Vision repo has an empty `supabase` folder and a copied migration checker. Both can go.
- **A desktop helper is the exception,** used only when hardware demands it, as Studio's does.
- **No new paid service without Matt's yes.** Check the free limits first and write them in the design.

## Repo layout

- **New Expo apps go in the apps monorepo,** under `apps/<product>`, so they share packages without publishing them. HQ stays in its own repo because it owns the database.
- **A folder is named after its product, and no product name is reused.** Do not build `apps/hq`.
- **Names follow one pattern.** Bundle ID `au.pivt.firstpass.<product>` and URL scheme `firstpass-<product>`. HQ's scheme (`firstpasshq`) and Studio's ID (`com.runplaywin.firstpassstudio`) predate the pattern and can stay.
- **Every repo has an `AGENTS.md`** with the shared rules: tests, child safety, user guide, migrations. Studio has none today.

## Sign-in

_Rewritten for design C on 15 November 2026. The rules marked "after the proof" depend on the proof plan passing._

- **Sign in through the central FirstPass sign-in, using the shared sign-in package.** Never write sign-in inside an app. There are four hand-written versions today.
- **Google and Apple are set up once, on the central sign-in** (after the proof). A club project has no sign-in providers of its own.
- **A club project accepts tokens only from the central sign-in** (after the proof). Every access rule keeps that check.
- **Keep tokens encrypted on the device,** as HQ does and Vantage and Vision do not.
- **Sign out on this device only,** so one product does not sign the person out of another.
- **Show sign-in errors to the person.** Vantage and Vision drop them today.
- **The redirect is `<scheme>://auth-callback`,** registered once on the central sign-in. Nobody adds a redirect per club.
- **Signing in grants nothing.** A person becomes a pending profile in a club only when they ask to join that club, and an admin still approves them.

## Club lookup

- **Read clubs from the one club directory,** which sits beside the central sign-in. No project address or key is typed into an app's code or config.
- **Every entry is marked test or live.** A store build lists live clubs only. A preview build lists test clubs only. Studio's shipped list breaks this today.
- **A club code means the same project in every product.** THUNDER does not today.
- **The directory lists clubs, not people.** Which clubs a person belongs to is answered by each club's own profiles.

## Access model

- **One HQ role or team-place rule per product,** granted by club admins in HQ. Admins are not let in by default unless the design says why.
- **The database enforces the rule on every call.** A check in the app is only there to show a helpful message. Vantage's game writes break this today.
- **Losing access takes effect within one minute on an open screen.** The app re-asks at least that often while it shows club data, and clears what it holds when refused.
- **No second secret on top of a role,** such as a pair code, unless it protects something the role does not.
- **Children's rules sit in the database.** If an app can show a child's name outside the club, the database withholds the name without publish consent. Studio's line-up call breaks this today.
- **No social features for under-18s,** as HQ's rules already say.

## Shared packages

- **Shared logic goes into a package before the second copy is written.** Today's packages are `@firstpass/schema`, `@firstpass/engine` and `@firstpass/playhq`. The sign-in package and club directory join them.
- **Apps pin exact package versions,** as Studio does.
- **One table says which product uses which package, and it is kept true.** Two documents get this wrong today.
- **Game events only ever gain fields.** The database stores each event as sent, without checking its shape ([game_stats.sql:441-496](https://github.com/zapheus-runplaywin/FirstPassHQ/blob/618aaa9/supabase/migrations/20261015000100_game_stats.sql#L441-L496)). So every reader must ignore event types it does not know, and installed apps must keep working when a newer recorder appears.

## Testing

- **Every change ships tests that run on every push,** HQ's rule since 18 October. Vantage, Vision and Studio run tests on pull requests and main only.
- **Access is tested in HQ, for every kind of member, both ways.** Each product has its own file there, as Vision and Studio do now.
- **Before a new app's first pilot, run the revocation walk-through** from this review: role removed, stood down, deleted, consent changed. Keep the output.
- **Sample people only.** Never live data.

## Release

- **Expo apps build with EAS,** with preview tied to test clubs and production tied to live clubs.
- **Builds are tagged `build-N`,** as HQ does.
- **Packages follow semantic versions,** and a breaking change to game events needs a written plan for apps already installed.
- **The user guide changes in the same pull request** as anything a member can see.

## Design checklist, finished before building starts

1. **Name.** Product name, folder, bundle ID and URL scheme, checked against every existing product.
2. **Who uses it.** A new column in the member matrix, filled in for every kind of member.
3. **What grants access.** Which HQ role or team place, who grants it, and whether a new role is needed.
4. **What it reads and writes.** Listed by HQ function or table. Mark anything about a child and which consent covers it.
5. **What happens when access ends.** Role removed, stood down, deleted, consent changed, with the one minute target.
6. **What stays on the device.** Tokens, cached club data, and how each is protected and cleared.
7. **Store rules.** Apple and Google Play rules read on the current official pages, with the date. Include sign-in options and account deletion.
8. **Shared packages.** Which it uses, and any logic that another product already has.
9. **Cost.** Any new service, its free limits, and the cost at ten clubs.
10. **Child safety.** Checked against HQ's rules and section 12 of the user guide. A new assessment if there is doubt.
11. **Tests.** The HQ test file that will cover its access, and the planned revocation run.
12. **Club setup.** What the setup script must add for each club.
