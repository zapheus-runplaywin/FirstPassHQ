#!/usr/bin/env python3
"""Flags migration statements that can throw away data.

Usage: check-migrations.py FILE...

Function bodies ($$ ... $$) are skipped, because deletes inside them run when
the app calls the function, not when the migration runs. Exits with status 1
when anything is found, so the deploy stops until Matt allows it.
"""

import re
import sys

RISKY = [
    (r'\bdrop\s+(table|schema|view|materialized\s+view|type|sequence)\b', 'drops an object'),
    # "alter table t drop c" drops a column too; the column keyword is optional.
    (
        r'\balter\s+table\b[^;]*?\bdrop\s+(?!constraint\b|default\b|not\b|identity\b|expression\b)'
        r'(column\s+)?[\w"]+',
        'drops a column',
    ),
    (r'\btruncate\b', 'empties a table'),
    (r'\bdelete\s+from\b', 'deletes rows'),
    (r'\bupdate\s+[\w."]+\s+set\b', 'overwrites existing rows'),
    (r'\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b', 'changes a column type'),
]


def strip(sql: str) -> str:
    # Keep line numbers by replacing skipped text with the same newlines.
    blank = lambda m: re.sub(r'[^\n]', ' ', m.group(0))
    sql = re.sub(r'\$(\w*)\$.*?\$\1\$', blank, sql, flags=re.S)
    sql = re.sub(r'--[^\n]*', blank, sql)
    sql = re.sub(r'/\*.*?\*/', blank, sql, flags=re.S)
    sql = re.sub(r"'(?:[^']|'')*'", blank, sql)
    return sql


def main(paths: list[str]) -> int:
    found = 0
    for path in paths:
        with open(path, encoding='utf-8') as f:
            original = f.read()
        lines = original.splitlines()
        sql = strip(original).lower()
        for pattern, why in RISKY:
            for match in re.finditer(pattern, sql):
                line = sql.count('\n', 0, match.start()) + 1
                print(f'{path}:{line}: {why}: {lines[line - 1].strip()}')
                found += 1
    if found:
        print(f'\n{found} statement(s) above can lose data. They need Matt\'s permission first.')
        return 1
    print('No statements that can lose data.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
