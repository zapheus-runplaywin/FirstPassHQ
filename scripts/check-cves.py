#!/usr/bin/env python3
"""Checks the app's npm packages for known vulnerabilities, used by the
"Security audit" workflow.

Runs `npm audit` on package-lock.json and fails on any high or critical
advisory that isn't listed in .github/known-vulnerabilities.json. That file
only holds advisories with no fixed release to move to yet, each with the
reason it can wait; remove an entry as soon as a fix ships. Moderate and low
advisories are reported as warnings.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KNOWN = ROOT / '.github' / 'known-vulnerabilities.json'
BLOCKING = {'high', 'critical'}


def main():
    run = subprocess.run(
        ['npm', 'audit', '--package-lock-only', '--json'],
        cwd=ROOT, capture_output=True, text=True,
    )
    try:
        report = json.loads(run.stdout)
    except json.JSONDecodeError:
        print(run.stdout, run.stderr)
        print('::error::npm audit did not run.')
        return 1
    if 'vulnerabilities' not in report:
        print(json.dumps(report, indent=2))
        print('::error::npm audit did not return a report.')
        return 1

    known = {k['id']: k for k in json.loads(KNOWN.read_text())['advisories']}

    # Each advisory once, however many packages bring it in.
    advisories = {}
    for vuln in report['vulnerabilities'].values():
        for via in vuln['via']:
            if isinstance(via, dict):
                gid = via['url'].rsplit('/', 1)[-1]
                advisories.setdefault(gid, {**via, 'fix': vuln['fixAvailable']})

    failed = 0
    for gid, a in sorted(advisories.items()):
        where = f"{a['name']} {a['range']} ({a['severity']}): {a['title']} {a['url']}"
        if a['severity'] in BLOCKING and gid not in known:
            failed += 1
            print(f'::error::{where}')
        elif gid in known:
            print(f"Known, waiting on a fix: {where}\n  Why it can wait: {known[gid]['reason']}")
            # npm also offers "fixes" that jump a major version (such as
            # moving expo-updates to an old release); only a plain update counts.
            fix = a['fix']
            if fix is True or (isinstance(fix, dict) and not fix.get('isSemVerMajor')):
                print(f'::warning::A fix is now available for {gid}. Update the package and remove it from known-vulnerabilities.json.')
        else:
            print(f'::warning::{where}')
    for gid in known.keys() - advisories.keys():
        print(f'::warning::{gid} is no longer reported. Remove it from known-vulnerabilities.json.')

    total = report['metadata']['vulnerabilities']
    print(f"\n{len(advisories)} advisories ({', '.join(f'{v} {k}' for k, v in total.items() if v and k != 'total')}), {failed} not allowed")
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
