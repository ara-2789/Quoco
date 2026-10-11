#!/usr/bin/env python3
"""Expand fixture-ID tokens in a scenario file to full UUID literals (so the transcript shows what ran).
Tokens: {T1} tenant, {P1} project, {U.PM1} users.id, {A.PM1} users.auth_id, {D1} document, {V1} delivery, {L1} link.
usage: expand.py <in.sql> <out.sql>
"""
import re, sys

USERS = {'PM1': 1, 'ENG1': 2, 'QS1': 3, 'DPM': 4, 'ADMN': 5, 'ADMP': 6, 'PM2': 7, 'PEND': 8, 'PM3': 9}

def uuid(prefix: int, n: int) -> str:
    return f'{prefix}0000000-0000-0000-0000-{n:012d}'

def sub(m):
    kind, arg = m.group(1), m.group(2)
    if kind == 'T': return uuid(1, int(arg))
    if kind == 'P': return uuid(2, int(arg))
    if kind == 'U.': return uuid(3, USERS[arg])
    if kind == 'A.': return uuid(4, USERS[arg])
    if kind == 'D': return uuid(5, int(arg))
    if kind == 'V': return uuid(6, int(arg))
    if kind == 'L': return uuid(7, int(arg))
    raise SystemExit(f'bad token {m.group(0)}')

text = open(sys.argv[1]).read()
out = re.sub(r'\{(T|P|U\.|A\.|D|V|L)([A-Za-z0-9]+)\}', sub, text)
if re.search(r'\{[TPUADVL]\.?[A-Za-z0-9]+\}', out):
    raise SystemExit('unexpanded token left')
open(sys.argv[2], 'w').write(out)
