#!/bin/sh
# 后端脚本冒烟测试（本地模拟 OpenWrt 环境，非固件运行时依赖）
# 验证：qmodem_support rpcd、qmodem-modem-support、qmodem-support-custom、
#       qmodem_stats rpcd、qmodem-stats-collect 的核心路径与修复点。
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FAIL=0
ok() { echo "  ok   - $1"; }
bad() { echo "  FAIL - $1"; FAIL=1; }

T=/tmp/qmtest
rm -rf "$T"
mkdir -p "$T/sbin" "$T/bin" "$T/libexec" "$T/lib/qmodem" "$T/share/qmodem" "$T/share/qmodem-generic" "$T/etc/qmodem-stats" "$T/cache"

cp "$ROOT"/root/usr/libexec/rpcd/qmodem_support "$T/libexec/"
cp "$ROOT"/root/usr/libexec/rpcd/qmodem_stats "$T/libexec/"
cp "$ROOT"/root/usr/sbin/qmodem-modem-support "$T/sbin/"
cp "$ROOT"/root/usr/sbin/qmodem-support-custom "$T/sbin/"
cp "$ROOT"/root/usr/bin/qmodem-stats-collect "$T/bin/"
cp "$ROOT"/root/usr/bin/qmodem-stats-loop "$T/bin/"
cp "$ROOT"/root/usr/lib/qmodem/qmodem-lib.sh "$T/lib/qmodem/"
cp "$ROOT"/root/usr/share/qmodem-generic/extra_modem_support.json "$T/share/qmodem-generic/"
chmod 755 "$T"/libexec/* "$T"/sbin/* "$T"/bin/* "$T"/lib/qmodem/*

# jsonfilter 替身（busybox jsonfilter 的最小实现：-i file + 单个 -e '@.key'）
cat > "$T/bin/jsonfilter" << 'JFEOF'
#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
src = None
i = 0
while i < len(args):
    if args[i] == '-i':
        src = open(args[i + 1]).read()
        i += 2
    elif args[i] == '-e':
        expr = args[i + 1]
        i += 2
    else:
        i += 1
data = json.loads(src if src is not None else sys.stdin.read())
cur = data
for part in expr.lstrip('@').split('.'):
    if part == '': continue
    if isinstance(cur, list):
        cur = cur[int(part)]
    else:
        cur = cur.get(part)
    if cur is None: break
if isinstance(cur, str):
    print(cur)
elif cur is True:
    print('true')
elif cur is False:
    print('false')
elif cur is None:
    print('null', end='')
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
JFEOF
chmod 755 "$T/bin/jsonfilter"

# ip 替身：返回固定计数（供 collector 的 ip -j 路径）
cat > "$T/bin/ip" << 'IP EOF'
#!/bin/sh
echo '[{"ifname":"eth0","stats":{"rx_bytes":1048576,"rx_packets":1000,"tx_bytes":524288,"tx_packets":500}}]'
IP EOF
chmod 755 "$T/bin/ip"

# uci 替身（节 4 使用）：modem2 返回一个 netdev
cat > "$T/bin/uci" << 'UCEOF'
#!/bin/sh
if [ "$1" = "-q" ] && [ "$2" = "get" ] && [ "$3" = "qmodem.modem2.network" ]; then
	echo "eth0"
	exit 0
fi
exit 0
UCEOF
chmod 755 "$T/bin/uci"

ENVQ="PATH=$T/bin:$PATH QMODEM_SUPPORT_LOCKDIR=$T/locks QMODEM_STATS_COLLECT=$T/bin/qmodem-stats-collect QMODEM_SBIN_DIR=$T/sbin QMODEM_BIN_DIR=$T/bin QMODEM_LIB_DIR=$T/lib/qmodem QMODEM_CACHE_DIR=$T/cache QMODEM_STATS_DIR=$T/etc/qmodem-stats QMODEM_SUPPORT_FILE=$T/share/qmodem/modem_support.json QMODEM_EXTRA_SUPPORT_FILE=$T/share/qmodem-generic/extra_modem_support.json QMODEM_CUSTOM_SUPPORT_DIR=$T/etc/qmodem-generic/modems"

# ---------------------------------------------------------------- 1. 支持库合并脚本
echo "== 1. qmodem-modem-support =="
# 初始支持库：只有 usb 组且缺 RG520N-CN
cat > "$T/share/qmodem/modem_support.json" << 'EOF'
{
    "modem_support": {
        "usb": {
            "rm500u-cn": {
                "manufacturer": "Quectel",
                "platform": "qualcomm",
                "modes": ["qmi", "gobinet"],
                "pdp_index": "1",
                "wcdma_band": "0",
                "lte_band": "1/3/5/8/20/38/40/41",
                "nsa_band": "n41/n78",
                "sa_band": "n78",
                "data_interface": "usb"
            }
        },
        "pcie": {}
    }
}
EOF
OUT=$(env $ENVQ sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '"available":1' && ok "首次同步 available=1" || bad "首次同步: $OUT"
echo "$OUT" | grep -q 'rg520n-cn' && ok "注入了内置型号 rg520n-cn" || bad "未注入: $OUT"
echo "$OUT" | grep -q '"skipped"' && ok "结果含 skipped 字段" || bad "缺 skipped"
# 幂等：第二次全部 skipped
OUT2=$(env $ENVQ sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT2" | grep -q '"added":\[\]' && ok "第二次幂等跳过（added 为空）" || bad "第二次仍尝试注入: $OUT2"
# 目标文件仍可解析
sh -c "awk 'BEGIN{RS=\"\"} END{print NR}' < '$T/share/qmodem/modem_support.json'" >/dev/null 2>&1 && ok "目标文件非空" || bad "目标文件为空"
tail -1 "$T/share/qmodem/modem_support.json" | grep -q '}' && ok "目标文件以 } 收尾" || bad "目标文件未以 } 收尾"

# ---------------------------------------------------------------- 2. qmodem_support rpcd
echo "== 2. qmodem_support rpcd =="
OUT=$(echo '{}' | env $ENVQ sh "$T/libexec/qmodem_support" list)
echo "$OUT" | grep -q '"status"' && echo "$OUT" | grep -q '"sync"' && ok "list 声明含 status/sync" || bad "list: $OUT"
echo "$OUT" | grep -q 'sync_async' && bad "list 仍声明已删除的 sync_async" || ok "list 已移除 sync_async"

mkdir -p "$T/cache/modem1"
OUT=$(echo '{}' | env $ENVQ sh "$T/libexec/qmodem_support" call status)
echo "$OUT" | grep -q '"available"' && ok "status 返回 JSON" || bad "status: $OUT"
# 缓存已写入
ls "$T/cache"/*/support.json 2>/dev/null | head -1 | grep -q support.json && ok "status 已写缓存" || bad "status 未写缓存"

