#!/usr/bin/env python3
"""Checks that Matt approved each migration that can lose data.

Usage: check-data-loss-approval.py FILE...

A migration is approved when the pull request that added it was merged into
main and, at the moment it merged, carried the data-loss-approved label added
by Matt. Anyone else adding the label doesn't count, and neither does a label
added after the merge. Anything this can't confirm (no pull request, a GitHub
API error) counts as not approved, so the deploy stops.

Needs a full git history (fetch-depth: 0), GITHUB_REPOSITORY, and a token in
GH_TOKEN that can read pull requests and issues. Exits with status 1 unless
every file is approved.
"""

import json
import os
import subprocess
import sys
import urllib.request

APPROVER = 'zapheus-runplaywin'  # Matt
LABEL = 'data-loss-approved'
BASE = 'main'


def api(path: str):
    """Returns every item of a GitHub API list (or the one object)."""
    url = f'https://api.github.com/repos/{os.environ["GITHUB_REPOSITORY"]}/{path}'
    headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if os.environ.get('GH_TOKEN'):
        headers['Authorization'] = f'Bearer {os.environ["GH_TOKEN"]}'
    items = []
    while url:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
            page = json.load(response)
            link = response.headers.get('Link', '')
        if not isinstance(page, list):
            return page
        items.extend(page)
        url = next((part.split(';')[0].strip(' <>') for part in link.split(',') if 'rel="next"' in part), None)
    return items


def adding_commit(path: str) -> str | None:
    out = subprocess.run(
        ['git', 'log', '--diff-filter=A', '--format=%H', '--', path],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    # The oldest commit that added it, in case it was ever removed and re-added.
    return out[-1] if out else None


def approval(path: str) -> str | None:
    """Returns the pull request that approves this file, or None with a reason printed."""
    sha = adding_commit(path)
    if not sha:
        print(f'{path}: not approved: git has no commit that added it.')
        return None
    prs = [
        pr for pr in api(f'commits/{sha}/pulls')
        if pr.get('merged_at') and pr['base']['ref'] == BASE
    ]
    if not prs:
        print(f'{path}: not approved: it wasn\'t added by a pull request merged into {BASE}.')
        return None
    for pr in prs:
        state = None
        for event in api(f'issues/{pr["number"]}/events?per_page=100'):
            if event.get('event') not in ('labeled', 'unlabeled'):
                continue
            if event.get('label', {}).get('name') != LABEL:
                continue
            # ISO 8601 times in UTC compare correctly as strings.
            if event['created_at'] > pr['merged_at']:
                continue
            state = (event['event'], (event.get('actor') or {}).get('login'))
        if state == ('labeled', APPROVER):
            return f'#{pr["number"]}'
        if state and state[0] == 'labeled':
            print(f'{path}: not approved: {LABEL} on #{pr["number"]} was added by {state[1]}, not Matt.')
        else:
            print(f'{path}: not approved: #{pr["number"]} didn\'t have {LABEL} when it merged.')
    return None


def main(paths: list[str]) -> int:
    approved = True
    for path in paths:
        try:
            pr = approval(path)
        except Exception as error:  # Fail closed on any API or git problem.
            print(f'{path}: not approved: couldn\'t check its pull request ({error}).')
            pr = None
        if pr:
            print(f'{path}: approved by Matt\'s {LABEL} label on {pr}.')
        else:
            approved = False
    return 0 if approved else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
