# qmodem-lib.sh — QModem Generic 后端公共库（POSIX sh / busybox ash 兼容）
#
# 3.0.0 曾删除本文件（误判为「无调用方」），但 rpcd/qmodem_support 与
# qmodem-support-custom 仍在 source 它，而官方 QModem 不提供此文件，
# 导致模组支持库功能回归。现按「仍被使用」的最小集恢复：
#
#   1) 路径变量（QMODEM_BIN_DIR / QMODEM_SBIN_DIR / QMODEM_CACHE_DIR …）
#   2) 工具函数（qm_init_dirs / qm_now / qm_json_escape）
#   3) 原子写入（qm_atomic_write / qm_envelope）
#   4) 互斥锁（qm_lock / qm_unlock / qm_unlock_all）
#
# 已不再使用的缓存领域函数（qm_write_domain / qm_read_domain / 任务队列）
# 不再保留 —— 读写已直连官方 ubus 接口，QModem rpcd 自带缓存兜底。
#
# 使用方式： . /usr/lib/qmodem/qmodem-lib.sh
#
# 设计约束：
#   - 只使用 OpenWrt 自带的 busybox applet（sh/awk/sed/date/mkdir/mv/cat/kill/sleep/logger）
#   - 不使用 bash 数组、[[ ]]、进程替换等 bashism

# 安装路径（默认值即 OpenWrt 上的真实路径；测试环境可用环境变量整体重定位）
QMODEM_LIB_DIR="${QMODEM_LIB_DIR:-/usr/lib/qmodem}"
QMODEM_BIN_DIR="${QMODEM_BIN_DIR:-/usr/bin}"
QMODEM_SBIN_DIR="${QMODEM_SBIN_DIR:-/usr/sbin}"

QMODEM_CACHE_DIR="${QMODEM_CACHE_DIR:-/tmp/qmodem-cache}"
QMODEM_LOCK_DIR="${QMODEM_LOCK_DIR:-$QMODEM_CACHE_DIR/locks}"
QMODEM_STATS_DIR="${QMODEM_STATS_DIR:-/etc/qmodem-stats}"

# 锁的最长持有时间（秒）：超过即视为持有者已死，允许强抢，避免死锁
QMODEM_LOCK_MAX_AGE="${QMODEM_LOCK_MAX_AGE:-120}"

# ------------------------------------------------------------------ 目录/工具

qm_init_dirs() {
	[ -d "$QMODEM_CACHE_DIR" ] || mkdir -p "$QMODEM_CACHE_DIR" 2>/dev/null
	[ -d "$QMODEM_LOCK_DIR" ] || mkdir -p "$QMODEM_LOCK_DIR" 2>/dev/null
	[ -d "$QMODEM_STATS_DIR" ] || mkdir -p "$QMODEM_STATS_DIR" 2>/dev/null
	return 0
}

qm_now() {
	date +%s 2>/dev/null || echo 0
}

qm_log() {
	logger -t qmodem-generic "$*" 2>/dev/null || true
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

# ------------------------------------------------------------------ 状态信封

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

		# 持有时间超限 → 强制回收（防止进程被 kill 后锁永久残留导致死锁）
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
	return 0
}
