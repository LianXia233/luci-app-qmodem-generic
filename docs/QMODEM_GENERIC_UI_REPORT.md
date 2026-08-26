# QModem 通用美化版 UI 重构与自我审查报告

## 概述（Executive Summary）

本次工作在上一轮「luci-app-mt5700m → QModem 兼容」重构的基础上，按用户最新要求把整套界面**从「MT5700M 专用」升级为「QModem 通用美化版 UI」**：界面不再绑定任何具体模组型号，而是**完全按 QModem 实际识别到的模组、实际返回的 `modem_info` 字段与能力来渲染**——QModem 支持什么，界面就显示什么。

核心改动有三处：(1) 在共享数据层 `controls.js` 中移除 `resolveSection()` 对 `mt5700m` 型号的偏好，改为通用解析并新增「模组选择器 / 同步列表 / 按 class 分组渲染全部字段」等通用辅助；(2) 把概览页 `status.js` 改写为真正的通用美化总览——标题显示实际型号、新增「完整信息」面板按 QModem 返回的类别动态铺开所有字段；(3) 其余 7 个视图全部接入模组选择器并去除硬编码的「MT5700M」文案。自我审查（9 个 JS 文件 `node --check` 语法校验 + 全量「MT5700M」字面量检索）全部通过。

## 背景（Background）

原仓库 `luci-app-mt5700m` 是鼎桥 MT5700M 的专用管理界面，依赖私有文本后端 `/usr/sbin/mt5700m-at`。上一轮重构已把所有数据来源与动作链路切到 QModem 的 `qmodem` ubus 对象，但 `resolveSection()` 仍写死了「优先选 model 含 `mt5700m` 的配置节」，且部分文案、标题、空状态提示仍写死「MT5700M」。用户指出：本包应作为 QModem 的**美化版 UI**，对任意 QModem 管理的模组生效，按 QModem 实际返回的型号与信息显示，不限于 5700。

参考实现为 QModem 官方 `luci-app-qmodem-next`：其 `overview.js` 从 UCI `modem-device` 配置节读取模组列表渲染下拉选择器，并把 `base_info / sim_info / network_info / cell_info` 的 `modem_info` 数组合并按 `class` 分组、逐类渲染（不写死字段）。本重构沿用这一权威模式。

## 主要改动（Main Body）

### 1. 数据层 controls.js（通用化基础）

- **移除型号偏好**：原 `resolveSection()` 用 `hay.indexOf('mt5700m')` 优先挑选 MT5700M，现改为「优先采用用户上次在模组选择器中的选择（`localStorage` 持久化），否则回退到第一个启用模组」，全程不判断型号。
- **模组选择器与列表**：新增 `getModemSectionsSync()`（在 `load` 之后、`render` 内同步读取 UCI 列表，避免再次异步加载）、`getModemList()`（仅返回已启用且带 AT 端口的模组，与 QModem-next 判定一致）、`getStoredSection()/setStoredSection()`、`renderModemBar(sections, currentId, onSwitch)`（多于一个模组时渲染美化下拉框，切换即持久化并刷新）。
- **按 class 动态渲染「全部信息」**：新增 `groupByClass(entries)` 与 `renderInfoGrouped(entries)`，把 QModem 返回的 `modem_info` 按 `class` 分组、逐类生成美化卡片——这是「QModem 支持什么就显示什么」的关键机制。
- **信号分级**：新增 `formatSignal(value, type)`，与 QModem-next 一致给出 优/良/中/差 文案。
- 文件头注释、导出表同步更新，新增 CSS（`.mt-modem-bar` 选择器、`.mt-info-card` 分组卡片）。

### 2. 概览页 status.js（美化版通用总览，核心交付）

- `load()` 中先 `getModemSections()` 记录 `self.modems`，并在原数据之外额外 `getNetworkInfo()` 并合并 `base+cell+sim+network` 为 `allInfo`。
- 标题不再写死「MT5700M Module」，改为显示 QModem 返回的实际 `name`（兜底「Modem」）；型号徽标兜底同样改为「Modem」。
- 顶部接入模组选择器：多模组时渲染下拉框，切换即 `setStoredSection` + 刷新。
- 新增**「完整信息（Full module information）」**区块，调用 `controls.renderInfoGrouped(res.allInfo)` 把 QModem 返回的全部字段按类别铺开——无论模组型号如何，界面都不会遗漏 QModem 上报的任何信息。
- 流量面板提示由「huawei 未实现 usage_stats」改为厂商无关表述「部分模组驱动未实现 usage_stats」；空状态提示改为通用「未检测到模组…」。

