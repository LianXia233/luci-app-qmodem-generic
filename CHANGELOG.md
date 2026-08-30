# 更新日志 / Changelog

本文件记录 `luci-app-qmodem-generic` 的版本变更。版本号格式为
`v<PKG_VERSION>-<PKG_RELEASE>-build<运行号>`，与 GitHub Actions 自动发布的 Release 对应。

## [2.4.11-12] - 2026-08-30

### 新增
- **模组支持库自动注入（Quectel RG520N-CN）**：QModem 通过 `/usr/share/qmodem/modem_support.json` 识别模组型号，未收录的型号不会生成 `modem-device`，LuCI 里也就看不到该模组。RG520N-CN（VID `2c7c` / USB 接口 / 高通平台）在部分 QModem 版本中正属此列，以往只能手工 `vi` 编辑支持库。现提供完整的自动链路：
  - 内置定义 `root/usr/share/qmodem-generic/extra_modem_support.json`（`usb.rg520n-cn`：WCDMA `1/8`、LTE `1/3/5/8/34/38/39/40/41`、NR NSA/SA `1/8/28/41/78`、modes `qmi/gobinet/ecm/mbim/rndis/ncm`），字段与缩进同 QModem 上游条目完全一致。
  - 合并脚本 `/usr/sbin/qmodem-modem-support`（POSIX sh，不依赖 jq/python）：按 `usb` / `pcie` 分组定位、幂等跳过已有型号、写入前生成 `.bak` 备份、写入后校验（`jsonfilter` 可用时按 JSON 解析校验）失败自动回滚、目录锁防并发、QModem 未安装（支持库不存在）时静默退出 0。
  - 开机服务 `/etc/init.d/qmodem-modem-support`（`START=90`，早于 QModem 自身启动）；首次安装由 `uci-defaults` 立即执行一次。
  - rpcd 插件 `qmodem_support`（`status` / `sync`）并在 ACL 放行；LuCI「高级」页新增「模组支持库」卡片：显示支持库路径、内置型号、已入库状态，支持一键同步，**未识别到模组时同样可见**（否则「未收录」时用户反而看不到注入入口）。

### 变更
- `controls.js` 新增 `getSupportStatus()` / `syncSupport()`；`advanced.js` 的 `load()` 改为并行获取支持库状态与模组配置节。
- `Makefile` 的 `postinst` 增加新脚本/服务的权限与 `enable`，`PKG_RELEASE` 11 → 12。
- po/zh_Hans 补充新增界面文案翻译（16 条）。

### 验证
- 以上游 QModem 当前 `modem_support.json`（usb 89 / pcie 40 / device 8 条）为样本：注入后 JSON 合法、`rg520n-cn` 落在 `usb` 组且字段与预设一致、`pcie` / `device` 组不受影响、文本差异仅 19 行新增、其余字节零改动；重复运行幂等跳过；支持库缺失 / 损坏 / 已收录 / 内置定义缺失 / 并发加锁五种边界场景行为均符合预期。

## [2.4.11-11] - 2026-08-26

### 修复
- **无线策略卡片当前状态高亮行**（网络页 `network.js` + `controls.js`）：
  「网络模式」卡片新增「当前制式」高亮行、「网络优选」卡片新增「当前优选」
  高亮行（浅蓝底强调条），与原有「当前模式 / 复选框勾选」并存，一眼看清当前
  拨号模式与允许驻网的制式，不再只依赖按钮/复选框状态。
- **无线状态·频段锁定排版重做**（网络页 `network.js`）：
  - 「无线状态」面板的频段锁定行由大段逗号文本改为**按制式分组的频段芯片**
    （每组一个类别标签 + 已锁定频段号芯片 + 可用频段数），31 个 LTE 频段、
    19 个 NR 频段一目了然，不再换行混乱。
  - **类别键完全兼容 QModem 各 vendor**：`get_lockband` 返回的类别键不统一
    （GW / UMTS / LTE / Lte / NR / NR_NSA / NRNSA / NR_SA / NRSA 等），
    全部映射为友好中文标签，并按 3G → 4G → 5G 顺序展示，未知类别排最后。
  - 频段锁定操作面板同步改为**芯片式网格**（紧凑自适应列）：选中高亮边框、
    标题显示可用总数、右上角实时「已选 N / M」计数，全选/清空即时刷新高亮；
    频段号按数值升序排列。
