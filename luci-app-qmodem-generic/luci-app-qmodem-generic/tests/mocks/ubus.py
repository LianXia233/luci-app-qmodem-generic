#!/usr/bin/env python3
"""Mock `ubus` for off-device testing of the QModem backend.

Behaviour is driven by $MOCK_UBUS_STATE (a JSON file):

  { "mode": "ok" | "dead" | "slow", "delay": <seconds>, "calls": {} }

  ok    -> answer immediately with canned modem data
  slow  -> sleep `delay` seconds first, then answer
  dead  -> sleep `delay` seconds and answer nothing (simulates a modem that
           never replies); `ubus -t N` honours the timeout and exits 6, just
           like the real client does.

Every invocation appends one line to $MOCK_UBUS_LOG so tests can assert on
call counts / concurrency.
"""

import json
import os
import sys
import time

STATE = os.environ.get('MOCK_UBUS_STATE')
LOG = os.environ.get('MOCK_UBUS_LOG')
SECTION = os.environ.get('MOCK_SECTION', 'modem0')


def load_state():
    if STATE and os.path.exists(STATE):
        try:
            with open(STATE, 'r', encoding='utf-8') as fh:
                return json.load(fh)
        except ValueError:
            pass
    return {'mode': 'ok', 'delay': 0}


def log(line):
    if not LOG:
        return
    with open(LOG, 'a', encoding='utf-8') as fh:
        fh.write('%f %s\n' % (time.time(), line))


def entries(pairs, cls):
    return {'modem_info': [
        {'key': k, 'value': v, 'full_name': k, 'type': 'string', 'class': cls}
        for k, v in pairs
    ]}


CANNED = {
    ('qmodem', 'base_info'): lambda: entries([
        ('Name', 'MOCK-5G'), ('Manufacturer', 'MockTel'), ('Revision', '1.0'),
        ('AT Port', '/dev/ttyMOCK0'), ('Connect Status', 'Yes'),
        ('Temperature', '42°C'), ('Network Mode', 'NR5G'),
    ], 'Basic Info'),
    ('qmodem', 'network_info'): lambda: entries([
        ('MCC', '460'), ('MNC', '00'), ('Network Type', 'NR5G'),
        ('Registration Status', 'Registered'), ('PLMN', '46000'),
    ], 'Network'),
    ('qmodem', 'cell_info'): lambda: entries([
        ('Cell ID', '12345'), ('PCI', '66'), ('TAC', '9001'),
        ('NR-ARFCN', '627264'), ('RSRP', '-83'), ('RSRQ', '-11'), ('SINR', '18'),
    ], 'Cell'),
    ('qmodem', 'sim_info'): lambda: entries([
        ('SIM Status', 'Ready'), ('ICCID', '89860000000000000000'),
        ('IMSI', '460000000000000'), ('SIM Slot', '1'),
    ], 'SIM'),
    ('qmodem', 'info'): lambda: entries([('IMEI', '860000000000001')], 'Device'),
    ('qmodem', 'get_connect_status'): lambda: {'connect_status': 'Yes'},
    ('qmodem', 'dial_status'): lambda: {'dial_status': 'connected', 'uptime': 1234},
    ('qmodem', 'get_dns'): lambda: {'dns': '223.5.5.5 114.114.114.114'},
    ('qmodem', 'get_mode'): lambda: {'mode': 'nr5g', 'modes': ['lte', 'nr5g']},
    ('qmodem', 'get_network_prefer'): lambda: {'prefer': 'auto'},
    ('qmodem', 'get_lockband'): lambda: {'lock_band': [], 'available_band': ['1', '3']},
    ('qmodem', 'get_neighborcell'): lambda: {'cells': []},
    ('qmodem', 'get_current_band'): lambda: {'cells': [{'band': 'n41', 'pci': 66}]},
    ('qmodem', 'get_current_band_capabilities'): lambda: {'bands': ['n41', 'n78']},
    ('qmodem', 'get_disabled_features'): lambda: {'disabled_features': []},
    ('qmodem', 'get_at_cfg'): lambda: {'at_cfg': {'at_port': '/dev/ttyMOCK0',
                                                  'ports': ['/dev/ttyMOCK0']}},
    ('qmodem', 'get_imei'): lambda: {'imei': '860000000000001'},
    ('qmodem', 'get_sim_slot'): lambda: {'slot': '1'},
    ('qmodem', 'get_sim_switch_capabilities'): lambda: {'support': True},
    ('qmodem', 'get_reboot_caps'): lambda: {'soft_reboot_caps': '1', 'hard_reboot_caps': '0'},
    ('qmodem', 'get_copyright'): lambda: {'copyright': 'Mock'},
    ('qmodem', 'get_stats'): lambda: {'available': True, 'total_rx_bytes': 1000000,
                                      'total_tx_bytes': 500000},
    ('qmodem', 'get_traffic_reset_schedule'): lambda: {'enabled': False},
    ('qmodem', 'get_sms'): lambda: {'sms': []},
    # send_at 需要在 reply() 里读取载荷中的实际 AT 命令，才能命中 send_at_response 分支，
    # 因此这里不占位，直接在 reply() 里特殊处理。
    ('qmodem', 'do_reboot'): lambda: {'result': 1},
}


