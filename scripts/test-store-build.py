#!/usr/bin/env python3
"""Checks the store build path (docs/beta-builds.md, docs/play-closed-testing.md)
stays wired up the way the runbooks describe:

eas.json
- the preview profile builds an installable APK; the production profile builds
  an Android App Bundle (.aab), the only kind Google Play accepts;
- the production submit profile sends Android builds to the closed testing
  track ("alpha" in Google's API) as a draft, so nothing reaches testers until
  someone rolls it out in Play Console;
- closed-test-rollout is the only profile that rolls out straight away, and it
  goes to the same closed testing track, never production;
- no submit profile names a key file: the Google service account key lives on
  Expo's servers, never in the repository.

.github/workflows/beta-build.yml
- it only runs when started by hand (Expo's free plan counts every build);
- each Android choice runs the profile the runbook says it does, and an
  unknown choice fails;
- every eas-cli call pins one version and runs non-interactively without
  waiting, so the job doesn't use up Actions minutes.

It also checks a few broken configurations are caught. Run by the "Tests"
workflow."""

import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EAS = ROOT / 'eas.json'
WORKFLOW = ROOT / '.github' / 'workflows' / 'beta-build.yml'

CLOSED_TRACK = 'alpha'
ANDROID_CHOICES = {
    'link': ['--profile preview'],
    'play-closed-test': ['--profile production', '--auto-submit-with-profile production'],
    'play-closed-test-rollout': [
        '--profile production',
        '--auto-submit-with-profile closed-test-rollout',
    ],
}


def submit_android(eas: dict, name: str) -> dict:
    """A submit profile's Android settings, following `extends` like EAS does."""
    profiles = eas.get('submit', {})
    seen = set()
    merged: dict = {}
    chain = []
    while name and name not in seen:
        seen.add(name)
        profile = profiles.get(name, {})
        chain.append(profile.get('android', {}))
        name = profile.get('extends')
    for part in reversed(chain):
        merged.update(part)
    return merged


def eas_problems(eas: dict) -> list[str]:
    found = []
    build = eas.get('build', {})
    if build.get('preview', {}).get('android', {}).get('buildType') != 'apk':
        found.append('the preview profile no longer builds an installable APK')
    prod_type = build.get('production', {}).get('android', {}).get('buildType', 'app-bundle')
    if prod_type != 'app-bundle':
        found.append('the production profile must build an app bundle for Google Play')
    if build.get('production', {}).get('distribution', 'store') != 'store':
        found.append('the production profile must be a store build')

    profiles = eas.get('submit', {})
    for required in ('production', 'closed-test-rollout'):
        if required not in profiles:
            found.append(f'submit profile {required} is missing')

    draft = submit_android(eas, 'production')
    if draft.get('track') != CLOSED_TRACK:
        found.append(f'production submits to {draft.get("track")!r}, not the closed test')
    if draft.get('releaseStatus') != 'draft':
        found.append('production must submit Android releases as drafts')

    rollout = submit_android(eas, 'closed-test-rollout')
    if rollout.get('track') != CLOSED_TRACK:
        found.append(f'closed-test-rollout submits to {rollout.get("track")!r}, not the closed test')
    if rollout.get('releaseStatus') != 'completed':
        found.append('closed-test-rollout must roll the release out')

    for name in profiles:
        android = submit_android(eas, name)
        if 'serviceAccountKeyPath' in android:
            found.append(f'{name} points at a key file; keep the key on Expo servers')
        if android.get('track') == 'production':
            found.append(f'{name} submits to the public production track')
        if name not in ('closed-test-rollout',) and android.get('releaseStatus') not in (None, 'draft'):
            found.append(f'{name} rolls out without the closed-test-rollout choice')
    return found


def android_step(text: str) -> str:
    match = re.search(r'- name: Build for Android\n(.*?)(?=\n      - name:|\Z)', text, re.S)
    return match.group(1) if match else ''