### 3. 其余 7 个视图（通用化 + 选择器）

`network.js / connection.js / system.js / sms.js / terminal.js / settings.js / advanced.js` 均由子代理并行改写：
- 每个 `render()` 顶部接入 `renderModemBar(getModemSectionsSync(), res.section, onSwitch)`，多模组时出现选择器、切换即持久化刷新；
- 删除所有用户可见的「MT5700M / mt5700m-cn」字面量（标题、kicker、空状态、描述、CLI 控制台名、型号兜底字符串等），改为实际型号或「模组 / 模块 / Modem」等通用词；
- 将 `huawei 经 QModem…` 注释/提示重写为厂商无关表述；
- 保留全部 `controls.<方法>(section)` 调用、`getDisabledFeatures` 能力门控（锁频 / 邻区隐藏等）、`form.Map('qmodem', section)` 用法与全部 CSS 类名——即只改「展示对象与文案」，不改数据链路与逻辑。

### 4. 工程文件

- `Makefile`：`LUCI_TITLE` 由「MT5700M module management (QModem compatible)」改为「Modem management (QModem beautified UI)」，注释改为「对任意 QModem 支持的模组生效」。
- `QMODEM_REFACTOR_CONTRACT.md`：标题、§0、§1、§2、§3、§5 全部改为通用表述，并补充新通用辅助 API。

### 5. SIM 与签约信息全模组通用化 + 接口地址修复（2026-08-25）

实测 FM350-GL（Fibocom/MTK 平台）时发现概览页「SIM 与签约」卡片多处空值、连接页 IP 不显示，根因均为**数据源解析与模组型号耦合**。本轮全部下沉为通用数据链：

- **IPv4/IPv6 地址不显示**：前端原调用 `network.interface status {interface:...}`——netifd 的裸 `network.interface` 对象只有 `dump` 方法，该调用恒定失败；接口名又误用 qmodem 配置的 `name`（模组型号）。现改用 `network.interface dump` 批量获取，新增 `controls.getModemInterfaces(section)` 按 ① `/etc/config/network` 的 `modem_config` 关联 → ② 同名/`v6` 后缀 → ③ 物理网口 三级策略自动解析任意模组的 v4/v6 逻辑接口并合并地址视图。
- **运营商**：原先仅依赖小区 MCC/MNC；现增加 SIM/网络信息上报的运营商名称（`ISP` 等键）回退链，经新增 `cleanText()` 清洗换行/控制字符（如 `"\nCHINA MOBILE"`）后由 `operatorInfo()` 关键字映射，无 MCC/MNC 也能显示真实运营商。
- **接入技术**：`network_mode` 之外回退各信息源的 `Network Type` / `Radio Access Technology` 键。
- **APN**：UCI 配置值之外回退 QoS 上报与网络信息的 `APN` 键。
- **电话号码**：多键探测（`SIM Number`/`MSISDN`/`Phone Number`），SIM 未存储号码时诚实显示 `--`。
- **签约速率 / QCI**：修复 rpcd 插件 `/usr/libexec/rpcd/qos` 权限为不可执行导致 ubus 对象从未加载的问题（git 索引改为 100755，uci-defaults/postinst 双保险 chmod）；脚本重写为通用探测链 `AT+CGEQOSRDP=<cid>` → `AT+CGCONTRDP`（解析 APN 与引号内 `"UL,DL"` 形式 AMBR），模组不支持时返回 `no_data`、UI 显示 `--`，绝不伪造数值。
- ACL 增加 `network.interface dump` 权限。

### 6. QoS/签约速率优先走 QModem + 载波调制显示（2026-08-25 第二轮）

- **QoS Level 与签约速率数据源优先级调整**：优先读取 QModem `network_info` 上报的
  `AMBR UL` / `AMBR DL`（vendor 脚本口径，单位 Mbps，前端换算 kbps）与 `QCI` / `5QI`
  键（Quectel / Meig / Neoway 等已导出）；仅当缺失时回退 AT 探测插件，仍无则显示 `--`。
