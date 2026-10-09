# Beta builds from GitHub

The **Beta build** workflow starts the app builds for testers on Expo's build servers. Nothing needs
to be installed on your computer once the one-time setup below is done.

| Platform | What it builds                                              | How testers get it                                     |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Android  | An installable APK (`preview` profile)                      | Open the build page link on their phone and install it |
| iOS      | A store build (`production` profile), sent on to TestFlight | The TestFlight app, after you add them as testers      |

Both use the live Supabase project (see [Test and live](environments.md)). Each build counts towards
the Expo plan's monthly builds, so the workflow only runs when you start it.

## One-time setup

1. **Expo token.** On [expo.dev](https://expo.dev), open **Account settings > Access tokens** and
   create a token (name it something like `github-builds`). In GitHub, **Settings > Secrets and
   variables > Actions**, add it as a repository secret called `EXPO_TOKEN`.
2. **Live Supabase settings in EAS.** Do step 4 of
   [Test and live](environments.md#4-point-the-installed-apps-at-the-live-project) if you haven't,
   so builds know which database to use.
3. **Signing keys, once per platform, from your computer.** GitHub can't answer questions, so the
   first build of each platform has to be started by hand, where EAS asks to create and keep the
   signing keys:
   - Android: `npx eas-cli@latest build --platform android --profile preview`, and let EAS generate
     a new keystore.
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
2. Pick **android**, **ios** or **both**. For iOS you can add a note on what testers should try.
3. When the run finishes, its summary has a link to each build on expo.dev.

- **Android:** when the build is done, share its expo.dev page with testers. It has an install link
  and a QR code. Testers may need to allow installs from their browser.
- **iOS:** Apple processes the build before it appears in TestFlight. Add testers in App Store
  Connect under **TestFlight**. People in your Apple team can test straight away; anyone else needs
  Apple's beta review the first time.

Small fixes that don't add a native library don't need a new build: publish them over the air with
`scripts/publish-update.sh` (see [Test and live](environments.md#day-to-day)).
