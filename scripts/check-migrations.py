#!/usr/bin/env python3
"""Flags migration statements that can throw away data.

Usage: check-migrations.py FILE...

Function bodies (create function ... as $$ ... $$) are skipped, because
deletes inside them run when the app calls the function, not when the
migration runs. Other $$ blocks, such as `do $$ ... $$`, run straight away, so
they are checked like any other statement. Exits with status 1 when anything
is found, so the deploy stops until Matt allows it.
"""

import re
import sys

RISKY = [
    (
        r'\bdrop\s+(table|schema|view|materialized\s+view|type|sequence|extension|database'
        r'|owned|foreign\s+table)\b',
        'drops an object',
    ),
    # "alter table t drop c" drops a column too; the column keyword is optional.
    (
        r'\balter\s+table\b[^;]*?\bdrop\s+(?!constraint\b|default\b|not\b|identity\b|expression\b)'
        r'(column\s+)?[\w"]+',
        'drops a column',
    ),
    (r'\btruncate\b', 'empties a table'),
    (r'\bdelete\s+from\b', 'deletes rows'),
    (r'\bupdate\s+(only\s+)?[\w."]+(\s+(as\s+)?\w+)?\s+set\b', 'overwrites existing rows'),
    (r'\bdo\s+update\b', 'overwrites existing rows on conflict'),
    (r'\bmerge\s+into\b', 'merges into existing rows'),
    # SQL built at run time can do any of the above without showing it here.
    (r'\bexecute\s+(?!function\b|procedure\b|on\b)', 'runs SQL built at run time'),
    (r'\balter\s+column\s+[\w"]+\s+(set\s+data\s+)?type\b', 'changes a column type'),
]


FUNCTION_HEADER = re.compile(r'\bcreate\s+(or\s+replace\s+)?(function|procedure)\b', re.I)


def blank_text(text: str) -> str:
    return re.sub(r'[^\n]', ' ', text)


def strip(sql: str) -> str:
    # Keep line numbers by replacing skipped text with the same newlines.
    blank = lambda m: blank_text(m.group(0))
    sql = strip_function_bodies(sql)
    sql = re.sub(r'--[^\n]*', blank, sql)
    sql = re.sub(r'/\*.*?\*/', blank, sql, flags=re.S)
    sql = re.sub(r"'(?:[^']|'')*'", blank, sql)
    return sql


def strip_function_bodies(sql: str) -> str:
    """Blanks the $$ bodies of create function and create procedure only."""
    out = []
    last = 0
    for match in re.finditer(r'\$(\w*)\$.*?\$\1\$', sql, flags=re.S):
        before = sql[last:match.start()]
        statement = before.rsplit(';', 1)[-1]
        out.append(before)
        if FUNCTION_HEADER.search(statement):
            out.append(blank_text(match.group(0)))
        else:
            # A do block (or similar) runs now: keep its contents, drop the quotes.
            tag = len(match.group(1)) + 2
            out.append(' ' * tag + match.group(0)[tag:-tag] + ' ' * tag)
        last = match.end()
    out.append(sql[last:])
    return ''.join(out)


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
