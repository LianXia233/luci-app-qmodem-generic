#!/usr/bin/env python3
"""
po/zh_Hans/qmodem-generic.po 的格式校验（msgfmt 的最小替代）

msgfmt 在精简的构建/CI 环境里常常不存在，本脚本用纯 Python 做等价校验：
  * 头部 msgid "" 必须存在且带 Content-Type / Language
  * 所有条目成对出现 msgid / msgstr，且都在同一行块内
  * 字符串字面量必须正确转义（不允许裸露的未转义双引号）
  * msgid 不允许重复
  * 占位符（%s / %d）在 msgid 与 msgstr 中数量一致
  * 文件必须是合法 UTF-8

退出码 0 = 通过，1 = 有问题。
"""
import re
import sys

PLACEHOLDER = re.compile(r'%(?:\d+\$)?[-+ #0]*[\d*]*(?:\.[\d*]+)?[sdifuxXoeEgGc%]')


def parse(path):
    with open(path, 'rb') as fh:
        raw = fh.read()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError as err:
        return None, ['不是合法的 UTF-8: %s' % err]

    errors = []
    entries = []          # [(lineno, msgid, msgstr)]
    lineno = 0
    cur_id = None
    cur_str = None
    cur_id_line = 0
    field = None

    def unquote(literal, where):
        if not (literal.startswith('"') and literal.endswith('"')):
            errors.append('%s: 字符串字面量必须以双引号包裹: %s' % (where, literal))
            return ''
        body = literal[1:-1]
        out = []
        i = 0
        while i < len(body):
            ch = body[i]
            if ch == '\\':
                if i + 1 >= len(body):
                    errors.append('%s: 反斜杠出现在字符串末尾' % where)
                    return ''.join(out)
                nxt = body[i + 1]
                if nxt not in 'nrt"\\':
                    errors.append('%s: 非法转义序列 \\%s' % (where, nxt))
                out.append({'n': '\n', 'r': '\r', 't': '\t',
                            '"': '"', '\\': '\\'}.get(nxt, nxt))
                i += 2
                continue
            if ch == '"':
                errors.append('%s: 未转义的双引号' % where)
                return ''.join(out)
            out.append(ch)
            i += 1
        return ''.join(out)

    for line in text.split('\n'):
        lineno += 1
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        where = '%s:%d' % (path, lineno)

        m = re.match(r'^(msgid|msgstr)\s+(.*)$', stripped)
        if m:
            field = m.group(1)
            value = unquote(m.group(2), where)
            if field == 'msgid':
                if cur_id is not None:
                    entries.append((cur_id_line, cur_id, cur_str if cur_str is not None else ''))
                cur_id, cur_str, cur_id_line = value, None, lineno
            else:
                if cur_id is None:
                    errors.append('%s: msgstr 出现在任何 msgid 之前' % where)
                cur_str = value
            continue

        if stripped.startswith('"'):
            if field is None:
                errors.append('%s: 续行出现在 msgid/msgstr 之前' % where)
                continue
            value = unquote(stripped, where)
            if field == 'msgid':
                cur_id = (cur_id or '') + value
            else:
                cur_str = (cur_str or '') + value
            continue

        errors.append('%s: 无法解析的行: %s' % (where, stripped))

    if cur_id is not None:
        entries.append((cur_id_line, cur_id, cur_str if cur_str is not None else ''))

    return entries, errors


def main(paths):
    total_errors = 0
    for path in paths:
        entries, errors = parse(path)
        if entries is None:
            print('FAIL %s' % path)
            for e in errors:
                print('  ' + e)
            total_errors += len(errors)
            continue

        seen = {}
        header_ok = False
        for lineno, msgid, msgstr in entries:
            where = '%s:%d' % (path, lineno)
            if msgid == '':
                if 'Content-Type' not in msgstr or 'Language' not in msgstr:
                    errors.append('%s: 头部缺少 Content-Type 或 Language' % where)
                header_ok = True
                continue
            if msgid in seen:
                errors.append('%s: msgid 重复（首次出现在第 %d 行）: %s'
                              % (where, seen[msgid], msgid))
            seen[msgid] = lineno
            if msgstr == '':
                errors.append('%s: msgstr 为空（未翻译）: %s' % (where, msgid))
            a = PLACEHOLDER.findall(msgid)
            b = PLACEHOLDER.findall(msgstr)
            if sorted(a) != sorted(b):
                errors.append('%s: 占位符不一致 %s != %s: %s'
                              % (where, sorted(a), sorted(b), msgid))

        if not header_ok:
            errors.append('%s: 缺少头部条目 msgid ""' % path)

        status = 'OK  ' if not errors else 'FAIL'
        print('%s %s  (%d 条翻译)' % (status, path, len([e for e in entries if e[1]])))
        for e in errors:
            print('  ' + e)
        total_errors += len(errors)

    return 1 if total_errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
