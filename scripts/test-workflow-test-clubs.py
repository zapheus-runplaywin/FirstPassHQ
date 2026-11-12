#!/usr/bin/env python3
"""Checks that the extra test clubs (2 and 3, docs/environments.md "More test
clubs") stay off in every workflow unless the TEST_CLUBS repository variable
turns them on. They were taken out on 1 November 2026 while Supabase's free
plan paused club 2; setting TEST_CLUBS to [2, 3] brings them back.

For every workflow it checks that:
- only a job named deploy-test-clubs reads a test club's secrets
  (SUPABASE_TEST_<n>_...), and no matrix hard-codes the clubs;
- that job's `if` starts with vars.TEST_CLUBS != '', so it's skipped without
  the variable, and its matrix comes from the variable;
- no other job waits for it, so the live deploy never depends on a test club.

It also checks a few broken workflows are caught. Run by the "Tests"
workflow."""

import re
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
JOB = 'deploy-test-clubs'
CLUB_SECRET = re.compile(r"SUPABASE_TEST_(\{0\}|\d+)_")


def jobs(text: str) -> dict[str, str]:
    """The text of each job under `jobs:`, by name."""
    body = text.split('\njobs:\n', 1)[1] if '\njobs:\n' in text else ''
    found: dict[str, str] = {}
    name = None
    for line in body.splitlines():
        head = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', line)
        if head:
            name = head.group(1)
            found[name] = ''
        elif name:
            found[name] += line + '\n'
    return found


def problems(text: str) -> list[str]:
    found = []
    all_jobs = jobs(text)
    for name, job in all_jobs.items():
        code = '\n'.join(l for l in job.splitlines() if not l.strip().startswith('#'))
        if re.search(r'^\s+club:\s*\[', code, re.M):
            found.append(f'{name} hard-codes the test clubs in its matrix')
        needs = re.search(r'^    needs:\s*(.+)$', code, re.M)
        if needs and JOB in needs.group(1):
            found.append(f'{name} waits for {JOB}')
        if name != JOB:
            if CLUB_SECRET.search(code):
                found.append(f"{name} reads a test club's secrets")
            continue
        cond = re.search(r'^    if:\s*\$\{\{\s*(.+?)\s*\}\}\s*$', code, re.M)
        if not cond or not cond.group(1).startswith("vars.TEST_CLUBS != ''"):
            found.append(f"{JOB} doesn't start its if with vars.TEST_CLUBS != ''")
        if not re.search(r"^\s+club:\s*\$\{\{\s*fromJSON\(vars\.TEST_CLUBS", code, re.M):
            found.append(f"{JOB}'s matrix doesn't come from vars.TEST_CLUBS")
    return found


failed = 0


def expect(label: str, got: list[str], want_problem: bool) -> None:
    global failed
    if bool(got) == want_problem:
        print(f'PASS {label}')
    else:
        failed += 1
        print(f'FAIL {label}: {got or "no problems found"}')


GOOD = """name: x
jobs:
  deploy-test:
    runs-on: ubuntu-24.04
  # The test clubs.
  deploy-test-clubs:
    needs: [deploy-test]
    if: ${{ vars.TEST_CLUBS != '' && !cancelled() }}
    strategy:
      matrix:
        club: ${{ fromJSON(vars.TEST_CLUBS || '["off"]') }}
    steps:
      - env:
          ID: ${{ secrets[format('SUPABASE_TEST_{0}_PROJECT_ID', matrix.club)] }}
  deploy:
    needs: [deploy-test]
    steps:
      - env:
          ID: ${{ secrets.SUPABASE_TEST_PROJECT_ID }}
"""

expect('a workflow with the clubs behind TEST_CLUBS passes', problems(GOOD), False)
expect(
    'a hard-coded [2, 3] matrix is caught',
    problems(GOOD.replace("${{ fromJSON(vars.TEST_CLUBS || '[\"off\"]') }}", '[2, 3]')),
    True,
)
expect(
    'a job that runs without TEST_CLUBS is caught',
    problems(GOOD.replace("vars.TEST_CLUBS != '' && !cancelled()", '!cancelled()')),
    True,
)
expect(
    'a live deploy that waits for the test clubs is caught',
    problems(GOOD.replace('  deploy:\n    needs: [deploy-test]', '  deploy:\n    needs: [deploy-test, deploy-test-clubs]')),
    True,
)
expect(
    "another job reading club 2's secrets is caught",
    problems(GOOD.replace('secrets.SUPABASE_TEST_PROJECT_ID', 'secrets.SUPABASE_TEST_2_PROJECT_ID')),
    True,
)

files = sorted(WORKFLOWS.glob('*.yml'))
if not files:
    failed += 1
    print(f'FAIL no workflows found in {WORKFLOWS}')
with_clubs = 0
for path in files:
    text = path.read_text(encoding='utf-8')
    with_clubs += JOB in jobs(text)
    expect(f'{path.name} keeps the test clubs off without TEST_CLUBS', problems(text), False)
# deploy-migrations, playhq-function and purge-expired-injuries.
if with_clubs < 3:
    failed += 1
    print(f'FAIL only {with_clubs} workflows have {JOB}; expected at least 3')

sys.exit(1 if failed else 0)
