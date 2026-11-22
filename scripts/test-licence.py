#!/usr/bin/env python3
"""Checks the repository stays "all rights reserved" (Matt, 22 November 2026).

The repository is public so its source can be read for reference only. LICENSE
must keep the PIVT Media Pty Ltd copyright line and say no right to use, copy,
modify or distribute is granted, and package.json (and its lockfile entry) must
say UNLICENSED with private true, so npm never publishes the app or reads it as
open source."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
failures = []


def check(ok, message):
    print(('PASS ' if ok else 'FAIL ') + message)
    if not ok:
        failures.append(message)


licence = (ROOT / 'LICENSE').read_text()
check('Copyright (c) 2026 PIVT Media Pty Ltd. All rights reserved.' in licence,
      'LICENSE has the PIVT Media Pty Ltd copyright line')
check('for reference only' in licence, 'LICENSE says the source is for reference only')
flat = ' '.join(licence.split())
check('No right or licence is granted to use, copy, modify, merge, publish, distribute' in flat,
      'LICENSE grants no right to use, copy, modify or distribute')
check('Permission is hereby granted' not in licence and 'MIT License' not in licence,
      'LICENSE is not an open source licence')

package = json.loads((ROOT / 'package.json').read_text())
check(package.get('license') == 'UNLICENSED', 'package.json license is UNLICENSED')
check(package.get('private') is True, 'package.json is private')

lock = json.loads((ROOT / 'package-lock.json').read_text())
check(lock['packages'][''].get('license') == 'UNLICENSED',
      'package-lock.json root entry license is UNLICENSED')

if failures:
    sys.exit(f'{len(failures)} licence check(s) failed')
print('All licence checks passed')
