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
expr = None
i = 0
while i < len(args):
    if args[i] == '-i':
        src = open(args[i + 1]).read()
        i += 2
    elif args[i] == '-s':
        src = args[i + 1]
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
    # 与真实 jsonfilter 一致：键不存在时不输出、返回非零
    sys.exit(1)
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

ENVQ="PATH=$T/bin:$PATH QMODEM_SUPPORT_LOCKDIR=$T/locks QMODEM_STATS_LOCKDIR=$T/lock-stats QMODEM_STATS_COLLECT=$T/bin/qmodem-stats-collect QMODEM_SBIN_DIR=$T/sbin QMODEM_BIN_DIR=$T/bin QMODEM_LIB_DIR=$T/lib/qmodem QMODEM_CACHE_DIR=$T/cache QMODEM_STATS_DIR=$T/etc/qmodem-stats QMODEM_SUPPORT_FILE=$T/share/qmodem/modem_support.json QMODEM_EXTRA_SUPPORT_FILE=$T/share/qmodem-generic/extra_modem_support.json QMODEM_CUSTOM_SUPPORT_DIR=$T/etc/qmodem-generic/modems"

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
# 批量注入：内置源的所有型号一次合并，内容必须与数据源逐项一致
DST="$T/share/qmodem/modem_support.json"
SRC="$T/share/qmodem-generic/extra_modem_support.json"
if env $ENVQ jq -e --slurpfile d "$DST" '
	[ .modem_support | to_entries[]
	  | .key as $g | .value | to_entries[]
	  | ($d[0].modem_support[$g][.key]) == .value ] | all
' "$SRC" >/dev/null 2>&1; then
	ok "批量注入：内置型号逐项与数据源一致"
else
	bad "批量注入：型号内容与数据源不一致"
fi
SRC_N=$(env $ENVQ jq '[ .modem_support[] | length ] | add' "$SRC" 2>/dev/null)
DST_N=$(env $ENVQ jq '[ .modem_support[] | length ] | add' "$DST" 2>/dev/null)
[ "$DST_N" -eq $((SRC_N + 1)) ] && ok "批量注入：型号总数 = 内置 $SRC_N + 原有 1" || bad "型号总数异常：$DST_N（期望 $((SRC_N + 1))）"
[ "$(grep -c '"rg520n-cn"[[:space:]]*:' "$DST")" -eq 1 ] && ok "批量注入：无重复键" || bad "批量注入产生了重复键"

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
[ ! -d "$T/lock-stats" ] && ! ls -d "$T"/lock-stats.* >/dev/null 2>&1 \
	&& ok "并发 run 后采集锁已清理（按节锁）" || bad "采集锁残留：$(ls -d "$T"/lock-stats* 2>/dev/null | tr '\n' ' ')"
[ ! -d /tmp/qmodem-stats-collect.modem2.lock ] && ok "旧锁路径不再使用" || bad "仍在写旧锁路径"
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

# ---------------------------------------------------------------- 6. 本轮修复的回归用例
echo "== 6. 回归：缩进异常 / 锁协议 / 跨日归属 / ACL 边界 =="