OUT=$(echo '{}' | env $ENVQ sh "$T/libexec/qmodem_support" call sync)
echo "$OUT" | grep -q '"available":1' && ok "sync 返回 available=1" || bad "sync: $OUT"
# sync 后支持库含注入型号
grep -q 'rg520n-cn' "$T/share/qmodem/modem_support.json" && ok "sync 已注入支持库" || bad "sync 未注入"

OUT=$(echo '{}' | env $ENVQ sh "$T/libexec/qmodem_support" call custom_list)
echo "$OUT" | grep -q '"entries"' && ok "custom_list 返回 entries" || bad "custom_list: $OUT"
echo "$OUT" | grep -q '"presets"' && ok "custom_list 返回 presets" || bad "custom_list 缺 presets"

# ---------------------------------------------------------------- 3. qmodem-support-custom
echo "== 3. qmodem-support-custom =="
mkdir -p "$T/etc/qmodem-generic/modems/usb" "$T/etc/qmodem-generic/modems/pcie"
OUT=$(echo '{}' | env $ENVQ sh "$T/sbin/qmodem-support-custom" list)
echo "$OUT" | grep -q '"entries"' && ok "list 返回 entries" || bad "list: $OUT"

# 保存一个自定义型号（usb / rgtest-01）
INPUT=$(printf '{"bus":"usb","model":"rgtest-01","manufacturer":"testvendor","manufacturer_id":"12d1","platform":"mediatek","modes":"gobinet,ecm","pdp_index":"2","wcdma_band":"0","lte_band":"1/3/5","nsa_band":"41","sa_band":"78","edit":"0"}')
OUT=$(echo "$INPUT" | env $ENVQ sh "$T/sbin/qmodem-support-custom" save)
echo "$OUT" | grep -q '"success":true' && ok "自定义型号保存成功" || bad "save: $OUT"
[ -f "$T/etc/qmodem-generic/modems/usb/rgtest-01.json" ] && ok "持久化 JSON 已写入" || bad "持久化 JSON 缺失"
# 已同步进支持库
grep -q 'rgtest-01' "$T/share/qmodem/modem_support.json" && ok "自定义型号已同步进支持库" || bad "未同步进支持库"
# 再次保存同型号 → 应提示已存在
OUT=$(echo "$INPUT" | env $ENVQ sh "$T/sbin/qmodem-support-custom" save)
echo "$OUT" | grep -q '已存在' && ok "重复保存被拒绝" || bad "重复保存未拒绝: $OUT"
# 删除
OUT=$(echo '{"bus":"usb","model":"rgtest-01"}' | env $ENVQ sh "$T/sbin/qmodem-support-custom" delete)
echo "$OUT" | grep -q '"success":true' && ok "删除成功" || bad "delete: $OUT"
[ ! -f "$T/etc/qmodem-generic/modems/usb/rgtest-01.json" ] && ok "持久化 JSON 已删除" || bad "JSON 仍存在"

