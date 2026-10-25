# 更新日志 / Changelog

本文件记录 `luci-app-qmodem-generic` 的版本变更。版本号格式为
`v<PKG_VERSION>-<PKG_RELEASE>-build<运行号>`，与 GitHub Actions 自动发布的 Release 对应。

## [3.0.0-1] - 2026-10-26

- 全面改为直连 QModem 官方 ubus 接口：移除 qmodem_cache 快照层、qmodem-task 任务队列与 qmodem-worker 采集服务，所有读写与官方 luci-app-qmodem-next 相同地直接调用 `qmodem` / `qmodem.sms` / `qmodem.uplink` 对象（QModem rpcd 自带 10 秒缓存）。
- 补齐此前缺失的官方能力：设备扫描与模组接入（scan_pcie/scan_usb/scan_all、get_available_devices、remove_modem、get_tty_ports）、qmodem_network 拨号服务启停与全局拨号开关、短信守护进程管理（qmodem.sms configure/storage_get/storage_set/同步状态）、PDU 直发（send_raw_pdu）、清除拨号日志、模组自动统计上报（save_stats）、5G LAN 开关（get/set_5g_lan）、网络监测状态（get_monitor_status）、上联管理状态（qmodem.uplink status）、AT 终端渲染官方快捷命令表（get_at_cfg.cmds）。
- 保留并自包含两个增值组件：分天流量统计（数据源仅为官方 qmodem get_stats，采样服务 + 只读 rpcd 插件）与模组支持库（qmodem_support）；移除 AT 探测 QOS/调制私有插件（qos）、MT5700 修复服务与串口映射对 worker 的依赖。
- QCI/5QI/签约速率改为纯官方 network_info 字段驱动；概览页分天流量图表、流量自动清零、SIM 切换、IMEI、锁频锁小区等既有功能全部保持。
- Makefile 依赖精简为 +luci-base +qmodem +jq +jsonfilter；uci-defaults 升级时自动禁用并清理旧版遗留的私有服务；ACL 移除私有对象并补齐 qmodem.sms 全方法、qmodem.uplink、qmodem_stats、qmodem_support 授权。

## [2.5.0-25] - 2026-10-18

- 新增旧版 opkg 系统的 IPK 构建，与现有 APK 共用最新代码；Actions 同时提供两种格式的主包、中文翻译包和独立离线 RUN。
- IPK 离线安装同时隔离 opkg 主配置与额外配置目录，缺少依赖或选错包管理器时直接提示，不更新软件源、不强制安装。
- 修复旧版 LuCI 缺少 JavaScript `uci.commit()` 导致 APN / 设备参数无法保存，改用官方 UCI RPC；安装钩子提前到 `luci.mk` 之前定义，确保旧版 SDK 正确打包。
- 显式声明 `jq` / `jsonfilter` 依赖，保留 QModem、现有配置及短信删除兼容修复。

## [2.5.0-24] - 2026-10-18

- 修复西瓜皮 QModem stable 3.3.0 的模组短信删除：检测到官方 RPC 重复读取请求参数的缺陷时，改用官方旧短信页的 `modem_ctrl.sh` 删除链路；不改官方 QModem、插件或配置。
- 单条和分段短信删除后均回读模组核对，失败时保留消息；删除任务不再同步等待无关的网络状态采集。
- 补充旧版真实参数读取缺陷、官方脚本调用、正常 RPC 保留与新版数据库删除的回归检查。

## [2.5.0-23] - 2026-10-18

- 构建同时提供自带 APK/翻译包的 `*-offline.run`，可在 iStore 手动安装页上传；安装时禁用联网和软件源访问，缺少依赖直接提示。
- 为八个页面的顶部标题统一添加本地 SVG 图标，保留运营商标志；统一大小、间距与移动端换行，清除短信标题前的额外缩进和主题伪元素。
- 安装时清理 LuCI 页面缓存并沿用 `rpcd reload`，保留登录会话和已有配置；补充离线安装、校验失败与安装失败的回归检查。

## [2.5.0-22] - 2026-10-18

- 安装后使用 `rpcd reload` 加载 RPC 插件，避免重启 rpcd 导致 LuCI 重新登录。
- 为六个主导航标签添加本地 SVG 图标，保留原菜单地址和选中状态。

## [2.5.0-21] - 2026-10-18

- IMEI 写入任务完成后不再同步等待无关的状态、网络与注册域采集，缩短 WebUI 的等待时间；SIM 缓存另行后台补采。
- 对照 QModem 的 `set_imei`/`get_imei`：写入后直接回读同一模组，确认成功才更新当前 IMEI；旧快照不再覆盖刚确认的值，也不再于 900 毫秒后重载旧页面。
- 回读仍为旧值或超时时明确提示尚未确认；增加前端、页面交互和后端任务的回归检查。

## [2.5.0-20] - 2026-10-18

