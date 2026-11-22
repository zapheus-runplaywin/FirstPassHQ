#!/usr/bin/env python3
"""Checks when the test workflows run, so a change can't quietly stop the
tests running on a branch before its pull request merges (AGENTS.md "Tests").

- Tests (tests.yml) runs on every push to every branch, with no path filter,
  and by hand, and runs the app, database and browser jobs. From 20 to 22
  November 2026 it ran on pull requests only, to save Actions minutes; every
  repo is public since 22 November, so minutes are free and it runs on every
  push again (Matt, 22 November 2026).
- The Security audit still runs on every merge to main.

It also checks a few broken workflows are caught. Run by the "Tests"
workflow."""

import sys
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
JOBS = ['app', 'database', 'browser']


def triggers(text: str) -> dict:
    data = yaml.safe_load(text) or {}
    # PyYAML reads the key `on` as True.
    on = data.get('on', data.get(True))
    if isinstance(on, str):
        on = {on: None}
    if isinstance(on, list):
        on = {name: None for name in on}
    return on or {}


def tests_problems(text: str) -> list[str]:
    on = triggers(text)
    problems = []
    if 'push' not in on:
        problems.append('Tests must run on push')
    else:
        push = on['push'] or {}
        for key in ('branches', 'branches-ignore', 'paths', 'paths-ignore', 'tags'):
            if key in push:
                problems.append(f'Tests must run on every push to every branch (no {key} filter)')
    if 'workflow_dispatch' not in on:
        problems.append('Tests must be runnable by hand (workflow_dispatch)')
    jobs = (yaml.safe_load(text) or {}).get('jobs') or {}
    for job in JOBS:
        if job not in jobs:
            problems.append(f'Tests must run the {job} job')
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
    audit = (WORKFLOWS / 'security-audit.yml').read_text()

    for problem in tests_problems(tests) or ['']:
        check(problem or 'Tests runs every job on every push and by hand', not problem)
    for problem in audit_problems(audit) or ['']:
        check(problem or 'Security audit runs on every merge to main', not problem)
    check('Tests runs the browser smoke tests', 'npm run e2e' in tests)
    check('No separate browser workflow can drift from Tests',
          not (WORKFLOWS / 'browser-tests.yml').exists())

    jobs = '\njobs:\n  app: {}\n  database: {}\n  browser: {}\n'
    # Broken workflows are caught.
    check('Catches Tests on pull requests only',
          bool(tests_problems('on:\n  pull_request:\n  workflow_dispatch:' + jobs)))
    check('Catches Tests on main only',
          bool(tests_problems('on:\n  push:\n    branches: [main]\n  workflow_dispatch:' + jobs)))
    check('Catches Tests with a path filter',
          bool(tests_problems("on:\n  push:\n    paths-ignore: ['docs/**']\n  workflow_dispatch:" + jobs)))
    check('Catches Tests that can\'t be run by hand', bool(tests_problems('on:\n  push:' + jobs)))
    check('Catches Tests without the browser job',
          bool(tests_problems('on:\n  push:\n  workflow_dispatch:\njobs:\n  app: {}\n  database: {}\n')))
    check('Accepts Tests on every push', not tests_problems('on:\n  push:\n  workflow_dispatch:' + jobs))
    check('Catches a security audit that skips main',
          bool(audit_problems("on:\n  pull_request:\n  schedule:\n    - cron: '0 0 * * 0'\n")))
    check('Catches a security audit with a path filter on main',
          bool(audit_problems("on:\n  push:\n    branches: [main]\n    paths: ['package.json']\n")))

    print(f'\n{len(failures)} failed' if failures else '\nAll passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
