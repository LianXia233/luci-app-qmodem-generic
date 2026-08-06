# 更新日志 / Changelog

本文件记录 `luci-app-qmodem-generic` 的版本变更。版本号格式为
`v<PKG_VERSION>-<PKG_RELEASE>-build<运行号>`，与 GitHub Actions 自动发布的 Release 对应。

## [2.4.11-3] - 2026-08-06

### 修复
- **MT5700 系列模组 SIM 初始化改为开机服务**：将修复逻辑抽离到
  `/usr/sbin/qmodem-mt5700-fix`，新增 `/etc/init.d/qmodem-mt5700-fix`（`START=99`），
  确保**每次开机**都会检查并修复 MT5700 系列模组的 SIM 卡槽初始化
  （向 `pre_dial_at_cmds` 注入 `AT^SCICHG=0,1`）。
- 开机服务额外监听 `qmodem` 配置变更（`procd_add_reload_trigger qmodem`），
  应对模组在更晚阶段才被识别、`/etc/config/qmodem` 才被写入的情况。
- 原 `uci-defaults` 脚本简化为：首次安装时立即执行一次修复，并 `enable` 开机服务。
- `Makefile`：`PKG_RELEASE` 提升到 `3`，`postinst` 为新脚本增加 `chmod 755`。

## [2.4.11-2] - 2026-08-06

### 修复
- 新增 `uci-defaults` 脚本，首次安装时为 `model/name/manufacturer` 匹配 `MT5700`
  的模组自动注入 `AT^SCICHG=0,1` 到 `pre_dial_at_cmds`，并提交 `qmodem` 配置，
  修复上电后 SIM 卡槽未初始化导致 `AT+CPIN?` 返回 `+CME ERROR: 10` 的问题。
- 脚本幂等，重复运行不会重复添加同一命令。

---

> 更早的 Release（`v2.4.0-1-build1` ~ `v2.4.5-1-build4`）为 UI 重构与基础功能版本，
> 已随历史 Release 清理一并归档，详细改动见对应提交历史。
