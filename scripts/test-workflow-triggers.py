#!/usr/bin/env python3
"""Checks when the test workflows run, so a change that saves Actions minutes
can't quietly stop the tests running on a pull request (AGENTS.md "Tests").

Since 20 November 2026 (Matt, to save minutes):
- Tests (tests.yml) runs on every pull request, and by hand. Not on every
  push, and not on main after a merge.
- Browser tests (browser-tests.yml) runs on pull requests, and by hand, but
  skips one that changes only the database, scripts or docs. Anything that can
  change the web build (src/, e2e/, assets/, package files, app.json, the
  workflow) must still run it.
- The Security audit still runs on every merge to main (AGENTS.md "Tests").

It also checks a few broken workflows are caught. Run by the "Tests"
workflow."""

import fnmatch
import re
import sys
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'

# Files a pull request might change that can change the web build. Each must
# start the browser tests.
MUST_RUN_BROWSER = [
    'src/app/(tabs)/index.tsx',
    'src/lib/inbox.ts',
    'src/components/concern-lights.tsx',
    'e2e/specs/messages.spec.ts',
    'e2e/playwright.config.ts',
    'assets/images/icon.png',
    'package.json',
    'package-lock.json',
    'app.json',
    'tsconfig.json',
    '.github/workflows/browser-tests.yml',
]
# Files that can't change the web build. Each may skip the browser tests.
MAY_SKIP_BROWSER = [
    'supabase/migrations/20261120000000_example.sql',
    'supabase/tests/record-access.sql',
    'supabase/functions/playhq/index.ts',
    'scripts/run-sql-tests.sh',
    'docs/user-guide.md',
    'docs/pdfs/manual.pdf',
    'README.md',
]


def triggers(text: str) -> dict:
    data = yaml.safe_load(text) or {}
    # PyYAML reads the key `on` as True.
    on = data.get('on', data.get(True))
    if isinstance(on, str):
        on = {on: None}
    if isinstance(on, list):
        on = {name: None for name in on}
    return on or {}


def glob_match(path: str, pattern: str) -> bool:
    """GitHub's path filters: ** crosses folders, * doesn't."""
    regex = ''
    i = 0
    while i < len(pattern):
        if pattern.startswith('**', i):
            regex += '.*'
            i += 2
        elif pattern[i] == '*':
            regex += '[^/]*'
            i += 1
        else:
            regex += fnmatch.translate(pattern[i])[4:-3]
            i += 1
    return re.fullmatch(regex, path) is not None


def skipped(path: str, ignore: list[str]) -> bool:
    return any(glob_match(path, p) for p in ignore)


def tests_problems(text: str) -> list[str]:
    on = triggers(text)
    problems = []
    if 'pull_request' not in on:
        problems.append('Tests must run on pull_request')
    elif on['pull_request'] and ('paths' in on['pull_request'] or 'paths-ignore' in on['pull_request']):
        problems.append('Tests must run on every pull request (no path filter)')
    if 'workflow_dispatch' not in on:
        problems.append('Tests must be runnable by hand (workflow_dispatch)')
    return problems


def browser_problems(text: str) -> list[str]:
    on = triggers(text)
    problems = []
    if 'pull_request' not in on:
        return ['Browser tests must run on pull_request']
    if 'workflow_dispatch' not in on:
        problems.append('Browser tests must be runnable by hand (workflow_dispatch)')
    pr = on['pull_request'] or {}
    if 'paths' in pr:
        problems.append('Browser tests must list what to skip (paths-ignore), not what to run')
    ignore = pr.get('paths-ignore', [])
    for path in MUST_RUN_BROWSER:
        if skipped(path, ignore):
            problems.append(f'Browser tests would skip a change to {path}')
    return problems


def audit_problems(text: str) -> list[str]:
    on = triggers(text)
    push = on.get('push') or {}
    if 'push' not in on or 'main' not in (push.get('branches') or []):
        return ['Security audit must run on every merge to main']
    if 'paths' in push or 'paths-ignore' in push:
        return ['Security audit must run on every merge to main (no path filter)']
    return []


def main() -> int:
    failures = []

    def check(name: str, ok: bool) -> None:
        print(('PASS' if ok else 'FAIL') + ': ' + name)
        if not ok:
            failures.append(name)

    tests = (WORKFLOWS / 'tests.yml').read_text()
    browser = (WORKFLOWS / 'browser-tests.yml').read_text()
    audit = (WORKFLOWS / 'security-audit.yml').read_text()

    for problem in tests_problems(tests) or ['']:
        check(problem or 'Tests runs on every pull request and by hand', not problem)
    for problem in browser_problems(browser) or ['']:
        check(problem or 'Browser tests run on pull requests that can change the web build', not problem)
    for problem in audit_problems(audit) or ['']:
        check(problem or 'Security audit runs on every merge to main', not problem)
    check('Tests no longer runs the browser job itself', 'browser:' not in (yaml.safe_load(tests).get('jobs') or {}))
    check('Browser tests runs the smoke tests', 'npm run e2e' in browser)

    ignore = (triggers(browser)['pull_request'] or {}).get('paths-ignore', [])
    for path in MAY_SKIP_BROWSER:
        check(f'Browser tests skip a pull request that changes only {path}', skipped(path, ignore))

    # Broken workflows are caught.
    check('Catches Tests on push only', bool(tests_problems('on:\n  push:\n  workflow_dispatch:\n')))
    check('Catches Tests with a path filter',
          bool(tests_problems("on:\n  pull_request:\n    paths: ['src/**']\n  workflow_dispatch:\n")))
    check('Catches browser tests skipping src/',
          bool(browser_problems("on:\n  pull_request:\n    paths-ignore: ['src/**']\n  workflow_dispatch:\n")))
    check('Catches browser tests skipping the package files',
          bool(browser_problems("on:\n  pull_request:\n    paths-ignore: ['*.json']\n  workflow_dispatch:\n")))
    check('Catches browser tests skipping everything',
          bool(browser_problems("on:\n  pull_request:\n    paths-ignore: ['**']\n  workflow_dispatch:\n")))
    check('Catches a security audit that skips main',
          bool(audit_problems("on:\n  pull_request:\n  schedule:\n    - cron: '0 0 * * 0'\n")))
    check('Catches a security audit with a path filter on main',
          bool(audit_problems("on:\n  push:\n    branches: [main]\n    paths: ['package.json']\n")))

    print(f'\n{len(failures)} failed' if failures else '\nAll passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
