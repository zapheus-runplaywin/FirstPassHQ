# How FirstPass HQ handles your club's data

One page for a club's board or committee: where the data is, who can read it, what happens if
something goes wrong, and how the club gets all of it back. It's kept up to date with the app,
like the [user guide](user-guide.md), and summarised in its section 13,
[Your club's data](user-guide.md#13-your-clubs-data).

## Where it is

- **Your club has its own database.** Each club is a separate Supabase project with its own
  database, file storage and sign-in settings. No other club's data is in it, and no other club's
  members can reach it.
- **In Australia.** The projects are hosted by [Supabase](https://supabase.com) on Amazon Web
  Services in Sydney (the `ap-southeast-2` region).
- **Encrypted.** Supabase encrypts the database and stored files on disk, and everything between
  the app and the database travels encrypted (TLS).
- **What it holds.** Members' names, contact details and roles; dates of birth and guardian links;
  Working With Children Check details; attendance, check-ins, training sessions, goals, messages and surveys;
  injuries and their documents; medical and emergency details; and the safeguarding records:
  concerns, stand-downs, Screening Unit notices, exemptions and consents. The user guide says who
  can see each kind, in section 11, [Who can see what](user-guide.md#11-who-can-see-what).

## Crash reports

When the app crashes on a phone, or shows "Something went wrong", it sends a crash report to
[Sentry](https://sentry.io) so FirstPass can find and fix the fault. Reports are stored in
Sentry's **EU data centre** (Germany), kept for 30 days, and only FirstPass can read them. Builds
without the Sentry settings send nothing, and nothing is sent from the web or from development
copies of the app.

| Sent | Never sent |
| --- | --- |
| The kind of error and its message, with anything that could be about a person taken out | Names, emails, dates of birth, phone numbers |
| Where in the app's code it happened | Member ids, guardian links, roles or teams |
| The app's version, build and update | Injury, medical, check-in or concern details |
| The phone's model and system version | Message, survey or note text |
| A random id made for that copy of the app, so repeat crashes group together | Tokens, keys, club passwords |
| The screen's name, such as "injuries/[id]", never the record's id | Screenshots, recordings, a trail of what the member tapped, the phone's name or its IP address |

- **The same for everyone.** Children's reports are no different, and nothing in a report says who
  the member is or which club they belong to.
- **Taken out on the phone, before sending,** for errors in the app's own code, which is most
  reports and every "Something went wrong". Each report keeps only the fields listed above. Every
  text in it has emails, ids, dates, long numbers, quoted text, web addresses' details and the
  signed-in member's own name and emails removed, and error messages also lose any capitalised
  word that isn't a common word, which is how names are written. The tests that check this run on
  every change (`src/lib/__tests__/crash-reports.test.ts`), including one that puts a sample
  member's details everywhere in a report and checks none of them is left.
- **Crashes deep in the phone's own code are filtered less.** When the app's native code crashes
  (for example the app closing the moment it opens), Sentry's built-in part on the phone sends the
  report the next time the app opens, and it doesn't pass through the filter above (Sentry's
  React Native documentation, "Filtering"). Such a report holds the crash's technical reason, the
  native code's stack, the phone model and system, the app's version, the screen's name and the
  random id. It is set to send no trail of what was tapped, no screenshots, no phone name and no
  IP address. A native crash's reason comes from the phone's system and libraries, not from what
  members entered, so it rarely holds anything personal.
- **Sentry's own scrubbing as well.** On Sentry's side, the project removes anything that looks
  like a password, token, card number or similar from every report ("Data Scrubber" and "Use
  Default Scrubbers"), and doesn't store IP addresses ("Prevent Storing of IP Addresses").
- **Sentry is a service provider.** It handles reports for FirstPass and doesn't use them for
  anything else. FirstPass uses Sentry's free plan.

## The app's log on the phone

The app also keeps a short technical log on each phone, with names, emails, health details and
tokens kept out of it. It never leaves the phone unless the member sends it themselves, with
**Send app log** in Your details, to whoever is helping them.

## Backups

- **Today there are no automatic backups.** The projects are on Supabase's free plan, which keeps
  none that FirstPass can restore. A deleted record can't be brought back from Supabase.
- On Supabase's paid (Pro) plan, each project is backed up daily and the last 7 days are kept.
  This page will say so, and how restores are tested, when the club's project moves to it.
- The club can ask for a full copy at any time (see [Getting all your data](#getting-all-your-data)),
  and keep it as its own backup.

## Who can read it

- **Club members** see only what their roles allow, checked by the database itself, not just
  hidden on the screen. Every time an adult opens a child's records it's logged, and parents see
  who opened their child's records.
- **FirstPass.** The person who runs FirstPass HQ owns each club's Supabase project, and so can
  read everything in it, including children's records, health information and concerns. FirstPass
  opens a club's data only to fix a fault, run the export below, or when the law requires it, and
  tells the club's admins when it has.
- **Supabase** staff can reach the projects only under Supabase's own security and privacy terms.
- **Nobody else.** FirstPass doesn't sell, share or analyse club data, and the app has no
  advertising or tracking.

### When FirstPass opens your data

This is a promise FirstPass keeps by hand, not something the app tracks: the app's own log of who
opened a child's records covers members only, not FirstPass working in the Supabase project.

- **What counts:** FirstPass looking at or changing a club's rows or files itself, through the
  Supabase dashboard, its SQL editor, the service key or the export script. Automatic jobs (such
  as the nightly removal of old records) and app updates deploying don't count.
- **What FirstPass writes down each time:** the date, the club, why (the fault, the export, or the
  legal request), what it looked at or changed, and when it told the admins. It keeps that log
  for as long as it holds the club's data.
- **What admins hear:** an email, once the work is done, saying the same things.

## If something goes wrong

If FirstPass learns that a club's data may have been seen, changed or lost by someone who
shouldn't have, it:

1. Stops it going further, as far as it can.
2. Tells the club's admins within 72 hours of finding out: what happened, what data and which
   members it affected, and what has been done.
3. Helps the club decide who else to tell, such as the affected members and parents, the
   governing body, and the Office of the Australian Information Commissioner where the Privacy
   Act's notifiable data breaches scheme applies.
4. Writes down what happened and what changed so it can't happen again.

## Getting all your data

- **On request, or when the club leaves.** An admin asks FirstPass in writing. Within 14 days
  FirstPass makes a full copy: every table as a spreadsheet (CSV) and as a database file, every
  stored file (injury documents, certificates, check receipts, session plans, logos), a count of
  everything in it, and checksums so the club can check nothing is missing.
- **Sent safely.** It goes to the admin the club names, through an encrypted link. It holds
  children's records and health information, so the club keeps it where only the people who need
  it can open it.
- **Not a button in the app.** A download button would let any one admin take every child's
  records at once, so FirstPass makes the copy instead. How: `scripts/export-club-data.sh` and
  [docs/environments.md](environments.md#a-full-copy-of-a-clubs-data).
- **When a club leaves**, once the club confirms it has its copy, FirstPass deletes the club's
  Supabase project, with its database and files, and every copy FirstPass made, and tells the club
  in writing. That can't be undone.
