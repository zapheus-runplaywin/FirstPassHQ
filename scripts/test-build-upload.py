#!/usr/bin/env python3
"""Checks what a build copies up to Expo (.easignore; docs/beta-builds.md,
"What goes up to Expo").

Before a build, EAS copies the project folder to its build servers. When an
.easignore file exists it reads that INSTEAD of .gitignore, so this checks:

- every .gitignore rule is repeated in .easignore, or a build would upload
  .env, signing keys and generated folders;
- the copy of the git history (.git) and docs/ stay out: the history and the
  guides, PDFs and screenshots were 470 MB of a 473 MB upload;
- nothing a build reads is left out: app.json, eas.json, package.json,
  package-lock.json, tsconfig.json, .gitignore (it is part of the runtime
  version's fingerprint) and everything under src/ and assets/;
- nothing in src/ or app.json loads a file from a folder that is left out;
- what is left stays small, so the next large folder is noticed.

It also checks a few broken .easignore files are caught. Run by the "Tests"
workflow."""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EASIGNORE = ROOT / '.easignore'
GITIGNORE = ROOT / '.gitignore'

# What a build reads from outside src/ and assets/.
NEEDED_FILES = ['app.json', 'eas.json', 'package.json', 'package-lock.json', 'tsconfig.json', '.gitignore']
NEEDED_FOLDERS = ['src/', 'assets/']
# Folders no build uses. EAS warns above 150 MiB; the upload is about 10 MB.
LEFT_OUT_FOLDERS = ['docs/']
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

LOADS = re.compile(r'''(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]''')


def rules(text: str) -> list[str]:
    """The rules in an ignore file: its lines without comments and blanks."""
    lines = [line.strip() for line in text.splitlines()]
    return [line for line in lines if line and not line.startswith('#')]


