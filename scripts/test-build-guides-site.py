#!/usr/bin/env python3
"""Checks the guides are published whole, under the names the app links to.

scripts/build-guides-site.py lays out the role guides from docs/pdfs/ for the
"Publish guides" workflow. This checks:

- the real docs/pdfs lays out: every role for both published editions, from
  one build, each file the same bytes as its source;
- a set with a hole in it is refused (a missing role, two of one, an unknown
  role, a file that isn't a PDF, mixed builds, a missing edition);
- the Warriors edition, a pitch, is never published;
- the roles and editions match the app's links (src/lib/guides.ts), so a
  guide the app offers is always one that is published;
- the workflow runs when new PDFs merge to main and by hand, may publish to
  Pages and nothing more, and stops when Pages isn't switched on.

Run by the "Tests" workflow."""

import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('build_guides_site', ROOT / 'scripts' / 'build-guides-site.py')
site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site)

failures = []


def check(name, ok):
    print(('PASS' if ok else 'FAIL') + ': ' + name)
    if not ok:
        failures.append(name)


def fake_pdfs(folder: Path, build=850, editions=('generic', 'thunder'), roles=None, prefix='Sample'):
    """A docs/pdfs look-alike with a tiny PDF for each role of each edition."""
    for edition in editions:
        guides = folder / edition / 'user-guides'
        guides.mkdir(parents=True, exist_ok=True)
        for role in roles if roles is not None else site.ROLES:
            (guides / f'{prefix}-user-guide-{role}-build-{build}.pdf').write_bytes(
                b'%PDF-1.7 ' + f'{edition} {role}'.encode())
    return folder


def refused(pdfs: Path, *words: str) -> bool:
    try:
        site.find_guides(pdfs)
    except site.GuidesError as error:
        return all(word in str(error) for word in words)
    return False


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)

    # The real PDFs.
    out = tmp / 'real'
    build = site.build_site(ROOT / 'docs' / 'pdfs', out)
    published = sorted(str(p.relative_to(out)) for p in out.rglob('*') if p.is_file())
    expected = sorted(
        ['index.html', 'guides/index.json']
        + [f'guides/{edition}/user-guide-{role}.pdf' for edition in site.EDITIONS for role in site.ROLES])
    check('docs/pdfs lays out as every role for both editions, an index and nothing else',
          published == expected)
    check('20 guides are published', len([p for p in published if p.endswith('.pdf')]) == 20)
    index = json.loads((out / 'guides' / 'index.json').read_text())
    check('index.json gives the build in the file names', index['build'] == build and build > 0)
    check('index.json lists every role for both editions',
          index['editions'] == {edition: sorted(site.ROLES) for edition in site.EDITIONS})
    same = True
    for edition in site.EDITIONS:
        for source in (ROOT / 'docs' / 'pdfs' / edition / 'user-guides').glob('*.pdf'):
            role = site.GUIDE_NAME.search(source.name)['role']
            copy = out / 'guides' / edition / f'user-guide-{role}.pdf'
            same = same and copy.stat().st_size == source.stat().st_size and copy.read_bytes()[:1024] == source.read_bytes()[:1024]
    check('each published guide is its source, unchanged', same)
    check('nothing of the Warriors pitch is published',
          'warriors' not in site.EDITIONS and not any('arriors' in name for name in published))
    page = (out / 'index.html').read_text()
    links = re.findall(r'href="(guides/[^"]+)"', page)
    check('the list links every published guide once',
          sorted(links) == sorted(p for p in published if p.endswith('.pdf')))
    check('the list says which build the guides describe', f'build {build}.' in page)
    check('the list runs no scripts and loads nothing from elsewhere',
          '<script' not in page and 'src=' not in page and '@import' not in page)

    # Laying out again replaces what was there.
    (out / 'guides' / 'generic' / 'left-over.pdf').write_bytes(b'%PDF-old')
    site.build_site(ROOT / 'docs' / 'pdfs', out)
    check('laying out again clears what was there before',
          not (out / 'guides' / 'generic' / 'left-over.pdf').exists())

    # Sets that must not go out.
    whole = fake_pdfs(tmp / 'whole')
    check('a whole sample set is accepted', site.find_guides(whole)[0] == 850)

    missing = fake_pdfs(tmp / 'missing')
    next((missing / 'thunder' / 'user-guides').glob('*-coaches-*')).unlink()
    check('refuses a set with a role missing', refused(missing, 'thunder has no guide for coaches'))

    twice = fake_pdfs(tmp / 'twice')
    (twice / 'generic' / 'user-guides' / 'Other-user-guide-athletes-build-850.pdf').write_bytes(b'%PDF-1.7')
    check('refuses two guides for one role', refused(twice, 'generic has two guides for athletes'))

    unknown = fake_pdfs(tmp / 'unknown', roles=[*site.ROLES, 'umpires'])
    check('refuses a role it does not know', refused(unknown, 'umpires', 'does not know'))

    not_pdf = fake_pdfs(tmp / 'not-pdf')
    next((not_pdf / 'generic' / 'user-guides').glob('*-admins-*')).write_text('<html>Not found</html>')
    check('refuses a file that is not a PDF', refused(not_pdf, 'is not a PDF', 'generic has no guide for admins'))

    mixed = fake_pdfs(tmp / 'mixed', editions=('generic',))
    fake_pdfs(mixed, build=851, editions=('thunder',))
    check('refuses guides from different builds', refused(mixed, 'different builds: 850, 851'))

    one_edition = fake_pdfs(tmp / 'one', editions=('generic',))
    check('refuses a missing edition', refused(one_edition, 'thunder', 'is missing'))

    stray = fake_pdfs(tmp / 'stray')
    (stray / 'generic' / 'user-guides' / 'notes.pdf').write_bytes(b'%PDF-1.7')
    check('refuses a PDF that is not named like a role guide', refused(stray, 'notes.pdf'))

    # The command itself: a refused set publishes nothing and exits 1.
    target = tmp / 'refused-out'
    check('the command exits 1 on a refused set', site.main([str(target), '--pdfs', str(missing)]) == 1)
    check('and writes nothing', not target.exists())
    check('the command exits 0 on a whole set', site.main([str(tmp / 'ok-out'), '--pdfs', str(whole)]) == 0)

