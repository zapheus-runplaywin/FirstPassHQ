# Google Play closed testing

How FirstPass HQ gets onto Android phones through the Google Play Store before it is public. Testers
install it from the Play Store like any other app, after joining the test with their Google
account. Builds come from the **Beta build** workflow (see [Beta builds from GitHub](beta-builds.md)).

Why a closed test: a personal Play Console account opened after 13 November 2023 has to run a closed
test with at least 12 testers who stay opted in for 14 days in a row before it can apply for
production access ([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)).
The 14 days only count while 12 testers are opted in, so aim for 15.

Everything below is done once, in this order, except "Each new build" at the end.

## 1. Create the app in Play Console

1. In [Play Console](https://play.google.com/console), choose **Create app**.
2. App name **FirstPass HQ**, default language English (Australia), **App**, **Free**. Tick the
   declarations and create it.
3. The package name is fixed by the first upload: `au.pivt.firstpass.hq` (from `app.json`). It can
   never change for this listing.

The app stays a draft in Play Console until the setup tasks in step 4 are done. Google only accepts
draft releases for a draft app, which is why the workflow's **play-closed-test** choice sends a
draft.

## 2. Let EAS upload builds (Google service account key)

EAS needs a Google service account key to send builds to Play. The key is kept on Expo's servers,
never in this repository (`scripts/test-store-build.py` refuses a key file in `eas.json`).

1. Follow Expo's guide,
   [Creating a Google Service Account](https://github.com/expo/fyi/blob/main/creating-google-service-account.md):
   make a service account in Google Cloud, enable the **Google Play Android Developer API**, and
   download its JSON key.
2. In Play Console, **Users and permissions > Invite new users**, add the service account's email,
   and give it **Release apps to testing tracks** for FirstPass HQ (and **View app information**).
3. Upload the key to EAS from your computer:
   `npx eas-cli@latest credentials --platform android`, choose the **production** profile, then
   **Google Service Account > Upload a Google Service Account Key**. Delete the downloaded JSON file
   afterwards.

Without this the Android build still finishes, but its submission fails with a message about the
missing key.

## 3. Make the closed test track and the tester list

1. **Test and release > Testing > Closed testing**. Play Console starts you with a track called
   **Closed testing - Alpha**. Use that one: it is the track called `alpha` in `eas.json`, and the
   only closed track the workflow sends to.
2. **Countries / regions**: add Australia (and anywhere a tester lives).
3. **Testers**: create an email list (for example "FirstPass HQ pilot") and add each tester's
   Google account email, the one signed in to the Play Store on their phone. Add a feedback email.
   Save.
4. Copy the **Join on the web** link from the Testers tab. Testers open it on their phone, tap
   **Become a tester**, then install from the Play Store link on that page. Only people on the list
   can join.

People on the list who haven't opened the link and joined don't count towards the 12. Check
**Closed testing > Testers** for the opted-in count.

## 4. Fill in the App content forms

Under **Monitor and improve > Policy and programs > App content** (also listed on the **Dashboard**
as setup tasks), Google wants these before any reviewed release. Answers must match what the app
really does.

| Form | What to give |
| --- | --- |
| Privacy policy | The public privacy policy address. The club template in `docs/policies/` is not a public page |
| App access | "All or some functionality is restricted", with sign-in instructions a reviewer can follow without a personal Google account |
| Ads | No ads |
| Content rating | Fill in the questionnaire: a club administration app with messages between club members, no user-generated public content |
| Target audience and content | The age groups who sign in themselves. Pick only ages that really sign in, because choosing under 13 brings the Families policy |
| Data safety | What the app collects and why: names, emails, dates of birth, health information (injuries, check-ins), messages, photos of session plans. Nothing sold or used for ads; data encrypted in transit; members can delete their account in the app |
| Account deletion | A public web page where members can ask for their account and data to be deleted, plus a note that **Delete account** at the bottom of the home screen does it in the app. Say what the club keeps afterwards (injury records for its keep period, code of conduct acceptances, concerns), as the user guide's "Deleting your account" does |
| Government apps, financial features, news | No |
| Health apps | Declare it if asked: it records injuries and wellbeing check-ins for club members |

## 5. The first upload

1. Run **Actions > Beta build > Run workflow**, platform **android**, Android build
   **play-closed-test**. This builds the store bundle (`.aab`) with the `production` profile, using
   the live Supabase project, and sends it to **Closed testing - Alpha** as a draft.
2. When the build finishes (about 15 to 25 minutes), its expo.dev page shows the submission. If the
   submission fails because Google doesn't know the app yet, download the `.aab` from the build page
   and upload it by hand in **Closed testing > Create new release**.
3. In Play Console, open **Closed testing - Alpha**, find the draft release, add release notes,
   then **Review release > Start rollout to Closed testing**.
4. Google enrols the app in Play App Signing on that first upload. Accept it. EAS keeps the upload
   key; Google keeps the key that signs what testers install.
5. Watch **Publishing overview**. Google may review the first release before testers can install it.
   Write down how long it took in this file, because nobody has confirmed it for this app yet.

## Each new build

Run the **Beta build** workflow with platform **android** and one of:

| Android build | What happens |
| --- | --- |
| `link` | An installable APK (the `preview` profile). Share the expo.dev page; testers install it outside the Play Store |
| `play-closed-test` | A store bundle sent to the closed test as a **draft**. Roll it out in Play Console (step 5, item 3) |
| `play-closed-test-rollout` | A store bundle rolled out to closed testers as soon as Google accepts it. Use it only after the first release has been rolled out by hand |

Every build counts towards Expo's monthly build allowance, so start one only when it carries
something an over-the-air update can't (see [Beta builds from GitHub](beta-builds.md)). Version
numbers go up on their own (`autoIncrement` with the version kept on Expo's servers).

Nothing here sends a build to Play's production track. Applying for production access comes after
the 14 days, from the Dashboard.
