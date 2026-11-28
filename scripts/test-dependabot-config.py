#!/usr/bin/env python3
"""Checks .github/dependabot.yml keeps package updates coming, so a change
can't quietly slow or stop them (Matt, 28 November 2026: updates are critical).

- npm and GitHub Actions are both covered, at the repository root.
- Each runs weekly or daily. It ran monthly to save Actions minutes until the
  repos went public on 22 November 2026; a month was too long to wait.
- Version updates aren't turned off (open-pull-requests-limit 0 stops them).
- npm keeps a group for security updates, so one PR carries every fix.
- React, React Native and TypeScript stay ignored where Expo pins them.

It also checks a few broken configs are caught. Run by the "Tests" workflow."""

import sys
from pathlib import Path

import yaml

CONFIG = Path(__file__).resolve().parent.parent / '.github' / 'dependabot.yml'
ECOSYSTEMS = ['npm', 'github-actions']
OFTEN_ENOUGH = {'daily', 'weekly'}
# Expo moves these on an SDK upgrade with `npx expo install --fix`.
EXPO_PINNED = ['react', 'react-dom', 'react-native', 'expo', 'typescript']


def problems(text: str) -> list[str]:
    try:
        data = yaml.safe_load(text) or {}
    except yaml.YAMLError as error:
        return [f'not valid YAML: {error}']
    found = []
    if data.get('version') != 2:
        found.append('version must be 2')
    updates = {u.get('package-ecosystem'): u for u in data.get('updates') or []}
    for name in ECOSYSTEMS:
        update = updates.get(name)
        if update is None:
            found.append(f'{name} is not covered')
            continue
        if update.get('directory') != '/':
            found.append(f'{name} must cover the repository root')
        interval = (update.get('schedule') or {}).get('interval')
        if interval not in OFTEN_ENOUGH:
            found.append(f'{name} runs {interval}, it must run weekly or daily')
        if update.get('open-pull-requests-limit', 5) == 0:
            found.append(f'{name} version updates are turned off')
    npm = updates.get('npm') or {}
    groups = npm.get('groups') or {}
    if not any(g.get('applies-to') == 'security-updates' for g in groups.values()):
        found.append('npm has no group for security updates')
    ignored = {i.get('dependency-name') for i in npm.get('ignore') or []}
    for name in EXPO_PINNED:
        if name not in ignored:
            found.append(f'npm must leave {name} to Expo SDK upgrades')
    return found


def main() -> int:
    failures = 0

    def check(label: str, ok: bool) -> None:
        nonlocal failures
        print(('PASS ' if ok else 'FAIL ') + label)
        if not ok:
            failures += 1

    text = CONFIG.read_text()
    real = problems(text)
    for problem in real:
        print('  ' + problem)
    check('dependabot.yml keeps weekly updates for npm and Actions', not real)

    def broken(old: str, new: str, count: int = 1) -> str:
        assert old in text, old
        return text.replace(old, new, count)

    check('a monthly schedule is caught',
          any('weekly or daily' in p for p in problems(broken('interval: weekly', 'interval: monthly'))))
    check('dropping GitHub Actions is caught',
          'github-actions is not covered' in problems(broken('package-ecosystem: github-actions', 'package-ecosystem: docker')))
    check('turning version updates off is caught',
          'npm version updates are turned off' in problems(broken('open-pull-requests-limit: 5', 'open-pull-requests-limit: 0')))
    check('losing the security group is caught',
          'npm has no group for security updates' in problems(broken('applies-to: security-updates', 'applies-to: version-updates')))
    check('dropping an Expo pin is caught',
          'npm must leave react-native to Expo SDK upgrades' in problems(broken('      - dependency-name: "react-native"\n', '')))
    check('broken YAML is caught', problems('updates: [') != [])

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
