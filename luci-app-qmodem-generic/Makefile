include $(TOPDIR)/rules.mk

# 本项目是 QModem 的通用美化版 Web UI：所有界面数据均通过 QModem 的 `qmodem`
# ubus 对象读取，对任意 QModem 支持的模组生效（不绑定特定型号，如 MT5700M）。
# 因此运行时依赖 qmodem，不再依赖 ubus-at-daemon / sms-tool_q / mt5700m-at。
#
# 保留关闭 JS 压缩：本包视图使用较新的 JS 语法（箭头函数、模板字符串等），
# 关闭 jsmin 可避免部分模式被误改写导致运行时白屏。
LUCI_MINIFY_JS:=0

PKG_NAME:=luci-app-qmodem-generic
PKG_VERSION:=2.4.11
PKG_RELEASE:=17
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233

LUCI_TITLE:=Modem management (QModem beautified UI)
LUCI_DESCRIPTION:=Generic beautified LuCI Web UI for any modem managed by QModem. \
	All data is read through the `qmodem` ubus object, so it is not bound to a \
	specific module model.
# 兼容基线：OpenWrt / ImmortalWrt 25.12 及更新版本（不再支持 24.10 及更早）。
# 注意：OpenWrt buildroot 的 DEPENDS 不支持 `(>= 版本)` 约束语法（package-metadata.pl
# 会把 `(>=` / `25.12)` 当作不存在的包名，导致 make defconfig 失败），因此 25.12+
# 基线由 CI 编译矩阵（仅 25.12 + snapshot）与文档强制，此处保持无版本约束写法。
LUCI_DEPENDS:=+luci-base +qmodem
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# 确保 rpcd 脚本、uci-defaults 钩子、MT5700 修复脚本/服务、模组支持库同步
# 脚本/服务、流量统计采集服务具有执行权限并注册 ubus 服务。
#
# 重要：本包随固件镜像打包时 postinst 不会被执行，镜像里的文件会保持源码
# 自身的权限位。因此这些脚本在仓库中必须以 100755 提交——否则 /usr/sbin 下
# 的脚本会落地成 0644，rpcd 的 [ -x ] 判定与 procd 启动都会失败，「模组
# 支持库」卡片会误报「未检测到 QModem 的模组支持库」。下面的 chmod 只是
# 通过包管理器安装时的兜底，不能作为唯一保障。
# postinst 必须快速返回：安装过程是同步的，任何耗时操作都会拖慢 opkg/apk
# 以及紧随其后的 LuCI 可用性。因此这里只补权限 + enable 服务，
# 模组支持库合并放后台，modem 探测完全交给 qmodem-worker 后台服务。
define Package/luci-app-qmodem-generic/postinst
#!/bin/sh
for f in \
	/usr/libexec/rpcd/qos \
	/usr/libexec/rpcd/qmodem_stats \
	/usr/libexec/rpcd/qmodem_support \
	/usr/libexec/rpcd/qmodem_cache \
	/usr/bin/qmodem-stats-collect \
	/usr/bin/qmodem-stats-loop \
	/usr/bin/qmodem-task \
	/usr/sbin/qmodem-mt5700-fix \
	/usr/sbin/qmodem-modem-support \
	/usr/sbin/qmodem-worker \
	/usr/lib/qmodem/qmodem-at-probe \
	/etc/init.d/qmodem-mt5700-fix \
	/etc/init.d/qmodem-modem-support \
	/etc/init.d/qmodem-stats-collect \
	/etc/init.d/qmodem-worker \
	/etc/uci-defaults/99_luci-app-qmodem-generic
do
	[ -f "$$f" ] && chmod 755 "$$f" 2>/dev/null
done

mkdir -p /etc/qmodem-stats 2>/dev/null || true
mkdir -p /tmp/qmodem-cache 2>/dev/null || true

# 模组支持库合并（幂等、纯文件操作）：放后台，不阻塞安装
if [ -x /usr/sbin/qmodem-modem-support ]; then
	( /usr/sbin/qmodem-modem-support >/dev/null 2>&1 & ) 2>/dev/null
fi
/etc/init.d/qmodem-modem-support enable 2>/dev/null || true

/etc/init.d/qmodem-stats-collect enable 2>/dev/null || true
/etc/init.d/qmodem-worker enable 2>/dev/null || true

# rpcd 需要重启才会加载新的 qmodem_cache 插件
/etc/init.d/rpcd restart 2>/dev/null || true
# 采集服务立即拉起（start 只向 procd 注册实例，不做任何 modem 探测）
/etc/init.d/qmodem-worker start 2>/dev/null || true
/etc/init.d/qmodem-stats-collect start 2>/dev/null || true
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