- **载波卡片新增上下行调制显示**：rpcd 插件 `qos` 新增 `radio_info` 方法——
  解析 Fibocom `AT+GTCAINFO?` 的 PCC 行（band 编码 `50x`=NR x、`101+N`=LTE N；
  MIMO 层数；调制枚举 0=BPSK…4=256QAM）与 Quectel `AT+QNWCFG="nr5g_csi"`
  （下行 PDSCH MCS），前端在载波状态卡片渲染
  「上行调制 NR · MCS 20 · 64QAM / 下行调制 NR · MCS 0 · QPSK」样式的磁贴，
  MCS 与调制任一缺失自动省略对应段。实测 FM350-GL（n41/100MHz）：下行 QPSK、上行 64QAM、DL MIMO 3 层 / UL MIMO 2 层。

### 7. 流量统计重做：本机持久化分天记录 + 方向自动识别（2026-08-26 第三轮）

用户反馈概览页流量卡片「上下行统计相反」，并要求：兼容识别所有模组、数据重启不丢失、
每天单独记录、按中国时区切日、支持定时自动清零与手动立即清零。实测确认内核 netdev
计数方向正确（rx=下行），「相反」源于个别模组驱动把两个计数器接反——因此不做全局字段
翻转，而是**逐模组自动识别**。本轮交付：

- **后台采集服务**（新增 4 个后端文件）：
  - `/usr/bin/qmodem-stats-collect`：单次 `run <节>`（采样+落盘+输出 JSON）、`show`（只读）、
    `reset`（清零）。计数器来源链：ubus `qmodem get_stats`（available=1）→ 内核 netdev
    `/sys/class/net/<dev>/statistics/*_bytes` 兜底，全模组通用；同日采样做差累计，新值小于
    旧值视为回绕/重拨、按新值起算；跨零点采样的增量归属相邻日。
  - `/usr/bin/qmodem-stats-loop <节> [间隔]`：常驻循环，默认 60 秒。
  - `/etc/init.d/qmodem-stats-collect`：procd 服务（START=97），为每个启用的 modem-device
    配置节启动一个循环实例——**开机即采样，不依赖 LuCI 页面打开**。
  - `/usr/libexec/rpcd/qmodem_stats`：rpcd 插件，暴露 `daily_stats` / `stats_history` /
    `stats_reset` 三个方法（ACL 已放行）。
- **持久化与切日**：记录写 overlay 持久分区 `/etc/qmodem-stats/<节>.stats`
  （键值格式：last_ts/last_rx/last_tx/total_rx/total_tx/swapped + day_<日期>=rx / dayx_<日期>=tx），
  自动保留最近 90 天；日期边界用 epoch+28800（awk strftime UTC）计算，不受系统时区影响。
  脚本兼容 dash/busybox ash（日期键经连字符→下划线转换后再作变量名），jshn.sh 缺失时
  内置纯 shell JSON 生成器兜底。
- **上下行方向自动识别**：累计流量 >50MB 且 tx > rx 时判定该驱动上下行接反，置
  `swapped=1`；前端据此交换今日下载/上传、历史条形图与累计拆分的显示，并提示
  「模组驱动上报的上下行计数相反，已自动交换」。
- **前端流量面板重写**（`status.js trafficPanel(usage, iface, daily)`）：三卡改为
  「今日下载 / 今日上传 / 本机累计（下载 · 上传拆分）」+ 最近 14 天每日双行条形图
  （下行蓝 / 上传绿，含今天一行），全部来自本机分天记录；今天尚无完整记录时给出
  「明天出现第一个完整自然日记录」说明。`load()` 第 13 个 Promise 接入
  `controls.getDailyStats(section)`。
- **清零链路**：「立即清零流量统计」= 模组侧 `clearStats`（部分模组不支持则跳过）
  → 本机 `statsReset`（rpcd `qmodem_stats.stats_reset`），两步串行执行；本机清零保留当前
  计数器基准，之后不会把清零前的差额误记为新流量。「定时自动清零」沿用 QModem 原生
  计划任务能力不变。