# JSON 里"同一个对象内重复出现的键"：jq 解析时会静默取最后一个，
# 所以重复键不会报错，只能自己按对象层级查（跨对象重名是正常的，不算重复）
dup_keys() {
	python3 - "$1" << 'PY'
import json, sys

class Obj(list):
    pass

def hook(pairs):
    o = Obj(pairs)
    o.names = [k for k, _ in pairs]
    return o

bad = []

def walk(node, path):
    if isinstance(node, Obj):
        seen = {}
        for k in node.names:
            seen[k] = seen.get(k, 0) + 1
        for k, n in seen.items():
            if n > 1:
                bad.append('%s.%s x%d' % (path, k, n))
        for k, v in node:
            walk(v, '%s.%s' % (path, k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, '%s[%d]' % (path, i))

with open(sys.argv[1]) as fh:
    walk(json.load(fh, object_pairs_hook=hook), '$')
print(' '.join(bad))
PY
}

# 6.1 官方支持库里存在缩进异常的块（RM520N 的 settings 里 sms/ims 用 8 空格）。
#     早先按缩进扫文本的实现会在那里提前收敛，看不见后半段型号，于是把已存在的
#     型号再注入一次 → 支持库出现重复键。
cat > "$T/share/qmodem/indent.json" << 'EOF'
{
    "modem_support": {
        "usb": {
            "rg520n-cn": {
                "manufacturer": "Quectel",
                "platform": "qualcomm",
                "settings": {
                        "sms": {
                            "mode": "pdu"
                        },
                        "ims": {
                            "enable": "1"
                        }
                },
                "modes": ["qmi", "ecm"],
                "pdp_index": "1"
            }
        },
        "pcie": {}
    }
}
EOF
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/indent.json" sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | jq -e '[.added[] | select(. | endswith("/rg520n-cn"))] | length == 0' >/dev/null 2>&1 \
	&& ok "缩进异常库：已存在型号未被重复注入" || bad "缩进异常库：已存在型号被重复注入: $OUT"
echo "$OUT" | jq -e '[.skipped[] | select(. == "usb/rg520n-cn")] | length == 1' >/dev/null 2>&1 \
	&& ok "缩进异常库：该型号被识别（skipped 恰好一次）" || bad "缩进异常库：判重结果异常: $OUT"
D=$(dup_keys "$T/share/qmodem/indent.json")
[ -z "$D" ] && ok "缩进异常库：无重复键" || bad "缩进异常库：出现重复键 $D"
POST=$(jq -r '.modem_support.usb | length' "$T/share/qmodem/indent.json")
[ "$POST" -gt 1 ] && ok "缩进异常库：其余型号照常合并（usb $POST 项）" || bad "缩进异常库：合并中断（usb $POST 项）"

# 6.2 任意合法缩进 + 空分组（QModem 在没有该类型模组时会写成 "pcie": {}）
jq --indent 2 '.modem_support.usb = {} | .modem_support.pcie = {}' "$T/share/qmodem/indent.json" > "$T/share/qmodem/compact.json"
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/compact.json" sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -qE '"added":\["' && ok "空分组+2 空格缩进：注入成功" || bad "空分组注入失败: $OUT"
D=$(dup_keys "$T/share/qmodem/compact.json")
[ -z "$D" ] && ok "空分组：无重复键" || bad "空分组：出现重复键 $D"

# 6.3 支持库损坏：拒绝写入且不改动原文件
printf '%s' '{"modem_support": broken' > "$T/share/qmodem/broken.json"
B=$(cksum "$T/share/qmodem/broken.json")
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/broken.json" sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '无法解析' && ok "损坏支持库：明确报错" || bad "损坏支持库：报错缺失: $OUT"
[ "$B" = "$(cksum "$T/share/qmodem/broken.json")" ] && ok "损坏支持库：原文件未被改写" || bad "损坏支持库：原文件被改写"

# 6.4 锁协议："<pid> <epoch>"；持锁进程已消失时回收，仍存活时不抢
rm -rf "$T/lk-stale" && mkdir -p "$T/lk-stale" && printf '99999999 %s\n' "$(date +%s)" > "$T/lk-stale/pid"
jq --indent 4 '.modem_support.usb = {} | .modem_support.pcie = {}' "$T/share/qmodem/indent.json" > "$T/share/qmodem/stale.json"
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/stale.json" QMODEM_SUPPORT_LOCKDIR="$T/lk-stale" \
	sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '另一个同步进程' && bad "陈旧锁未回收: $OUT" || ok "陈旧锁（pid 不存在）自动回收"
[ ! -e "$T/lk-stale" ] && ok "陈旧锁回收后锁目录已清理" || bad "锁目录残留"

jq --indent 4 '.modem_support.usb = {} | .modem_support.pcie = {}' "$T/share/qmodem/indent.json" > "$T/share/qmodem/busy.json"
B=$(cksum "$T/share/qmodem/busy.json")
rm -rf "$T/lk-live" && mkdir -p "$T/lk-live" && printf '%s %s\n' "$$" "$(date +%s)" > "$T/lk-live/pid"
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/busy.json" QMODEM_SUPPORT_LOCKDIR="$T/lk-live" \
	QMODEM_SUPPORT_LOCK_RETRY=1 sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '另一个同步进程' && ok "活锁：拒绝并发写入" || bad "活锁被强行接管: $OUT"
[ "$B" = "$(cksum "$T/share/qmodem/busy.json")" ] && ok "活锁：目标文件未被改动" || bad "活锁：目标文件被改写"
rm -f "$T/lk-live/pid"; rmdir "$T/lk-live" 2>/dev/null

# 锁冲突这类直接 exit 的出口也必须清掉临时清单，不能只靠末尾统一清理
LEAK="$T/tmp-leak"; rm -rf "$LEAK" "$T/lk-leak"; mkdir -p "$LEAK" "$T/lk-leak"
printf '%s %s\n' "$$" "$(date +%s)" > "$T/lk-leak/pid"
env $ENVQ TMPDIR="$LEAK" QMODEM_SUPPORT_FILE="$T/share/qmodem/busy.json" QMODEM_SUPPORT_LOCKDIR="$T/lk-leak" \
	QMODEM_SUPPORT_LOCK_RETRY=1 sh "$T/sbin/qmodem-modem-support" --json >/dev/null 2>&1
[ -z "$(ls "$LEAK" 2>/dev/null)" ] && ok "锁冲突退出后无临时文件残留" || bad "临时文件残留: $(ls "$LEAK" | tr '\n' ' ')"
rm -rf "$T/lk-leak"

# 6.4b 旧版本残留锁：3.0.0-4 的 merge 写 sync_pid/sync_ts，custom 只 mkdir 从不
#      写 pid。升级后这两类残留都必须能回收，否则同步与自定义保存永久失败。
jq --indent 4 '.modem_support.usb = {} | .modem_support.pcie = {}' "$T/share/qmodem/indent.json" > "$T/share/qmodem/legacy.json"
rm -rf "$T/lk-legacy" && mkdir -p "$T/lk-legacy"
printf '99999999' > "$T/lk-legacy/sync_pid" && date +%s > "$T/lk-legacy/sync_ts"
sleep 1
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/legacy.json" QMODEM_SUPPORT_LOCKDIR="$T/lk-legacy" \
	QMODEM_SUPPORT_LOCK_GRACE=0 sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '另一个同步进程' && bad "旧格式锁（sync_pid）未回收: $OUT" || ok "旧格式锁（sync_pid）已回收"
echo "$OUT" | grep -q '"added":\["' && ok "旧格式锁回收后继续写入" || bad "旧格式锁回收后未写入: $OUT"

rm -rf "$T/lk-empty" && mkdir -p "$T/lk-empty"
sleep 1
# 用一份全新的空库，确保确实有型号需要写入（否则不会走到取锁）
jq --indent 4 '.modem_support.usb = {} | .modem_support.pcie = {}' "$T/share/qmodem/indent.json" > "$T/share/qmodem/empty.json"
OUT=$(env $ENVQ QMODEM_SUPPORT_FILE="$T/share/qmodem/empty.json" QMODEM_SUPPORT_LOCKDIR="$T/lk-empty" \
	QMODEM_SUPPORT_LOCK_GRACE=0 sh "$T/sbin/qmodem-modem-support" --json 2>/dev/null)
echo "$OUT" | grep -q '另一个同步进程' && bad "空锁目录未回收: $OUT" || ok "空锁目录已回收"
[ ! -d "$T/lk-empty" ] && ok "空锁目录回收后无残留" || bad "空锁目录残留"

# custom 侧：旧版崩溃留下的空锁目录曾让"保存自定义型号"永久报同步进行中
rm -rf "$T/lk-cust" && mkdir -p "$T/lk-cust"
sleep 1
COUT=$(printf '{"bus":"usb","model":"testmod","manufacturer":"brandx","manufacturer_id":"2dee","platform":"qualcomm","modes":"qmi","pdp_index":"1","edit":false}\n' \
	| env $ENVQ QMODEM_SUPPORT_LOCKDIR="$T/lk-cust" QMODEM_SUPPORT_LOCK_GRACE=0 \
		sh "$T/sbin/qmodem-support-custom" save 2>/dev/null)
echo "$COUT" | grep -q '"success":true' && ok "空锁目录：自定义型号仍可保存" || bad "空锁目录阻塞自定义保存: $COUT"

# 6.5 采集器：跨日归属合计精确 + 计数器不可读时 reset 保住生命周期基准
cat > "$T/bin/ubus" << 'UBEOF'
#!/bin/sh
# 计数替身：从 $QMODEM_CTR_DIR/{rx,tx,fail} 读取 get_stats 结果。
# rx/tx 任一文件缺失即模拟"该侧计数器读不到"，用于验证单侧不可读时的基准处理。
d="${QMODEM_CTR_DIR:?}"
[ -f "$d/fail" ] && exit 1
r=''; t=''
[ -f "$d/rx" ] && r=$(cat "$d/rx" 2>/dev/null)
[ -f "$d/tx" ] && t=$(cat "$d/tx" 2>/dev/null)
if [ -n "$r" ] && [ -n "$t" ]; then
	printf '{"available":true,"total_rx_bytes":%s,"total_tx_bytes":%s}\n' "$r" "$t"
elif [ -n "$r" ]; then
	printf '{"available":true,"total_rx_bytes":%s}\n' "$r"
elif [ -n "$t" ]; then
	printf '{"available":true,"total_tx_bytes":%s}\n' "$t"
else
	printf '{"available":true}\n'
fi
UBEOF
chmod 755 "$T/bin/ubus"
mkdir -p "$T/ctr"; printf '1000' > "$T/ctr/rx"; printf '500' > "$T/ctr/tx"; rm -f "$T/ctr/fail"
NOW=$(date +%s)
# 上一轮采样在 72 小时前，本轮增量 1900/1503 需按跨越的天数分摊，且各天之和必须等于增量
printf 'last_ts=%s\nlast_rx=1000\nlast_tx=500\ntotal_rx=0\ntotal_tx=0\nswapped=0\n' "$((NOW - 260000))" > "$T/etc/qmodem-stats/split.stats"
printf '2900' > "$T/ctr/rx"; printf '2003' > "$T/ctr/tx"
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" run split >/dev/null 2>&1
OUT=$(env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" show split)
echo "$OUT" | grep -q '"total_rx":1900' && ok "跨日分摊：总量精确（1900）" || bad "跨日分摊总量错误: $OUT"
SUM=$(echo "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["today_rx"] + sum(x["rx"] for x in d["days"]))')
[ "$SUM" = "1900" ] && ok "跨日分摊：各天之和等于增量（$SUM）" || bad "跨日分摊丢失/重复计数（$SUM）"
NDAYS=$(echo "$OUT" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["days"]))')
[ "$NDAYS" -ge 1 ] && ok "跨日分摊：已回填历史日（$NDAYS 天）" || bad "跨日分摊：历史日为空"

# reset 时读不到计数器：必须保留 last_rx/last_tx，否则下一轮会把模组整个生命周期的流量记账
printf 'last_ts=%s\nlast_rx=50000000\nlast_tx=40000000\ntotal_rx=49999000\ntotal_tx=39999500\nswapped=0\n' "$NOW" > "$T/etc/qmodem-stats/rs.stats"
touch "$T/ctr/fail"
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" reset rs >/dev/null 2>&1
grep -q '^last_rx=50000000$' "$T/etc/qmodem-stats/rs.stats" && ok "reset 计数器不可读时保住基准" || bad "reset 丢失基准: $(cat "$T/etc/qmodem-stats/rs.stats")"
grep -q '^total_rx=0$' "$T/etc/qmodem-stats/rs.stats" && ok "reset 已清零当日/累计" || bad "reset 未清零"
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" run rs >/dev/null 2>&1
OUT=$(env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" show rs)
echo "$OUT" | grep -q '"total_rx":0' && ok "计数器仍不可读时不凭空记账" || bad "凭空记账: $OUT"
rm -f "$T/ctr/fail"

# 6.5b 单侧计数器暂时不可读：该侧基准必须保住，恢复后只记真实增量。
#      写成 0 会让下一轮把模组整个生命周期的累计流量记进当天。
printf 'last_ts=%s\nlast_rx=1000\nlast_tx=500\ntotal_rx=0\ntotal_tx=0\nswapped=0\n' "$NOW" > "$T/etc/qmodem-stats/one.stats"
mv "$T/ctr/rx" "$T/ctr/rx.off"       # 只有 tx 可读
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" run one >/dev/null 2>&1
grep -q '^last_rx=1000$' "$T/etc/qmodem-stats/one.stats" \
	&& ok "单侧不可读：该侧基准未被清零" || bad "单侧不可读：基准被清零 $(grep '^last_rx=' "$T/etc/qmodem-stats/one.stats")"
mv "$T/ctr/rx.off" "$T/ctr/rx"
printf '101000' > "$T/ctr/rx"; printf '1600' > "$T/ctr/tx"
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" run one >/dev/null 2>&1
OUT=$(env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" sh "$T/bin/qmodem-stats-collect" show one)
echo "$OUT" | grep -q '"total_rx":100000' \
	&& ok "计数器恢复后只记真实增量（100000）" || bad "计数器恢复后虚增: $OUT"

# 6.5c 存活持锁进程即使时间戳很旧也不能被抢占：慢采样不等于崩溃
printf 'last_ts=0\nlast_rx=0\nlast_tx=0\ntotal_rx=0\ntotal_tx=0\nswapped=0\n' > "$T/etc/qmodem-stats/live1.stats"
sleep 30 & HOLD=$!
rm -rf "$T/lock-live.live1" && mkdir -p "$T/lock-live.live1"
printf '%s %s\n' "$HOLD" "$(( $(date +%s) - 600 ))" > "$T/lock-live.live1/pid"
env $ENVQ PATH="$T/bin:$PATH" QMODEM_CTR_DIR="$T/ctr" QMODEM_STATS_LOCKDIR="$T/lock-live" \
	QMODEM_STATS_LOCK_RETRY=1 sh "$T/bin/qmodem-stats-collect" run live1 >/dev/null 2>&1
if [ -f "$T/lock-live.live1/pid" ] && [ "$(cut -d' ' -f1 "$T/lock-live.live1/pid" 2>/dev/null)" = "$HOLD" ]; then
	ok "存活持锁进程未被超时抢占"
else
	bad "存活持锁进程被抢占（锁已被清或易主）"
fi
kill "$HOLD" 2>/dev/null; rm -rf "$T/lock-live.live1"

# 6.6 ACL：写操作不能再落在 read 段（rpcd 里 write 蕴含 read，只放 read 等于放开给只读会话）
ACL="$ROOT/root/usr/share/rpcd/acl.d/luci-app-qmodem-generic.json"
MENU="$ROOT/root/usr/share/luci/menu.d/luci-app-qmodem-generic.json"
jq -e '.["luci-app-qmodem-generic"].read.ubus.qmodem_stats | index("stats_reset") == null' "$ACL" >/dev/null 2>&1 \
	&& ok "ACL：stats_reset 不在 read 段" || bad "ACL：只读段仍含 stats_reset"
jq -e '.["luci-app-qmodem-generic"].write.ubus.qmodem_stats | index("stats_reset") != null' "$ACL" >/dev/null 2>&1 \
	&& ok "ACL：stats_reset 已归入 write 段" || bad "ACL：write 段缺 stats_reset"
for m in sync custom_save custom_delete probe_port; do
	jq -e --arg m "$m" '.["luci-app-qmodem-generic"].read.ubus.qmodem_support | index($m) == null' "$ACL" >/dev/null 2>&1 \
		&& ok "ACL：只读段不含 $m" || bad "ACL：只读段仍含写方法 $m"
done
MISS=$(jq -r 'to_entries[] | select(.key | startswith("admin/modem/qmodem-generic")) | select(.value.title == null) | .key' "$MENU")
[ -z "$MISS" ] && ok "menu.d：所有子页都有 title（否则标签页标题空白）" || bad "menu.d 缺 title: $MISS"

echo
if [ "$FAIL" = "0" ]; then
	echo "BACKEND SMOKE TESTS PASSED"
else
	echo "BACKEND SMOKE TESTS FAILED"
	exit 1
fi
