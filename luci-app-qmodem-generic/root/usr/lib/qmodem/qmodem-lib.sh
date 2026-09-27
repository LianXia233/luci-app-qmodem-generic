# qmodem-lib.sh — QModem Generic 后端公共库（POSIX sh / busybox ash 兼容）
#
# 本库只负责三件事，是「异步化改造」的地基：
#
#   1) 状态缓存（State Cache）
#        /tmp/qmodem-cache/<config_section>/<domain>.json
#      统一信封格式：
#        { "updated":1780000000, "stale":false, "status":"ready",
#          "ttl":30, "error":null, "data":{ ... } }
#      写入一律「临时文件 + mv」原子替换，绝不产生半截 JSON；
#      读取失败/文件缺失立即返回空，绝不阻塞调用方。
#
#   2) 互斥锁（Mutex）
#        /tmp/qmodem-cache/locks/<name>/{pid,ts}
#      mkdir 原子加锁 + 持有者存活检测 + 超时强抢，
#      保证「同一 AT 端口不会被并发读写」，且进程被 kill 后锁不会永久残留。
#
#   3) 带超时的 ubus 调用
#      优先 `ubus -t <秒>`；ubus 不支持 -t 时退化为「后台执行 + 看门狗 kill」。
#      任何 modem / AT / 网络查询都不允许无限等待。
#
# 使用方式： . /usr/lib/qmodem/qmodem-lib.sh
#
# 设计约束：
#   - 只使用 OpenWrt 自带的 busybox applet（sh/awk/sed/date/mkdir/mv/cat/kill/sleep/logger）
#   - 不引入 python / node / 额外 daemon
#   - 所有函数都不使用 bash 数组、[[ ]]、local -、进程替换等 bashism

# 安装路径（默认值即 OpenWrt 上的真实路径）。测试环境可用环境变量整体重定位，
# 生产环境不需要设置。
QMODEM_LIB_DIR="${QMODEM_LIB_DIR:-/usr/lib/qmodem}"
QMODEM_BIN_DIR="${QMODEM_BIN_DIR:-/usr/bin}"
QMODEM_SBIN_DIR="${QMODEM_SBIN_DIR:-/usr/sbin}"

QMODEM_CACHE_DIR="${QMODEM_CACHE_DIR:-/tmp/qmodem-cache}"
QMODEM_LOCK_DIR="${QMODEM_LOCK_DIR:-$QMODEM_CACHE_DIR/locks}"
QMODEM_TASK_DIR="${QMODEM_TASK_DIR:-$QMODEM_CACHE_DIR/tasks}"
QMODEM_STATS_DIR="${QMODEM_STATS_DIR:-/etc/qmodem-stats}"

# 单次 ubus 调用（= 一次 modem/AT/网络查询）的默认硬超时（秒）
QMODEM_UBUS_TIMEOUT="${QMODEM_UBUS_TIMEOUT:-8}"
# AT 直发（send_at）的默认硬超时（秒）
QMODEM_AT_TIMEOUT="${QMODEM_AT_TIMEOUT:-8}"
# 锁的最长持有时间（秒）：超过即视为持有者已死，允许强抢，避免死锁
QMODEM_LOCK_MAX_AGE="${QMODEM_LOCK_MAX_AGE:-120}"
# 缓存过期（stale）判定阈值（秒）
QMODEM_STALE_AFTER="${QMODEM_STALE_AFTER:-90}"

# ------------------------------------------------------------------ 目录/工具

qm_init_dirs() {
	[ -d "$QMODEM_CACHE_DIR" ] || mkdir -p "$QMODEM_CACHE_DIR" 2>/dev/null
	[ -d "$QMODEM_LOCK_DIR" ] || mkdir -p "$QMODEM_LOCK_DIR" 2>/dev/null
	[ -d "$QMODEM_TASK_DIR" ] || mkdir -p "$QMODEM_TASK_DIR" 2>/dev/null
	[ -d "$QMODEM_STATS_DIR" ] || mkdir -p "$QMODEM_STATS_DIR" 2>/dev/null
	return 0
}

qm_now() {
	date +%s 2>/dev/null || echo 0
}

