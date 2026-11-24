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
- Names are seen only by whoever sent it and the squad or team's coaches and
  managers. Captains who ask are treated like coaches (Matt). Admins saw them
  too until `20261121100000_message_archive_and_access.sql`, which stopped
  admins reading messages they didn't send (Matt, 21 November 2026).
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
| Messages | Coaches, managers, the committee, admins and captains send notices to squads, teams, roles or the club, and may ask one question with 2 to 4 answers they set | One way: no replies, no written answers, no direct messages, no threads. A question takes one tap from the answers the sender set, once; only the sender's side (the sender and the group's coaches and managers) and the member's own parents see who answered what. Nobody else reads a message they weren't sent; the Child Safety Officer or Complaints Manager can read one member's messages for an open concern only when an admin who isn't involved approves it, for 24 hours, with every message opened logged. Parents get a copy of every message to or from a child and can answer for their child. |
| Chat groups (off unless an admin switches them on) | Adults in a group post back and forth. A member under 18 posts only in an automatic group of their own squad or team (its coaches and captains, coaches and managers, or coaches and physios) while one of its coaches is in it; in groups admins set up, they read only | Each group is a fixed set of people the club chose by role, squad or team, not people members find or follow. Every post a child can see or write is copied to the child's parents, and the group's coaches can remove any post (the text is kept for safeguarding). Members can't make groups, invite anyone, message one person, or see who is in a group while under 18. See "Chat groups" below. |
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
  is allowed: see "Questions on messages" in section 1. Posting in a
  coach-led chat group of their own squad or team is allowed: see "Chat
  groups" below;
- feeds, timelines or stories;
- profile pictures, or profiles members can browse;
- following, friends or contacts lists;
- likes, reactions or sharing;
- posts visible outside a member's own squads and teams.

Any comment feature must sit inside a coach-led squad or team, be about a
coaching item, be readable by parents and guardians, and be removable by
coaches. This rule is also in `AGENTS.md`, so every change to the app is
checked against it.

### Chat groups (reassessed 24 November 2026)

Matt asked for chat groups that admins set up for roles, squads and teams
and named people, and automatic groups for each squad's and team's coaches
and managers, each team's coaches and captains, each squad's and team's
coaches and physios (with any Head Physio), and all managers. Captains can be
under 18, so he was asked how children take part, and chose that under 18s
can write too (24 November 2026), which reopened this assessment before the
feature was built. Built in `20261124600000_chat_groups.sql`, behind the
**Chat groups** switch, off by default:

- **Where a child can write.** Only in an automatic group of their own squad
  or team, and only while one of its coaches (cleared, not stood down) is in
  it. That is the "comment feature inside a coach-led squad or team" the
  design rule already allows. In groups admins set up, which can span the
  club, a child reads only.
- **Two-deep.** Every post in a group with a child in it, the child's own
  posts included, is copied to each of the child's verified parents and
  guardians, in their own inbox, naming the child. A child is never in a
  conversation that only one adult sees. A child with no verified parent
  or guardian linked has their groups hidden and can't post until one is
  (Matt, 24 November 2026); posts still reach them meanwhile, and a parent
  or guardian linked later gets a copy of every group post the child was
  sent or wrote.
- **Removable by coaches.** The group's coaches (in an admin's group, its
  coaches and admins) can remove any post. Members see who removed it; the
  text is kept, so the Child Safety Officer or Complaints Manager can still
  read it under an approved request, and a concern can still report it.
- **No contact outside the club's structure.** Members can't make groups,
  add anyone, message one person, follow anyone or see a member list while
  under 18. Who is in a group is worked out from squads, teams, captaincies
  and roles the club sets, and a child leaves when they leave the team.
- **Everything else messages do still applies.** Posts are messages: never
  deleted by members, kept for the club's keep period (7 years when a child
  is involved, by default), covered by legal hold, and admins don't read
  groups they aren't in.

**Still not an age-restricted social media platform.** The purpose of the
app is unchanged: a club administration tool. Chat groups are a messaging
feature, a kind of service the Rules exclude, between people the club has
already put together to run a team. They add no way to find, link to or
follow other users, no profiles, no feeds and no likes, and nothing a child
writes is seen outside their own squad or team and their own parents. The
nearest services eSafety lists, such as WhatsApp and Messenger, are not
age-restricted, and HQ is narrower than either. The club should still
re-run eSafety's self-assessment tool when it next reviews this document.

**Child safety rules this keeps.** Netball's two-deep rule for electronic
communication (parents copied on every post), coach-led spaces, and the
club's ability to look into a concern (posts kept, removals named).

**What would reopen this:** under 18s writing in groups that aren't coach-led
or that span squads and teams, groups members can create or join themselves,
a member list or profiles shown to under 18s, posts reaching people outside
the group, removing a post's text for good, or one-to-one chat.

### What would change this

Any feature that breaks the design rule reopens this assessment before it
is built, not after. Also: eSafety guidance or the Rules changing, or the
app's primary purpose changing (for example, public highlights or a fan
page). If the question reopens, use eSafety's self-assessment tool and
record the result here.
