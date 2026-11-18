# Beta builds from GitHub

The **Beta build** workflow starts the app builds for testers on Expo's build servers. Nothing needs
to be installed on your computer once the one-time setup below is done.

| Platform | Choice                     | What it builds                                                                     | How testers get it                                           |
| -------- | -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Android  | `link`                     | An installable APK (`preview` profile)                                             | Open the build page link on their phone and install it       |
| Android  | `play-closed-test`         | A store bundle, `.aab` (`production` profile), sent to the Play closed test as a draft | The Play Store, once you roll the draft out in Play Console  |
| Android  | `play-closed-test-rollout` | The same store bundle, rolled out to closed testers straight away                  | The Play Store, after joining the closed test                |
| iOS      |                            | A store build (`production` profile), sent on to TestFlight                        | The TestFlight app, after you add them as testers            |

The Google Play choices need the one-time Play Console setup in
[Google Play closed testing](play-closed-testing.md) first.

Both use the live Supabase project (see [Test and live](environments.md)). Each build counts towards
the Expo plan's monthly builds, so the workflow only runs when you start it.

## One-time setup

1. **Expo token.** On [expo.dev](https://expo.dev), open **Account settings > Access tokens** and
   create a token (name it something like `github-builds`). In GitHub, **Settings > Secrets and
   variables > Actions**, add it as a repository secret called `EXPO_TOKEN`.
2. **Live Supabase settings in EAS.** Do step 4 of
   [Test and live](environments.md#4-point-the-installed-apps-at-the-live-project) if you haven't,
   so builds know which database to use. Every build checks them before it starts: see
   [What a build checks first](#what-a-build-checks-first).
3. **Signing keys, once per platform, from your computer.** GitHub can't answer questions, so the
   first build of each platform has to be started by hand, where EAS asks to create and keep the
   signing keys:
   - Android: `npx eas-cli@latest build --platform android --profile preview`, and let EAS generate
     a new keystore. The Play closed test builds use the same keystore, as the upload key.
   - iOS (needs a paid Apple Developer account):
     `npx eas-cli@latest build --platform ios --profile production --auto-submit`. Sign in with your
     Apple ID when asked. EAS creates the certificates and the app in App Store Connect, and saves
     an App Store Connect API key so later builds can go to TestFlight without you.

   The app's store id is `au.pivt.firstpass.hq` (it was `au.com.wcmmna.thunder` until October
   2026). Signing keys belong to a store id, so after that change both platforms need this step
   once more, and testers install the new app alongside the old one and sign in again.

   From then on, EAS keeps the keys and GitHub can start builds on its own.

## Making a build

1. In GitHub, open **Actions > Beta build > Run workflow**.
2. Pick **android**, **ios** or **both**. For Android, pick how testers get it (the table above);
   it starts on `link`. For iOS you can add a note on what testers should try.
3. When the run finishes, its summary has a link to each build on expo.dev.

- **Android, `link`:** when the build is done, share its expo.dev page with testers. It has an
  install link and a QR code. Testers may need to allow installs from their browser.
- **Android, Play closed test:** the build page shows the submission to Google Play once the build
  is done. A draft waits in **Closed testing - Alpha** until you roll it out. Testers update from
  the Play Store. See [Google Play closed testing](play-closed-testing.md).
- **iOS:** Apple processes the build before it appears in TestFlight. Add testers in App Store
  Connect under **TestFlight**. People in your Apple team can test straight away; anyone else needs
  Apple's beta review the first time.

Small fixes that don't add a native library don't need a new build: publish them over the air with
`scripts/publish-update.sh` (see [Test and live](environments.md#day-to-day)).

## What a build checks first

The club's address and key are built into the app from the EAS environment named after the build's
profile (`preview` or `production`): the **Environment variables** page on expo.dev. A build can't
read them from GitHub or from the `.env` on your computer. An app built without them stops the
moment it opens, and nothing else says so: the build is green, it is signed, and the store accepts
it. That is what happened to the first signed builds, on 18 November 2026.

So the first thing a build does on Expo's servers is run `scripts/check-build-settings.js` (the
`eas-build-pre-install` script in `package.json`). The build stops in its first minute, and the
top of the log on its expo.dev page says why, when:

- `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY`, the live club's address and key,
  is missing;
- an address isn't `https://` and the project's address alone, such as
  `https://abcd1234.supabase.co`, with no slash at the end;
- a key is a secret or `service_role` key (those give full access to a club's data and must never
  be in an app), has expired, or belongs to another project than its address;
- only one of `EXPO_PUBLIC_DEMO_CLUB_URL` and `EXPO_PUBLIC_DEMO_CLUB_ANON_KEY` is set, or the demo
  club is the live club's own project. With neither set the build goes ahead without a demo club.

Before that, when a build is started, EAS prints which variables it found:

```
Environment variables with visibility "Plain text" and "Sensitive" loaded from the "production"
environment on EAS: EXPO_PUBLIC_DEMO_CLUB_ANON_KEY, EXPO_PUBLIC_DEMO_CLUB_URL,
EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SUPABASE_URL.
```

If it says `No environment variables ... found` instead, the variables aren't where this project
reads them. Add them on the project's own page (expo.dev, the `thunderapp` project,
**Environment variables**) with **Preview** and **Production** ticked. Variables added on the
account's page are marked **Global** and reach every project in the account, this one included.

If an installed build ever closes the moment it opens, look here first: the iPhone's crash report
names `ErrorRecovery.crash()` from expo-updates, which only means the app's own code stopped
before the first screen.

## What goes up to Expo

Before each build, EAS copies this folder up to Expo's build servers. `.easignore` lists what stays
behind: everything `.gitignore` lists, the copy of the git history EAS would otherwise add, and
`docs/` (the guides, PDFs, screenshots and branding files). That takes the upload from about 470 MB
to under 10 MB, so a build starts sooner from your computer and from GitHub.

EAS reads `.easignore` **instead of** `.gitignore`, not as well as it (Expo's
[.easignore](https://docs.expo.dev/build-reference/easignore/) page, read 18 November 2026). So
when a line is added to `.gitignore`, add it to `.easignore` too, or a build would upload those
files. `scripts/test-build-upload.py` checks that on every push, and that nothing a build reads is
left out.

Leaving these out changes nothing in the app: no build reads a file from `docs/` or from the git
history, and the app's runtime version (its fingerprint) is the same with and without them.

## Sign in with Apple and iPhone signing

The app has the **Sign in with Apple** capability (`ios.usesAppleSignIn` in `app.json`). Expo's
[iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/) page (read 17 November
2026) says `eas build` compares the app's entitlements with the App ID on the Apple Developer site
and turns on any capability it supports that is missing; Sign in with Apple is on its list. The
same page says that when a capability is turned on by hand instead, any existing provisioning
profiles for the store id must be regenerated before they can sign a store build.

So the first signed iPhone build after Sign in with Apple merged needs EAS to change things on
Apple's side:

- If you haven't made your first iPhone build yet (step 3 above), make it after the Sign in with
  Apple change is on main. Nothing extra is needed.
- If you made iPhone builds before it, start the next one from your computer with the step 3
  command, so EAS can sign in to Apple, turn the capability on and make a new profile. The page
  doesn't say a GitHub build can do this without you, so don't rely on it. After that, GitHub builds
  work as before.