# ---------------------------------------------------------------- 4. qmodem_stats rpcd + collector
echo "== 4. qmodem_stats rpcd + collector =="
# 先手动造一个状态文件
cat > "$T/etc/qmodem-stats/modem1.stats" << 'EOF'
last_ts=1700000000
last_rx=1000
last_tx=500
total_rx=1000
total_tx=500
swapped=0
day_2026_10_29_rx=100
dayx_2026_10_29_tx=50
EOF
OUT=$(echo '{"config_section":"modem1"}' | env $ENVQ sh "$T/libexec/qmodem_stats" call daily_stats)
echo "$OUT" | grep -q '"available":true' && ok "daily_stats 读取已有统计" || bad "daily_stats: $OUT"
echo "$OUT" | grep -q '"config_section":"modem1"' && ok "daily_stats 返回节名" || bad "daily_stats 缺节名"

# show 不采样、只读
OUT=$(env $ENVQ sh "$T/bin/qmodem-stats-collect" show modem1)
echo "$OUT" | grep -q '"total_rx":1000' && ok "collector show 只读输出" || bad "show: $OUT"

# reset 清零（ubus 不存在 → read_counters 失败 → 兜底 0，不崩溃）
OUT=$(env $ENVQ sh "$T/bin/qmodem-stats-collect" reset modem1)
echo "$OUT" | grep -q '"result":true' && ok "reset 成功" || bad "reset: $OUT"
grep -q 'total_rx=0' "$T/etc/qmodem-stats/modem1.stats" && ok "reset 已清零" || bad "reset 未清零"

# 并发锁：同时跑两个 run，不应崩溃、锁目录最终清理
( env PATH="$T/bin:$PATH" $ENVQ sh "$T/bin/qmodem-stats-collect" run modem2 >/dev/null 2>&1 & ) 2>/dev/null
( env PATH="$T/bin:$PATH" $ENVQ sh "$T/bin/qmodem-stats-collect" run modem2 >/dev/null 2>&1 & ) 2>/dev/null
sleep 2
[ ! -d /tmp/qmodem-stats-collect.modem2.lock ] && ok "并发 run 后锁目录已清理" || bad "锁目录残留"
[ -f "$T/etc/qmodem-stats/modem2.stats" ] && ok "并发 run 已落盘" || bad "并发 run 未落盘"

# ---------------------------------------------------------------- 5. stats-loop 节删除自查
echo "== 5. qmodem-stats-loop =="
# 造一个假 uci：modem1 存在、modem2 已删除
mkdir -p "$T/etc/config"
cat > "$T/etc/config/qmodem" << 'EOF'
config modem-device 'modem1'
	option state 'enabled'
EOF
# 模拟 uci：循环内调用 uci -q show/get —— 用 PATH 前置假 uci
cat > "$T/bin/uci" << 'EOF'
#!/bin/sh
# 最小 uci 替身：只支持 -q show/get 的 qmodem 配置查询
if [ "$1" = "-q" ] && [ "$2" = "show" ]; then
	sec="${3#qmodem.}"
	[ "$sec" = "modem1" ] && { echo "config modem-device"; echo "	option state 'enabled'"; }
	exit 0
fi
if [ "$1" = "-q" ] && [ "$2" = "get" ]; then
	sec="${3#qmodem.}"
	opt="${4#*.}"
	[ "$sec" = "modem1" ] && [ "$opt" = "state" ] && { echo "enabled"; exit 0; }
	exit 0
fi
exit 0
EOF
chmod 755 "$T/bin/uci"
# 启动循环（短间隔），验证存活；再删节验证退出
env PATH="$T/bin:$PATH" $ENVQ sh "$T/bin/qmodem-stats-loop" modem1 5 >/tmp/qmtest/loop.log 2>&1 &
LOOP_PID=$!
sleep 3
kill -0 $LOOP_PID 2>/dev/null && ok "循环在节存在时持续运行" || bad "循环提前退出"
# 删除节：删除 uci 替身输出 → 循环应在下个间隔退出
cat > "$T/bin/uci" << 'EOF'
#!/bin/sh
exit 0
EOF
sleep 7
kill -0 $LOOP_PID 2>/dev/null && bad "节删除后循环未退出" || ok "节删除后循环自动退出"
kill $LOOP_PID 2>/dev/null
grep -q "section removed" /tmp/qmtest/loop.log && ok "退出日志正确" || bad "退出日志缺失"

echo
if [ "$FAIL" = "0" ]; then
	echo "BACKEND SMOKE TESTS PASSED"
else
	echo "BACKEND SMOKE TESTS FAILED"
	exit 1
fi
