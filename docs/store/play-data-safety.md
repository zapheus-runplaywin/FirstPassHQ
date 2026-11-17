# Google Play: Data safety form

Play Console > FirstPass HQ > Policy > App content > Data safety. Answers in the order the form
asks, each from [data-inventory.md](data-inventory.md) (row numbers in brackets). Google's
definitions: "collected" means sent off the phone; sending data to a service provider that
processes it for us (Supabase, Expo's push service) is not "shared"
([Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469)).

Before you submit, check that the form's wording still matches. Google changes it now and then;
where a question has moved or a data type has a new name, pick the closest match and tell this
thread so the file is updated.

## Data collection and security

| Question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | Rows 1 to 20 |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS/TLS to Supabase and to Expo's push service |
| Which of the following methods of account creation does your app support? | **OAuth** (Sign in with Google; Sign in with Apple on iPhone, #219) | `src/lib/sign-in.ts` |
| Delete account URL | The public delete page, **to confirm** when W9 publishes it (planned `https://firstpass-hq.expo.app/delete-account`) | [public-pages/delete-account.md](public-pages/delete-account.md) |
| Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? | **No** | The app deletes the whole account; other requests go to the club's admin, which is not a self-serve path. Answer Yes only if you want to offer it by email |
| Committed to the Play Families Policy | **No** | The app is 13 and over (Matt, 18 Nov). See [play-app-content.md](play-app-content.md#target-audience-and-content) |
| Independent security review | **No** (optional) | |

## Data types

Every type below is **collected, not shared**, **not processed ephemerally** (it is stored), and
used only for the purposes named. None is used for advertising, marketing, analytics,
personalisation or fraud prevention. "Required" means a member can't use the app without it.

| Category | Data type | Collected? | Required or optional | Purposes | Rows |
| --- | --- | --- | --- | --- | --- |
| Personal info | Name | Yes | Required | App functionality, Account management | 2 |
| Personal info | Email address | Yes | Required (the sign-in email; the PlayHQ email is optional) | App functionality, Account management | 1, 4 |
| Personal info | User IDs | Yes | Required | App functionality, Account management | 1 |
| Personal info | Phone number | Yes | Optional (emergency contacts' numbers) | App functionality | 8 |
| Personal info | Other info | Yes | Required (date of birth). Optional: Working With Children Check details, guardian links | App functionality, Fraud prevention, security and compliance (screening the law requires) | 3, 5, 6 |
| Personal info | Address, Race and ethnicity, Political or religious beliefs, Sexual orientation | No | | | |
| Financial info | All types | No | | | |
| Health and fitness | Health info | Yes | Optional | App functionality | 7, 8, 9 |
| Health and fitness | Fitness info | Yes | Optional | App functionality | 10 |
| Messages | Other in-app messages | Yes | Optional | App functionality | 12 |
| Messages | Emails, SMS or MMS | No | | | |
| Photos and videos | Photos | Yes | Optional | App functionality | 7, 15, 16 |
| Photos and videos | Videos | No | | | |
| Audio files | All types | No | | | |
| Files and docs | Files and docs | Yes | Optional | App functionality | 6, 7, 15, 16 |
| Calendar | Calendar events | No | The app reads the club's calendar, not the phone's | | |
| Contacts | Contacts | No | | | |
| App activity | App interactions | Yes | Required (attendance, read receipts, who opened a child's records) | App functionality, Fraud prevention, security and compliance | 11, 12, 18 |
| App activity | Other user-generated content | Yes | Optional (game goals, surveys, session plans, concerns, award votes) | App functionality | 13, 14, 15, 17, 20 |
| App activity | In-app search history, Installed apps, Other actions | No | | | |
| Web browsing | Web browsing history | No | | | |
| Location | Approximate, Precise | No | | | |
| App info and performance | Crash logs, Diagnostics, Other app performance data | **No** today. The app log stays on the phone (row 22). Change to Yes when W2 crash reporting merges | | | 22 |
| Device or other IDs | Device or other IDs | Yes | Optional (only if the member allows notifications) | App functionality | 19 |

### Notes for the form

- **Push tokens.** Google's examples for "Device or other IDs" are installation and device ids;
  a push token is declared there to be safe. The token and notification text pass through
  Expo's push service and Apple or Google to reach the phone. That is a service provider
  delivering for us, so it is not "shared".
- **Health info** covers injuries, medical and emergency details, and the daily check-in's
  soreness, stress and mood. The app is a club administration tool, not a medical service.
- **Game stats** (row 21) are recorded in FirstPass Vantage, not this app, and are declared on
  Vantage's form.
- **Data deletion.** Members delete their account in the app (Delete account, at the bottom of
  the home screen) or through the public delete page. Some records are kept by the club for set
  periods; the delete page lists them.
