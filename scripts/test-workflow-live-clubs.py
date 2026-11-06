#!/usr/bin/env python3
"""Checks that every live club and association other than the home one (docs/
environments.md "More clubs and associations", such as WCMMNA after West Coast
Thunder was split from it) gets every database change and function, and that
none of them can hold up another.

For every workflow it checks that:
- only the jobs deploy-live-clubs and purge-live-clubs read another club's
  secrets (SUPABASE_CLUB_<n>_...), and no matrix hard-codes the clubs;
- those jobs start their `if` with vars.LIVE_CLUBS != '', so they're skipped
  until the variable lists a club, and take their matrix from it;
- no job waits for them, except purge-live-clubs after deploy-live-clubs.

Every workflow that deploys migrations or functions to the home club's live
project must also have deploy-live-clubs, so a new club never misses one.

It also checks a few broken workflows are caught. Run by the "Tests"
workflow."""

import re
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
JOBS = ('deploy-live-clubs', 'purge-live-clubs')
CLUB_SECRET = re.compile(r"SUPABASE_CLUB_(\{0\}|\d+)_")
DEPLOYS_LIVE = re.compile(r'supabase functions deploy|scripts/deploy-migrations\.sh')


def jobs(text: str) -> dict[str, str]:
    """The text of each job under `jobs:`, by name, without comment lines."""
    body = text.split('\njobs:\n', 1)[1] if '\njobs:\n' in text else ''
    found: dict[str, str] = {}
    name = None
    for line in body.splitlines():
        head = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', line)
        if head:
            name = head.group(1)
            found[name] = ''
        elif name and not line.strip().startswith('#'):
            found[name] += line + '\n'
    return found


def problems(text: str) -> list[str]:
    found = []
    all_jobs = jobs(text)
    for name, code in all_jobs.items():
        if re.search(r'^\s+club:\s*\[', code, re.M) and name in JOBS:
            found.append(f'{name} hard-codes the clubs in its matrix')
        needs = re.search(r'^    needs:\s*(.+)$', code, re.M)
        if needs:
            for job in JOBS:
                if job in needs.group(1) and not (name == 'purge-live-clubs' and job == 'deploy-live-clubs'):
                    found.append(f'{name} waits for {job}')
        if name not in JOBS:
            if CLUB_SECRET.search(code):
                found.append(f"{name} reads another club's secrets")
            continue
        cond = re.search(r'^    if:\s*\$\{\{\s*(.+?)\s*\}\}\s*$', code, re.M)
        if not cond or not cond.group(1).startswith("vars.LIVE_CLUBS != ''"):
            found.append(f"{name} doesn't start its if with vars.LIVE_CLUBS != ''")
        if not re.search(r"^\s+club:\s*\$\{\{\s*fromJSON\(vars\.LIVE_CLUBS", code, re.M):
            found.append(f"{name}'s matrix doesn't come from vars.LIVE_CLUBS")
    home = [n for n, c in all_jobs.items() if 'secrets.SUPABASE_PROJECT_ID' in c and DEPLOYS_LIVE.search(c)]
    if home and 'deploy-live-clubs' not in all_jobs:
        found.append(f"{', '.join(home)} deploys to the home club but there's no deploy-live-clubs")
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
  deploy:
    steps:
      - run: scripts/deploy-migrations.sh
        env:
          ID: ${{ secrets.SUPABASE_PROJECT_ID }}
  # The other clubs.
  deploy-live-clubs:
    needs: [deploy-test]
    if: ${{ vars.LIVE_CLUBS != '' && !cancelled() }}
    strategy:
      matrix:
        club: ${{ fromJSON(vars.LIVE_CLUBS || '["off"]') }}
    steps:
      - env:
          ID: ${{ secrets[format('SUPABASE_CLUB_{0}_PROJECT_ID', matrix.club)] }}
  purge-live-clubs:
    needs: deploy-live-clubs
    if: ${{ vars.LIVE_CLUBS != '' && !cancelled() }}
    strategy:
      matrix:
        club: ${{ fromJSON(vars.LIVE_CLUBS || '["off"]') }}
    steps:
      - env:
          KEY: ${{ secrets[format('SUPABASE_CLUB_{0}_PURGE_SECRET', matrix.club)] }}
"""

expect('a workflow with the clubs behind LIVE_CLUBS passes', problems(GOOD), False)
expect(
    'a hard-coded [2] matrix is caught',
    problems(GOOD.replace("${{ fromJSON(vars.LIVE_CLUBS || '[\"off\"]') }}", '[2]', 1)),
    True,
)
expect(
    'a job that runs without LIVE_CLUBS is caught',
    problems(GOOD.replace("vars.LIVE_CLUBS != '' && !cancelled()", '!cancelled()', 1)),
    True,
)
expect(
    'a home deploy that waits for the other clubs is caught',
    problems(GOOD.replace('  deploy:\n    steps:', '  deploy:\n    needs: [deploy-live-clubs]\n    steps:')),
    True,
)
expect(
    "another job reading club 2's secrets is caught",
    problems(GOOD.replace('secrets.SUPABASE_PROJECT_ID', 'secrets.SUPABASE_CLUB_2_PROJECT_ID')),
    True,
)
expect(
    'a home deploy with no deploy-live-clubs is caught',
    problems(GOOD.split('  # The other clubs.')[0]),
    True,
)

files = sorted(WORKFLOWS.glob('*.yml'))
if not files:
    failed += 1
    print(f'FAIL no workflows found in {WORKFLOWS}')
with_clubs = 0
for path in files:
    text = path.read_text(encoding='utf-8')
    with_clubs += 'deploy-live-clubs' in jobs(text)
    expect(f'{path.name} reaches every live club, behind LIVE_CLUBS', problems(text), False)
# deploy-migrations, playhq-function and purge-expired-injuries.
if with_clubs < 3:
    failed += 1
    print(f'FAIL only {with_clubs} workflows have deploy-live-clubs; expected at least 3')

sys.exit(1 if failed else 0)
