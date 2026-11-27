#!/usr/bin/env python3
"""Checks the "OTA update" workflow (.github/workflows/ota-update.yml), which
publishes an over-the-air update from GitHub (docs/environments.md,
"Publishing an update from GitHub"):

- it only runs by hand (workflow_dispatch), never on a push, pull request or
  schedule, so nothing reaches members without someone pressing Run;
- production updates only go out from main;
- it runs scripts/publish-update.sh, so it makes the same runtime-version and
  Supabase checks as a publish from a Mac (scripts/test-publish-update.sh tests
  those);
- typed inputs reach the shell only through env, never pasted into a script;
- it pins the same EAS CLI release as the Beta build workflow, and checks out
  the whole history for the build number.

It also checks a few broken workflows are caught. Run by the "Tests"
workflow."""

import re
import sys
from pathlib import Path

import yaml

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'


def triggers(data: dict) -> dict:
    # PyYAML reads the key `on` as True.
    on = data.get('on', data.get(True))
    if isinstance(on, str):
        on = {on: None}
    if isinstance(on, list):
        on = {name: None for name in on}
    return on or {}


def problems(text: str, beta_text: str) -> list[str]:
    found = []
    data = yaml.safe_load(text) or {}
    on = triggers(data)
    if set(on) != {'workflow_dispatch'}:
        found.append(f'OTA update must only run by hand, found triggers {sorted(map(str, on))}')
    inputs = ((on.get('workflow_dispatch') or {}).get('inputs')) or {}
    channel = inputs.get('channel') or {}
    if sorted(channel.get('options') or []) != ['preview', 'production']:
        found.append('the channel must be a choice of production or preview')
    if not (inputs.get('message') or {}).get('required'):
        found.append('a message saying what changed must be required')
    if sorted((inputs.get('platform') or {}).get('options') or []) != ['all', 'android', 'ios']:
        found.append('the platform must be a choice of all, android or ios')

    steps = [s for job in (data.get('jobs') or {}).values() for s in (job.get('steps') or [])]
    runs = [str(s.get('run', '')) for s in steps]
    if not any('refs/heads/main' in r and 'production' in r and 'exit 1' in r for r in runs):
        found.append('production updates must be refused unless the run is from main')
    if not any('EXPO_TOKEN' in r and 'exit 1' in r for r in runs):
        found.append('a missing EXPO_TOKEN must stop the run with a clear message')
    if not any(r.lstrip().startswith('scripts/publish-update.sh') for r in runs):
        found.append('it must publish with scripts/publish-update.sh, which makes the runtime check')
    for r in runs:
        if '${{' in r:
            found.append(f'inputs must reach the shell through env, not inside run: {r.strip()[:60]}')
    checkout = [s for s in steps if str(s.get('uses', '')).startswith('actions/checkout@')]
    if not checkout or (checkout[0].get('with') or {}).get('fetch-depth') != 0:
        found.append('it must check out the whole history (fetch-depth: 0) for the build number')
    if not any('npm ci' in r for r in runs):
        found.append('it must install the packages (npm ci) to work out the runtime version')

    pins = {str((s.get('env') or {}).get('EAS_CLI', '')) for s in steps} - {''}
    beta = set(re.findall(r'npx --yes (eas-cli@\S+) build', beta_text))
    if len(pins) != 1 or not re.fullmatch(r'eas-cli@\d+\.\d+\.\d+', next(iter(pins), '')):
        found.append(f'EAS_CLI must pin one exact eas-cli release, found {sorted(pins)}')
    elif pins != beta:
        found.append(f'EAS_CLI {sorted(pins)} must match the Beta build workflow {sorted(beta)}')
    return found


def main() -> int:
    failures = []

    def check(name: str, ok: bool) -> None:
        print(('PASS' if ok else 'FAIL') + ': ' + name)
        if not ok:
            failures.append(name)

    text = (WORKFLOWS / 'ota-update.yml').read_text()
    beta = (WORKFLOWS / 'beta-build.yml').read_text()
    for problem in problems(text, beta) or ['']:
        check(problem or 'OTA update runs by hand, from main for production, through publish-update.sh',
              not problem)

    # Broken workflows are caught.
    broken = {
        'running on every push': text.replace('on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:', 1),
        'running on a schedule': text.replace('on:\n  workflow_dispatch:',
                                              "on:\n  schedule:\n    - cron: '0 0 * * *'\n  workflow_dispatch:", 1),
        'no main-only rule for production': text.replace('refs/heads/main', 'refs/heads/anything', 1),
        'an input pasted into the script': text.replace(
            'scripts/publish-update.sh "$CHANNEL" "$MESSAGE"', 'scripts/publish-update.sh "$CHANNEL" "${{ inputs.message }}"', 1),
        'eas update without the script': text.replace(
            'run: scripts/publish-update.sh', 'run: npx eas-cli update --auto #', 1),
        'an unpinned EAS CLI': text.replace('EAS_CLI: eas-cli@24.12.0', 'EAS_CLI: eas-cli@latest', 1),
        'a different EAS CLI from Beta build': text.replace('EAS_CLI: eas-cli@24.12.0', 'EAS_CLI: eas-cli@1.0.0', 1),
        'a shallow checkout': text.replace('fetch-depth: 0', 'fetch-depth: 1', 1),
        'an optional message': text.replace('        required: true', '        required: false', 1),
    }
    for name, variant in broken.items():
        check(f'Catches {name}', variant != text and bool(problems(variant, beta)))

    print(f'\n{len(failures)} failed' if failures else '\nAll passed')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
