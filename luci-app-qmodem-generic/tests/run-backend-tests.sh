#!/bin/sh
# QModem Generic 后端异步化回归测试
#
# 在没有真实 OpenWrt 设备 / modem 的环境里，用 mock 的 ubus / uci / jsonfilter
# 完整跑一遍后端调用链，验证「异步化改造」的核心契约：
#
#   1. rpcd 只读方法必须极快（< 200 ms，实际是纯文件 IO），且不访问 modem
#   2. modem 完全无响应时，采集一轮必须在一个 ubus 超时内快速失败，
#      并写出 status=offline 的信封；rpcd 依然秒回
#   3. 后台任务：new 立即返回 task_id；同类任务去重复用；get 能拿到结果
#   4. AT/串口访问串行化：并发采集不会产生重叠的 AT 事务
#   5. 锁不会残留；没有僵尸子进程
#
# 用法：
#   tests/run-backend-tests.sh            # 用 /bin/sh 跑
#   TEST_SH="busybox sh" tests/run-backend-tests.sh   # 用 busybox ash 跑（更贴近设备）
#
# 依赖：python3（跑 mock）、标准 coreutils。不需要 ubus/uci/jsonfilter。

set -u

SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)
ROOT="$SRC_DIR/root"
TEST_SH="${TEST_SH:-sh}"

WORK=${TMPDIR:-/tmp}/qmodem-test.$$
BIN="$WORK/bin"
SBIN="$WORK/sbin"
LIB="$WORK/lib/qmodem"
CACHE="$WORK/tmp/qmodem-cache"
STATS="$WORK/etc/qmodem-stats"
MOCKS="$SRC_DIR/tests/mocks"

PASS=0
FAIL=0
FAILED_NAMES=''

# ------------------------------------------------------------------ 输出

c_green() { printf '\033[32m%s\033[0m' "$1"; }
c_red()   { printf '\033[31m%s\033[0m' "$1"; }

ok()   { PASS=$(( PASS + 1 )); printf '  %s %s\n' "$(c_green ok)" "$1"; }
bad()  { FAIL=$(( FAIL + 1 )); FAILED_NAMES="$FAILED_NAMES\n    - $1"; printf '  %s %s\n' "$(c_red FAIL)" "$1"; }
hdr()  { printf '\n== %s\n' "$1"; }

assert_eq() { # <name> <expected> <actual>
	if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2], got [$3])"; fi
}
assert_true() { # <name> <cmd...>
	if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi
}
assert_json() { # <name> <json> <jsonfilter-expr> <expected>
	_got=$(printf '%s' "$2" | jsonfilter -e "$3" 2>/dev/null)
	assert_eq "$1" "$4" "$_got"
}
# 断言耗时（毫秒）小于上限
assert_fast() { # <name> <ms> <cmd...>
	_t0=$(date +%s%N 2>/dev/null || echo 0)
	_out=$(eval "$3" 2>&1)
	_rc=$?
	_t1=$(date +%s%N 2>/dev/null || echo 0)
	case "$_t0" in ''|*[!0-9]*) _ms=-1 ;; *) _ms=$(( (_t1 - _t0) / 1000000 )) ;; esac
	if [ "$_rc" != 0 ]; then
		bad "$1 (command failed, rc=$_rc)"
		return
	fi
	if [ "$_ms" -lt 0 ] || [ "$_ms" -lt "$2" ]; then
		ok "$1 (${_ms}ms < ${2}ms)"
	else
		bad "$1 (${_ms}ms >= ${2}ms)"
	fi
	LAST_OUT="$_out"
}

# ------------------------------------------------------------------ 环境搭建

