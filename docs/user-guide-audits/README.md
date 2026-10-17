# User guide audits

One report per role, checking every claim in `docs/user-guide.md` for that role against the app and
the database rules (RLS and functions), who-sees claims included. Each report lists what was wrong
and how it was fixed (guide or code), the decisions Matt made, and what was confirmed accurate.

| Role | Report | Fixes |
|---|---|---|
| Athlete | [athlete-guide-audit-2026-10-17.md](athlete-guide-audit-2026-10-17.md) | PR #140 |
| Coach | [coach-guide-audit-2026-10-17.md](coach-guide-audit-2026-10-17.md) | PR #142 |
| Manager | [manager-guide-audit-2026-10-17.md](manager-guide-audit-2026-10-17.md) | PR #143 |

Still to audit: guardian, committee, physio, guest, temporary helper, admin.
