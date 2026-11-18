# Store listing pack

Everything Google Play and the App Store ask about FirstPass HQ, each answer checked against the
code, plus the text of the three public pages the stores link to. Design: tab D4 of the year-end
launch plan (work item W3). Nothing outside `docs/store/` changes for this pack, and the user
guide doesn't change, because nothing a member sees or does changes.

## Files

| File | What it holds | Step |
| --- | --- | --- |
| [data-inventory.md](data-inventory.md) | The single source: every kind of data, where in the code, why, who sees it, how long, whether it leaves the club's project | 1 |
| [play-data-safety.md](play-data-safety.md) | Google's Data safety form, question by question | 1 |
| [play-app-content.md](play-app-content.md) | App access, ads, content rating, target audience, health, advertising ID, privacy and deletion links | 1 |
| [play-listing.md](play-listing.md) | Name, descriptions, category, contact details, countries | 1 |
| [review-notes.md](review-notes.md) | What reviewers need: the DEMO club, which account shows which role, what the app is for. Never the password | 1 |
| [public-pages/privacy.md](public-pages/privacy.md) | Privacy policy page | 1 |
| [public-pages/support.md](public-pages/support.md) | Support page | 1 |
| [public-pages/delete-account.md](public-pages/delete-account.md) | Delete-my-account page | 1 |
| `apple-privacy-labels.md`, `apple-listing.md` | Apple's privacy questions and listing, age rating, export compliance | 2, Fri 27 Nov |
| `screenshots/` | Store screenshots and Google's feature graphic, sample people only | 3, Fri 4 Dec |

The public pages are published by the small site in the Vantage and Vision repo (`apps/site`,
work item W9), which copies these Markdown files word for word. They are plain Markdown on
purpose: one `# Title` line, then headings, paragraphs, lists, bold and links only, and links
between pages as `/privacy`, `/support` and `/delete-account`. Keep it that way when editing.
Change the words here, then the site copies them again.

## Answered

- **13 and over this year** (Matt, 18 Nov). Play target audience 13 to 15, 16 to 17 and 18 and over; no Families Policy. The join rule that turns away under 13s merged in #225.
- **Demo club sign-in: build it now** (Matt, 18 Nov). Merged in #224; the review notes' accounts are checked against `supabase/demo-club.sql`.
- **Operator name on the privacy page: Matthew Brown** (Matt, 18 Nov), matching the App Store seller.
- **Support email: pivtmedia@gmail.com** (Matt, 18 Nov). Used in the three pages, Play contact details, IARC and TestFlight feedback.

## To confirm before any form is filled

| What | Who | Needed by | Where it is used |
| --- | --- | --- | --- |
| A read of the privacy, support and delete pages, including the 14-day reply promised on the delete page, and the privacy page's statements that Google and Apple sign-in and the notification services (Expo, Apple, Google) are run from outside Australia | Matt | Thu 19 Nov | Before W9 publishes them |
| The public page addresses (planned `https://firstpass-hq.expo.app/...`) | W9 | Thu 19 Nov | Privacy policy and deletion links in Play |
| No `AD_ID` permission in the first store build's merged manifest | W8 | First upload | Advertising ID answer |
| The test project's region (the demo club holds sample people only) | Matt | Step 2 | Data inventory |
| Whether the record of who opened a child's records stays after the child's account is deleted (open from security audit run 1; today it is deleted) | Matt | Step 2 | Data inventory, delete page |
| The app's name on each store, if not "FirstPass HQ" | Matt | Thu 19 Nov | Listing |

The "Last updated" date at the top of the privacy page changes whenever its words change.

## Checks before anything is submitted

There is no code here, so the check is consistency. Before a form is filled or a link is given
to a store:

- the privacy page, the Data safety answers and (step 2) Apple's privacy labels are compared row
  by row against `data-inventory.md`;
- the delete page is compared with `src/app/delete-account.tsx` and `delete_member_now`;
- the review notes are compared with `supabase/demo-club.sql`;
- every screenshot is checked for real names (there must be none) and the current brand kit;
- the published pages are compared with the files here.

When a pull request changes what the app collects, who sees it, how long it's kept or how
deletion works, it updates `data-inventory.md` and the files that quote it in the same pull
request.