def git(*args: str) -> list[str]:
    out = subprocess.run(['git', *args, '-z'], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [path for path in out.split('\0') if path]


def left_out(easignore: str, tracked: list[str]) -> set[str]:
    """The tracked files these rules keep out of the upload, as git reads them."""
    with tempfile.NamedTemporaryFile('w', suffix='.easignore', delete=False) as handle:
        handle.write(easignore)
    try:
        ignored = set(git('ls-files', '--cached', '--ignored', f'--exclude-from={handle.name}'))
    finally:
        os.unlink(handle.name)
    return ignored & set(tracked)


def loads_from(folders: list[str], sources: dict[str, str]) -> list[str]:
    """Imports, requires and app.json paths that point into one of the folders."""
    found = []
    for path, text in sources.items():
        if path.endswith('.json'):
            targets = re.findall(r'"(?:\./)?([^"]+)"', text)
            base = ''
        else:
            targets = [t for t in LOADS.findall(text) if t.startswith('.')]
            base = os.path.dirname(path)
        for target in targets:
            resolved = os.path.normpath(os.path.join(base, target)).replace(os.sep, '/')
            if any(resolved == folder.rstrip('/') or resolved.startswith(folder) for folder in folders):
                found.append(f'{path} loads {target}, which is not uploaded')
    return found


def size_problems(kept: list[str], limit: int) -> list[str]:
    total = sum((ROOT / path).stat().st_size for path in kept if (ROOT / path).is_file())
    if total > limit:
        return [
            f'the upload is {total / 1048576:.0f} MB, over {limit / 1048576:.0f} MB: '
            'add the folder a build does not need to .easignore'
        ]
    return []


def problems(gitignore: str, easignore: str, tracked: list[str]) -> list[str]:
    found = []
    eas_rules = set(rules(easignore))
    for rule in rules(gitignore):
        if rule not in eas_rules:
            found.append(f'"{rule}" is in .gitignore but not in .easignore, so a build would upload it')
    if not eas_rules & {'.git', '.git/', '/.git', '/.git/'}:
        found.append('.git is not in .easignore, so every build uploads a copy of the history')

    out = left_out(easignore, tracked)
    kept = [path for path in tracked if path not in out]
    for folder in LEFT_OUT_FOLDERS:
        uploaded = [path for path in kept if path.startswith(folder)]
        if uploaded:
            found.append(f'{folder} is uploaded ({len(uploaded)} files): add /{folder.rstrip("/")} to .easignore')
    needed = [
        path for path in tracked
        if path in NEEDED_FILES or any(path.startswith(folder) for folder in NEEDED_FOLDERS)
    ]
    missing = [path for path in needed if path in out]
    if missing:
        more = f' and {len(missing) - 3} more' if len(missing) > 3 else ''
        found.append(f'a build needs {", ".join(missing[:3])}{more}, but .easignore leaves it out')
    return found + size_problems(kept, MAX_UPLOAD_BYTES)


def app_sources(tracked: list[str]) -> dict[str, str]:
    sources = {'app.json': (ROOT / 'app.json').read_text()}
    for path in tracked:
        if path.startswith('src/') and path.endswith(('.ts', '.tsx', '.js', '.jsx')):
            sources[path] = (ROOT / path).read_text()
    return sources


def main() -> int:
    failures = 0
    if not EASIGNORE.exists():
        print('FAIL: .easignore is missing, so every build uploads the guides and a copy of the history')
        return 1
    gitignore = GITIGNORE.read_text()
    easignore = EASIGNORE.read_text()
    tracked = git('ls-files')

    found = problems(gitignore, easignore, tracked) + loads_from(LEFT_OUT_FOLDERS, app_sources(tracked))
    for problem in found:
        print(f'FAIL: {problem}')
        failures += 1
    if not found:
        kept = [path for path in tracked if path not in left_out(easignore, tracked)]
        total = sum((ROOT / path).stat().st_size for path in kept if (ROOT / path).is_file())
        print(f'PASS: a build uploads {len(kept)} of {len(tracked)} tracked files, {total / 1048576:.1f} MB, '
              'without .git or docs/ and with everything .gitignore keeps out')

    def without(line: str) -> str:
        return '\n'.join(row for row in easignore.splitlines() if row.strip() != line) + '\n'

    cases = {
        'a .gitignore rule missing (.env)': without('.env'),
        'a .gitignore rule missing (signing keys)': without('*.p8'),
        'the history uploaded': without('.git'),
        'the guides uploaded': without('/docs'),
        "the app's code left out": easignore + '/src/lib\n',
        'the icons left out': easignore + '*.png\n',
        'the lockfile left out': easignore + 'package-lock.json\n',
        'app.json left out': easignore + '*.json\n',
        '.gitignore left out': easignore + '.gitignore\n',
    }
    for name, broken in cases.items():
        if rules(broken) == rules(easignore):
            print(f'FAIL: test case "{name}" no longer changes .easignore; update it')
            failures += 1
        elif problems(gitignore, broken, tracked):
            print(f'PASS: catches {name}')
        else:
            print(f'FAIL: does not catch {name}')
            failures += 1

    reference_cases = {
        'an import from docs/': {'src/app/about.tsx': "import logo from '../../docs/branding/logo.png';"},
        'a require from docs/': {'src/components/guide.tsx': "const page = require('../../docs/user-guide/home.png');"},
        'an app.json image in docs/': {'app.json': json.dumps({'expo': {'icon': './docs/branding/icon.png'}})},
    }
    for name, sources in reference_cases.items():
        if loads_from(LEFT_OUT_FOLDERS, sources):
            print(f'PASS: catches {name}')
        else:
            print(f'FAIL: does not catch {name}')
            failures += 1
    if loads_from(LEFT_OUT_FOLDERS, {'src/lib/a.ts': "import b from './docs/b';\n// see docs/beta-builds.md"}):
        print('FAIL: takes a folder inside src/ or a comment for the docs folder')
        failures += 1
    else:
        print('PASS: a docs folder inside src/ and a comment are not mistaken for docs/')

    if size_problems(tracked[:50], 1):
        print('PASS: catches an upload over the size limit')
    else:
        print('FAIL: does not catch an upload over the size limit')
        failures += 1

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
