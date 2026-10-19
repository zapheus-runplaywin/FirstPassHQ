#!/usr/bin/env python3
"""Checks that check-migration-security.py flags new functions left open to
signed-out visitors, and doesn't flag a function an earlier migration already
created or renamed into place (replacing one keeps its revokes). Run by the
"Tests" workflow."""

import importlib.util
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'check_migration_security', Path(__file__).parent / 'check-migration-security.py'
)
cms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cms)

FN = """create or replace function public.{name}() returns void language sql
security definer set search_path = '' as $$ select $$;
"""
REVOKE = 'revoke execute on function public.{name}() from public, anon;\n'

failed = 0


def expect(label: str, migrations: dict[str, str], last: str, flagged: list[str]) -> None:
    global failed
    with tempfile.TemporaryDirectory() as folder:
        for name, sql in migrations.items():
            Path(folder, name).write_text(sql, encoding='utf-8')
        found = [why for _, why in cms.check(Path(folder, last))]
    got = sorted(w.split(' is ')[0] for w in found if 'not revoked' in w)
    if got == sorted(flagged):
        print(f'PASS {label}')
    else:
        failed += 1
        print(f'FAIL {label}: flagged {got}, expected {flagged}')


expect('a new function without a revoke is flagged',
       {'1_a.sql': FN.format(name='f')}, '1_a.sql', ['f'])
expect('a new function with a revoke passes',
       {'1_a.sql': FN.format(name='f') + REVOKE.format(name='f')}, '1_a.sql', [])
expect('replacing a function an earlier migration created passes',
       {'1_a.sql': FN.format(name='f') + REVOKE.format(name='f'), '2_b.sql': FN.format(name='f')},
       '2_b.sql', [])
expect('replacing a function an earlier migration renamed into place passes',
       {'1_a.sql': FN.format(name='f') + REVOKE.format(name='f'),
        '2_b.sql': 'alter function public.f() rename to f_base;\n',
        '3_c.sql': FN.format(name='f_base')},
       '3_c.sql', [])
expect('a rename in a later migration doesn\'t count',
       {'1_a.sql': FN.format(name='g'), '3_c.sql': 'alter function public.f() rename to g;\n'},
       '1_a.sql', ['g'])

sys.exit(1 if failed else 0)