- 实测 FM350-GL（Fibocom）：UMTS 5 / LTE 31 / NR 19 三类正常分组渲染，
  锁定状态与 QModem 上报一致。

## [2.4.11-10] - 2026-08-26

### 新增
- **流量统计全面重做：本机持久化分天记录**（概览页流量卡片 + 后端新服务）：
  - **数据不再依赖页面打开**：新增 procd 服务 `qmodem-stats-collect`
    （`/usr/bin/qmodem-stats-loop` 每 60 秒驱动 `/usr/bin/qmodem-stats-collect run`），
    开机即后台采样，无论 LuCI 是否打开都不漏记。
  - **重启不丢失**：记录落盘于 overlay 持久分区 `/etc/qmodem-stats/<配置节>.stats`，
    实机重启验证数据完好；自动保留最近 90 天。
  - **按中国时区（UTC+8）切日**：日期边界由 epoch+28800 计算（awk strftime UTC），
    不受路由器系统时区影响；跨零点采样的增量归属相邻日。
  - **上下行方向自动识别，兼容所有模组**：正常模组 rx(下行) 远大于 tx(上行)；
    个别驱动把两个计数器接反。累计流量超过 50MB 且 tx > rx 时判定方向颠倒，
    输出以 `swapped=1` 标记，前端自动交换下载/上传显示并给出提示。
    计数器来源链：QModem `get_stats`（available=1 时）→ 内核 netdev
    `/sys/class/net/<dev>/statistics/*_bytes` 兜底，未实现 get_stats 的模组同样可用。
  - **计数器回绕保护**：模组重拨 / 驱动重置导致计数变小（或清零）时按新值起算，
    不会误录巨额增量。
  - 前端流量面板改为「今日下载 / 今日上传 / 本机累计」三卡 + 最近 14 天每日
    双行条形图（下行蓝 / 上传绿，含今天），全部来自本机持久化记录。
- **手动立即清零同步本地记录**：「立即清零流量统计」在 QModem 模组侧清零
  （部分模组不支持时跳过）之外，同时调用新的 rpcd 方法 `qmodem_stats.stats_reset`
  清零本机累计与分天记录；清零保留当前计数器基准，之后不会把清零前的差额
  误记为新流量。

### 变更
- rpcd 新增插件 `qmodem_stats`（`daily_stats` / `stats_history` /
  `stats_reset` 三个方法），ACL 同步放行；`.gitignore` 放行包内
  `root/usr/bin/` 安装脚本目录。
- po/zh_Hans 补充新增界面文案翻译（今日下载/上传、方向反转提示、首日说明、
  清零确认等）。

## [2.4.11-9] - 2026-08-26

### 修复
- **移动数据连接状态误报"未连接"**（概览页 `status.js` / 连接页 `connection.js`）：
  ECM/RNDIS/NCM 等内置自动拨号模组的 `get_connect_status` 可能恒报 `No`，但
  接口已获取全局地址、实际有网。原逻辑以 `||` 串接各来源原始值——`"No"` 也是
  真值字符串，串接会令后面的 `"Yes"` 失效，导致明明有网却显示「移动数据未连接」。
  现改为多来源综合判定（`controls.js` 新增 `evalConnectionStatus()`）：
  ① netifd 接口 up 且持有全局地址（IPv4 任一；IPv6 排除 `fe80::/10` 链路本地）
  为最强证据 → ② 模组 AT 自报 `connect_status` → ③ QModem 拨号状态，
  任一命中即判已连接，并记录采信来源。
- **肯定写法归一化**：新增 `isConnectedValue()` 统一识别 `yes` / `y` / `1` /
  `true` / `connected` / `online` / `connect` / `已连接` 等变体（忽略大小写与
  首尾空白）；新增 `hasGlobalAddress()` 判定接口地址有效性。
- 实机验证（FM350-GL，RNDIS 模式）：接口 `10.5.220.69/24` + 全局 IPv6 下，
  概览页顶部横幅、连接徽标与移动数据页均正确显示「已连接」。

## [2.4.11-8] - 2026-08-25

### 修复
- **SIM 与签约卡片"QoS Level"行不再消失**：改为常显——模组上报 QCI/5QI 时展示
  映射等级（含 Non-GBR / GBR 说明），无法获取时显示 `--`，不再整行隐藏。

