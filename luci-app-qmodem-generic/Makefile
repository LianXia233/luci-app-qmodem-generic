include $(TOPDIR)/rules.mk

# 本项目是 QModem 的通用美化版 Web UI：全部数据与控制动作直连 QModem 官方的
# `qmodem` / `qmodem.sms` / `qmodem.uplink` ubus 接口（与官方 luci-app-qmodem-next
# 相同的接线方式），对任意 QModem 支持的模组生效，不绑定特定型号。
# 本包不再携带任何私有 rpcd 插件或后台守护进程，运行时依赖 qmodem。
#
# 保留关闭 JS 压缩：本包视图使用较新的 JS 语法（箭头函数、模板字符串等），
# 关闭 jsmin 可避免部分模式被误改写导致运行时白屏。
LUCI_MINIFY_JS:=0

PKG_NAME:=luci-app-qmodem-generic
PKG_VERSION:=3.0.0
PKG_RELEASE:=2
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233

LUCI_TITLE:=Modem management (QModem beautified UI)
LUCI_DESCRIPTION:=Generic beautified LuCI Web UI wired entirely to the official \
	QModem ubus interfaces (qmodem, qmodem.sms, qmodem.uplink). No private \
	rpcd plugins or daemons are shipped.
# 兼容 23.05 / 24.10 的 opkg/IPK 与 25.12+ 的 apk；依赖由各版本 SDK 解析。
# jq/jsonfilter 为模组支持库与流量统计脚本直接使用，显式声明。
LUCI_DEPENDS:=+luci-base +qmodem +jq +jsonfilter
LUCI_PKGARCH:=all

# 除 LuCI 资源外，本包附带两个后台组件（均只依赖 QModem 官方接口）：
#   * 分天流量统计：rpcd 只读插件 + 60 秒周期采样服务（qmodem get_stats）
#   * 模组支持库：rpcd 插件 + 支持库合并服务（官方 modem_support.json 注入）
# 确保它们具有执行权限并注册 ubus 服务。
#
# 重要：本包随固件镜像打包时 postinst 不会被执行，镜像里的文件会保持源码
# 自身的权限位。因此这些脚本在仓库中必须以 100755 提交——否则脚本会落地成
# 0644，rpcd 的 [ -x ] 判定与 procd 启动都会失败。下面的 chmod 只是通过包
# 管理器安装时的兜底，不能作为唯一保障。
# postinst 必须快速返回：安装过程是同步的。这里只补权限 + enable 服务，
# 模组支持库合并放后台。
define Package/luci-app-qmodem-generic/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0
for f in \
	/usr/libexec/rpcd/qmodem_stats \
	/usr/libexec/rpcd/qmodem_support \
	/usr/bin/qmodem-stats-collect \
	/usr/bin/qmodem-stats-loop \
	/usr/sbin/qmodem-modem-support \
	/usr/sbin/qmodem-support-custom \
	/etc/init.d/qmodem-stats-collect \
	/etc/init.d/qmodem-modem-support \
	/etc/uci-defaults/99_luci-app-qmodem-generic
do
	[ -f "$$f" ] && chmod 755 "$$f" 2>/dev/null
done

mkdir -p /etc/qmodem-stats 2>/dev/null || true
mkdir -p /etc/qmodem-generic/modems/usb /etc/qmodem-generic/modems/pcie 2>/dev/null || true

# 模组支持库合并（幂等、纯文件操作）：放后台，不阻塞安装
if [ -x /usr/sbin/qmodem-modem-support ]; then
	( /usr/sbin/qmodem-modem-support >/dev/null 2>&1 & ) 2>/dev/null
fi
/etc/init.d/qmodem-modem-support enable 2>/dev/null || true
/etc/init.d/qmodem-stats-collect enable 2>/dev/null || true

# rpcd reload 会注册 qmodem_stats / qmodem_support 插件，同时保留 LuCI 登录会话。
rm -f /tmp/luci-indexcache.*
rm -rf /tmp/luci-modulecache/
/etc/init.d/rpcd reload 2>/dev/null || true
# 采样服务立即拉起（start 只向 procd 注册实例，不做任何 modem 探测）
/etc/init.d/qmodem-stats-collect start 2>/dev/null || true
exit 0
endef

# 放在自定义 postinst 之后，确保旧版 luci.mk 在 BuildPackage 时使用本包安装钩子。
include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