def workflow_problems(text: str) -> list[str]:
    found = []
    on = re.search(r'^on:\n(.*?)^\S', text, re.S | re.M)
    triggers = re.findall(r'^  ([a-z_]+):', on.group(1), re.M) if on else []
    if triggers != ['workflow_dispatch']:
        found.append(f'the workflow must only run by hand, not on {triggers}')

    options = re.search(r'android_build:.*?options:\s*\[([^\]]*)\]', text, re.S)
    listed = [o.strip() for o in options.group(1).split(',')] if options else []
    if sorted(listed) != sorted(ANDROID_CHOICES):
        found.append(f'android_build offers {listed}, expected {sorted(ANDROID_CHOICES)}')
    default = re.search(r'android_build:.*?default:\s*(\S+)', text, re.S)
    if not default or default.group(1) != 'link':
        found.append('android_build should default to an install link')

    step = android_step(text)
    if not step:
        found.append('the Build for Android step is missing')
    for choice, flags in ANDROID_CHOICES.items():
        line = re.search(rf'^\s+{re.escape(choice)}\)\s*(.*?);;', step, re.M)
        if not line:
            found.append(f'the Android step does not handle {choice}')
            continue
        for flag in flags:
            if flag not in line.group(1):
                found.append(f'{choice} should run with {flag}')
        if choice == 'link' and 'submit' in line.group(1):
            found.append('an install link build must not be sent to Google Play')
    if not re.search(r'^\s+\*\).*exit 1', step, re.M):
        found.append('an unknown Android choice must fail the step')

    calls = re.findall(r'npx --yes (eas-cli@\S+) build', text)
    if len(set(calls)) != 1 or not re.fullmatch(r'eas-cli@\d+\.\d+\.\d+', calls[0] if calls else ''):
        found.append(f'every build should use one pinned eas-cli version, found {calls}')
    steps = re.findall(r'- name: (Build for [^\n]*)\n(.*?)(?=\n      - name:|\Z)', text, re.S)
    if len(steps) < 2:
        found.append('expected a build step for Android and one for iOS')
    for name, body in steps:
        for flag in ('--non-interactive', '--no-wait'):
            if flag not in body:
                found.append(f'"{name}" runs eas-cli without {flag}')
    return found


def main() -> int:
    eas = json.loads(EAS.read_text())
    workflow = WORKFLOW.read_text()
    failures = 0

    for problem in eas_problems(eas) + workflow_problems(workflow):
        print(f'FAIL: {problem}')
        failures += 1
    if not failures:
        print('PASS: eas.json and the Beta build workflow match the store build runbooks')

    def broken_eas(change) -> dict:
        copy_ = copy.deepcopy(eas)
        change(copy_)
        return copy_

    eas_cases = {
        'production builds an APK': lambda e: e['build']['production'].setdefault('android', {}).update(buildType='apk'),
        'draft profile rolls out': lambda e: e['submit']['production']['android'].update(releaseStatus='completed'),
        'draft profile goes to internal testing': lambda e: e['submit']['production']['android'].update(track='internal'),
        'rollout profile goes public': lambda e: e['submit']['closed-test-rollout']['android'].update(track='production'),
        'rollout profile missing': lambda e: e['submit'].pop('closed-test-rollout'),
        'key file in the repo': lambda e: e['submit']['production']['android'].update(serviceAccountKeyPath='./key.json'),
        'preview no longer an APK': lambda e: e['build']['preview']['android'].update(buildType='app-bundle'),
    }
    for name, change in eas_cases.items():
        if eas_problems(broken_eas(change)):
            print(f'PASS: catches {name}')
        else:
            print(f'FAIL: does not catch {name}')
            failures += 1

    workflow_cases = {
        'runs on push': workflow.replace('on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:', 1),
        'link build sent to Play': workflow.replace('link) args=(--profile preview)', 'link) args=(--profile preview --auto-submit)', 1),
        'closed test without submit': workflow.replace(' --auto-submit-with-profile production)', ')', 1),
        'rollout uses the draft profile': workflow.replace('--auto-submit-with-profile closed-test-rollout', '--auto-submit-with-profile production', 1),
        'unknown choice ignored': re.sub(r'\n\s+\*\) echo .*?;;', '', workflow, count=1),
        'unpinned eas-cli': workflow.replace('eas-cli@24.12.0 build --platform android', 'eas-cli@latest build --platform android', 1),
        'waits for the build': workflow.replace('--non-interactive --no-wait | tee android.log', '--non-interactive | tee android.log', 1),
        'extra choice offered': workflow.replace('[link, play-closed-test,', '[link, play-production, play-closed-test,', 1),
    }
    for name, broken in workflow_cases.items():
        if broken == workflow:
            print(f'FAIL: test case "{name}" no longer changes the workflow; update it')
            failures += 1
        elif workflow_problems(broken):
            print(f'PASS: catches {name}')
        else:
            print(f'FAIL: does not catch {name}')
            failures += 1

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
