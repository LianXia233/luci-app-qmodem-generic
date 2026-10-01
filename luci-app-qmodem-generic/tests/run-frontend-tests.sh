#!/bin/sh
# QModem Generic — LuCI 前端测试包装脚本
#
# 前端测试用 Node 加载真实的 controls.js / 视图模块并驱动它们，
# 需要 node（OpenWrt 设备上没有，CI 上有）。没有 node 时跳过而不是失败。
#
# 用法：sh tests/run-frontend-tests.sh

set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

NODE_BIN=""
for candidate in node nodejs; do
	if command -v "$candidate" >/dev/null 2>&1; then
		NODE_BIN=$candidate
		break
	fi
done

if [ -z "$NODE_BIN" ]; then
	echo "SKIP: 未找到 node，跳过前端测试（仅后端测试生效）"
	exit 0
fi

echo "using $($NODE_BIN --version)"
exec "$NODE_BIN" "$DIR/run-frontend-tests.js" "$@"
