# User guide audits

One report per role, checking every claim in `docs/user-guide.md` for that role against the app and
the database rules (RLS and functions), who-sees claims included. Each report lists what was wrong
and how it was fixed (guide or code), the decisions Matt made, and what was confirmed accurate.

| Role | Report | Fixes |
|---|---|---|
| Athlete | [athlete-guide-audit-2026-10-17.md](athlete-guide-audit-2026-10-17.md) | PR #140 |
| Coach | [coach-guide-audit-2026-10-17.md](coach-guide-audit-2026-10-17.md) | PR #142 |
| Manager | [manager-guide-audit-2026-10-17.md](manager-guide-audit-2026-10-17.md) | PR #143 |
| Committee | [committee-guide-audit-2026-10-17.md](committee-guide-audit-2026-10-17.md) | PR #143 |
| Physio | [physio-guide-audit-2026-10-18.md](physio-guide-audit-2026-10-18.md) | PR #143 |
| Guest | [guest-guide-audit-2026-10-18.md](guest-guide-audit-2026-10-18.md) | PR #143 |
| Temporary helper | [temporary-helper-guide-audit-2026-10-18.md](temporary-helper-guide-audit-2026-10-18.md) | PR #143 |
| Parent and guardian | [guardian-guide-audit-2026-10-19.md](guardian-guide-audit-2026-10-19.md) | this PR (the guide was first reviewed in PR #141 without a report) |

Still to audit: admin.