- 对齐 QModem 官方短信页：按 reference、发件人和总段数合并模组里的分段短信，依 part 顺序展示正文；删除时把所有段的存储索引按降序一次提交给 `delete_sms`。
- 多段删除即使后台返回成功，也重新读取模组列表核对所有索引；删除成功后立即更新气泡、联系人、短信数和会话数，无需手动刷新。
- 增加分段短信渲染、降序删除、部分删除失败与删除后页面自动更新的回归测试。

## [2.5.0-19] - 2026-10-18

- 修复页面尚未挂载时短信轮询器提前停止：旧版 QModem 的首次读取完成后会自动显示短信，无需再点“刷新”。
- 修复不同写操作复用同一后台任务导致删除命令未执行；删除响应缺少确认字段时，重新读取模组短信核对索引后再更新界面。
- 增加真实 QModem 删除响应、旧版无状态返回、页面自动更新及连续删除任务的回归检查。

## [2.5.0-18] - 2026-10-17

- QModem 页面内的提示按级别在 5–10 秒后自动关闭，避免连续编辑时通知堆叠。
- 概览、无线和高级页的手动刷新等待后台采集完成再更新；短信刷新读取新结果并重绘。拨号与模组设置操作会补采相关状态。
- 修复 APN 和设备参数保存后页面仍显示旧配置，设备参数 PDP 值采用 QModem 的小写枚举并兼容旧值。
- 修复模组支持库同步脚本未枚举型号，导致同步按钮误报成功和状态未更新；覆盖八个页面的渲染、常用按钮及后端同步回归检查。

## [2.5.0-17] - 2026-10-18

- 优化「移动数据」页面：拨号运行状态改为全宽紧凑状态栏，明确分离拨号服务运行和实际联网状态；隐藏冗余原始状态，额外诊断信息按需展开。
- 修复拨号、挂断、重拨操作反馈：按 QModem 官方 `result.status` 验证命令执行结果，拒绝把 `0` 误报成功；旧版直连场景使用操作级超时，按钮提供确认与失败提示。
- 修复 APN 表单：协议枚举调整为官方的小写 `ip`/`ipv6`/`ipv4v6`/`ethernet`，兼容已有大写旧值，补齐 MSCHAPv2；校验表单是否正常加载、提交 UCI 并提示结果。
- 为动态模组拨号/挂断/重拨新增成功及拒绝返回的前端回归测试，不修改官方 QModem 和原有配置。

## [2.5.0-16] - 2026-10-18

- 修复旧版 QModem 模组短信无法删除：delete_sms 传入官方要求的字符串索引，并支持单条/多段短信及索引 0。
- 删除前检查索引、删除后检查 QModem 确认结果；失败时保留短信并展示错误，不再误报成功。
- 删除成功后立即更新会话并刷新旧短信缓存，避免刚删完又出现；新增对应前端回归测试。
- 优化删除按钮的常显状态、触控尺寸与键盘焦点，保持 qmodem.sms 数据库删除兼容性。

## [2.5.0-15] - 2026-10-18

- 修复 QModem 官方支持库无频段时出现 `nullnullnullnull`：隐藏缺失、未定义或无效频段，保留 PDP 序号 0 等有效字段。
- 优化高级页面首次加载：外观与硬件信息先渲染，官方支持库和串口映射后台补充；缓存静态信息 120 秒，刷新周期从 10 秒调整为 90 秒，减少频繁重新渲染。
- 后台加载完成时避让用户正在编辑的输入框；增加无频段型号与高级页非阻塞加载的前端测试，保留自定义型号编辑和官方库只读展示。

## [2.5.0-14] - 2026-10-18

- 高级页拆分“QModem 官方支持库（只读）”和“自定义模组库”：官方支持型号可按 USB / PCIe 查看协议、频段及平台；插件内置预设与用户自定义 JSON 单独显示。
- 自定义型号支持编辑并同步更新对应用户 JSON 与 QModem 支持库，锁定型号/连接方式，保留原始文件备份；同名官方定义与来源不一致时阻止覆盖。
- 固件重新合并支持库时优先载入用户持久化 JSON，再补充插件预设；补充同步冲突、编辑回滚、安全边界回归测试和 Shell 语法检查。

## [2.5.0-11] - 2026-10-17

- 旧版 QModem 短信采用“缓存先显示、后台再读一次模组”：即使缓存命中也触发 `qmodem.get_sms`，不阻塞首屏；后续页面轮询自动显示新短信。
- 旧版实时结果按时间戳优先于旧缓存，30 秒请求去重和失败退避；缓存缺失时仍直读，后台失败不会清空已显示的缓存。
- 新版 `qmodem.sms` 数据库与 direct 模式不变，保留现有设置、短信及发送删除逻辑；增加缓存命中后刷新、失败保护、浏览器请求断言。

## [2.5.0-10] - 2026-10-17