qm_log() {
	logger -t qmodem-worker "$*" 2>/dev/null || true
}

# 字符串 → JSON 字符串正文（不含首尾引号）。多行折叠成 \n。
qm_json_escape() {
	tr -d '\000\r' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
		| awk '{ printf "%s%s", (NR > 1 ? "\\n" : ""), $0 }'
}

qm_is_json() {
	case "$1" in
		\{*|\[*) return 0 ;;
		*) return 1 ;;
	esac
}

# 原样返回合法 JSON；否则返回兜底值（避免把空/错误文本拼进 JSON 里）
qm_json_or() {
	if qm_is_json "$1"; then
		printf '%s' "$1"
	else
		printf '%s' "${2:-\{\}}"
	fi
}

# ------------------------------------------------------------------ 原子写入

# stdin → $1（临时文件 + mv，同一文件系统内 mv 是原子 rename）
qm_atomic_write() {
	_qm_dst="$1"
	[ -n "$_qm_dst" ] || return 1
	qm_init_dirs
	_qm_tmp="${_qm_dst}.tmp.$$"
	cat > "$_qm_tmp" 2>/dev/null || { rm -f "$_qm_tmp" 2>/dev/null; return 1; }
	mv -f "$_qm_tmp" "$_qm_dst" 2>/dev/null || { rm -f "$_qm_tmp" 2>/dev/null; return 1; }
	return 0
}

# ------------------------------------------------------------------ 缓存信封

# qm_envelope <status> <data-json> [error] [ttl]
qm_envelope() {
	_qm_st="${1:-unknown}"
	_qm_data="$2"
	_qm_err="$3"
	_qm_ttl="${4:-0}"

	qm_is_json "$_qm_data" || _qm_data='{}'

	if [ -n "$_qm_err" ]; then
		_qm_errj="\"$(printf '%s' "$_qm_err" | qm_json_escape)\""
	else
		_qm_errj='null'
	fi

	printf '{"updated":%s,"stale":false,"status":"%s","ttl":%s,"error":%s,"data":%s}\n' \
		"$(qm_now)" "$_qm_st" "$_qm_ttl" "$_qm_errj" "$_qm_data"
}

# qm_write_domain <section> <domain> <status> <data-json> [error] [ttl]
qm_write_domain() {
	_qm_sec="$1"; _qm_dom="$2"
	[ -n "$_qm_sec" ] && [ -n "$_qm_dom" ] || return 1
	case "$_qm_sec" in *[!A-Za-z0-9_-]*) return 1 ;; esac
	case "$_qm_dom" in *[!A-Za-z0-9_-]*) return 1 ;; esac

	_qm_dir="$QMODEM_CACHE_DIR/$_qm_sec"
	[ -d "$_qm_dir" ] || mkdir -p "$_qm_dir" 2>/dev/null
	qm_envelope "$3" "$4" "$5" "$6" | qm_atomic_write "$_qm_dir/$_qm_dom.json"
}

# qm_read_domain <section> <domain> → stdout 原始信封 JSON；缺失/读失败返回 1
qm_read_domain() {
	_qm_f="$QMODEM_CACHE_DIR/$1/$2.json"
	[ -f "$_qm_f" ] || return 1
	cat "$_qm_f" 2>/dev/null
}

qm_domain_file() {
	printf '%s\n' "$QMODEM_CACHE_DIR/$1/$2.json"
}

# ------------------------------------------------------------------ 互斥锁

