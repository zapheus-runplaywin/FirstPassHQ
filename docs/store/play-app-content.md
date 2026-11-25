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
  social networking: HQ is a club administration tool. Its messages go to groups the club sets
  up; members can't find, follow or privately message anyone.
- **Violence, fear, sexuality, language, controlled substances, crude humour, gambling:** No to
  each.
- **Does the app allow users to interact or exchange content with other users?** **Yes.** Two
  ways, both text only:
  - **Messages** from coaches, managers, the committee and admins to whole squads, teams and
    roles. Members can't reply in writing; a message may ask one question with answers the
    sender sets, and members pick one.
  - **Chat groups**, only if a club admin turns them on (Club features, off by default). Members
    post back and forth in groups the club sets up by squad, team and role, never ones members
    make or join themselves. Under 18s post only in their own squad's or team's automatic group
    while one of its coaches is in it, and read only in other groups. Every post in a group
    with a child in it is copied to the child's verified parents, and a child with no verified
    parent linked can't see or post in groups until one is.
  - There are no direct messages, no feeds, no profile pictures, no likes and no following, and
    no way to contact a member outside the club's own squads, teams and roles. For under 18s
    every message and group post is copied to their parents (user guide, Messages and Chat
    groups; `docs/security/privacy-and-social-media-assessment-2026-10-13.md`, section 2).
- **If the questionnaire asks how users' content is moderated or reported** (the wording is
  **to confirm**): any member can open a message or post and tap **Report this message**, which
  raises a concern with the club's Child Safety Officer; a group's coaches (and in an admin's
  group, its admins) swipe a post to hide it from the group (#295, the text is kept for
  safeguarding); any member can block a post's author, and every block is told to the admins
  and safeguarding officers to follow up (an adult can't block a member under 18); admins can
  close a group or remove a member's access. There is no automatic word filter.
- **Does the app share the user's current physical location with other users?** **No.**
- **Does the app allow users to purchase digital goods?** **No.**
- **Does the app contain unrestricted internet access (a browser)?** **No.** Links open in the
  system browser.
- Expected result: a low rating such as PEGI 3 / Everyone, with an "Users interact" notice.

## Target audience and content

**13 and over this year** (Matt, 18 Nov, on the lead thread's card).

- **Target age groups:** tick **13 to 15, 16 to 17, and 18 and over**. Leave every group under 13
  unticked. Google says the 13 to 17 groups "may be considered to include children in some
  locales", and Play asks extra questions; the app's design answers them: no ads, no direct
  messages, feeds or profiles, parent approval before an under 18 can use the app, parents
  copied on every message and chat group post, and under 18s posting only in their own
  coach-led team group when the club has chat groups on.
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
