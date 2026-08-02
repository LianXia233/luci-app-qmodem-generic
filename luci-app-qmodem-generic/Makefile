include $(TOPDIR)/rules.mk

# 本项目是 QModem 的通用美化版 Web UI：所有界面数据均通过 QModem 的 `qmodem`
# ubus 对象读取，对任意 QModem 支持的模组生效（不绑定特定型号，如 MT5700M）。
# 因此运行时依赖 qmodem，不再依赖 ubus-at-daemon / sms-tool_q / mt5700m-at。
#
# 保留关闭 JS 压缩：本包视图使用较新的 JS 语法（箭头函数、模板字符串等），
# 关闭 jsmin 可避免部分模式被误改写导致运行时白屏。
LUCI_MINIFY_JS:=0

PKG_NAME:=luci-app-qmodem-generic
PKG_VERSION:=2.4.2
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233

LUCI_TITLE:=Modem management (QModem beautified UI)
LUCI_DESCRIPTION:=Generic beautified LuCI Web UI for any modem managed by QModem. \
	All data is read through the `qmodem` ubus object, so it is not bound to a \
	specific module model.
LUCI_DEPENDS:=+luci-base +qmodem
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