### 变更
- **QModem 侧 QCI 扫描范围扩大**：`QCI` / `5QI` 键现于全部 modem_info 数组
  （network_info / base_info / cell_info / sim_info）中查找，任一来源命中即优先采用。
- **AT 探测链新增 Neoway C5GQOSRDP**（位于 CGEQOSRDP 之后、CGCONTRDP 之前）：
  返回 `+C5GQOSRDP: <cid>,<5QI>,...,<DL_SAMBR>,<UL_SAMBR>`，同时提供 5QI 与
  签约速率，提升对 Neoway 系模组的兼容性。

## [2.4.11-7] - 2026-08-25

### 新增
- **载波状态卡片新增上下行调制显示**：rpcd 插件 `qos` 新增 `radio_info` 方法——
  解析 Fibocom 系 `AT+GTCAINFO?` 的 PCC 行（band 编码 `50x`=NR x / `101+N`=LTE N、
  MIMO 层数、调制枚举 0=BPSK…4=256QAM）与 Quectel 系 `AT+QNWCFG="nr5g_csi"`
  （下行 PDSCH MCS）。前端以「NR · MCS 20 · 64QAM」样式渲染上/下行调制磁贴，
  MCS 与调制任一缺失自动省略对应段。实测 FM350-GL：下行 NR · QPSK、
  上行 NR · 64QAM（DL MIMO 3 层 / UL MIMO 2 层）。

### 变更
- **QoS Level 与签约速率数据源优先级**：优先读取 QModem `network_info` 上报的
  `AMBR UL` / `AMBR DL`（vendor 脚本口径，单位 Mbps，前端 ×1000 换算 kbps）
  与 `QCI` / `5QI` 键（Quectel / Meig / Neoway 等已导出）；缺失时回退 AT 探测
  插件（rpcd `qos qos_info`），仍无则显示 `--`。

## [2.4.11-6] - 2026-08-25

### 修复
- **SIM 与签约卡片全模组通用**（概览页 `status.js`）：
  - 运营商：原先仅依赖小区 MCC/MNC，现增加模组上报的运营商名称回退链
    （sim_info/network_info 的 `ISP` / `operator` / `Operator` 键），经新增
    `cleanText()` 清洗换行与控制字符（实测 FM350-GL 的 ISP 值为 `"\nCHINA MOBILE"`）
    后由 `operatorInfo()` 关键字映射，无 MCC/MNC 也能显示真实运营商。
  - 接入技术：`network_mode` 之外回退各信息源的 `Network Type` /
    `Radio Access Technology` 键（不同模组上报字段名不一）。
  - APN：UCI 配置值之外回退 QoS 上报（AT+CGCONTRDP 解析结果）与网络信息的 `APN` 键。
  - 电话号码：多键探测（`SIM Number`/`MSISDN`/`Phone Number`），SIM 未存储号码时
    显示 `--`，不再依赖单一字段名。
- **签约速率 / QCI 无数据**：rpcd 插件 `/usr/libexec/rpcd/qos` 在 git 索引中为
  644（不可执行），rpcd 从未加载该插件、`qos` ubus 对象不存在。现索引权限改为
  100755，并在 uci-defaults 与 postinst 双保险 chmod 755。

### 变更
- **qos rpcd 插件重写为通用探测链**：依次探测标准 3GPP AT 命令
  `AT+CGEQOSRDP=<cid>`（直接返回 QCI 与 kbps 计 AMBR，Quectel 等多数模组支持）
  → `AT+CGCONTRDP`（兜底解析 APN 与引号内 `"UL,DL"` 形式 AMBR，适配部分
  MTK/Fibocom 固件）；均不支持时返回 `status=no_data`，UI 显示 `--`，绝不伪造数值。
  实测 FM350-GL 经 CGCONTRDP 兜底成功取得签约速率（DL≈262 Mbps / UL≈64 Mbps）。
- 概览页 `load()` 额外下发 `net`（getNetworkInfo）供各通用回退链使用；
  QCI 为 0 时不再显示"QCI 0 自定义承载"占位。

### 文档
- `docs/QMODEM_REFACTOR_CONTRACT.md` §3 补充运营商/接入技术/APN/签约速率的
  通用解析链说明；`docs/QMODEM_GENERIC_UI_REPORT.md` 新增本轮改动记录。

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
