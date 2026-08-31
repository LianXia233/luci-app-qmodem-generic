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
PKG_RELEASE:=13
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233

LUCI_TITLE:=Modem management (QModem beautified UI)
LUCI_DESCRIPTION:=Generic beautified LuCI Web UI for any modem managed by QModem. \
	All data is read through the `qmodem` ubus object, so it is not bound to a \
	specific module model.
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
define Package/luci-app-qmodem-generic/postinst
#!/bin/sh
[ -f /usr/libexec/rpcd/qos ] && chmod 755 /usr/libexec/rpcd/qos
[ -f /usr/libexec/rpcd/qmodem_stats ] && chmod 755 /usr/libexec/rpcd/qmodem_stats
[ -f /usr/libexec/rpcd/qmodem_support ] && chmod 755 /usr/libexec/rpcd/qmodem_support
[ -f /usr/bin/qmodem-stats-collect ] && chmod 755 /usr/bin/qmodem-stats-collect
[ -f /usr/bin/qmodem-stats-loop ] && chmod 755 /usr/bin/qmodem-stats-loop
[ -f /etc/uci-defaults/99_luci-app-qmodem-generic ] && chmod 755 /etc/uci-defaults/99_luci-app-qmodem-generic
[ -f /usr/sbin/qmodem-mt5700-fix ] && chmod 755 /usr/sbin/qmodem-mt5700-fix
[ -f /etc/init.d/qmodem-mt5700-fix ] && chmod 755 /etc/init.d/qmodem-mt5700-fix
[ -f /usr/sbin/qmodem-modem-support ] && chmod 755 /usr/sbin/qmodem-modem-support
[ -f /etc/init.d/qmodem-modem-support ] && chmod 755 /etc/init.d/qmodem-modem-support
# 立即同步一次模组支持库（幂等），并注册开机服务
[ -x /usr/sbin/qmodem-modem-support ] && /usr/sbin/qmodem-modem-support
/etc/init.d/qmodem-modem-support enable 2>/dev/null || true
[ -f /etc/init.d/qmodem-stats-collect ] && chmod 755 /etc/init.d/qmodem-stats-collect
/etc/init.d/qmodem-stats-collect enable 2>/dev/null || true
mkdir -p /etc/qmodem-stats 2>/dev/null || true
/etc/init.d/rpcd restart 2>/dev/null || true
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
