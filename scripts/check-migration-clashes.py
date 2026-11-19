#!/usr/bin/env python3
"""Stops a pull request whose new migration shares its version number with a
migration another open pull request adds.

Supabase records migrations by the number before the first "_", so two files
with the same number stop every deploy after them. "Every migration has its
own version number" in "Check migrations" only sees main and this branch, and
GitHub doesn't re-run a pull request's checks when main moves, so two open
pull requests could each pass and then clash once both merged (#246 and #247
on 19 November 2026). This compares against every other open pull request
while both are still open.

Usage: check-migration-clashes.py <this PR's new migration files...>
Needs GITHUB_REPOSITORY, PR_NUMBER and GH_TOKEN (or GITHUB_TOKEN).
Tested by scripts/test-check-migration-clashes.py."""

import json
import os
import re
import sys
import urllib.request
from pathlib import PurePosixPath

MIGRATION = re.compile(r'^supabase/migrations/[^/]+\.sql$')


def version(path: str) -> str:
    return PurePosixPath(path).name.split('_', 1)[0]


def clashes(mine: list[str], others: dict[int, list[str]]) -> list[tuple[str, int, str]]:
    """Each of this PR's migrations whose version another open PR also adds,
    as (this file, other PR number, other file)."""
    found = []
    for path in sorted(mine):
        v = version(path)
        for number in sorted(others):
            for other in sorted(others[number]):
                if version(other) == v:
                    found.append((path, number, other))
    return found


def new_migrations(files: list[dict]) -> list[str]:
    """The migrations a pull request adds or renames into place, from the
    GitHub "list pull request files" response."""
    return [
        f['filename']
        for f in files
        if f.get('status') in ('added', 'renamed', 'copied') and MIGRATION.match(f['filename'])
    ]


def get(url: str, token: str) -> list[dict]:
    items: list[dict] = []
    while url:
        request = urllib.request.Request(
            url,
            headers={
                'Accept': 'application/vnd.github+json',
                'Authorization': f'Bearer {token}',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            items += json.load(response)
            links = response.headers.get('Link', '')
        match = re.search(r'<([^>]+)>;\s*rel="next"', links)
        url = match.group(1) if match else ''
    return items


def main(mine: list[str]) -> int:
    mine = [p for p in mine if MIGRATION.match(p)]
    if not mine:
        print('No new migrations.')
        return 0
    repo = os.environ['GITHUB_REPOSITORY']
    me = int(os.environ['PR_NUMBER'])
    token = os.environ.get('GH_TOKEN') or os.environ['GITHUB_TOKEN']
    api = f'https://api.github.com/repos/{repo}'
    others: dict[int, list[str]] = {}
    for pr in get(f'{api}/pulls?state=open&per_page=100', token):
        if pr['number'] == me:
            continue
        files = get(f'{api}/pulls/{pr["number"]}/files?per_page=100', token)
        others[pr['number']] = new_migrations(files)
    found = clashes(mine, others)
    for path, number, other in found:
        print(f'::error file={path}::{PurePosixPath(path).name} has the same version as '
              f'{PurePosixPath(other).name} in open pull request #{number}. '
              'Give the newer one a later, unused number.')
    if found:
        return 1
    print(f'No clashes with {len(others)} other open pull requests.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
