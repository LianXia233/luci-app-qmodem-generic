# 更新日志 / Changelog

本文件记录 `luci-app-qmodem-generic` 的版本变更。版本号格式为
`v<PKG_VERSION>-<PKG_RELEASE>-build<运行号>`，与 GitHub Actions 自动发布的 Release 对应。

## [2.4.11-5] - 2026-08-25

### 修复
- **连接页/概览页 IPv4 与 IPv6 地址不显示**：前端原先调用
  `network.interface status {interface: ...}`，但 netifd 的裸 `network.interface`
  ubus 对象只提供 `dump` 方法（`status` 属于具体的 `network.interface.<name>`
  对象），该调用恒定返回 ubus 错误码 4（方法不存在），导致地址、MTU、协议、
  接口状态全部显示为 `--`。
- **接口名解析错误**：原先以 qmodem 配置节的 `name` 选项（模组型号，如
  `fm350-gl`）推导 netifd 接口名，与 QModem 实际创建的逻辑接口
  （以配置节命名的 `<section>` / `<section>v6`）不匹配。

### 变更
- `controls.js`：改用 `network.interface dump` 批量获取接口状态；新增
  `getModemInterfaces(section)` 按三级策略自动解析任意模组对应的逻辑接口——
  ① `/etc/config/network` 中 `modem_config` 指向该配置节的接口（QModem 标准
  关联方式）；② 回退同名及 `<section>v6` 后缀接口；③ 回退物理网口
  （qmodem `network` 选项）匹配。`getInterfaceStatus()` 现返回 IPv4/IPv6
  双接口合并后的状态视图（地址/前缀/DNS 合并、uptime 取最大、up 取或），
  不绑定任何模组型号。
- `connection.js`：IPv4 取自合并视图的 `ipv4-address`；IPv6 依次回退
  `ipv6-address` → `ipv6-prefix-assignment` → `ipv6-prefix`；MTU 由
  `network.device status` 补齐；QModem DNS 字段的杂散换行数据做清洗，
  缺失时回退接口上报的 `dns-server`。
- `status.js`：概览页"Mobile IP"同样改走配置节自动解析，不再用型号名
  推导接口名。
- ACL（`acl.d/luci-app-qmodem-generic.json`）：`network.interface` 增加
  `dump` 权限。

## [2.4.11-4] - 2026-08-11

### 修复
- **流量统计可用性判定 bug**：概览页（`status.js`）原以 `String(usage.available) !== '1'`
  判定，但 QModem rpcd 文档中 `get_stats` 的 `available` 为布尔 `true`，导致布尔 `true`
  被误判为"本模组未提供流量统计"而不显示计数。现统一支持 `true` / `1` / `'1'` / `'true'`
  四种取值（`isTrafficAvailable()`），与 rpcd 文档、重构契约及本地兜底保持一致。

### 新增
- **流量自动清零计划 UI**：在概览页"流量统计"面板下方新增"流量自动清零"卡片，
  对接 QModem rpcd 的 `get_traffic_reset_schedule` / `set_traffic_reset_schedule`，
  支持启用开关、按月/按日、小时/分钟（每月模式含清零日）的定时自动清零配置。
- 同一卡片提供"立即清零流量统计"动作，对接 `clear_stats`（仅部分模组如 Quectel 可用）。
- 上述控件仅在模组确实支持流量统计（`available` 为真）时展示，对非支持的模组自动隐藏，
  符合防御式渲染规范。

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
