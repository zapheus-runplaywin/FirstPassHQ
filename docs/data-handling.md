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
  Working With Children Check details; attendance, check-ins, goals, messages and surveys;
  injuries and their documents; medical and emergency details; and the safeguarding records:
  concerns, stand-downs, Screening Unit notices, exemptions and consents. The user guide says who
  can see each kind, in section 11, [Who can see what](user-guide.md#11-who-can-see-what).

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
