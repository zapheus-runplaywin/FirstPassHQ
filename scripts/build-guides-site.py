#!/usr/bin/env python3
"""Lays out the user guides for publishing, under names that don't change.

    scripts/build-guides-site.py <out dir> [--pdfs docs/pdfs]

The role guides in docs/pdfs/ carry their build number in the file name, so
their names change with every rebuild. The app, and the guides page on the
public site, link to them, so they are published at fixed addresses:

    <out>/guides/<edition>/user-guide-<role>.pdf
    <out>/guides/index.json      the build they describe, and what is there
    <out>/index.html             a plain list of every guide, for anyone who
                                 lands on the address itself

The "Publish guides" workflow runs this and puts <out> on GitHub Pages
(docs/pdfs/README.md, "Published guides"). Two editions are published: the
FirstPass HQ one for every club, and West Coast Thunder's own. The Warriors
edition is a pitch and is never published.

It stops, publishing nothing, when a guide is missing, isn't a PDF, there are
two of one, or the guides aren't all from the same build: the app links to
every one of them, so a set with a hole in it must not go out.
"""

import argparse
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Edition folder in docs/pdfs -> the name on the list. Keep in step with
# BRANDED_EDITIONS in src/lib/guides.ts (scripts/test-build-guides-site.py).
EDITIONS = {
    'generic': 'FirstPass HQ',
    'thunder': 'West Coast Thunder',
}

# The role in the file name -> who the guide is for. Keep in step with
# ROLE_GUIDES in src/lib/guides.ts (the same test).
ROLES = {
    'athletes': 'Athletes',
    'guardians': 'Parents and guardians',
    'coaches': 'Coaches',
    'managers': 'Managers',
    'committee': 'Committee',
    'physios': 'Physios',
    'guests': 'Guests',
    'statisticians': 'Statisticians',
    'temporary-helpers': 'Temporary helpers',
    'admins': 'Admins',
}

GUIDE_NAME = re.compile(r'-user-guide-(?P<role>[a-z-]+)-build-(?P<build>\d+)\.pdf$')


class GuidesError(Exception):
    """Why the guides can't be published as they stand."""


def find_guides(pdfs: Path) -> tuple[int, dict[str, dict[str, Path]]]:
    """The build number and, for each edition, the PDF of each role."""
    problems: list[str] = []
    builds: set[int] = set()
    found: dict[str, dict[str, Path]] = {}
    for edition in EDITIONS:
        folder = pdfs / edition / 'user-guides'
        found[edition] = {}
        if not folder.is_dir():
            problems.append(f'{folder} is missing')
            continue
        for pdf in sorted(folder.glob('*.pdf')):
            match = GUIDE_NAME.search(pdf.name)
            if not match:
                problems.append(f'{pdf.name} in {edition} is not named like a role guide')
                continue
            role = match['role']
            if role not in ROLES:
                problems.append(f'{pdf.name} in {edition} is for a role this script does not know')
                continue
            if role in found[edition]:
                problems.append(f'{edition} has two guides for {role}')
                continue
            with pdf.open('rb') as handle:
                if handle.read(5) != b'%PDF-':
                    problems.append(f'{pdf.name} in {edition} is not a PDF')
                    continue
            found[edition][role] = pdf
            builds.add(int(match['build']))
        for role in ROLES:
            if role not in found[edition]:
                problems.append(f'{edition} has no guide for {role}')
    if len(builds) > 1:
        problems.append('the guides are from different builds: ' + ', '.join(map(str, sorted(builds))))
    if problems:
        raise GuidesError('; '.join(problems))
    return builds.pop(), found


def published_name(role: str) -> str:
    return f'user-guide-{role}.pdf'


def index_page(build: int) -> str:
    sections = []
    for edition, name in EDITIONS.items():
        links = '\n'.join(
            f'<li><a href="guides/{edition}/{published_name(role)}">{html.escape(readers)}</a></li>'
            for role, readers in ROLES.items()
        )
        sections.append(f'<h2>{html.escape(name)}</h2>\n<ul>\n{links}\n</ul>')
    body = '\n'.join(sections)
    return f"""<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="description" content="User guides for the FirstPass HQ app, one for each role.">
<title>FirstPass HQ user guides</title>
<style>
:root {{ color-scheme: light dark; }}
body {{ margin: 0 auto; max-width: 720px; padding: 24px 16px 48px; font: 16px/24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
h1 {{ font-size: 32px; line-height: 38px; }}
h2 {{ font-size: 22px; line-height: 28px; margin-top: 32px; }}
li {{ margin-bottom: 6px; }}
.small {{ font-size: 14px; opacity: 0.75; }}
</style>
</head>
<body>
<h1>FirstPass HQ user guides</h1>
<p>FirstPass HQ is a club administration app for netball clubs. There is one guide for each role, as a PDF. Someone with more than one role reads each of their roles' guides.</p>
{body}
<p class="small">These guides describe the app at build {build}. Every person in them is made up.</p>
<p class="small"><a href="https://firstpass-hq.expo.app/support">Support</a> · <a href="https://firstpass-hq.expo.app/privacy">Privacy policy</a></p>
</body>
</html>
"""


def build_site(pdfs: Path, out: Path) -> int:
    """Writes the site into `out` (emptied first) and returns the build number."""
    build, found = find_guides(pdfs)
    if out.exists():
        shutil.rmtree(out)
    for edition, guides in found.items():
        folder = out / 'guides' / edition
        folder.mkdir(parents=True)
        for role, pdf in guides.items():
            shutil.copyfile(pdf, folder / published_name(role))
    index = {
        'build': build,
        'editions': {edition: sorted(guides) for edition, guides in found.items()},
    }
    (out / 'guides' / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
    (out / 'index.html').write_text(index_page(build))
    return build


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('out', type=Path, help='the folder to write the site into (emptied first)')
    parser.add_argument('--pdfs', type=Path, default=ROOT / 'docs' / 'pdfs',
                        help='the folder holding <edition>/user-guides/ (default: docs/pdfs)')
    args = parser.parse_args(argv)
    try:
        build = build_site(args.pdfs, args.out)
    except GuidesError as error:
        print(f'Not publishing the guides: {error}.', file=sys.stderr)
        return 1
    count = len(EDITIONS) * len(ROLES)
    print(f'Laid out {count} guides from build {build} in {args.out}.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