- 西瓜皮实机反馈 `qmodem.get_sms` 可直接返回短信，但 `qmodem_cache.get_sms` 仍为 `missing`；旧版 QModem 的短信视图在无有效缓存时改走官方直读接口，不再错误显示 0 条。
- 旧版直读增加 30 秒结果缓存、并发去重、18 秒超时和错误提示；不再同时排队补采抢占 AT 串口。
- 新版短信数据库及 direct 模式继续按原设计运行，未改动官方 QModem、短信数据、设置、发送和删除接口；补充缺失缓存场景回归测试。

## [2.5.0-9] - 2026-10-17

- 修复 LuCI 25.12 返回 `-32000: Object not found` 时未回退旧版 QModem 短信接口的问题，兼容西瓜皮等仅提供 `qmodem.get_sms` 的固件。
- 仅在明确缺少 `qmodem.sms` 服务或方法时降级；无权限、超时与数据库错误仍如实提示，不会重复发送短信。
- 补充缺失服务、方法及权限异常回归用例，并让浏览器测试模拟实机返回的错误格式；无需修改官方 QModem 或删除原有短信设置。

## [2.5.0-8] - 2026-10-17

- 设备参数页改用可伸缩的中文配置与 AT 端口节点，修复拓扑文字溢出及手机端布局。
- 修复嵌套标题被渲染成卡片的问题，调整表单宽度、行距和标题对比度；保存逻辑保持原样。

## [2.5.0-7] - 2026-10-17

- 补充 RG502Q-EA、RG650E-EU 的 USB/PCIe 型号定义，RG650V-EU 作为旧版 QModem 的兼容条目；已有官方条目自动跳过。
- 高级页新增串口到模组的名称、USB/PCIe 和硬件 ID 映射，支持按需读取未知串口的型号，并保存自定义模组配置后同步支持库。
- 外观新增森林绿、落日橙、莓果红和两端颜色自定义；修复向支持库同组插入多个型号时的 JSON 逗号问题。

## [2.5.0-6] - 2026-10-17

- 短信页接入官方 `qmodem.sms` 数据库接口，修复原 QModem 有短信、本页却显示 0 条的问题；支持读取后自动从 SIM 删除的配置。
- 数据库模式的发送、删除、标记已读和手动同步使用同一官方服务；补齐 ACL 权限、Unix 时间和收发方向，失败不切换接口重发，保留草稿。
- 旧版无短信服务或 direct 模式继续读取模组缓存，兼容嵌套 `sms.msg` 与序号 0；数据库错误明确提示，过期模组短信缓存会后台刷新。
- 短信设置区说明数据库与浏览器历史的区别；通用模组不再查询鼎桥专有 IMS 指令，只串行提交用户改动的设置。
- 验证：211 项前端断言、172 个 DOM 页面场景及 JS／JSON／PO 检查通过；实机短信收发待安装验证。

## [2.5.0-5] - 2026-10-17

- 修复带指定端口发送 AT 时缺少显式模组配置节、参数未放入 `params` 导致的错误；共享写请求补齐模组标识，短信与重启同步对齐 RPC 参数结构。
- 兼容 QModem 官方 `at_cfg.res`、平铺 `response` 和旧版 `result` 响应；真实 AT 错误与任务错误如实显示，已进入队列的失败命令不重复直发。
- AT 返回区增加独立标题、发送状态、清空记录和高对比度正文；保留输入便于重试，Enter 不再提交 LuCI 表单，发送中阻止重复操作。
- 常用信号查询采用通用 `AT+CSQ`，型号专有快捷指令仅向对应型号展示。
- 概览底部快捷入口增加图标、渐变色条和悬停反馈，统一页面名称并适配手机布局。
- 验证：182 项前端断言、160 个 DOM 页面场景通过，覆盖动态模组、端口、真实响应结构、错误恢复及明暗主题文字对比度；实机收发仍待设备验证。

## [2.5.0-4] - 2026-10-17

- 高级页精简重复的网络模式、网络优选、锁频、重启和 AT 控制台；分别统一到无线与小区、模组与 SIM 卡及 AT 终端。
- 高级页新增外观主题：默认蓝绿渐变，可切换清爽蓝、暮光紫或跟随系统主题；支持自动、浅色、深色，并记住当前浏览器的选择。
- 两页拓扑改用自适应中文节点与流动连接线；窄屏纵向排列，未上报卡槽或 SIM 状态时不补造数据。
- 模组页三张摘要信息卡单独布局，铺满整行；温度保留在运行状态与顶部，通栏控制区不再撑出空列。
- 验证通过 147 项前端检查与 160 个 DOM 场景，覆盖主题保存、存储异常、明暗切换、缺数据及多模组；最终浏览器布局、动画和实机写操作待设备确认。

## [2.5.0-3] - 2026-10-17

- 逐页修复 `null` 文字、按钮事件绑定、标题区白底白字、频段竖排和表单溢出问题。
- 未上报的 QoS、签约速率、ICCID、信号、小区与连接数据按行隐藏；保留有效的零值和 false。
- 统一常见字段别名；SIM 页读取实际 ICCID；修正数字 MNC 的运营商识别。
- 网络模式和制式按 QModem 实际能力展示；MT5700 专有 AT 设置不再向其它品牌显示，保留通用 AT 控制台。
- 出厂重置入口改为型号指令说明，不再将开启射频或重启误报为恢复出厂。
- 增加缺失数据和各页 DOM 回归用例；不修改 QModem 后端、插件配置和构建触发方式。

