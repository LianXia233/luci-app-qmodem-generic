#!/usr/bin/env python3
"""Minimal `jsonfilter` stand-in for off-device testing.

Only the subset of expressions used by the QModem backend scripts is
implemented; it is deliberately strict about output formatting so that the
shell code under test sees exactly what the real jsonfilter on OpenWrt
would produce:

  * strings  -> printed raw, without quotes
  * numbers  -> printed as-is
  * bools    -> true / false
  * null     -> nothing
  * objects  -> compact JSON on one line
  * arrays   -> only with -a, one element per line

Supported expressions:
  @                       whole document
  @.a.b.c                 nested key lookup
  @.arr[*]                every element of an array
  @.obj.*.key             wildcard over object values
  @[@.k="v"].key          array filter by equality predicate
"""

import json
import sys


def fail():
    sys.exit(1)


def parse_expr(expr):
    """Return a list of steps; each step is ('key', name) / ('index_all',) /
    ('wild',) / ('filter', key, value) / ('key_after_filter', name)."""
    if not expr.startswith('@'):
        fail()
    rest = expr[1:]
    steps = []
    i = 0
    n = len(rest)
    while i < n:
        ch = rest[i]
        if ch == '.':
            i += 1
            j = i
            while j < n and rest[j] not in '.[':
                j += 1
            name = rest[i:j]
            if name == '*':
                steps.append(('wild',))
            else:
                steps.append(('key', name))
            i = j
        elif ch == '[':
            j = rest.find(']', i)
            if j < 0:
                fail()
            inner = rest[i + 1:j]
            if inner == '*':
                steps.append(('index_all',))
            elif inner.isdigit():
                steps.append(('index', int(inner)))
            elif inner.startswith('@.'):
                # [@.key="value"]
                body = inner[2:]
                if '=' not in body:
                    fail()
                k, v = body.split('=', 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                    v = v[1:-1]
                steps.append(('filter', k, v))
            else:
                fail()
            i = j + 1
        else:
            fail()
    return steps


def evaluate(doc, steps):
    cur = [doc]
    for step in steps:
        nxt = []
        kind = step[0]
        for node in cur:
            if kind == 'key':
                if isinstance(node, dict) and step[1] in node:
                    nxt.append(node[step[1]])
            elif kind == 'index_all':
                if isinstance(node, list):
                    nxt.extend(node)
            elif kind == 'index':
                if isinstance(node, list) and 0 <= step[1] < len(node):
                    nxt.append(node[step[1]])
            elif kind == 'wild':
                if isinstance(node, dict):
                    nxt.extend(node.values())
                elif isinstance(node, list):
                    nxt.extend(node)
            elif kind == 'filter':
                if isinstance(node, list):
                    for item in node:
                        if isinstance(item, dict) and str(item.get(step[1], '')) == step[2]:
                            nxt.append(item)
        cur = nxt
        if not cur:
            break
    return cur


def render(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return json.dumps(value)
    return json.dumps(value, separators=(',', ':'))


def main():
    argv = sys.argv[1:]
    source = None
    exprs = []
    allow_array = False
    limit = 0
    prefix = None

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '-s':
            i += 1
            source = argv[i]
        elif a == '-i':
            i += 1
            try:
                with open(argv[i], 'r', encoding='utf-8') as fh:
                    source = fh.read()
            except OSError:
                fail()
        elif a == '-e':
            i += 1
            exprs.append(argv[i])
        elif a == '-a':
            allow_array = True
        elif a == '-l':
            i += 1
            limit = int(argv[i])
        elif a == '-p':
            i += 1
            prefix = argv[i]
        i += 1

    if source is None:
        source = sys.stdin.read()

    try:
        doc = json.loads(source)
    except ValueError:
        fail()

    out = []
    for expr in exprs:
        for value in evaluate(doc, parse_expr(expr)):
            if isinstance(value, list):
                if not allow_array:
                    continue
                for item in value:
                    text = render(item)
                    if text is not None:
                        out.append(text)
            else:
                text = render(value)
                if text is not None:
                    out.append(text)

    if limit:
        out = out[:limit]

    for line in out:
        if prefix:
            sys.stdout.write('%s%s\n' % (prefix, line))
        else:
            sys.stdout.write('%s\n' % line)

    if not out:
        sys.exit(1)


if __name__ == '__main__':
    main()
