# Notes for store reviewers

What Google's and Apple's reviewers, and TestFlight's beta review, need to get in and understand
the app. The demo password is **never written here or anywhere in the repo**: you type it into
each store form yourself.

The demo club is merged (#224). The club code and the five accounts below were checked against
`supabase/demo-club.sql`, which the "Reset demo club" workflow runs on the test project. Run that
workflow, and check the test project isn't paused, the day before each submission.

## Signing in

- **Club code:** `DEMO` (FirstPass Demo Club). It holds sample people only, never a real member.
- **How:** open the app, enter `DEMO`, tap the button to continue, then sign in with an email
  and password on the next screen. Real clubs show "Continue with Google", and "Continue with Apple" on iPhone and iPad.
- **Password:** the same for every demo account. You paste it into the store form.

| Account | Signs in as | What to look at |
| --- | --- | --- |
| `admin@demo.firstpass.example` | Admin | Administration: approving members, squads and teams, club settings, keep periods |
| `headcoach@demo.firstpass.example` | Head coach of the 20 & Under team, current Working With Children Check | Messages to the team, attendance, injured athletes and restrictions, session plans |
| `athlete19@demo.firstpass.example` | Athlete aged 19 | Home screen to-do list, calendar, daily check-in, reporting an injury or absence |
| `guardian@demo.firstpass.example` | Verified parent of `athlete16@` | Only their own child's records; who opened them; consents |
| `athlete16@demo.firstpass.example` | Athlete aged 16, linked to a verified parent | The under 18 rules |

These names follow the shared list in project files `thunder/pilot/demo-accounts.md`, which W7, the
pilot test scripts and these notes all use; it lists more accounts for our own testers. Give
reviewers the five above so the form stays short.

## Google Play: App access instructions

Paste into Policy > App content > App access > Add instructions. Google's form has separate
boxes for username, password and other instructions.

- **Name:** Demo club
- **Username:** `admin@demo.firstpass.example`
- **Password:** (you type it)
- **Any other information:**

> Enter the club code DEMO on the first screen, then sign in with the email and password. This is
> a demo club with sample people only. Other roles use the same password: headcoach@,
> athlete19@, guardian@ and athlete16@demo.firstpass.example. Each club using FirstPass HQ has its own code and
> signs in with Google, or with Apple on iPhone.

## TestFlight: beta app review and "What to test"

App Store Connect > TestFlight > Test information.

- **Sign-in required:** yes. Username and password as above.
- **Beta app description:**

> FirstPass HQ runs netball clubs: messages, attendance, injuries, Working With Children Checks
> and child safety, for admins, coaches, managers, athletes and parents.

- **What to test** (build A):

> Sign in to the DEMO club as each role and check you see what that role should. Report anything
> that looks wrong, or a screen you expected and couldn't reach, through TestFlight's feedback.

- **Feedback email:** pivtmedia@gmail.com.

## Notes for the reviewer (App Review Information, and the Play notes box)

> FirstPass HQ is an administration app for netball clubs, not a medical service and not social
> media. It is for any netball club: each club gets a club code and its own private database, and
> members ask to join their club and are approved by its admins. The DEMO club code opens a demo
> club with sample people so you can see each role.
>
> Injury records and wellbeing check-ins are kept so the club can look after injured athletes and
> clear them to play. The app gives no diagnosis or treatment.
>
> Athletes under 18 can't use the app until a verified parent or guardian is linked. There are no
> direct messages, replies, feeds, profile pictures or likes. Messages go from coaches, managers,
> the committee and admins to whole squads, teams or roles, and parents get a copy of every
> message to or from their child.
>
> The app contains no ads, tracking or purchases. Members delete their account in the app: Delete
> account, at the bottom of the home screen.

## Questions a reviewer may ask

| Question | Answer | Source |
| --- | --- | --- |
| Why is a club's app public? | It serves any netball club; the club code picks the club, and DEMO shows it working. Not verified with Apple. If Apple objects, unlisted distribution is the fallback (tab D4) | `src/constants/clubs.ts`, `src/app/choose-club.tsx` |
| How is user content moderated? | Only coaches, managers, the committee and admins send messages, to whole groups, and admins can remove anyone's access. There are no replies or direct messages. Anyone can raise a concern with the club's Child Safety Officer from Raise a concern | User guide: Messages, Raise a concern, Approving members |
| Can I delete my account? | Yes: Delete account at the bottom of the home screen, then Delete my account permanently | `src/app/delete-account.tsx` |
| Which sign-in methods are there? | Continue with Google, and Continue with Apple (Sign in with Apple) on iPhone and iPad. A member who chose Hide My Email isn't required to give a PlayHQ email. Parents and guardians still give the email they registered their child with, whatever the sign-in, because it is how the club checks an adult before linking them to a child | `src/lib/sign-in.ts`, `src/app/join.tsx` (#219) |
| Is health data used for anything else? | No. It is seen only by the athlete, their parents, their coaches and physios (for under 18s only with a parent's consent) and admins | [data-inventory.md](data-inventory.md) rows 7 to 9 |