## [2.5.0-2] - 2026-10-11

### 维护
- **版本号提升并触发 CI 重新编译**：`PKG_VERSION=2.5.0` / `PKG_RELEASE=2`，
  用于产出带 QM UI v2 视觉层的 ipk / apk 包（内容与 2.5.0-1 一致，仅重新构建并发布）。
- **CI 发布保留策略**：触发编译时沿用 `keep_releases=1`，发布后仅保留最近 1 个
  Release（旧 Release 与对应 tag 自动清理）。

## [2.5.0-1] - 2026-10-11

### 新增
- **QM UI v2 统一视觉层**（新增 `htdocs/luci-static/resources/qmodem-generic/theme.js`）：
  设计令牌 + 组件标准件 + 响应式断点 + 旧类适配层，作用域限定在 `body.qm-app` 内，
  不污染 LuCI 自身与其它插件。
  - **主题兼容**：所有颜色改为 `var(<主题变量>, <内置 fallback>)`，优先取
    `--background-color-* / --border-color-* / --text-color-* / --primary-color /
    --success-color` 等；支持 `color-mix()` 时从主题主色实时派生强调色与半透明底色，
    bootstrap / argon / material / openwrt-2020 及暗色 fork 均自动跟随。
  - **明暗自适应**：`detectTone()` 依次用主题变量亮度 → `body` 计算背景色 →
    `prefers-color-scheme` 判定，给 `body` 加 `qm-dark` 切换内置调色板；老主题（无 CSS
    变量）同样生效。
  - **响应式**：栅格统一 `auto-fit + minmax`，断点 1280/1024/820/560；≤820px 时 cbi 表单
    标题与控件上下堆叠、输入与按钮 ≥38px、表格横滑、SMS 双栏会话改单栏；≤560px 全部单列、
    按钮全宽 42px；尊重 `prefers-reduced-motion`。
  - **组件标准件**：`.qm-shell/.qm-grid/.qm-card/.qm-stat/.qm-badge/.qm-dot/.qm-btn/
    .qm-alert/.qm-kv/.qm-terminal/.qm-progress/.qm-table-wrap` 及 `theme.card()/kv()/
    stat()/badge()/alert()/progress()` helper。
  - **旧类适配**：按语义分组接管 250 个历史私有类名（卡片/标题/徽章/栅格/键值行/按钮/
    等宽块/Hero），SVG 内嵌颜色用属性选择器 `[stroke="#0072f5"]{stroke:var(--qm-accent)}`
    令牌化，无需改动 SVG 字符串；Hero 统一渐变 + 文字反色（`!important` 覆盖历史
    inline style），保证任意主题可读。
- **预览页** `qmodem-ui-preview.html`（仓库根目录，不进安装包）：iframe 内真实执行
  theme.js，可切换 5 种主题 × 3 种视口，并可开关「叠加旧视图内联样式」验证兼容层。

### 变更
- **前端硬编码颜色全面令牌化**：`controls.js` 与 8 个视图共 500+ 处 hex/rgba/渐变
  按声明属性（文字 vs 背景/描边）分流替换为 `--qm-*` 令牌；各视图原先定义在 `:root` 的
  毛玻璃变量（会污染整个 LuCI）收窄到 `.qm-app` 作用域并改引令牌；运行时拼接到
  inline style 的颜色（IPv4/IPv6 连接态、指标条、信号等级色）同样改为令牌。
- **流量图例**：原先把色值当文本显示（`● 下行 (DL) #0072f5`），改为真正的彩色圆点 +
  文案（并接入 i18n）。

### 测试
- `tests/run-frontend-tests.js` 的模块加载器新增 `qmodem-generic.theme` 依赖注入
  （懒加载并缓存），`controls.js` 引入 theme 后 8 个视图的 render 用例仍全部通过
  （108 项）。
- `node --check` 覆盖 `theme.js` + `controls.js` + 8 个视图；CSS 括号平衡校验通过。

## [2.4.11-18] - 2026-10-01

### 维护
- **仓库结构整理**：包内容原嵌套在 `luci-app-qmodem-generic/luci-app-qmodem-generic/`
  二级目录下，且根目录与一级目录重复保存了一套脚手架（`.github/`、`docs/`、
  `CHANGELOG.md`、`README.md`、`LICENSE`、`.editorconfig` 等）。本次把包内容上移一层
  至 `luci-app-qmodem-generic/`，并删除一级目录下的重复脚手架（内容与根目录完全一致）。
  纯文件移动（`git mv` 保持字节级不变），不影响产物结构与 CI（`PKG_DIR` 路径未变）。