# qm_lock <name> [timeout_secs]
#   timeout=0（默认）表示拿不到立即失败（非阻塞）；>0 表示最多等待这么多秒。
#   同一进程可重入（重复加同名锁只计数，不重复创建目录）。
qm_lock() {
	_qm_name="$1"
	_qm_to="${2:-0}"
	case "$_qm_name" in ''|*[!A-Za-z0-9._-]*) return 2 ;; esac
	_qm_dir="$QMODEM_LOCK_DIR/$_qm_name"
	qm_init_dirs

	# 重入：本进程已持有同名锁
	case " $QM_HELD_LOCKS " in
		*" $_qm_name "*) return 0 ;;
	esac

	_qm_waited=0
	while :; do
		if mkdir "$_qm_dir" 2>/dev/null; then
			printf '%s\n' "$$" > "$_qm_dir/pid" 2>/dev/null
			qm_now > "$_qm_dir/ts" 2>/dev/null
			QM_HELD_LOCKS="$QM_HELD_LOCKS $_qm_name"
			return 0
		fi

		_qm_pid=$(cat "$_qm_dir/pid" 2>/dev/null)
		_qm_ts=$(cat "$_qm_dir/ts" 2>/dev/null)
		case "$_qm_ts" in ''|*[!0-9]*) _qm_ts=0 ;; esac
		_qm_age=$(( $(qm_now) - _qm_ts ))

		# 持有者已死 → 立即回收（不会残留僵尸锁）
		if [ -n "$_qm_pid" ] && ! kill -0 "$_qm_pid" 2>/dev/null; then
			rm -rf "$_qm_dir" 2>/dev/null
			continue
		fi

		# 持有时间超限 → 强制回收（防止 RPC 超时后 worker 永久卡死导致死锁）
		if [ "$_qm_age" -gt "$QMODEM_LOCK_MAX_AGE" ]; then
			qm_log "lock $_qm_name held for ${_qm_age}s (> $QMODEM_LOCK_MAX_AGE), stealing"
			rm -rf "$_qm_dir" 2>/dev/null
			continue
		fi

		[ "$_qm_to" -le 0 ] && return 1
		[ "$_qm_waited" -ge "$_qm_to" ] && return 1
		sleep 1
		_qm_waited=$(( _qm_waited + 1 ))
	done
}

qm_unlock() {
	_qm_name="$1"
	[ -n "$_qm_name" ] || return 0
	case " $QM_HELD_LOCKS " in
		*" $_qm_name "*) ;;
		*) return 0 ;;
	esac

	_qm_dir="$QMODEM_LOCK_DIR/$_qm_name"
	# 只有仍是本进程持有时才删除，避免误删被强抢后的新持有者的锁
	if [ "$(cat "$_qm_dir/pid" 2>/dev/null)" = "$$" ]; then
		rm -rf "$_qm_dir" 2>/dev/null
	fi
	QM_HELD_LOCKS=$(printf '%s' " $QM_HELD_LOCKS " | sed "s/ $_qm_name / /")
	return 0
}

# 退出时释放所有本进程持有的锁（trap EXIT/INT/TERM 使用）
qm_unlock_all() {
	for _qm_n in $QM_HELD_LOCKS; do
		_qm_dir="$QMODEM_LOCK_DIR/$_qm_n"
		if [ "$(cat "$_qm_dir/pid" 2>/dev/null)" = "$$" ]; then
			rm -rf "$_qm_dir" 2>/dev/null
		fi
	done
	QM_HELD_LOCKS=''
}

# ------------------------------------------------------------------ 超时执行

# ubus 是否支持 -t <秒>
qm_ubus_has_timeout() {
	[ -n "$QM_UBUS_T_OK" ] && { [ "$QM_UBUS_T_OK" = 1 ] && return 0 || return 1; }
	if ubus -t 1 list >/dev/null 2>&1; then
		QM_UBUS_T_OK=1
	else
		QM_UBUS_T_OK=0
	fi
	[ "$QM_UBUS_T_OK" = 1 ]
}

# 后台执行 + 看门狗：`ubus -t` 不可用时的兜底，1 秒粒度轮询。
# qm_run_limited <secs> <outfile> <cmd...>
qm_run_limited() {
	_qm_t="$1"; _qm_out="$2"; shift 2
	[ -n "$_qm_t" ] || _qm_t=5
	case "$_qm_t" in ''|*[!0-9]*) _qm_t=5 ;; esac

	( "$@" > "$_qm_out" 2>/dev/null ) &
	_qm_pid=$!
	_qm_w=0
	while kill -0 "$_qm_pid" 2>/dev/null; do
		if [ "$_qm_w" -ge "$_qm_t" ]; then
			kill -TERM "$_qm_pid" 2>/dev/null
			sleep 1
			kill -KILL "$_qm_pid" 2>/dev/null
			wait "$_qm_pid" 2>/dev/null
			return 124
		fi
		sleep 1
		_qm_w=$(( _qm_w + 1 ))
	done
	wait "$_qm_pid" 2>/dev/null
	return $?
}