# The app's links (src/lib/guides.ts) and this script name the same guides.
app = (ROOT / 'src' / 'lib' / 'guides.ts').read_text()
app_files = re.findall(r"file: '([a-z-]+)'", app)
check('the app links the roles this script publishes', sorted(app_files) == sorted(site.ROLES))
branded = re.search(r'BRANDED_EDITIONS[^=]*=\s*\{([^}]*)\}', app)
app_editions = set(re.findall(r":\s*'([a-z-]+)'", branded.group(1) if branded else '')) | {'generic'}
check('the app links only editions this script publishes', app_editions == set(site.EDITIONS))
check('the app builds addresses as guides/<edition>/user-guide-<role>.pdf',
      "`${GUIDES_URL}/${guideEdition(clubCode)}/user-guide-${file}.pdf`" in app
      and re.search(r"GUIDES_URL =\s*'https://[a-z0-9.-]+/FirstPassHQ/guides'", app) is not None
      and site.published_name('athletes') == 'user-guide-athletes.pdf')

# The workflow.
text = (ROOT / '.github' / 'workflows' / 'publish-guides.yml').read_text()
workflow = yaml.safe_load(text)
on = workflow.get('on', workflow.get(True)) or {}
push = on.get('push') or {}
check('Publish guides runs on merges to main that change the PDFs',
      push.get('branches') == ['main'] and 'docs/pdfs/**' in (push.get('paths') or []))
check('Publish guides can be run by hand', 'workflow_dispatch' in on)
check('Publish guides never runs on pull requests or a schedule',
      'pull_request' not in on and 'pull_request_target' not in on and 'schedule' not in on)
check('Publish guides may read the code and publish to Pages, nothing more',
      workflow.get('permissions') == {'contents': 'read', 'pages': 'write', 'id-token': 'write'})
steps = workflow['jobs']['publish']['steps']
gated = [step for step in steps if step.get('id') != 'pages']
check('every step after the Pages check waits for it',
      steps[0].get('id') == 'pages' and all(step.get('if') == "steps.pages.outputs.on == 'true'" for step in gated))
check('a run by hand fails when Pages is off', 'exit 1' in steps[0]['run'] and 'BY_HAND' in steps[0]['run'])
check('the workflow lays the guides out with the script',
      any(step.get('run') == 'python3 scripts/build-guides-site.py _site' for step in steps))
check('the workflow only checks out the published editions',
      'warriors' not in text.lower().replace('west coast warriors', ''))
check('actions are pinned to a commit',
      all(re.fullmatch(r'[\w./-]+@[0-9a-f]{40}', step['uses']) for step in steps if 'uses' in step))

if failures:
    sys.exit(f'{len(failures)} guides site check(s) failed')
print('All guides site checks passed')