### 修复
- **「模组与 SIM」页无法正确显示签约速率与 QCI/5QI 等级**：完整追踪了
  模组 → AT → `qmodem-at-probe` → `qmodem-worker` → `/tmp/qmodem-cache` → `rpcd/qos`
  → LuCI RPC → 前端 的整条数据链，修复三方面问题，并各加 `*_source` 溯源字段便于排障：
  - **AT 探测**（`qmodem-at-probe`）：`QCI`（LTE，`AT+CGEQOSRDP`）与 `5QI`（5G，
    `AT+C5GQOSRDP`）不再混为一谈，分别解析、分别上报；速率统一折算为 kbps
    （`bps/kbps/Mbps` 归一为 `kbps`），无值显式用 `null`（绝不伪装成 `0`）。
  - **多 PDP Context**：不再写死 `CID=1`。先经 `AT+CGCONTRDP` 收集 active PDP 上下文，
    再和配置里的 APN 匹配，优先取「当前拨号数据 APN」（如 `internet`）对应的 CID，
    避免把 `ims`/`cbs` 等控制面上下文的 QoS 误当用户签约速率。
  - **前端展示**（`status.js` / `controls.js`）：QCI 与 5QI 分开展示、互不覆盖；
    未知一律显示 `--`（绝不把「QCI 0」当成未知）；下载/上传按
    `1 Mbps = 1024 kbps`、`1 Gbps = 1024×1024 kbps` 折算（`102400→100 Mbps`、`51200→50 Mbps`）。
  - **`rpcd/qos` 空态信封**：`qci`/`five_qi`/`downlink_rate_kbps`/`uplink_rate_kbps`
    返回 `null` 而非 `0`。
- **`qmodem-worker` 退出清理**：SIGTERM 时先停掉在途采集子进程（它会持有 AT 互斥锁）
  再释放锁，避免慢模组下 AT 锁残留阻塞其它访问；关闭路径带强杀兜底并释放 worker 锁，
  保证 procd/测试对 SIGTERM 收敛的要求（子进程锁可经 `qm_lock` 的「持有者已死」检测自动回收）。

### 测试
- 后端回归（`tests/run-backend-tests.sh`）新增并校准 QoS 断言：QCI/5QI 分别溯源、
  下行/上行 `102400/51200 kbps`、优先选 `internet` 而非 `ims` APN；前端
  `run-frontend-tests.js` 新增 `formatRate`/`qosExplain`/`subscriptionRate` 的成对用例
  （QCI 与 5QI 并存不覆盖、未知/0 → `--`、速率单位折算）。

## [2.4.11-17] - 2026-09-30

### 修复
- **移动数据页崩溃（connection 页渲染失败）**：`controls.js` 的 `liveView.paint()` 直接
  `appendChild(opts.paint(...))`，而移动数据页的 `paintContent` 借助 CBI `form.Map.render()` 返回
  Promise，导致 `Uncaught TypeError: Failed to execute 'appendChild' ... not of type 'Node'`，
  整页停在「正在载入视图…」并抛「页面渲染失败」红横幅。
  现在 `paint()` 对 paint 回调统一 `Promise.resolve().then()` 再挂载，任意异步 paintContent 均安全。
- **移动数据页每 5 s 重建整张 CBI 表单**：轮询每次都 `new form.Map().render()`，既是卡顿源也会打断
  用户编辑焦点。现改为表单单例（`buildApnForm` 只构建一次并缓存渲染节点，轮询复用局部状态区），
  `saveApn` 抽成独立方法，去掉轮询时的整表重建。

### 变更
- **`qmodem-worker`：support 域降频门控**。support（模组支持库 / 包可用性）近静态数据，原每轮
  重复采集并刷屏日志；现引入 `SUPPORT_TTL`（默认 1 h，可被 `QMODEM_WORKER_SUPPORT_TTL` 覆盖，
  最小 60 s）与 `qm_domain_stale()` 新鲜度门控，未过期即跳过本轮采集。
- **四个页面 UI 全面中文化**（`status.js` / `connection.js` / `network.js` / `system.js`）：
  概览页（信号强度、载波聚合、网络信息、移动 IP 等卡片标题与信号等级）；移动数据页（拓扑图
  节点 `蜂窝广域网`、IP 透传 / 后置路由 / DMZ 标题）；网络与小区页（制式 `4G 长期演进（LTE）`
  与 `5G 新空口（NR）`、协议 ECM/NCM/RNDIS/MBIM/QMI/GobiNet/PPP 中文全称+缩写、信号指标
  RSRP/RSRQ/SINR、PCI/MCC/MNC/EARFCN 等）；模组与 SIM 页（PIN/PUK 管理、热保护、标识实验室、
  恢复出厂、FOTA、SIM 与射频控制等约 80 处文案）。保留 ubus 数据 key、枚举值、CSS/SVG 与
  ICCID/IMEI/AT 等设备专名不变。