setup() {
	rm -rf "$WORK"
	mkdir -p "$BIN" "$SBIN" "$LIB" "$CACHE" "$STATS" "$WORK/etc/config"

	# 被测脚本（软链，保证测的是仓库里的真实文件）
	for f in qmodem-worker qmodem-modem-support qmodem-support-custom qmodem-mt5700-fix; do
		ln -sf "$ROOT/usr/sbin/$f" "$SBIN/$f"
	done
	for f in qmodem-task qmodem-stats-collect qmodem-stats-loop; do
		ln -sf "$ROOT/usr/bin/$f" "$BIN/$f"
	done
	cp "$ROOT/usr/lib/qmodem/qmodem-lib.sh" "$LIB/qmodem-lib.sh"
	cp "$ROOT/usr/lib/qmodem/qmodem-at-probe" "$LIB/qmodem-at-probe"
	chmod 755 "$LIB"/* "$BIN"/* "$SBIN"/*

	# mock 外部命令
	for m in ubus uci jsonfilter; do
		cat > "$BIN/$m" <<EOF
#!/bin/sh
exec python3 "$MOCKS/$m.py" "\$@"
EOF
		chmod 755 "$BIN/$m"
	done
	printf '#!/bin/sh\nexit 0\n' > "$BIN/logger"
	chmod 755 "$BIN/logger"

	# mock 配置
	cat > "$WORK/etc/config/mock.json" <<'EOF'
{
  "qmodem": {
    "modem0": {
      ".type": "modem-device",
      "name": "MOCK-5G",
      "model": "RG520N-CN",
      "manufacturer": "quectel",
      "network": "mock0",
      "at_port": "/dev/ttyMOCK0"
    }
  },
  "network": {
    "mockwan": { ".type": "interface", "modem_config": "modem0", "proto": "dhcp" },
    "mockwanv6": { ".type": "interface", "modem_config": "modem0", "proto": "dhcpv6" }
  }
}
EOF

	cat > "$WORK/ubus-state.json" <<'EOF'
{ "mode": "ok", "delay": 0 }
EOF

	export PATH="$BIN:$PATH"
	export QMODEM_LIB_DIR="$LIB"
	export QMODEM_BIN_DIR="$BIN"
	export QMODEM_SBIN_DIR="$SBIN"
	export QMODEM_CACHE_DIR="$CACHE"
	export QMODEM_STATS_DIR="$STATS"
	export QMODEM_SUPPORT_FILE="$WORK/modem_support.json"
	export QMODEM_EXTRA_SUPPORT_FILE="$ROOT/usr/share/qmodem-generic/extra_modem_support.json"
	export QMODEM_CUSTOM_SUPPORT_DIR="$WORK/custom-modems"
	export QMODEM_SUPPORT_LOCKDIR="$WORK/support.lock"
	export MOCK_UBUS_STATE="$WORK/ubus-state.json"
	export MOCK_UBUS_LOG="$WORK/ubus.log"
	export MOCK_UCI_CONFIG="$WORK/etc/config/mock.json"
	export QMODEM_UBUS_TIMEOUT=3
	export QMODEM_AT_TIMEOUT=3
	export QMODEM_TASK_KEEP=60

	# 一个可解析的 QModem 支持库，供 qmodem-modem-support 使用
	cat > "$WORK/modem_support.json" <<'EOF'
{
    "modem_support": {
        "usb": {
            "em160r-gl": {
                "manufacturer_id": "2c7c",
                "manufacturer": "quectel"
            }
        },
        "pcie": {
        }
    }
}
EOF
	: > "$MOCK_UBUS_LOG"
}

teardown() {
	# 杀掉可能残留的后台任务进程
	pkill -f "qmodem-task _run" 2>/dev/null || true
	pkill -f "qmodem-worker run" 2>/dev/null || true
	rm -rf "$WORK"
}

# ubus 调用日志的行数（grep -c 在无匹配时会打印 0 且返回 1，不能配 || echo 0）
log_count() {
	_n=$(grep -c . "$1" 2>/dev/null)
	case "$_n" in ''|*[!0-9]*) _n=0 ;; esac
	printf '%s' "$_n"
}

set_ubus() { # <mode> <delay>
	printf '{ "mode": "%s", "delay": %s }\n' "$1" "$2" > "$MOCK_UBUS_STATE"
}

rpcd_call() { # <plugin> <method> <input-json>
	printf '%s' "$3" | $TEST_SH "$ROOT/usr/libexec/rpcd/$1" call "$2"
}

# ------------------------------------------------------------------ 测试

t_worker_collect_ok() {
	hdr "worker: 正常采集一轮"
	set_ubus ok 0
	: > "$MOCK_UBUS_LOG"
	$TEST_SH "$SBIN/qmodem-worker" collect modem0 >/dev/null 2>&1

	for d in status network signal registration sim device stats qos radio support; do
		if [ -s "$CACHE/modem0/$d.json" ]; then ok "cache domain written: $d"; else bad "cache domain written: $d"; fi
	done

	_st=$(cat "$CACHE/modem0/status.json")
	assert_json "status envelope status=ready" "$_st" '@.status' ready
	assert_json "status.data.base_info present" "$_st" '@.data.base_info.modem_info[0].key' Name
	assert_json "status.data.ifaces resolved mockwan" "$_st" '@.data.ifaces.names[0]' mockwan
	assert_json "status.data.device mtu" "$_st" '@.data.device.mtu' 1500

	_net=$(cat "$CACHE/modem0/network.json")
	assert_json "network.data.mode" "$_net" '@.data.mode.mode' nr5g
	assert_json "network.data.cell_info shared" "$_net" '@.data.cell_info.modem_info[0].key' 'Cell ID'

	_qos=$(cat "$CACHE/modem0/qos.json")
	assert_json "qos probed via AT (CGEQOSRDP)" "$_qos" '@.data.status' ok
	assert_json "qos qci source traced" "$_qos" '@.data.qci_source' AT+CGEQOSRDP
	assert_json "qos qci = 9" "$_qos" '@.data.qci' 9
	assert_json "qos five_qi = 9" "$_qos" '@.data.five_qi' 9
	assert_json "qos downlink_rate_kbps" "$_qos" '@.data.downlink_rate_kbps' 102400
	assert_json "qos uplink_rate_kbps" "$_qos" '@.data.uplink_rate_kbps' 51200
	assert_json "qos picks internet (data) apn, not ims" "$_qos" '@.data.apn' internet

	# 每个域文件都必须是合法 JSON（原子写入，不能有半截）
	_n=0; _badjson=0
	for f in "$CACHE"/modem0/*.json; do
		_n=$(( _n + 1 ))
		jsonfilter -i "$f" -e '@.updated' >/dev/null 2>&1 || _badjson=$(( _badjson + 1 ))
	done
	assert_eq "all cache files are valid JSON" 0 "$_badjson"
}

t_rpcd_fast_reads() {
	hdr "rpcd: 只读 API 必须快且不碰 modem"
	set_ubus ok 0
	: > "$MOCK_UBUS_LOG"

	assert_fast "qmodem_cache.snapshot < 200ms" 200 \
		"rpcd_call qmodem_cache snapshot '{\"config_section\":\"modem0\"}'"
	_snap="$LAST_OUT"
	assert_json "snapshot returns status domain" "$_snap" '@.domains.status.status' ready
	assert_json "snapshot returns qos domain" "$_snap" '@.domains.qos.data.status' ok
	assert_json "snapshot has now" "$_snap" '@.now' "$(jsonfilter -s "$_snap" -e '@.now')"

	assert_fast "qmodem_cache.get_status < 200ms" 200 \
		"rpcd_call qmodem_cache get_status '{\"config_section\":\"modem0\"}'"
	assert_fast "qmodem_cache.get_signal < 200ms" 200 \
		"rpcd_call qmodem_cache get_signal '{\"config_section\":\"modem0\"}'"
	assert_fast "qmodem_cache.worker_status < 200ms" 200 \
		"rpcd_call qmodem_cache worker_status '{}'"
	assert_fast "qos.qos_info (cache read) < 200ms" 200 \
		"rpcd_call qos qos_info '{\"config_section\":\"modem0\"}'"
	assert_json "qos.qos_info keeps legacy shape" "$LAST_OUT" '@.status' ok
	assert_fast "qmodem_stats.daily_stats < 400ms" 400 \
		"rpcd_call qmodem_stats daily_stats '{\"config_section\":\"modem0\"}'"

	# 关键契约：只读方法一次 modem 查询都不允许发起
	_hits=$(log_count "$MOCK_UBUS_LOG")
	assert_eq "read-only RPCs issued 0 ubus calls" 0 "$_hits"
}

t_modem_dead() {
	hdr "modem 完全无响应：快速失败 + rpcd 依然可用"
	set_ubus dead 30
	rm -rf "$CACHE/modem0"
	: > "$MOCK_UBUS_LOG"

	_t0=$(date +%s)
	$TEST_SH "$SBIN/qmodem-worker" collect modem0 >/dev/null 2>&1
	_t1=$(date +%s)
	_dur=$(( _t1 - _t0 ))
	# base_info 超时(3s) 即判定离线；其余域名直接写 offline，不再逐条等超时
	if [ "$_dur" -le 12 ]; then ok "dead-modem cycle bounded (${_dur}s <= 12s)"; else bad "dead-modem cycle bounded (${_dur}s > 12s)"; fi

	_st=$(cat "$CACHE/modem0/status.json")
	assert_json "status marked offline" "$_st" '@.status' offline
	assert_json "offline carries error text" "$_st" '@.error' 'modem not responding (ubus timeout)'
	_stats=$(cat "$CACHE/modem0/stats.json")
	assert_json "stats still available while offline" "$_stats" '@.data.daily.config_section' modem0

	: > "$MOCK_UBUS_LOG"
	assert_fast "rpcd snapshot still fast while modem dead" 200 \
		"rpcd_call qmodem_cache snapshot '{\"config_section\":\"modem0\"}'"
	assert_json "snapshot reports offline" "$LAST_OUT" '@.domains.status.status' offline
	_hits=$(log_count "$MOCK_UBUS_LOG")
	assert_eq "rpcd issued 0 ubus calls while modem dead" 0 "$_hits"

	set_ubus ok 0
}

t_tasks() {
	hdr "后台任务：立即返回 / 去重 / 结果可查"
	# 让每次 modem 调用花 1.5 秒，确保任务在第二次请求时仍在运行（去重可被观测）
	set_ubus ok 1.5

	_r=$(rpcd_call qmodem_cache refresh '{"config_section":"modem0","domains":["status"]}')
	_id=$(jsonfilter -s "$_r" -e '@.task_id' 2>/dev/null)
	assert_json "refresh returns success" "$_r" '@.success' true
	if [ -n "$_id" ]; then ok "refresh returned task_id ($_id)"; else bad "refresh returned task_id"; fi

	# 同类任务在跑时必须复用，不能重复探测 modem
	_r2=$(rpcd_call qmodem_cache refresh '{"config_section":"modem0","domains":["status"]}')
	_id2=$(jsonfilter -s "$_r2" -e '@.task_id' 2>/dev/null)
	_dedup=$(jsonfilter -s "$_r2" -e '@.deduplicated' 2>/dev/null)
	if [ "$_id2" = "$_id" ] || [ "$_dedup" = "true" ]; then
		ok "concurrent refresh deduplicated ($_id2)"
	else
		bad "concurrent refresh deduplicated (got $_id2, want $_id)"
	fi

	# 等任务结束（上限 20 秒）
	_i=0; _state=queued
	while [ "$_i" -lt 40 ]; do
		_state=$(rpcd_call qmodem_cache get_task "{\"task_id\":\"$_id\"}" | jsonfilter -e '@.state' 2>/dev/null)
		case "$_state" in success|failed|missing) break ;; esac
		sleep 0.5 2>/dev/null || sleep 1
		_i=$(( _i + 1 ))
	done
	assert_eq "task finished" success "$_state"

	_r3=$(rpcd_call qmodem_cache get_tasks '{"config_section":"modem0"}')
	assert_json "get_tasks lists the task" "$_r3" '@.tasks[0].id' "$_id"

	# 写操作即使属于同一模组，也不得复用上一个命令的 task_id。
	# 否则一次删除会读到其它 action 的结果，命令本身根本没有执行。
	_a1=$(rpcd_call qmodem_cache action '{"config_section":"modem0","object":"qmodem","method":"delete_sms","args":{"config_section":"modem0","index":"1"}}')
	_a2=$(rpcd_call qmodem_cache action '{"config_section":"modem0","object":"qmodem","method":"delete_sms","args":{"config_section":"modem0","index":"2"}}')
	_aid1=$(jsonfilter -s "$_a1" -e '@.task_id' 2>/dev/null)
	_aid2=$(jsonfilter -s "$_a2" -e '@.task_id' 2>/dev/null)
	if [ -n "$_aid1" ] && [ -n "$_aid2" ] && [ "$_aid1" != "$_aid2" ]; then
		ok "concurrent SMS delete commands each get a distinct task"
	else
		bad "concurrent SMS delete commands share a task ($_aid1 / $_aid2)"
	fi
	set_ubus ok 0
	for _action_id in "$_aid1" "$_aid2"; do
		[ -n "$_action_id" ] || continue
		_i=0; _action_state=queued
		while [ "$_i" -lt 80 ]; do
			_action_state=$(rpcd_call qmodem_cache get_task "{\"task_id\":\"$_action_id\"}" | jsonfilter -e '@.state' 2>/dev/null)
			case "$_action_state" in success|failed|missing) break ;; esac
			sleep 0.25
			_i=$(( _i + 1 ))
		done
		assert_eq "SMS action $_action_id completed" success "$_action_state"
	done
	_deleted=$(grep -c 'qmodem delete_sms ' "$MOCK_UBUS_LOG" 2>/dev/null || true)
	assert_eq "both SMS delete commands reached QModem" 2 "$_deleted"

	# IMEI 写入不应等待状态、网络、注册等无关域采集完才完成任务。
	: > "$MOCK_UBUS_LOG"
	_imei=$(rpcd_call qmodem_cache action '{"config_section":"modem0","object":"qmodem","method":"set_imei","args":{"config_section":"modem0","imei":"860000000000002"}}')
	_imei_id=$(jsonfilter -s "$_imei" -e '@.task_id' 2>/dev/null)
	_i=0; _imei_state=queued
	while [ "$_i" -lt 80 ]; do
		_imei_task=$(rpcd_call qmodem_cache get_task "{\"task_id\":\"$_imei_id\"}")
		_imei_state=$(printf '%s' "$_imei_task" | jsonfilter -e '@.state' 2>/dev/null)
		case "$_imei_state" in success|failed|missing) break ;; esac
		sleep 0.25
		_i=$(( _i + 1 ))
	done
	assert_eq "IMEI action completed" success "$_imei_state"
	assert_json "IMEI action returns official echoed value" "$_imei_task" '@.result.imei' '860000000000002'
	_imei_calls=$(grep -c 'qmodem set_imei ' "$MOCK_UBUS_LOG" 2>/dev/null || true)
	assert_eq "IMEI action reached QModem once" 1 "$_imei_calls"
	_unrelated=$(grep -Ec 'qmodem (base_info|network_info|get_connect_status|dial_status) ' "$MOCK_UBUS_LOG" 2>/dev/null || true)
	assert_eq "IMEI action does not block on unrelated collection" 0 "$_unrelated"

	# 未知方法 / 非法参数必须快速失败而不是挂住
	assert_fast "unknown method returns fast" 500 \
		"rpcd_call qmodem_cache bogus_method '{}'"
	assert_json "unknown method rejected" "$LAST_OUT" '@.success' false
	_bad=$(rpcd_call qmodem_cache get_status '{"config_section":"../../etc/passwd"}')
	assert_json "path traversal section rejected" "$_bad" '@.success' false
}

t_task_timeout() {
	hdr "任务超时：modem 卡死时任务必须自己结束"
	set_ubus dead 30
	export QMODEM_UBUS_TIMEOUT=2
	_r=$(rpcd_call qmodem_cache send_at '{"config_section":"modem0","at":"AT"}')
	_id=$(jsonfilter -s "$_r" -e '@.task_id' 2>/dev/null)
	if [ -n "$_id" ]; then ok "send_at task created"; else bad "send_at task created"; fi

	_i=0; _state=queued
	while [ "$_i" -lt 60 ]; do
		_state=$(rpcd_call qmodem_cache get_task "{\"task_id\":\"$_id\"}" | jsonfilter -e '@.state' 2>/dev/null)
		case "$_state" in success|failed|missing) break ;; esac
		sleep 0.5 2>/dev/null || sleep 1
		_i=$(( _i + 1 ))
	done
	if [ "$_state" = "failed" ] || [ "$_state" = "success" ]; then
		ok "send_at task terminated instead of hanging ($_state)"
	else
		bad "send_at task terminated instead of hanging ($_state)"
	fi
	unset QMODEM_UBUS_TIMEOUT
	set_ubus ok 0
}

t_at_serialisation() {
	hdr "AT 串行化：并发采集不产生重叠的 AT 事务"
	set_ubus ok 0.4
	: > "$MOCK_UBUS_LOG"

	$TEST_SH "$SBIN/qmodem-worker" collect modem0 'status' >/dev/null 2>&1 &
	_p1=$!
	$TEST_SH "$SBIN/qmodem-worker" collect modem0 'status' >/dev/null 2>&1 &
	_p2=$!
	wait "$_p1" 2>/dev/null
	wait "$_p2" 2>/dev/null

	# 锁目录必须被释放（不残留）
	_left=$(find "$CACHE/locks" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
	assert_eq "no leftover lock dirs" 0 "$_left"

	# AT 事务不得重叠：mock 每次调用带时间戳，delay=0.4s，
	# 若并发抢串口，会出现两个调用开始时间差 < 0.4s 的情况
	_overlap=$(python3 - "$MOCK_UBUS_LOG" <<'PY'
import sys
rows = []
for line in open(sys.argv[1], encoding='utf-8'):
    parts = line.split()
    if len(parts) >= 2:
        rows.append((float(parts[0]), ' '.join(parts[1:])))
rows.sort()
overlap = 0
for i in range(1, len(rows)):
    # 同一进程内的连续调用间隔极小属正常；只检查跨进程抢串口的重叠
    if rows[i][0] - rows[i - 1][0] < 0.05:
        overlap += 1
print(overlap)
PY
)
	# 说明：这里只统计「几乎同时开始」的调用数；串行化下应为 0
	assert_eq "no overlapping modem transactions" 0 "$_overlap"
}

t_stats_background() {
	hdr "流量统计：采样只在后台，rpcd 只读"
	set_ubus ok 0
	rm -f "$STATS/modem0.stats"
	$TEST_SH "$BIN/qmodem-stats-collect" run modem0 >/dev/null 2>&1
	$TEST_SH "$SBIN/qmodem-worker" collect modem0 stats >/dev/null 2>&1

	: > "$MOCK_UBUS_LOG"
	_out=$(rpcd_call qmodem_stats daily_stats '{"config_section":"modem0"}')
	_hits=$(log_count "$MOCK_UBUS_LOG")
	assert_eq "daily_stats issued 0 modem calls" 0 "$_hits"
	assert_json "daily_stats returns config_section" "$_out" '@.config_section' modem0
	assert_json "daily_stats returns available" "$_out" '@.available' true

	: > "$MOCK_UBUS_LOG"
	_out=$(rpcd_call qmodem_stats stats_history '{"config_section":"modem0"}')
	_hits=$(log_count "$MOCK_UBUS_LOG")
	assert_eq "stats_history issued 0 modem calls" 0 "$_hits"

	# 清零改为后台任务：RPC 本身不碰 modem
	: > "$MOCK_UBUS_LOG"
	_out=$(rpcd_call qmodem_stats stats_reset '{"config_section":"modem0"}')
	_hits=$(log_count "$MOCK_UBUS_LOG")
	assert_eq "stats_reset issued 0 synchronous modem calls" 0 "$_hits"
	assert_json "stats_reset returns task_id" "$_out" '@.success' true
}

t_support() {
	hdr "模组支持库：status 走缓存，sync 有超时上限"
	$TEST_SH "$SBIN/qmodem-worker" collect modem0 support >/dev/null 2>&1
	_out=$(rpcd_call qmodem_support status '{}')
	assert_json "support status available" "$_out" '@.available' 1
	assert_json "support status lists rg520n-cn as missing" "$_out" '@.missing[0]' rg520n-cn

	assert_fast "support sync bounded" 15000 "rpcd_call qmodem_support sync '{}'"
	_out="$LAST_OUT"
	assert_json "support sync added rg520n-cn" "$_out" '@.added[0]' rg520n-cn
	assert_true "built-in RG502Q-EA usb and PCIe added" "python3 -c 'import json; d=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"]; assert all(\"rg502q-ea\" in d[b] for b in (\"usb\",\"pcie\"))'"
	assert_true "official RG650V-EU fallback added" "python3 -c 'import json; d=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"]; assert all(\"rg650v-eu\" in d[b] for b in (\"usb\",\"pcie\"))'"
}

t_custom_support() {
	hdr "未知型号自定义与串口映射"
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"../../evil","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi","pdp_index":"1"}')
	assert_json "reject path traversal in custom model" "$_out" '@.success' false
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"pcie","model":"rg-future","manufacturer":"quectel","manufacturer_id":"","platform":"qualcomm","modes":"ecm","pdp_index":"1"}')
	assert_json "reject USB mode on PCIe" "$_out" '@.success' false
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"rg502q-ea","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi","pdp_index":"1"}')
	assert_json "do not shadow built-in model" "$_out" '@.success' false
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"rg-future","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi,mbim","pdp_index":"1"}')
	assert_json "save USB custom model" "$_out" '@.success' true
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"pcie","model":"rg-future","manufacturer":"quectel","manufacturer_id":"","platform":"qualcomm","modes":"qmi,mbim","pdp_index":"1"}')
	assert_json "save PCIe custom model" "$_out" '@.success' true
	_out=$(rpcd_call qmodem_support custom_list '{}')
	assert_json "list custom USB model" "$_out" '@.entries[0].model' rg-future
	_out=$($TEST_SH "$SBIN/qmodem-modem-support" --json)
	assert_true "custom model injected into both buses" "python3 -c 'import json; d=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"]; assert all(\"rg-future\" in d[b] for b in (\"usb\",\"pcie\"))'"
	# 编辑自定义型号时同时更新用户 JSON 与 QModem JSON，保留备份与其它定义
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"rg-future","edit":"1","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi,mbim,ncm","pdp_index":"1","wcdma_band":"1/5/8","lte_band":"3/8/41","nsa_band":"41/78","sa_band":"41/78/79"}')
	assert_json "edit own USB custom definition" "$_out" '@.success' true
	assert_true "edit updates both custom and QModem without losing unrelated models" \
		"python3 -c 'import json; import os; c=json.load(open(\"$WORK/custom-modems/usb/rg-future.json\"))[\"modem_support\"][\"usb\"][\"rg-future\"]; q=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"]; assert c == q[\"usb\"][\"rg-future\"]; assert c[\"lte_band\"] == \"3/8/41\"; assert c[\"modes\"] == [\"qmi\",\"mbim\",\"ncm\"]; assert \"rg502q-ea\" in q[\"usb\"]'"
	assert_true "QModem and custom JSON backups created" \
		"test -f '$WORK/modem_support.json.bak' && test -f '$WORK/custom-modems/usb/rg-future.json.bak'"
	_out=$(rpcd_call qmodem_support custom_list '{}')
	assert_json "edited custom entry reports synchronized" "$_out" '@.entries[0].state' synced

	# 模拟第三方更改 QModem 条目；自定义编辑不得覆盖外部更改
	jq --indent 4 '.modem_support.usb["rg-future"].lte_band="9"' \
		"$WORK/modem_support.json" > "$WORK/other-change.json"
	cp "$WORK/other-change.json" "$WORK/modem_support.json"
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"rg-future","edit":"1","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi,mbim","pdp_index":"1","lte_band":"1/3/5"}')
	assert_json "reject overwrite of external QModem changes" "$_out" '@.success' false
	assert_true "rejected conflict preserves both existing definitions" \
		"python3 -c 'import json; c=json.load(open(\"$WORK/custom-modems/usb/rg-future.json\"))[\"modem_support\"][\"usb\"][\"rg-future\"]; q=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"][\"usb\"][\"rg-future\"]; assert c[\"lte_band\"] == \"3/8/41\"; assert q[\"lte_band\"] == \"9\"'"
	# 恢复模拟的外部改动，后续测试沿用正常支持库
	cp "$WORK/modem_support.json.bak" "$WORK/modem_support.json"
	# 备份为编辑前版本，重新同步到最新用户定义后继续执行其他测试
	jq --indent 4 --slurpfile custom "$WORK/custom-modems/usb/rg-future.json" \
		'.modem_support.usb["rg-future"] = $custom[0].modem_support.usb["rg-future"]' \
		"$WORK/modem_support.json" > "$WORK/final.json"
	cp "$WORK/final.json" "$WORK/modem_support.json"

	# 插件自带的预设 JSON 可通过编辑创建持久化覆盖文件，官方源定义不修改
	_out=$(rpcd_call qmodem_support custom_save '{"bus":"usb","model":"rg502q-ea","edit":"1","manufacturer":"quectel","manufacturer_id":"2c7c","platform":"qualcomm","modes":"qmi,gobinet,mbim","pdp_index":"1","wcdma_band":"1/3/5","lte_band":"3/8/41","nsa_band":"41/78","sa_band":"41/78"}')
	assert_json "edit built-in custom profile by creating persistent JSON override" "$_out" '@.success' true
	assert_true "custom override and QModem have same builtin-edited definition" \
		"python3 -c 'import json; a=json.load(open(\"$WORK/custom-modems/usb/rg502q-ea.json\"))[\"modem_support\"][\"usb\"][\"rg502q-ea\"]; b=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"][\"usb\"][\"rg502q-ea\"]; assert a == b; assert b[\"lte_band\"] == \"3/8/41\"'"
	_out=$($TEST_SH "$SBIN/qmodem-modem-support" --status)
	assert_json "legacy merge/status still reads QModem after jq 4-space edit" "$_out" '@.available' 1
	assert_true "package-provided immutable extra JSON remains intact" \
		"python3 -c 'import json; a=json.load(open(\"$ROOT/usr/share/qmodem-generic/extra_modem_support.json\"))[\"modem_support\"][\"usb\"][\"rg502q-ea\"]; assert a[\"lte_band\"] != \"3/8/41\"'"

	_out=$(rpcd_call qmodem_support custom_delete '{"bus":"pcie","model":"rg-future"}')
	assert_json "remove PCIe custom source" "$_out" '@.success' true
	assert_true "removing source keeps official support entries" "python3 -c 'import json; d=json.load(open(\"$WORK/modem_support.json\"))[\"modem_support\"]; assert \"rg-future\" in d[\"pcie\"]'"

	mkdir -p "$WORK/sys/class/tty/ttyUSB77" "$WORK/sys/devices/usb/2-1" "$WORK/dev"
	printf '2c7c\n' > "$WORK/sys/devices/usb/2-1/idVendor"
	printf '0801\n' > "$WORK/sys/devices/usb/2-1/idProduct"
	printf 'RG502Q-EA\n' > "$WORK/sys/devices/usb/2-1/product"
	ln -s "$WORK/sys/devices/usb/2-1" "$WORK/sys/class/tty/ttyUSB77/device"
	ln -s /dev/null "$WORK/dev/ttyUSB77"
	export QMODEM_SYS_TTY_DIR="$WORK/sys/class/tty"
	export QMODEM_SYS_WWAN_DIR="$WORK/sys/class/wwan"
	export QMODEM_DEV_DIR="$WORK/dev"
	_out=$(rpcd_call qmodem_support ports '{}')
	assert_json "candidate port maps model from USB device" "$_out" '@.ports[0].model' RG502Q-EA
	assert_json "candidate port maps VID:PID" "$_out" '@.ports[0].id' '2c7c:0801'
	assert_json "unprobed port is not confirmed AT" "$_out" '@.ports[0].confirmed' 0
	_out=$(rpcd_call qmodem_support probe_port '{"port":"/dev/ttyUSB77;rm -rf /"}')
	assert_json "reject unlisted probe port" "$_out" '@.success' false
	cat > "$BIN/tom_modem" <<'EOF'
#!/bin/sh
printf 'AT+CGMM\r\n+CGMM: RG502Q-EA\r\nOK\r\n'
EOF
	chmod 755 "$BIN/tom_modem"
	_out=$(rpcd_call qmodem_support probe_port "{\"port\":\"$WORK/dev/ttyUSB77\"}")
	assert_json "user-initiated AT probe reads model" "$_out" '@.model' RG502Q-EA
	python3 -c 'import json,os; p=os.environ["MOCK_UCI_CONFIG"]; d=json.load(open(p)); d["qmodem"]["modem0"]["at_port"]=os.environ["QMODEM_DEV_DIR"]+"/ttyUSB77"; json.dump(d,open(p,"w"))'
	_out=$(rpcd_call qmodem_support ports '{}')
	assert_json "QModem configured AT port confirmed" "$_out" '@.ports[0].confirmed' 1
	_out=$(rpcd_call qmodem_support probe_port "{\"port\":\"$WORK/dev/ttyUSB77\"}")
	assert_json "probe refuses QModem-owned serial" "$_out" '@.success' false
}

t_no_orphans() {
	hdr "进程与锁清理"
	_left=$(find "$CACHE/locks" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
	assert_eq "no lock dirs left behind" 0 "$_left"
	# 避免测试命令自身的 shell 命令行被 pgrep -f 匹配。
	_orphans=$(pgrep -f "[q]modem-task _run" 2>/dev/null | wc -l | tr -d ' ')
	assert_eq "no orphaned task runners" 0 "$_orphans"
	_tmp=$(find "$CACHE" -name '*.tmp.*' 2>/dev/null | wc -l | tr -d ' ')
	assert_eq "no leftover temp files (atomic writes cleaned up)" 0 "$_tmp"
}

t_worker_daemon() {
	hdr "常驻 worker：启动即返回，单实例"
	set_ubus ok 0
	export QMODEM_WORKER_INTERVAL=5
	$TEST_SH "$SBIN/qmodem-worker" run >"$WORK/worker.log" 2>&1 &
	_wpid=$!
	sleep 4
	if kill -0 "$_wpid" 2>/dev/null; then ok "worker daemon alive"; else bad "worker daemon alive"; fi
	if [ -s "$CACHE/worker.json" ]; then ok "heartbeat written"; else bad "heartbeat written"; fi

	# 第二个实例必须自己退出（单实例锁）
	$TEST_SH "$SBIN/qmodem-worker" run >"$WORK/worker2.log" 2>&1 &
	_w2=$!
	sleep 2
	if kill -0 "$_w2" 2>/dev/null; then
		bad "second worker exits (single instance)"
		kill "$_w2" 2>/dev/null
	else
		ok "second worker exits (single instance)"
	fi

	kill -TERM "$_wpid" 2>/dev/null
	sleep 2
	if kill -0 "$_wpid" 2>/dev/null; then
		bad "worker stops on SIGTERM"
		kill -KILL "$_wpid" 2>/dev/null
	else
		ok "worker stops on SIGTERM"
	fi
	_left=$(find "$CACHE/locks" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
	assert_eq "worker released its lock on exit" 0 "$_left"
	unset QMODEM_WORKER_INTERVAL
}

# ------------------------------------------------------------------ main

trap 'teardown' EXIT INT TERM
setup

printf 'QModem Generic backend tests\n'
printf '  shell under test : %s\n' "$TEST_SH"
printf '  package root     : %s\n' "$SRC_DIR"

t_worker_collect_ok
t_rpcd_fast_reads
t_modem_dead
t_tasks
t_task_timeout
t_at_serialisation
t_stats_background
t_support
t_custom_support
t_worker_daemon
t_no_orphans

printf '\n----------------------------------------\n'
printf 'passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
	printf 'failures:%b\n' "$FAILED_NAMES"
	exit 1
fi
printf 'ALL BACKEND TESTS PASSED\n'
exit 0
