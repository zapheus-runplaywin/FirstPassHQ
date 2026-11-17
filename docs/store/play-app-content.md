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
- **To confirm:** depends on the demo club sign-in (W7), which waits on your yes to tab D2.
  Without it, Google's reviewers have no way in, and the closed test can't be reviewed.

## Ads

- **No, my app does not contain ads.** No ad library is in `package.json`.

## Content rating

The IARC questionnaire. The category and answers are below; the exact question wording is
**to confirm** when you open it, as it changes by category.

- **Email address for IARC:** the support address, **to confirm** (see below).
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

**To confirm with Matt by Thu 19 Nov: who is the youngest person who signs in themselves?** The
join flow has no minimum age today, and under 18s stay locked until a verified parent approves
(#201). The answer here follows from it:

| If the youngest is | Tick these age groups | What follows |
| --- | --- | --- |
| 18 or over (children never sign in) | 18 and over | Simplest. Under 18 athletes are then reached only through their parents, which is not how the app works today |
| 13 to 17 (recommended reading of today's teams, if no one under 13 signs in) | 13 to 15, 16 to 17, 18 and over | Google says these groups "may be considered to include children in some locales". Play shows extra questions; the app's design (no ads, no direct messages, parent approval, parent copies of messages) answers them |
| under 13 | Add the matching younger groups | The app becomes subject to the Families Policy: Families-certified libraries only, a teacher-approved style review, and the Data safety "committed to Families Policy" box. Not recommended for this year |

- **Store listing appeals to children?** **No.** Plain club administration screens, no
  cartoons or games.
- A minimum-age rule inside the app would be a new access rule with its own yes, tests and user
  guide change. It is not part of this work.

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

The listing and the IARC questionnaire need a contact email shown in public. **To confirm with
Matt:** which address.
