#!/usr/bin/env python3
"""Checks that check-migration-clashes.py stops a migration whose version
another open pull request also adds (#246 and #247 both added 20261119130000
on 19 November 2026), and lets different versions through. Run by the "Tests"
workflow."""

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'check_migration_clashes', Path(__file__).parent / 'check-migration-clashes.py'
)
cmc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cmc)

M = 'supabase/migrations/'
failed = 0


def expect(label: str, got, want) -> None:
    global failed
    if got == want:
        print(f'PASS {label}')
    else:
        failed += 1
        print(f'FAIL {label}: got {got}, expected {want}')


expect(
    'the #246 and #247 clash is caught',
    cmc.clashes(
        [M + '20261119130000_wwcc_self_submit.sql'],
        {246: [M + '20261119130000_concern_reported_message.sql']},
    ),
    [(M + '20261119130000_wwcc_self_submit.sql', 246, M + '20261119130000_concern_reported_message.sql')],
)
expect(
    'different versions pass',
    cmc.clashes(
        [M + '20261119135000_wwcc_self_submit.sql', M + '20261119140000_wwcc_self_submit_push.sql'],
        {246: [M + '20261119130000_concern_reported_message.sql'], 248: [M + '20261120000000_x.sql']},
    ),
    [],
)
expect(
    'a shared name after the version is no clash',
    cmc.clashes([M + '20261120000000_a.sql'], {1: [M + '20261120000001_a.sql']}),
    [],
)
expect(
    'every clashing pull request is named',
    cmc.clashes([M + '20261120000000_a.sql'], {7: [M + '20261120000000_b.sql'], 3: [M + '20261120000000_c.sql']}),
    [(M + '20261120000000_a.sql', 3, M + '20261120000000_c.sql'), (M + '20261120000000_a.sql', 7, M + '20261120000000_b.sql')],
)
expect('no other open pull requests', cmc.clashes([M + '20261120000000_a.sql'], {}), [])

expect(
    'only migrations a pull request adds or renames in count',
    cmc.new_migrations([
        {'filename': M + '20261120000000_new.sql', 'status': 'added'},
        {'filename': M + '20261120000100_moved.sql', 'status': 'renamed'},
        {'filename': M + '20261007000000_init.sql', 'status': 'modified'},
        {'filename': M + '20261008000000_gone.sql', 'status': 'removed'},
        {'filename': 'supabase/tests/x.sql', 'status': 'added'},
        {'filename': M + 'README.md', 'status': 'added'},
    ]),
    [M + '20261120000000_new.sql', M + '20261120000100_moved.sql'],
)
expect('no new migrations is fine without a token', cmc.main(['src/app/index.tsx']), 0)

sys.exit(1 if failed else 0)
