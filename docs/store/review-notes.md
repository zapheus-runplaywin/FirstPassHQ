# Notes for store reviewers

What Google's and Apple's reviewers, and TestFlight's beta review, need to get in and understand
the app. The demo password is **never written here or anywhere in the repo**: you type it into
each store form yourself.

The demo club is merged (#224). The club code and the five accounts below were checked against
`supabase/demo-club.sql`, which the "Reset demo club" workflow runs on the test project. Run that
workflow, and check the test project isn't paused, the day before each submission.

## Signing in

- **Club code:** `DEMO` (Perth Pumpkins, a made-up demo club). It holds sample people only, never a real member.
- **How:** open the app, enter `DEMO`, tap the button to continue, then sign in with an email
  and password on the next screen. Real clubs show "Continue with Google", and "Continue with Apple" on iPhone and iPad.
- **Password:** the same for every demo account. You paste it into the store form.

| Account | Signs in as | What to look at |
| --- | --- | --- |
| `admin@demo.firstpass.example` | Admin | The Club tab: approving members, squads and teams, club settings, keep periods |
| `headcoach@demo.firstpass.example` | Head coach of the 20 & Under team, current Working With Children Check | Messages to the team, attendance, injured athletes and restrictions, session plans |
| `athlete19@demo.firstpass.example` | Athlete aged 19 | Today's to-do list, calendar, daily check-in, reporting an injury or absence |
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
> direct messages, feeds, profile pictures, likes or following. Messages go from coaches,
> managers, the committee and admins to whole squads, teams or roles. A club can also turn on
> chat groups (off by default) for groups the club sets up by squad, team and role: under 18s
> post only in their own team's group while a coach is in it, the group's coaches can hide any
> post, any member can report a post to the club's Child Safety Officer or block its author (the
> club's admins and safeguarding officers are told of every block), and parents get a copy of
> every message and group post to or from their child.
>
> The app contains no ads, tracking or purchases. Members delete their account in the app: My
> account in the Me tab, then Delete my account.

## Questions a reviewer may ask

| Question | Answer | Source |
| --- | --- | --- |
| Why is a club's app public? | It serves any netball club; the club code picks the club, and DEMO shows it working. Not verified with Apple. If Apple objects, unlisted distribution is the fallback (tab D4) | `src/constants/clubs.ts`, `src/app/choose-club.tsx` |
| How is user content moderated? | Messages come only from coaches, managers, the committee and admins, to whole groups. Chat groups are off unless a club turns them on, and hold only people the club puts together by squad, team and role; members can't make or join groups. A group's coaches (and in an admin's group, its admins) swipe a post to hide it from the group; the text is kept for safeguarding. Any member opens a message or post and taps Report this message, which raises a concern with the club's Child Safety Officer. Any member can block someone in their groups, and the club's admins and safeguarding officers are told and follow it up. Admins can close a group or remove a member's access. There are no direct messages | User guide: Messages, Chat groups, Blocks in chat groups, Raise a concern, Approving members; #294, #295 |
| Can children talk to strangers? | No. A member under 18 posts only in their own squad's or team's automatic chat group while one of its coaches is in it, reads only in other groups, can't see who else is in a group, and has groups hidden until a verified parent is linked. Their parents get a copy of every post in those groups, their child's own included | `20261124600000_chat_groups.sql`; privacy and social media assessment, section 2, "Chat groups" |
| Can I delete my account? | Yes: My account in the Me tab, then Delete my account, then Delete my account permanently | `src/app/my-account.tsx`, `src/app/delete-account.tsx` |
| Which sign-in methods are there? | Continue with Google, and Continue with Apple (Sign in with Apple) on iPhone and iPad. A member who chose Hide My Email isn't required to give a PlayHQ email. Parents and guardians still give the email they registered their child with, whatever the sign-in, because it is how the club checks an adult before linking them to a child | `src/lib/sign-in.ts`, `src/app/join.tsx` (#219) |
| Is health data used for anything else? | No. It is seen only by the athlete, their parents, their coaches and physios (for under 18s only with a parent's consent) and admins | [data-inventory.md](data-inventory.md) rows 7 to 9 |

## App Store: user-generated content (Guideline 1.2) and age rating

Apple asks apps with content members write to have a way to report it, to act on reports, to
block abusive users, and to give contact details
([App Review Guidelines 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content)).
What HQ has, for App Review Information or a reviewer's question:

| Apple asks for | What HQ has | Where |
| --- | --- | --- |
| A way to filter objectionable material | Nobody outside the club can post: every member is approved by the club's admins, and chat groups hold only people the club puts together. A group's coaches hide posts with a swipe. No automatic word filter | Approving members; Chat groups |
| A way to report offensive content | Report this message on any message or group post raises a concern with the club's Child Safety Officer | User guide, Raise a concern |
| A way to block abusive users | Open any post in a chat group and tap Block: that member's posts stop showing to you, and Blocked people lists them with Unblock. Every block is told to the club's admins, Child Safety Officer and Complaints Manager, who follow it up. An adult can't block a member under 18 (they ask a coach to hide the post or raise a concern). Admins can also close a group or remove a member's access | Chat groups, Blocks in chat groups; `20261125400000_chat_blocks.sql` |
| Published contact details | pivtmedia@gmail.com on the support page | [public-pages/support.md](public-pages/support.md) |

In Apple's age rating questions (App Information > Age Rating), answer **Yes** to user-generated
content and to messaging or chat, and **No** to unrestricted web access and advertising. The
exact wording is **to confirm** when you open it. Step 2's `apple-listing.md` takes these answers
over.
