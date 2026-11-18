#!/usr/bin/env python3
"""Tests scripts/check-build-settings.js, the check a build on Expo's servers
runs first (docs/beta-builds.md, "What a build checks first").

The first signed builds (18 November 2026) were made with no club settings in
the EAS environment. They built, were signed and reached TestFlight, and the
app stopped the moment it opened. So this checks that a build:

- goes ahead with the live club's address and key, with or without a demo
  club, and with either kind of public key;
- is stopped when the live club's address or key is missing, blank or
  malformed; when a key is a secret or service_role key, has expired or
  belongs to another project than its address; when the demo club has only
  one of its two settings; and when the demo club is the live club's project;
- never prints a key.

And that the check stays wired up: package.json runs it as EAS's
eas-build-pre-install script, it needs nothing but Node (EAS runs it before
installing packages), and it checks the names the app reads. It reaches no
network. Run by the "Tests" workflow."""

import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts' / 'check-build-settings.js'
HOOK = 'eas-build-pre-install'

LIVE_URL = 'EXPO_PUBLIC_SUPABASE_URL'
LIVE_KEY = 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
DEMO_URL = 'EXPO_PUBLIC_DEMO_CLUB_URL'
DEMO_KEY = 'EXPO_PUBLIC_DEMO_CLUB_ANON_KEY'

FAR_FUTURE = 4102444800  # 1 January 2100