- **实机验证**（FM350-GL / RNDIS）：60 秒采样周期下 ~6MB 真实下载准确入账；清零后立即
  采样无误录增量；注入历史数据后整机重启，`/etc/qmodem-stats/` 数据完好、服务自启、
  分天记录正常输出；LuCI 会话经 ACL 可调用新 rpcd 方法。

## 分析与综合（Analysis / Synthesis）

本轮重构的本质是把「型号特例」下沉为「数据驱动」。QModem 的契约是：信息方法统一返回 `{ modem_info: [{ key, value, full_name, type, class, extra_info }] }`。只要 UI 不复读具体 key、不假设型号，而是 (a) 通用解析配置节、(b) 按 `class` 分组渲染全部字段、(c) 按 `getDisabledFeatures` / `get_mode` / `get_lockband` 的实际返回做能力门控，就能天然适配 QModem 管理的任意模组——这正是 QModem-next 的做法，本包沿用了同一模式并叠加了更精致的卡片视觉。

需要注意的取舍：模组选择器切换采用「持久化 + 整页刷新」而非就地重渲染。对概览/数据页这会带来一次刷新（可接受），对表单页（设置/连接/网络/系统/高级）则能避免 `form.Map` 的就地重渲染风险，是最稳妥的通用方案。单模组设备上 `renderModemBar` 返回 `null`，界面不出现多余控件。

## 结论（Conclusion）

本包现已是**完全通用的 QModem 美化版 Web UI**：不绑定 MT5700M，对所有 QModem 识别到的模组生效；显示内容严格来自 QModem 实际返回——标题显示真实型号，总览页「完整信息」面板按类别铺开 QModem 上报的全部字段，特性按能力门控显示/隐藏，多模组时通过顶部选择器一键切换。所有显示与控制均经 `qmodem` ubus，旧的 `mt5700m-at` 文本后端已无残留引用。

## 自我审查结果（Self-Review）

- **语法校验**：`controls.js` 与 8 个视图共 9 个 JS 文件全部 `node --check` 通过（OK）。
- **字面量检索**：全量大小写不敏感检索 `MT5700M`，已无**用户可见**字面量残留；仅剩 `require mt5700m.controls` 模块路径、路由 `admin/modem/mt5700m/*`、CSS 类名 `mt5700m-*` 等非展示性引用（保留，改之会破坏加载/导航/样式）。
- **辅助连线**：`controls.js` 中 `getModemSectionsSync / renderModemBar / renderInfoGrouped / groupByClass / formatSignal / getStoredSection / setStoredSection` 均已定义并导出；8 个视图均实际调用 `renderModemBar` 与 `getModemSectionsSync`；`resolveSection()` 中已无任何 `mt5700m` 型号偏好判断。
- **逻辑保真**：能力门控（`getDisabledFeatures` / `get_mode` / `get_lockband`）、`controls.*` 调用链、表单 `form.Map('qmodem', section)`、CSS 类名均未改动。

## 局限与后续（Limitations / Next）

- 当前未做 OpenWrt 真实固件编译与浏览器实跑验证（沙箱无目标环境）；语法与结构审查已通过，但运行期渲染建议在实际设备上最终确认。
- `sms.js` 的导入/导出文件名与 `localStorage` 键仍含 `mt5700m-` 前缀（为兼容既有备份，未改名）；如需彻底去品牌，可后续单独迁移。
- 「完整信息」面板为通用铺开，未做字段翻译映射；如希望某些 `full_name` 中文化，可在 `po/zh_Hans/mt5700m.po` 中补充。

## 参考（References）

- [QModem 官方仓库（luci-app-qmodem-next，模组选择器与按 class 渲染的权威实现）](https://github.com/FUjr/QModem)
- [QModem 用户指南](https://github.com/FUjr/QModem/blob/main/docs/user-guide.zh-cn.md)
- 本包重构产物：`/workspace/mt5700m-src/luci-app-mt5700m/`
  - `htdocs/luci-static/resources/mt5700m/controls.js`（通用数据层 + 选择器 + 分组渲染）
  - `htdocs/luci-static/resources/view/mt5700m/status.js`（通用美化总览 + 完整信息面板）
  - `htdocs/luci-static/resources/view/mt5700m/{network,connection,system,sms,terminal,settings,advanced}.js`（已通用化并接入选择器）
  - `Makefile`、`QMODEM_REFACTOR_CONTRACT.md`（同步更新为通用表述）
