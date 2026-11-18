# Google Play: App content

Play Console > FirstPass HQ > Policy > App content. One section per declaration, in the order
Play Console lists them. Answers come from [data-inventory.md](data-inventory.md). The Data
safety form has its own file, [play-data-safety.md](play-data-safety.md).

## Privacy policy

- **Privacy policy URL:** the public privacy page, **to confirm** when W9 publishes it (planned
  `https://firstpass-hq.expo.app/privacy`). Text: [public-pages/privacy.md](public-pages/privacy.md).
- Matt reads the text before it goes live.

## App access

- **All or some functionality in my app is restricted.** Every screen needs a club sign-in.
- Add one set of instructions. Name: **Demo club**. The details are in
  [review-notes.md](review-notes.md); the password is never written in the repo, so you type it
  into the form yourself.
- The demo club sign-in is merged (#224). It works only in a build that has the demo club's two
  EAS variables (`docs/environments.md`, "The demo club"), so build A must be made after they're
  set.

## Ads

- **No, my app does not contain ads.** No ad library is in `package.json`.

## Content rating

The IARC questionnaire. The category and answers are below; the exact question wording is
**to confirm** when you open it, as it changes by category.

- **Email address for IARC:** pivtmedia@gmail.com.
- **Category:** All other app types (utility, productivity, communication). Not a game, not
  social networking: HQ is a club administration tool with group messages only.
- **Violence, fear, sexuality, language, controlled substances, crude humour, gambling:** No to
  each.
- **Does the app allow users to interact or exchange content with other users?** **Yes.** Group
  messages from coaches, managers, the committee and admins to squads, teams and roles. There
  are no direct messages and no replies, and for under 18s every message is copied to their
  parents (user guide, Messages; `docs/security/privacy-and-social-media-assessment-2026-10-13.md`).
- **Does the app share the user's current physical location with other users?** **No.**
- **Does the app allow users to purchase digital goods?** **No.**
- **Does the app contain unrestricted internet access (a browser)?** **No.** Links open in the
  system browser.
- Expected result: a low rating such as PEGI 3 / Everyone, with an "Users interact" notice.

## Target audience and content

**13 and over this year** (Matt, 18 Nov, on the lead thread's card).

- **Target age groups:** tick **13 to 15, 16 to 17, and 18 and over**. Leave every group under 13
  unticked. Google says the 13 to 17 groups "may be considered to include children in some
  locales", and Play asks extra questions; the app's design (no ads, no direct messages, parent
  approval, parent copies of messages) answers them.
- **No Families Policy.** With no group under 13, the "committed to the Play Families Policy"
  box in the Data safety form stays unticked.
- **Why not 12-year-olds this year:** Google's
  [Families Policy](https://support.google.com/googleplay/android-developer/answer/9893335)
  doesn't let an app for children and older users require sign-in through an OAuth service
  such as Google sign-in, which is HQ's only way in, and
  [Sign in with Apple](https://support.apple.com/en-au/102609) isn't available to children under
  13 (both read 18 Nov).
- **The app turns away under 13s** (#225): the join step refuses a date of birth under 13 and
  saves nothing, and admins can't approve anyone under 13
  (`20261118100000_join_age_13.sql`, `src/app/join.tsx`). Members approved before it are
  unchanged.
- **Store listing appeals to children?** **No.** Plain club administration screens, no cartoons
  or games.

## News apps

- **No.**

## Government apps

- **No.** The app is not made by or for a government.

## Financial features

- **My app doesn't provide any financial features.**

## Health apps

- **The app has health features.** Don't tick "no health features": it stores injury records,
  medical and emergency details and wellbeing check-ins.
- Pick the closest of Google's options, such as injury or fitness tracking for sport. The exact
  list is **to confirm** when you open the form. If nothing fits, pick "Other" and describe it
  as: "Sports club administration: athletes and parents report injuries and upload clearance
  letters, and coaches see current restrictions. No diagnosis or treatment."
- HQ is not a medical device and connects to no health platform.

## Advertising ID

- **Does your app use advertising ID?** **No.**
- **To confirm in W8:** the merged manifest of the first store build has no
  `com.google.android.gms.permission.AD_ID` permission. If a library adds it, W8 removes it in
  `app.json`, or this answer changes.

## Account deletion

Asked in the Data safety form. The link is the public delete page, **to confirm** when W9
publishes it (planned `https://firstpass-hq.expo.app/delete-account`). Text:
[public-pages/delete-account.md](public-pages/delete-account.md).

## Support email for the store

pivtmedia@gmail.com (Matt, 18 Nov), for the listing, the IARC questionnaire and the public pages.