# qm_ubus <object> <method> [args-json] [timeout-secs] → stdout（JSON 或空）
# 任何情况下都有硬超时；失败/超时输出空串并返回非 0。
qm_ubus() {
	_qm_obj="$1"; _qm_m="$2"; _qm_a="${3:-}" _qm_t="${4:-$QMODEM_UBUS_TIMEOUT}"
	[ -n "$_qm_a" ] || _qm_a='{}'
	case "$_qm_t" in ''|*[!0-9]*) _qm_t="$QMODEM_UBUS_TIMEOUT" ;; esac
	[ "$_qm_t" -lt 1 ] && _qm_t=1

	if qm_ubus_has_timeout; then
		ubus -t "$_qm_t" call "$_qm_obj" "$_qm_m" "$_qm_a" 2>/dev/null
		return $?
	fi

	_qm_out="$QMODEM_CACHE_DIR/.ubus.$$"
	qm_init_dirs
	if qm_run_limited "$_qm_t" "$_qm_out" ubus call "$_qm_obj" "$_qm_m" "$_qm_a"; then
		cat "$_qm_out" 2>/dev/null
		rm -f "$_qm_out" 2>/dev/null
		return 0
	fi
	rm -f "$_qm_out" 2>/dev/null
	return 124
}

# qm_ubus_json <object> <method> [args-json] [timeout-secs]
# 与 qm_ubus 相同，但保证输出合法 JSON（失败时输出 {}）
qm_ubus_json() {
	_qm_r=$(qm_ubus "$1" "$2" "$3" "$4")
	if qm_is_json "$_qm_r"; then
		printf '%s' "$_qm_r"
	else
		printf '{}'
		return 1
	fi
}

# ------------------------------------------------------------------ 配置节

# 列出 /etc/config/qmodem 中所有 modem-device 配置节名
qm_sections() {
	uci show qmodem 2>/dev/null \
		| sed -n 's/^qmodem\.\([A-Za-z0-9_][A-Za-z0-9_]*\)=modem-device$/\1/p'
}

# 仅列出未禁用的配置节（state=disabled 的跳过）
qm_enabled_sections() {
	for _qm_s in $(qm_sections); do
		case "$(uci -q get "qmodem.$_qm_s.state" 2>/dev/null)" in
			disabled) continue ;;
		esac
		printf '%s\n' "$_qm_s"
	done
}

qm_valid_section() {
	case "$1" in
		''|*[!A-Za-z0-9_-]*) return 1 ;;
		*) return 0 ;;
	esac
}

# 模组的 AT 端口（优先 override_at_port，与 qos 插件的既有取值顺序一致）
qm_at_port() {
	_p=$(uci -q get "qmodem.$1.override_at_port" 2>/dev/null)
	[ -n "$_p" ] || _p=$(uci -q get "qmodem.$1.at_port" 2>/dev/null)
	printf '%s' "$_p"
}

# AT 端口互斥锁名：同一物理串口只允许一个进程访问
qm_at_lock_name() {
	_p=$(qm_at_port "$1")
	if [ -n "$_p" ]; then
		printf 'at.%s' "$(printf '%s' "$_p" | tr '/.' '__')"
	else
		printf 'at.section.%s' "$1"
	fi
}

# ------------------------------------------------------------------ 心跳

# qm_heartbeat <pid> <interval> [extra-json]
qm_heartbeat() {
	qm_atomic_write "$QMODEM_CACHE_DIR/worker.json" <<EOF
{"pid":${1:-0},"updated":$(qm_now),"interval":${2:-0},"extra":$(qm_json_or "${3:-}" '{}')}
EOF
}

qm_read_heartbeat() {
	[ -f "$QMODEM_CACHE_DIR/worker.json" ] || return 1
	cat "$QMODEM_CACHE_DIR/worker.json" 2>/dev/null
}

QM_HELD_LOCKS=''
QM_UBUS_T_OK=''