- **修复 connection 页一处 `this` 上下文 bug**：`buildApnForm().then(function(){ ... })` 普通
  回调内误用 `this.renderSvgDataTunnel(...)`（此处 `this` 非视图实例），导致整页渲染失败
  `Cannot read properties of undefined`；改为 `self.renderSvgDataTunnel(...)` 后页面正常。
- **高级设置页 `advanced.js` 全面中文化**：硬件信息、IP 透传 / Post-Route / DMZ、模组支持库
  同步、诊断控制台等约 30 处界面文案汉化。
- **短信页 `sms.js` 全面中文化**：短信列表、发送表单、会话视图等界面文案汉化。
- **设备参数页 `settings.js` 毛玻璃重构并中文化**：现代白色毛玻璃风格 + 动态 UCI 配置流
  拓扑 SVG，展示 UCI 配置节、QModem 守护进程与硬件设备节点间的同步流向；全部表单文案中文化。
- **模组与 SIM 页移除 FOTA 卡片**：删除固件在线升级（FOTA）卡片及其 CSS（升级地址输入、
  进度条、状态徽标与 AT^FOTADL 逻辑）；卡片内独立的「重启模组」按钮保留并移入
  「防护与维护」工具箱（诊断 / 热保护阈值 / 标识实验室 / 恢复出厂设置之后）。
- **README 优化精简**：去除冗余与重复表述、压缩文件布局与各章节，全文不再使用 emoji 图标。

### 实机验证（ImmortalWrt SNAPSHOT / LuCI 26.261）
- 8 个页面全部完整渲染、无 console/PAGEERROR、无渲染失败横幅；各页首屏约 0.25-0.44 s。
- 「移动数据」页 APN 表单 6 个字段（APN/pdp_type/auth/username/password/dns_list）与
  拨号·挂断·重拨、保存按钮全部正常渲染，两轮轮询无崩溃。
- 根因之一为实机残留多个孤儿 `qmodem-worker` 互相抢 AT 锁导致缓存过期、页面退化为慢速直连；
  worker 已带单实例守卫，干净重启后缓存恢复新鲜。

### 备注：静态资源缓存与「刷新即最新」
- LuCI 通过 `require()`/`?v=<luci 版本号>` 加载本插件 JS，插件升级后该版本号不变，浏览器可能按同
  URL 走启发式缓存（无 `Cache-Control`，仅 ETag + Last-Modified）。
- 实机验证：uhttpd 对 ETag / `If-Modified-Since` 条件请求处理正常，插件文件更新导致 mtime/ETag
  变化后，普通刷新即取最新；偶见旧 UI 时硬刷新（Ctrl+F5）一次即可。无需改动服务器缓存策略。

## [2.4.11-16] - 2026-09-27

### 新增（异步化架构：后端任务不再阻塞页面加载）
- **状态缓存层 `/tmp/qmodem-cache`**：按 `<section>/<domain>.json` 原子写入（临时文件 + `mv`），
  每个域带 `{updated, stale, status, ttl, error, data}` 信封。文件缺失时立即合成
  `missing/stale`，绝不去等采集。
- **`qmodem-worker`（procd 常驻，周期 15 s）**：唯一允许访问 modem / AT / netifd 的进程。
  所有外部调用带硬超时（`ubus -t`、`qmodem-at-probe -t`），串口访问经 `qm_lock` 串行化，
  单实例（抢不到锁直接退出）。慢域（`qos` / `radio` 的 AT 探测）每 4 轮采一次。
- **`qmodem-task` 任务队列**：`new` 立即返回 `task_id`，同 `(type, config_section)` 已有
  `queued/running` 任务时直接复用（`deduplicated:true`）；`get` 回收「running 但已超时」的僵尸任务。
  超时预算：`send_at` 20 s、`sync_support`/`collect_stats` 30 s、`action` 120 s、
  `refresh` 90 s、`refresh_all` 180 s。
- **`rpcd/qmodem_cache` 插件**：A 类快速读取（`snapshot` / `get_*` / `get_task` / `worker_status`，
  纯文件 IO）+ B 类任务（`refresh` / `send_at` / `action` / `sync_support` / `collect_stats`）。
  插件内不含 `ubus call qmodem`、tty 读写、`sleep`、`uqmi`/`mmcli`/`ifstatus`/`logread`。
- **`qmodem-lib.sh` / `qmodem-at-probe`**：公共库与带超时的 AT 探测工具，供 worker 与任务队列复用。
- **`tests/`**：后端 67 项（`run-backend-tests.sh`，dash 与 busybox sh 均通过）+
  前端 94 项（`run-frontend-tests.js`，用 Node 加载真实的 `controls.js` 与 8 个视图驱动）。
- **`docs/QMODEM_ASYNC_ARCHITECTURE.md`**：架构说明与 12 项验收结论。
- **`tests/check-po.py`**：`msgfmt` 的最小替代（头部、成对性、转义、重复 msgid、占位符一致性、UTF-8）。

