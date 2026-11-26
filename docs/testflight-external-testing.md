# TestFlight external testing (iPhone and iPad closed test)

How FirstPass HQ reaches iPhones and iPads through Apple's TestFlight app before it is in the App
Store. This is the iOS closed test: club members who aren't in our Apple Developer team, such as
the 20 & Under pilot team and their parents, install it from TestFlight after an email invite.
Builds come from the **Beta build** workflow (see [Beta builds from GitHub](beta-builds.md)), which
sends every iOS build to TestFlight on its own.

Apple's pages this follows (read 24 November 2026):
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview),
[Provide test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information)
and [Invite external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).

## How it differs from internal testing

| | Internal testers | External testers |
| --- | --- | --- |
| Who | People in our App Store Connect team, up to 100 | Anyone with an email address, up to 10,000 |
| Apple review | None | Beta App Review for the first build of each version; later builds of the same version may not need it |
| How they join | Added in App Store Connect under **Users and Access** | Email invite or a public link |

There is no 12-testers-for-14-days rule on Apple's side (that is Google's rule for personal Play
accounts, see [Google Play closed testing](play-closed-testing.md)).

Things that hold for both:

- A build can be tested for 90 days after it was uploaded, then it expires. A new Beta build
  resets that.
- Apple accepts six builds a day for review, and one build per version in review at a time.
- The app declares it uses no non-exempt encryption (`ios.config.usesNonExemptEncryption: false`
  in `app.json`), so builds don't wait at **Missing Compliance** for the export question.
  `scripts/test-store-build.py` fails if that line goes.

## Before each submission for review

- Run **Actions > Reset demo club** the day before, and check the test Supabase project isn't
  paused (a free project pauses after a week without use). The reviewer signs in to the DEMO club,
  which lives there. See [Notes for store reviewers](store/review-notes.md).
- The public pages must load: https://firstpass-hq.expo.app/privacy, `/support` and
  `/delete-account`. Use them with no slash at the end.

## One-time setup, in this order

### 1. Test information

App Store Connect > **Apps** > **FirstPass HQ** > **TestFlight** tab > in the left sidebar under
**Additional**, **Test Information**. It needs the Account Holder, Admin or App Manager role.

| Field | Value |
| --- | --- |
| Beta App Description | The text under "Beta app description" in [review-notes.md](store/review-notes.md#testflight-beta-app-review-and-what-to-test) |
| Feedback Email | `pivtmedia@gmail.com` |
| Marketing URL | `https://firstpass-hq.expo.app` |
| Privacy Policy URL | `https://firstpass-hq.expo.app/privacy` |
| Beta App Review Information: first name, last name, phone, email | Matthew, Brown, your mobile number, `pivtmedia@gmail.com` |
| Sign-in required | Ticked. Username `admin@demo.firstpass.example`; password: the demo password, typed by you, never written down here |
| Review notes | The text under "Notes for the reviewer" in [review-notes.md](store/review-notes.md#notes-for-the-reviewer-app-review-information-and-the-play-notes-box), with this line added at the top: "Enter the club code DEMO on the first screen, then sign in with the email and password." |

Press **Save** at the top right.

### 2. Check a build is ready

TestFlight tab > **iOS** under **Builds** in the sidebar. The newest build should show
**Ready to Submit** (or **Testing** if you have an internal group). If it shows **Missing
Compliance**, the build is older than the encryption setting; run a new Beta build. If no build is
there, check the iOS submission on the build's expo.dev page.

### 3. Internal group (if you don't have one)

Apple wants an internal group before an external one. Sidebar > **(+)** next to **Internal
Testing**, name it `Team`, add yourself, and install the build on your own iPhone through the
TestFlight app. Open it, enter `DEMO`, and sign in, so you know the build opens before Apple sees it.

### 4. External group and the first review

1. Sidebar > **(+)** next to **External Testing**. Name it `20 & Under pilot`. **Create**.
2. In the group, **Add Builds** (the **+** next to Builds), pick iOS, version 1.0.0 and the newest
   build, **Next**.
3. **What to Test**: paste the "What to test" text from
   [review-notes.md](store/review-notes.md#testflight-beta-app-review-and-what-to-test). Tick
   **Automatically notify testers**.
4. **Submit for Review**. The group's build shows **Waiting for Review**, then **Approved**
   (Apple emails you). A rejection shows under **App Review** in the sidebar.

### 5. Invite the testers

Once the build is approved, in the group: **(+)** next to **Testers** > **Email**, and type each
person's first name, last name and email (or **Import** a CSV of the same), then **Next**. Each gets an
email from TestFlight.

Use email invites for the pilot, not a public link: you know exactly who has the app, and you can
remove one person. The club code and admin approval still decide who sees any club data.

The email address you type is given to Apple to send the invite. It doesn't have to be the
tester's Apple Account email. An athlete under 18 can't use the app until a verified parent is
linked, so invite a parent at the same time.

What testers do:

1. Install **TestFlight** from the App Store.
2. Open the invite email on the iPhone or iPad and tap **View in TestFlight**, then **Accept** and
   **Install**.
3. Open FirstPass HQ, enter the club code you give them, and sign in with Apple or Google.

## Each new build

1. **Actions > Beta build > Run workflow**, platform **ios** (or **both**).
2. Once Apple has processed it (it appears under **iOS** builds), the group's **Builds** list > **+** > the
   new build, paste the release notes as **What to Test**, and **Submit for Review**. A later build
   of version 1.0.0 often goes straight to testers without a new review.
3. Testers get it in TestFlight (automatically, if they turned on automatic updates there).

Fixes that don't change the native app go out over the air instead, with no new build or review
(`scripts/publish-update.sh`, see [Test and live](environments.md#day-to-day)).
