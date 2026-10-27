# Where this skill comes from

Vendored copy of Cloudflare's security-audit skill (MIT, licence in `LICENSE`):
https://github.com/cloudflare/security-audit-skill, `skills/security-audit` at commit
`c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` (2026-09-14). Files are unchanged apart from
this note and the copied `LICENSE`.

Claude Code picks it up from `.claude/skills/` in any session on this repo. Ask Claude to
"security audit this codebase" for the full multi-agent audit (it uses a lot of tokens), or
ask a focused security question to use guidance mode. Full audits write their reports
outside the repo, to `~/security-audit-skill/<repo>/run-<N>`.

It never reaches the app: Metro only bundles files the app imports, the package is
private, Supabase deploys only `supabase/`, and Jest (`testPathIgnorePatterns` in
`package.json`) and ESLint (`eslint.config.js`) skip `.claude/`, so the skill's
`*.test.cjs` files don't run in the app's test suite.

To update: clone the repo, read the changes, copy `skills/security-audit` from the latest
commit over this folder (plus the repo's `LICENSE`), keep this note, and change the commit
above.