### 变更
- **`rpcd/qos`、`rpcd/qmodem_stats`、`rpcd/qmodem_support` 改为缓存读取器**：
  原先 `qos_info` 同步跑 3 次 `tom_modem -t 8`（约 24 s）、`radio_info` 跑 2 次（约 16 s）、
  `daily_stats` 同步跑采集器、`support.status/sync` 在 RPC 里做 awk + 文件锁。
  现在只读缓存文件；`stats_reset` / `support.sync` 改为建任务。
- **`controls.js` 全面异步化**：
  - 新增 `bootstrap()`（uci + 一次 `snapshot`）/ `liveView()`（立即渲染 + 非重叠轮询 + 卸载自动停）
    / `createPoller()` / `qmodemAction()` / `runTask()` / `withTimeout()`。
  - 所有 getter 改为「缓存优先」（`cachedValue` / `cachedDomain`），缓存缺失时返回兜底值并
    后台排队补采，绝不同步查 modem；旧的 `callXxx` 保留为缓存层不可用时的直连兜底。
  - **全部 58 个 `rpc.declare` 加上 `nobatch: true`**：LuCI 的 `rpc.js` 会把同一 tick 内的调用
    合并成一个 HTTP POST 并由 rpcd 顺序执行，一个慢方法会拖住同批次的**所有**请求（含其它页面）。
    关掉批处理后快请求不再被慢请求劫持。
  - 所有写操作（AT / 短信 / 模式 / IMEI / 锁频段 / 网络优选 / 卡槽 / 重启 / 拨号 / 清零 / 计划 /
    支持库同步）改为「建任务 → 轮询 `get_task`」，签名与返回值保持不变。
  - 快照并发去重（同 section 复用 in-flight Promise）+ 3 s TTL：一页多个 getter 只发 1 次 RPC。
  - 轮询：`busy` 标志防堆叠、`document.hidden` 降频 4 倍、节点移出 DOM 或 `pagehide`/`beforeunload`
    自动停止（登记表停掉全部活跃轮询器）、用户正在输入时跳过本轮重绘。
- **8 个视图全部改造**：`load()` 只走 `bootstrap()`（0 次 modem 访问），原 `render` 拆为
  `paintContent` 并由 `liveView` 驱动局部重绘。`settings.js`（CBI 表单）与 `terminal.js`
  （AT 会话日志）**不轮询**，避免冲掉用户未保存的内容。
- **`qmodem-stats-collect` / `-loop`**：采集结果同时写入缓存域，`get_stats` 只读。
- **`uci-defaults`**：安装时 enable 并启动 `qmodem-worker`。
- **ACL**：放行 `qmodem_cache` / `qmodem_stats` / `qmodem_support` / `qos`（读写）。
- `Makefile`：`PKG_RELEASE` 15 → 16。
- `po/zh_Hans`：补齐 24 条新增的任务/超时提示翻译。

### 验证
- 后端 `sh tests/run-backend-tests.sh` → **67 passed / 0 failed**；
  `TEST_SH="busybox sh"` 同样 67/0。关键项：`qmodem_cache.snapshot < 200ms (83ms)`、
  `get_status (30ms)`、`read-only RPCs issued 0 ubus calls`、
  `rpcd snapshot still fast while modem dead (61ms)`、`concurrent refresh deduplicated`、
  `no overlapping modem transactions`、`second worker exits (single instance)`、
  `no lock dirs left behind`、`no orphaned task runners`、`dead-modem cycle bounded (3s <= 12s)`。
- 前端 `sh tests/run-frontend-tests.sh` → **94 passed / 0 failed**。关键项：
  8 个视图 `load()` 首屏 0–6 ms 且 `qmodem`/`qos`/`luci-rpc` 调用数均为 0、
  `所有 rpc.declare 都声明了 nobatch (58/58)`、`慢 collect 不会堆叠`、
  `pagehide 后第二个视图也停止`、缓存全空（模组离线）时 7 个视图仍能渲染。
- 全部 JS 通过 `node --check`；ACL / menu.d / extra_modem_support.json 通过 `json.load`；
  `po` 通过 `tests/check-po.py`（1212 条翻译，0 错误）。
- 未能本地执行：`msgfmt` 与 `shellcheck` 在本环境缺失（已用 `tests/check-po.py` 等价替代 `msgfmt`）。

## [2.4.11-15] - 2026-09-20

### 修复
- **状态页把「模组未上报」的占位值当成真实读数渲染**（实测 Fibocom FM350-GL + QModem 3.2.0 / ImmortalWrt SNAPSHOT r0-1aa8ac8）：
  - **温度显示 `0°C`**：模组不提供温度时，QModem 在 `base_info` 的 `temperature` 回填 `"0°C"`。前端只做「非数字字符剥离」后得到 `0`，被当作有效温度渲染在 20–80°C 刻度上。新增 `controls.normalizeTemperature()`：无数值或非正数一律视为未上报（0 不是有效工作温度），`status.js` / `system.js`（模组与 SIM 页温度卡）/ `advanced.js`（热保护提示）三处统一走该函数，未上报显示 `--`。
  - **上下行带宽显示裸 `M`**：QModem 的 `cell_info` 中 `DL/UL Bandwidth` 在数值缺失时只回传单位残值 `"M"`（同样是 FM350-GL 实测值），而 `mhz()` 判断「含字母就原样返回」，于是页面显示成 `M`。新增加「必须含数字」判定，无数值返回空 → 显示 `--`。