def part(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')


def key(project: str, role: str = 'anon', expires: int = FAR_FUTURE) -> str:
    """A key shaped like Supabase's older ones: readable claims and a signature."""
    claims = {'iss': 'supabase', 'ref': project, 'role': role, 'iat': 1700000000, 'exp': expires}
    return '.'.join([part({'alg': 'HS256', 'typ': 'JWT'}), part(claims), 'signature-not-checked'])


LIVE = {LIVE_URL: 'https://liveclub.supabase.co', LIVE_KEY: key('liveclub')}
DEMO = {DEMO_URL: 'https://testclub.supabase.co', DEMO_KEY: key('testclub')}
BOTH = {**LIVE, **DEMO}


def run(command: list[str], settings: dict[str, str]) -> tuple[int, str]:
    """Runs the check with these settings and nothing else from this machine."""
    env = {'PATH': os.environ['PATH'], 'HOME': os.environ.get('HOME', '/tmp'), **settings}
    done = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
    return done.returncode, done.stdout + done.stderr


def check(settings: dict[str, str]) -> tuple[int, str]:
    return run(['node', str(SCRIPT)], settings)


def without(settings: dict[str, str], *names: str) -> dict[str, str]:
    return {name: value for name, value in settings.items() if name not in names}


# name: (settings, what the message must name)
GOES_AHEAD = {
    'the live club and the demo club': (BOTH, [LIVE[LIVE_URL], DEMO[DEMO_URL]]),
    'the live club alone': (LIVE, [LIVE[LIVE_URL], 'no demo club']),
    'publishable keys': (
        {**BOTH, LIVE_KEY: 'sb_publishable_live', DEMO_KEY: 'sb_publishable_test'},
        [LIVE[LIVE_URL], DEMO[DEMO_URL]],
    ),
    'a project on its own domain': (
        {LIVE_URL: 'https://data.club.example', LIVE_KEY: key('liveclub')},
        ['https://data.club.example'],
    ),
}

STOPPED = {
    'no settings at all, as on 18 November': ({}, [LIVE_URL, LIVE_KEY, 'stops as soon as it opens']),
    'only the demo club set': (DEMO, [LIVE_URL, LIVE_KEY]),
    'the live address missing': (without(BOTH, LIVE_URL), [f'{LIVE_URL} is missing']),
    'the live key missing': (without(BOTH, LIVE_KEY), [f'{LIVE_KEY} is missing']),
    'the live address blank': ({**BOTH, LIVE_URL: '  '}, [f'{LIVE_URL} is missing']),
    'the live key blank': ({**BOTH, LIVE_KEY: ''}, [f'{LIVE_KEY} is missing']),
    'a slash after the address': ({**BOTH, LIVE_URL: LIVE[LIVE_URL] + '/'}, [LIVE_URL, 'alone']),
    'a path after the address': ({**BOTH, LIVE_URL: LIVE[LIVE_URL] + '/rest/v1'}, [LIVE_URL, 'alone']),
    'a space before the address': ({**BOTH, LIVE_URL: ' ' + LIVE[LIVE_URL]}, [LIVE_URL, 'space']),
    'quotes around the address': ({**BOTH, LIVE_URL: f'"{LIVE[LIVE_URL]}"'}, [LIVE_URL, 'quote']),
    'capitals in the address': ({**BOTH, LIVE_URL: 'https://LiveClub.supabase.co'}, [LIVE_URL, 'alone']),
    'an address without https': ({**BOTH, LIVE_URL: 'http://liveclub.supabase.co'}, [LIVE_URL, 'https://']),
    'a project id for an address': ({**BOTH, LIVE_URL: 'liveclub'}, [LIVE_URL, 'not a web address']),
    'the service_role key': (
        {**BOTH, LIVE_KEY: key('liveclub', 'service_role')},
        [LIVE_KEY, 'service_role', 'must never be in an app'],
    ),
    'a secret key': ({**BOTH, LIVE_KEY: 'sb_secret_abc123'}, [LIVE_KEY, 'SECRET', 'must never be in an app']),
    "a signed-in person's token for a key": ({**BOTH, LIVE_KEY: key('liveclub', 'authenticated')}, [LIVE_KEY, 'anon']),
    'an expired key': ({**BOTH, LIVE_KEY: key('liveclub', expires=1700000001)}, [LIVE_KEY, 'expired']),
    "the test project's key with the live address": (
        {**BOTH, LIVE_KEY: key('testclub')},
        [LIVE_KEY, 'another project'],
    ),
    'the address pasted as the key': ({**BOTH, LIVE_KEY: LIVE[LIVE_URL]}, [LIVE_KEY, 'not a Supabase public key']),
    'a key cut short': ({**BOTH, LIVE_KEY: LIVE[LIVE_KEY][:40]}, [LIVE_KEY, 'not a Supabase public key']),
    'a space in the key': ({**BOTH, LIVE_KEY: LIVE[LIVE_KEY] + ' '}, [LIVE_KEY, 'space']),
    'the demo address without its key': (without(BOTH, DEMO_KEY), [f'{DEMO_KEY} is missing', 'no demo club']),
    'the demo key without its address': (without(BOTH, DEMO_URL), [f'{DEMO_URL} is missing', 'no demo club']),
    "the demo club on the live club's project": (
        {**LIVE, DEMO_URL: LIVE[LIVE_URL], DEMO_KEY: LIVE[LIVE_KEY]},
        [DEMO_URL, "live club's own project"],
    ),
    "the demo club on the live club's project, written differently": (
        {**LIVE, DEMO_URL: LIVE[LIVE_URL] + '/', DEMO_KEY: LIVE[LIVE_KEY]},
        [DEMO_URL, "live club's own project"],
    ),
    "the live club's publishable key for the demo club": (
        {**BOTH, LIVE_KEY: 'sb_publishable_live', DEMO_KEY: 'sb_publishable_live'},
        [DEMO_KEY, "live club's key"],
    ),
    'the service_role key for the demo club': (
        {**BOTH, DEMO_KEY: key('testclub', 'service_role')},
        [DEMO_KEY, 'service_role'],
    ),
    'a slash after the demo address': ({**BOTH, DEMO_URL: DEMO[DEMO_URL] + '/'}, [DEMO_URL, 'alone']),
}


def main() -> int:
    failures = 0

    def result(passed: bool, name: str, output: str = '') -> None:
        nonlocal failures
        print(f'{"PASS" if passed else "FAIL"}: {name}')
        if not passed:
            failures += 1
            if output:
                print('  ' + output.strip().replace('\n', '\n  '))

    printed_keys = []
    for cases, wanted, verb in ((GOES_AHEAD, 0, 'goes ahead'), (STOPPED, 1, 'is stopped')):
        for name, (settings, named) in cases.items():
            status, output = check(settings)
            result(status == wanted and all(text in output for text in named), f'a build {verb} with {name}', output)
            secrets = [value for setting, value in settings.items() if setting.endswith('_KEY') and len(value) > 20]
            if any(value.strip() in output for value in secrets if 'https://' not in value):
                printed_keys.append(name)
    result(not printed_keys, 'no key is printed, whatever is wrong', ', '.join(printed_keys))

    status, output = run(['node', str(SCRIPT)], {'EAS_BUILD_PROFILE': 'production'})
    result('"production" environment' in output and 'docs/beta-builds.md' in output,
           'a stopped build names its EAS environment and the guide', output)

    # The wiring: EAS runs the package.json script of this name before `npm install`.
    package = json.loads((ROOT / 'package.json').read_text())
    hook = package.get('scripts', {}).get(HOOK, '')
    result(hook == 'node scripts/check-build-settings.js', f'package.json runs the check as {HOOK}', hook)
    status, output = run(['npm', 'run', '--silent', HOOK], {})
    result(status != 0 and LIVE_URL in output, f'{HOOK} fails a build with no settings', output)
    status, output = run(['npm', 'run', '--silent', HOOK], BOTH)
    result(status == 0, f'{HOOK} passes a build with its settings', output)

    source = SCRIPT.read_text()
    needs = re.findall(r'''require\(\s*['"]([^'"]+)['"]\s*\)''', source)
    result(bool(needs) and all(name.startswith('node:') for name in needs),
           'the check needs nothing but Node, so it can run before packages are installed', ', '.join(needs))

    clubs = (ROOT / 'src' / 'constants' / 'clubs.ts').read_text()
    unread = [name for name in (LIVE_URL, LIVE_KEY, DEMO_URL, DEMO_KEY)
              if f'process.env.{name}' not in clubs or name not in source]
    result(not unread, 'the check and the app read the same four settings', ', '.join(unread))
    result('if (!homeUrl || !homeKey)' in clubs and 'throw new Error' in clubs,
           'the app still refuses to start without the live club, which is why the build must have it')

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
