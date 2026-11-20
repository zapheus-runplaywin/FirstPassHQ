# Privacy and social media assessments

13 October 2026 · child safety audit finding 17

These are two decisions about the app, written down with their reasons
because either could change. They draw on the legal research of 12 October
2026 (`child-safety-legal-research-2026-10-12.md`, section 6). They aren't
legal advice: where a section says to get advice, the club should.

Review both assessments every year, when a new club joins, and before any
change listed under "What would change this".

## 1. Does the Privacy Act 1988 (Cth) bind the club?

**Decision: probably not today, for a club like West Coast Thunder. The app
is built to the Act's standards anyway.**

### Reasons

- An incorporated or unincorporated association is an "organisation" under
  the Act. It is exempt as a small business operator when its annual turnover
  is $3 million or less, unless it provides a health service, trades in
  personal information, is a Commonwealth contractor or opts in (OAIC,
  "Rights and responsibilities").
- A community netball club's turnover is far below $3 million. It doesn't
  trade in personal information or contract to the Commonwealth.
- **The open question is health information.** The app keeps injuries,
  physio updates, return-to-play clearances and medical letters. A club whose
  physio records treatment may be a "health service provider" for those
  records. If it is, the Act binds the club for that information whatever its
  turnover. **Get legal advice on this**, and assume the Act applies to injury
  records until the advice says otherwise.
- The *Privacy and Other Legislation Amendment Act 2024* did not remove the
  small business exemption. The government has agreed in principle to remove
  it, but no bill had been introduced as at 12 October 2026. The statutory
  tort for serious invasions of privacy (from 10 June 2025) applies to every
  club regardless of turnover.
- The *Privacy (Children's Online Privacy) Code 2026* must be registered by
  10 December 2026. It binds only entities the Act already covers, so the
  small business exemption still applies. The app already meets its main
  standards:
  - a checked date of birth for every athlete;
  - a verified parent or guardian, and their consent, before anyone outside
    the family sees a child's check-ins or injuries;
  - only the information the club needs;
  - a parent can see who opened their child's records;
  - old records are removed on a schedule the club sets;
  - a member can delete their account.

### What the app does regardless

The app treats every club as if the Act and the Code applied, so a club that
crosses the line, or a change in the law, doesn't need a rebuild. The privacy
policy template (`docs/policies/privacy-policy.md`) says what is kept, who
sees it and for how long.

### Questions on messages (reassessed 20 November 2026)

Matt asked for a way to answer a question in a message without opening up
chat ("If we don't support real use cases the teams will use other chat
platforms which are less safe anyway"). Built in
`20261120300000_message_questions.sql`:

- A message may ask one question with 2 to 4 answers the sender sets (such
  as Yes / No / Not sure). Members tap one, once; it can't be changed, and
  there is no box to type in and no answer to an answer.
- Names are seen only by whoever sent it, the squad or team's coaches and
  managers, and admins. Captains who ask are treated like coaches (Matt).
  Other members see nothing, or only the totals if the sender shares them.
- A parent or guardian can answer for their child under 18, and always sees
  the question, their child's answer, who gave it and when.

**Still not an age-restricted social media platform.** The answers are
structured replies to a club notice, like the quick polls the app already
has: they go back to the sender's side, never to other members, so they add
no interaction between users. Every child's answer to an adult is seen by
the child's parents and by the club, which meets netball's two-deep rule for
electronic communication. No new kind of personal information is collected.

**What would reopen this:** written answers, names shown to other members, or
any way to answer an answer.

### What would change this

- Advice that the club is a health service provider (the Act then applies to
  injury records at least).
- The small business exemption being removed or narrowed.
- A club with turnover over $3 million, or one that opts in.
- The app being run for clubs by an operator that is itself bound by the Act
  (the operator, and the Children's Online Privacy Code, would then apply).

## 2. Is the app an "age-restricted social media platform"?

**Decision: no. The app is a club administration tool, and it must stay
that way for members under 18.**

### The law

The *Online Safety Amendment (Social Media Minimum Age) Act 2024* has applied
since 10 December 2025. Providers of age-restricted social media platforms
must take reasonable steps to stop under-16s holding accounts. A service is
caught when a significant purpose is online social interaction between users,
users can link to or interact with each other, and users can post material.
There is no size threshold.

The *Online Safety (Age-Restricted Social Media Platforms) Rules 2025* exclude
services whose sole or primary purpose is messaging, online gaming, product
or service information, professional networking, education or health.

### Reasons

The app's primary purpose is running a club: membership, squads and teams,
fixtures and calendars, attendance, injuries and clearances, integrity
training, awards, and safeguarding records. What members can post is narrow
and tied to that purpose:

| Feature | What members can post | Why it isn't social interaction |
| --- | --- | --- |
| Messages | Coaches, managers, the committee, admins and captains send notices to squads, teams, roles or the club, and may ask one question with 2 to 4 answers they set | One way: no replies, no written answers, no direct messages, no threads. A question takes one tap from the answers the sender set, once; only the sender's side (the sender, the group's coaches and managers, admins) and the member's own parents see who answered what. Parents get a copy of every message to or from a child and can answer for their child. |
| Daily check-ins | An athlete's scores and an optional note | Seen only by the athlete, their parents and their coaches (with a parent's consent for under 18s). Never shown to other athletes. |
| Game goals and reflections | An athlete's own goals and how the game went; coaches comment | Coaching between an athlete and their coaches, read by parents. Other athletes don't see them. |
| Team goals | Coaches set goals for a game; athletes and coaches in the team comment | Inside one coach-led team, about one game, read by parents. Coaches can remove any comment. No likes, sharing or following. |
| Injuries | Athletes, parents, physios and coaches record an injury and its clearance | Health records, shown only to the people who look after the athlete. |
| Raise a concern | Anyone reports a worry | Goes only to the club's safeguarding contacts. |

There are no profiles to browse, no profile pictures, no feeds, no likes, no
following or friends, no public posts and no way to find or contact a member
outside your own squads and teams. That places the app with the services the
Rules exclude (messaging, education, health), alongside services eSafety
lists as not currently age-restricted, such as Messenger, WhatsApp and Google
Classroom. It doesn't belong with social media.

### The design rule that follows

For members under 18, the app must never have:

- replies to messages (written answers of any kind), or direct messages
  between members. Picking one of the answers the sender set on a question
  is allowed: see "Questions on messages" below;
- feeds, timelines or stories;
- profile pictures, or profiles members can browse;
- following, friends or contacts lists;
- likes, reactions or sharing;
- posts visible outside a member's own squads and teams.

Any comment feature must sit inside a coach-led squad or team, be about a
coaching item, be readable by parents and guardians, and be removable by
coaches. This rule is also in `AGENTS.md`, so every change to the app is
checked against it.

### What would change this

Any feature that breaks the design rule reopens this assessment before it
is built, not after. Also: eSafety guidance or the Rules changing, or the
app's primary purpose changing (for example, public highlights or a fan
page). If the question reopens, use eSafety's self-assessment tool and
record the result here.