- **LuCI 26.x（Master 26.246+）旧 API 兼容**：该版本移除 `String.prototype.format`（仅保留 `String.prototype.format.call()`）与全局 `E()` / `findParent()`。本包视图仍沿用这些写法（数百处），在新版 LuCI 上表现为「菜单正常、内容区永远停在 Loading view」。在 `controls.js` 顶部新增按需注入的兼容层——所有视图 `require qmodem-generic.controls` 时即生效（早于任何视图体执行），缺失才注入、已存在绝不覆盖，不影响其它插件。
  - 兼容层同时补齐全局 `_()`：26.x 的 `ui.js` 在错误提示路径（`LuCI.prototype.error` → `ui.addNotification`）直接引用全局 `_()`，缺失时会先崩在提示逻辑上、把真正的错误吞成一句 `_ is not defined`。补上轻量兜底（原样返回）后可正常显示真实错误。

### 变更
- `Makefile`：`PKG_RELEASE` 14 → 15。
- README「已知事项」补充：占位值降级显示说明、`radio_info` 不可用时的 `--` 属预期、LuCI 26.x 兼容层说明。

### 验证
- 全部 9 个 JS 通过 `node --check`；兼容层在 Node 下实测 `'%04d-%02d-%02d %02d:%02d'.format(...)`、`%s`、`%d` 输出正确。
- 设备实测（FM350-GL，页面 `admin/modem/mt5700m/status`）：温度由 `0°C` → `--`，`Downlink/Uplink bandwidth` 由 `M` → `--`，调制保持 `--`（`qos.radio_info` 返回 `unavailable`，属预期），IPv6 `Not assigned --` 不变；补 `_` 兜底后页面零 JS 错误。

## [2.4.11-14] - 2026-09-18

### 变更
- **LuCI 前端命名空间彻底迁移为 `qmodem-generic`**（`PKG_RELEASE` 13 → 14）：消除全部 `mt5700m` 历史命名包袱，UI 结构与具体模组型号彻底解耦：
  - 资源目录迁移：`resources/view/mt5700m/` → `resources/view/qmodem-generic/`，`resources/mt5700m/controls.js` → `resources/qmodem-generic/controls.js`，不保留旧目录兼容。
  - JS 模块命名空间：全部 9 个视图的 `require mt5700m.controls` → `require qmodem-generic.controls`。
  - 菜单路由迁移：`admin/modem/mt5700m/*` → `admin/modem/qmodem-generic/*`，`action.path` 同步更新，无新旧路由并存。
  - CSS 命名空间：`.mt5700m-*` 类名（页面/卡片/信号/载波/频段/流量等全部）→ `.qmodem-generic-*`，JS 动态 class、CSS 选择器与 media query 同步迁移。
  - 运行时字符串：`L.url()` 跳转、`localStorage` 持久化键（`mt5700m_active_section`、`mt5700m.at.saved`）统一迁移为 `qmodem-generic` 命名空间。
  - PO 翻译：清理 71 条旧版 `MT5700M` 死条目（当前 UI 已不引用），`msgfmt` 校验通过。
- **OpenWrt 兼容基线调整为 25.12+**：
  - `Makefile`：`LUCI_DEPENDS` 保持 `+luci-base +qmodem`（OpenWrt buildroot 的 DEPENDS 不支持 `(>= 版本)` 约束语法，实测 25.12 SDK 会因 `(>=`/`25.12)` 被当作不存在的包名导致 `make defconfig` 失败；25.12+ 基线由 CI 编译矩阵与文档强制）。
  - CI：移除 ImmortalWrt 23.05 / 24.10 编译矩阵，仅保留 25.12（必需）与 snapshot（允许失败）；Release 安装说明只保留 apk。
  - README 兼容矩阵、安装说明、已知事项同步更新。

### 保留（模型专用兼容层，与通用 UI 解耦）
- `qmodem-mt5700-fix` 脚本/服务：仅服务于 MT5700 系列海思平台 SIM 卡槽初始化，作为独立的、按型号条件触发的 workaround 保留，不进入通用 UI 命名空间。
- README / docs / CHANGELOG 中作为历史来源说明保留的 `mt5700m` 提及（均不涉及当前运行路径、路由、CSS 或模块命名空间）。

### 验证
- 全仓 `grep -RniE 'mt5700m|MT5700M'`：`htdocs/` 与 `menu.d/` 零残留；剩余命中仅为 README / docs 历史说明及 build.yml 旧包卸载提示。
- 9 个 JS 文件全部通过 `node --check`；menu.d / acl.d JSON 解析通过；PO `msgfmt --check-format` 通过。

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
