#!/usr/bin/env python3
"""Checks package-lock.json never goes back to a package version with a known
advisory that `overrides` in package.json moved us off (November 2026):

- node-forge below 1.4.3 (GHSA-6889-vf6x-f3g5, GHSA-w4xr-hqv8-ch44,
  GHSA-6cv4-p8m7-4r25, GHSA-j8rw-jp99-435v), used by the Expo CLI;
- glob 9.0.0 to 14.0.1 (GHSA-3g3m-2fjr-6pw4), used by Jest;
- minimatch 7.0.0 to 11.0.0 (GHSA-g3hv-75wg-m249), used by the Expo
  fingerprint, Stryker, typescript-eslint and Jest's coverage.

The Security audit workflow only runs on pull requests that change packages, so
this runs on every push in the "Tests" workflow and fails as soon as a lockfile
change (a Dependabot PR, an `npm install`, an Expo upgrade) brings one back.
Drop an entry once nothing in the lockfile can resolve to the bad range without
the override. It also checks a lockfile with a bad version is caught."""

import json
import sys
from pathlib import Path

LOCKFILE = Path(__file__).resolve().parent.parent / 'package-lock.json'

# package: (lowest bad version, first fixed version)
BAD_RANGES = {
    'node-forge': ((0, 0, 0), (1, 4, 3)),
    'glob': ((9, 0, 0), (14, 0, 2)),
    'minimatch': ((7, 0, 0), (11, 0, 1)),
}


def version(text: str) -> tuple[int, ...]:
    core = text.split('-', 1)[0].split('+', 1)[0]
    return tuple(int(part) for part in core.split('.'))


def problems(lock: dict) -> list[str]:
    found = []
    for path, entry in lock.get('packages', {}).items():
        if 'node_modules/' not in path:
            continue
        name = path.rsplit('node_modules/', 1)[1]
        if name not in BAD_RANGES or 'version' not in entry:
            continue
        low, fixed = BAD_RANGES[name]
        if low <= version(entry['version']) < fixed:
            found.append(f"{path} is {entry['version']}, needs {'.'.join(map(str, fixed))} or later")
    return found


def self_test() -> list[str]:
    failures = []
    cases = {
        'old node-forge': ({'node_modules/@expo/cli/node_modules/node-forge': {'version': '1.4.2'}}, 1),
        'old glob': ({'node_modules/glob': {'version': '13.0.6'}}, 1),
        'old minimatch': ({'node_modules/@expo/fingerprint/node_modules/minimatch': {'version': '10.2.6'}}, 1),
        'eslint minimatch 3 is outside the range': ({'node_modules/minimatch': {'version': '3.1.5'}}, 0),
        'fixed versions pass': ({
            'node_modules/node-forge': {'version': '1.4.3'},
            'node_modules/glob': {'version': '14.0.6'},
            'node_modules/minimatch': {'version': '11.0.9'},
        }, 0),
        'the root project is ignored': ({'': {'name': 'glob', 'version': '10.0.0'}}, 0),
    }
    for label, (packages, expected) in cases.items():
        got = len(problems({'packages': packages}))
        if got != expected:
            failures.append(f'FAIL self-test "{label}": expected {expected} problem(s), got {got}')
        else:
            print(f'PASS self-test "{label}"')
    return failures


def main() -> int:
    failures = self_test()
    for problem in problems(json.loads(LOCKFILE.read_text())):
        failures.append(f'FAIL {problem}')
    if failures:
        print('\n'.join(failures))
        return 1
    print('PASS package-lock.json has none of the versions moved off by overrides')
    return 0


if __name__ == '__main__':
    sys.exit(main())