# 模拟不同 AT 命令的真实响应，验证 qmodem-at-probe 对「QCI / 5QI 分离、
# 多 PDP 上下文、单位归一化(bps→kbps)」的解析。
# 这里故意构造：
#   CID 1 = ims       → QCI 5，无 AMBR
#   CID 2 = internet  → QCI 9，DL=102400kbps / UL=51200kbps（当前拨号数据 APN，
#                       配置 APN=internet，因此解析器应选中它而不是 CID 1）
#   5G 形态（C5GQOSRDP）→ 5QI 9，SAMBR 102400/51200 kbps
#   CGCONTRDP 的 AMBR 用 bps（5G 规范单位），DL=102400000 / UL=51200000 → 归一化 102400/51200
def send_at_response(at_cmd):
    c = at_cmd or ''
    if 'AT+C5GQOSRDP' in c:
        return {'result': 'OK\r\n+C5GQOSRDP: 2,9,0,0,0,0,102400,51200\r\n',
                'source': 'AT+C5GQOSRDP'}
    if 'AT+CGEQOSRDP' in c:
        # 定向查询某 CID：返回对应上下文
        if '=1' in c:
            return {'result': 'OK\r\n+CGEQOSRDP: 1,5,0,0,0,0,0,0\r\n',
                    'source': 'AT+CGEQOSRDP=1'}
        return {'result': 'OK\r\n+CGEQOSRDP: 2,9,0,0,0,0,102400,51200\r\n',
                'source': 'AT+CGEQOSRDP=2'}
    if 'AT+CGCONTRDP' in c:
        return {'result': 'OK\r\n'
                          '+CGCONTRDP: 1,1,"ims","10.20.30.40","255.255.255.255","0.0.0.0","0.0.0.0","0.0.0.0","0.0.0.0",0,0,0\r\n'
                          '+CGCONTRDP: 2,1,"internet","200.100.50.1","255.255.255.0","218.7.7.7","114.114.114.114","0.0.0.0","0.0.0.0",0,102400000,51200000\r\n',
                'source': 'AT+CGCONTRDP'}
    return {'result': 'OK\r\n'}


def reply(obj, method, payload):
    if obj == 'qmodem':
        if method == 'send_at':
            # payload 是 ubus 传给我们的原始 JSON 字符串，读取出实际 AT 命令，
            # 命中 send_at_response 对应分支
            at_cmd = ''
            obj_in = None
            try:
                obj_in = json.loads(payload) if isinstance(payload, str) else payload
                at_cmd = obj_in['params']['at']
            except (KeyError, TypeError, ValueError):
                try:
                    at_cmd = obj_in.get('at', '') if obj_in else ''
                except Exception:
                    at_cmd = ''
            return send_at_response(at_cmd)
        fn = CANNED.get((obj, method))
        return fn() if fn else {}
    if obj.startswith('network.interface.'):
        name = obj[len('network.interface.'):]
        if method == 'status':
            if name not in ('mockwan', 'mockwanv6'):
                return None
            return {'interface': name, 'up': True, 'l3_device': 'mock0',
                    'ipv4-address': [{'address': '10.0.0.2', 'mask': 24}],
                    'ipv6-address': [], 'dns-server': ['223.5.5.5'], 'uptime': 999}
        if method == 'dump':
            return [{'interface': 'mockwan', 'l3_device': 'mock0', 'up': True},
                    {'interface': 'mockwanv6', 'l3_device': 'mock0', 'up': True}]
    if obj == 'network.device' and method == 'status':
        return {'external': True, 'mtu': 1500, 'speed': 1000, 'link': True}
    return {}


def main():
    argv = sys.argv[1:]
    timeout = 0
    rest = []
    i = 0
    while i < len(argv):
        if argv[i] == '-t' and i + 1 < len(argv):
            try:
                timeout = float(argv[i + 1])
            except ValueError:
                timeout = 0
            i += 2
            continue
        rest.append(argv[i])
        i += 1

    if not rest:
        sys.stderr.write('usage: ubus [-t timeout] <command>\n')
        sys.exit(2)

    cmd = rest[0]

    if cmd == 'list':
        # used by qm_ubus_has_timeout() as a capability probe
        sys.stdout.write('qmodem\nnetwork.device\n')
        sys.exit(0)

    if cmd != 'call':
        sys.stderr.write('unsupported command: %s\n' % cmd)
        sys.exit(2)

    obj = rest[1] if len(rest) > 1 else ''
    method = rest[2] if len(rest) > 2 else ''
    payload = rest[3] if len(rest) > 3 else '{}'

    state = load_state()
    mode = state.get('mode', 'ok')
    delay = float(state.get('delay', 0) or 0)

    log('%s %s %s timeout=%s mode=%s' % (obj, method, payload, timeout, mode))

    if mode == 'dead':
        # Never answer. Honour -t exactly like the real client.
        if timeout > 0:
            time.sleep(min(delay, timeout))
            sys.exit(6)
        time.sleep(delay)
        sys.exit(6)

    if delay:
        if timeout and delay > timeout:
            time.sleep(timeout)
            sys.exit(6)
        time.sleep(delay)

    data = reply(obj, method, payload)
    if data is None:
        sys.exit(4)
    sys.stdout.write(json.dumps(data, separators=(',', ':')))
    sys.exit(0)


if __name__ == '__main__':
    main()
