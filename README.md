# luci-app-qmodem-generic

[![Build APK and IPK](https://github.com/PEIT98/luci-app-qmodem-generic/actions/workflows/build.yml/badge.svg)](https://github.com/PEIT98/luci-app-qmodem-generic/actions/workflows/build.yml)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Target](https://img.shields.io/badge/LuCI-PKGARCH%3Aall-green.svg)

> **QModem 的通用美化版 LuCI Web UI。** 界面数据经由 QModem 官方 ubus 接口读取，不绑定任何具体模组型号 —— QModem 识别到什么模组、返回什么字段，界面就显示什么。
>
> 本项目由 [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m)（鼎桥 MT5700M 专用界面）重构而来，已去除私有文本后端，使用官方 `qmodem` 与可选 `qmodem.sms` 接口。

未获取到的数据自动隐藏对应行。网络模式按 QModem 实际上报展示；MT5700 专有设置仅向对应型号显示，其它模组可使用通用 AT 控制台。

AT 控制台保留命令以便重试或收藏，支持 Enter 发送；返回窗口独立显示状态、响应正文和错误信息。常用指令使用通用查询，专有指令按模组型号显示。

短信自动适配 QModem 数据库模式和旧版模组存储。开启“读取后从 SIM 删除”后，已保存到路由器的短信仍可在这里查看；数据库模式与原 QModem 界面共用收发记录，不要求安装 Next 界面。读取错误会明确提示。

西瓜皮等 QModem stable 3.3.0 固件的短信 RPC 若存在重复读取参数的缺陷，删除时自动复用官方旧界面的 `modem_ctrl.sh`，并回读模组确认。正常 RPC 和新版数据库模式沿用各自接口，无需修改或升级官方 QModem。

## 目录

- [功能特性](#功能特性)
- [文件布局](#文件布局)
- [依赖与版本](#依赖与版本)
- [安装](#安装)
- [流量统计](#流量统计)
- [模组支持库自动注入](#模组支持库自动注入)
- [自行编译](#自行编译)
- [GitHub Actions 自动构建](#github-actions-自动构建)
- [界面主题与响应式（QM UI v2）](#界面主题与响应式qm-ui-v2)
- [数据获取与降级（直连官方接口）](#数据获取与降级直连官方接口)
- [已知事项](#已知事项)
- [相关文档](#相关文档)
- [致谢](#致谢)
- [许可](#许可)

## 功能特性

多模组设备会在页面顶部出现模组选择器，切换后本地持久化。各页面能力如下：

| 页面 | 说明 |
| --- | --- |
| 总览 Overview | 实际型号标题、信号/流量卡片、按 `class` 分组铺开 QModem 上报的**全部字段** |
| 移动数据 Mobile Data | APN、拨号、IP 详情与会话计数 |
| 射频与小区 Radio and Cells | 频段、邻区、锁频锁小区、诊断 |
| 短信 Messages | 数据库／模组存储自动识别，收发、未读状态与会话视图 |
| 模组与 SIM | 模组身份、SIM 信息与维护操作 |
| 高级 Advanced | 外观主题、串口与模组映射、自定义型号、支持库同步及能力诊断 |
| AT 控制台 | 经 `qmodem` ubus 下发 AT 命令（从「高级」页进入） |
| 设备参数设置 | QModem `modem-device` 配置节（从「高级 / 模组与 SIM」页进入） |

**亮点**

- 使用 QModem 官方 ubus 接口，全模组通用；动态字段自适应，内置字段使用中文标签映射。
- 自带流量统计后台采集服务，重启不丢数据，按中国时区（UTC+8）分天记录。
- 内置 RG520N-CN、RG502Q-EA、RG650E-EU、RG650V-EU 定义；高级页可查看 USB/PCIe 串口和硬件 ID，并添加其它型号。

## 文件布局

本包除 LuCI 前端资源外，还附带若干后端脚本与服务，均使用 `qmodem-generic` 命名空间：

```
/etc/config/qmodem                  # QModem 配置（本包读取的 modem-device 节）
/etc/init.d/qmodem-stats-collect    # 流量采样 procd 服务（开机自启）
/etc/init.d/qmodem-modem-support    # 模组支持库同步开机服务（START=90）
/etc/uci-defaults/99_luci-app-qmodem-generic  # 首次安装：注册服务并清理旧版遗留
/etc/qmodem-generic/modems/         # 用户自定义模组定义（usb / pcie 两个子目录）
/etc/qmodem-stats/                  # 分天流量统计落盘目录
/usr/bin/qmodem-stats-collect       # 流量采样 / 落盘 / 输出 JSON / 清零
/usr/bin/qmodem-stats-loop          # 按间隔驱动采集器的常驻循环
/usr/sbin/qmodem-modem-support      # 模组支持库合并脚本（幂等，写入前备份）
/usr/sbin/qmodem-support-custom     # 自定义型号管理（配合 rpcd 的 custom_* 方法）
/usr/libexec/rpcd/qmodem_stats      # rpcd 插件：daily_stats / stats_history / stats_reset
/usr/libexec/rpcd/qmodem_support    # rpcd 插件：status / sync / ports / custom_*
/usr/share/qmodem-generic/extra_modem_support.json  # 内置待注入模组定义
/www/luci-static/resources/qmodem-generic/          # 前端资源
```

自 3.0.0 起，本包不再携带任何私有 rpcd 插件或后台守护进程：数据与控制全部直连
QModem 官方 ubus 对象（`qmodem` / `qmodem.sms` / `qmodem.uplink`），映射关系见
[docs/QMODEM_OFFICIAL_WIRING.md](docs/QMODEM_OFFICIAL_WIRING.md)。

## 依赖与版本

| 目标系统 | 包格式 | 状态 |
| --- | --- | --- |
| ImmortalWrt 25.12 | `.apk` | 支持 |
| OpenWrt / ImmortalWrt / iStoreOS 23.05、24.10 | `.ipk` | 支持使用 opkg 和 JavaScript LuCI 的固件 |
| ImmortalWrt snapshot | `.apk` | 兼容，未单独构建 |

**兼容基线**：23.05 起的 JavaScript LuCI。旧版使用 IPK，新版使用 APK，按设备包管理器选择，不能互换。**前置依赖**：`luci-base`、[`qmodem`](https://github.com/FUjr/QModem)、`jq`、`jsonfilter`。QModem stable 和 Next 共用本包的能力检测与降级逻辑，不要求升级后端。本包仅含 LuCI 资源和 Shell 脚本，`LUCI_PKGARCH:=all`，同一种格式适用于 ARM / x86 等架构。

旧版 LuCI 的 APN 和设备参数保存使用官方 `uci.commit` ubus 接口，不依赖缺失的 JavaScript `uci.commit()` 方法。安装钩子在加载 `luci.mk` 前定义，确保旧版 SDK 打入本包的服务加载与会话保留逻辑。

## 安装

**iStore 手动安装：旧版 opkg 系统上传 `*-ipk-offline.run`，新版 apk 系统上传 `*-apk-offline.run`。** 每个离线包自带对应格式的主包和翻译包，安装时隔离软件源、不更新索引；缺少依赖会直接提示，不强制安装，也不改动系统软件源。

直接上传 `.apk` 时，iStore 自带的 APK 安装命令仍可能访问软件源。离线包通过 iStore 原生支持的 `.run` 入口安装，无需修改系统软件源或 iStore。

```sh
# SSH 安装离线 RUN（ImmortalWrt 25.12 / snapshot）
sh ./luci-app-qmodem-generic-*-apk-offline.run

# 或直接离线安装本地主 APK（需要的翻译 APK 也可加在命令末尾）
apk --no-network --repositories-file /dev/null add --allow-untrusted ./luci-app-qmodem-generic-*.apk

# 旧版 OpenWrt / ImmortalWrt / iStoreOS（opkg）
sh ./luci-app-qmodem-generic_*-ipk-offline.run
# 或在依赖齐全时安装本地 IPK，主包和翻译包一起安装
opkg install ./luci-app-qmodem-generic_*_all.ipk ./luci-i18n-qmodem-generic-zh-cn_*_all.ipk
```

> 若设备上此前安装过旧版 `luci-app-mt5700m`，请先 `opkg remove luci-app-mt5700m` 再安装本包，避免旧包残留的菜单与 ACL 条目干扰。

安装后在 LuCI 菜单 **移动网络 → 模组管理** 下使用。

自 `2.5.0-r22` 起，安装钩子使用 `rpcd reload` 保留 LuCI 会话；更新后刷新页面即可。`r23` 同时清理 LuCI 页面缓存，保留已有配置、短信与流量记录。

## 流量统计

概览页「流量统计」卡片由本包自带的采集服务驱动，与模组侧计数相互独立：

- **后台采样**：procd 服务开机自启，每 60 秒采样一次，无论 LuCI 是否打开都不漏记。
- **重启不丢失**：落盘于 overlay 持久分区，自动保留最近 90 天。
- **按中国时区（UTC+8）切日**：日期边界由 `epoch+28800` 计算，不受系统时区影响；跨零点增量归属相邻日。
- **上下行方向自动识别**：累计流量超过 50MB 且 `tx > rx` 时判定方向颠倒，前端自动交换下载/上传显示。
- **全模组通用计数器**：优先 QModem `get_stats`，未实现时回退内核 netdev 计数器；重拨/回绕时按新值起算。
- **自动 / 手动清零**：「流量自动清零」卡片设置定时清零计划（QModem 原生能力）；「立即清零」同步清零本机累计与分天记录，保留计数器基准。

相关文件：`/usr/bin/qmodem-stats-collect`（run/show/reset）、`/usr/bin/qmodem-stats-loop`、`/etc/init.d/qmodem-stats-collect`、`/usr/libexec/rpcd/qmodem_stats`、数据目录 `/etc/qmodem-stats/`。

> MT5700 系列海思模组的 SIM 卡槽初始化脚本（`qmodem-mt5700-fix`）自 3.0.0 起随包移除；
> 如仍需要 `AT^SCICHG=0,1`，请改用 QModem 自身的 `pre_dial_at_cmds` 配置项手动添加。

## 模组支持库自动注入

QModem 通过 `/usr/share/qmodem/modem_support.json` 识别模组型号，未收录的型号不会生成 `modem-device`（例如 Quectel RG520N-CN 在部分 QModem 版本中就没有条目）。本包内置这些型号的定义，安装时与每次开机自动合并进支持库。

**自动流程**：首次安装（`/etc/uci-defaults`）立即合并；每次开机（`/etc/init.d/qmodem-modem-support`，`START=90` 早于 QModem）再执行一次；也可在 LuCI **高级 → 模组支持库** 点「同步支持库」或手动执行 `/usr/sbin/qmodem-modem-support`。

**安全性与边界**

| 行为 | 说明 |
| --- | --- |
| 幂等 | 型号已存在时直接跳过，绝不重复写入 |
| 备份 | 首次写入前生成 `modem_support.json.bak` 用于回滚 |
| 校验 | 写入后按 JSON 解析校验，失败自动回滚备份 |
| 兼容 | QModem 未安装时直接退出；用目录锁避免并发改写；按分组（`usb`/`pcie`）查找不误判 |

**生效条件**：QModem 只在启动 / 重扫时读取支持库，注入后需 `/etc/init.d/qmodem restart` 或重启设备。已有的官方型号会跳过，不覆盖原定义。RG650V-EU 已在新版官方 QModem 中收录，这里保留给旧版作兼容。

高级页的「串口与模组对应关系」从系统设备树读取 USB VID:PID 或 PCI 厂商/设备 ID；QModem 配置过的 AT 口标为已确认，其余仅是候选串口，可手动点「读取型号」。自定义配置按 USB/PCIe 和型号分别保存到 `/etc/qmodem-generic/modems/`，点「保存并同步支持库」后重启 QModem 生效。USB 配置填写厂商 VID，PCIe 硬件 ID 仅用于设备识别；拨号驱动及型号专属能力仍须由 QModem 和固件提供。移除自定义配置不会删除已经注入的官方支持库条目。

相关文件：`/usr/share/qmodem-generic/extra_modem_support.json`、`/usr/sbin/qmodem-modem-support`（`--status` 只查询，`--json` 机器可读）、`/etc/init.d/qmodem-modem-support`、`/usr/libexec/rpcd/qmodem_support`。

## 自行编译

作为 feed 加入 OpenWrt / ImmortalWrt 源码树：

```sh
echo 'src-git qmodem_generic https://github.com/PEIT98/luci-app-qmodem-generic.git' >> feeds.conf.default
./scripts/feeds update qmodem_generic
./scripts/feeds install -a -p qmodem_generic
make menuconfig   # LuCI -> Applications -> luci-app-qmodem-generic
make package/luci-app-qmodem-generic/compile V=s
```

## GitHub Actions 自动构建

仓库内置 [`.github/workflows/build.yml`](.github/workflows/build.yml)，**手动触发**（Actions → Build APK and IPK → Run workflow）：

1. `lint` — JS 语法（`node --check`）、JSON 解析、`msgfmt` 校验、ACL/菜单一致性检查
2. `build` — 分别用 ImmortalWrt 25.12 SDK 编译 APK、24.10 SDK 编译 IPK；每种格式生成主包、中文翻译包和独立离线 RUN，包架构均为 `all`
3. `release` — 两种格式全部编译成功后上传同一个 Release，核验主包和对应离线包均齐全后才清理旧发布（tag 可在触发时指定，留空则自动生成）

下载位置：运行摘要中的「下载本次安装包」，或仓库 [Releases](https://github.com/PEIT98/luci-app-qmodem-generic/releases) 的附件；iStore 安装按包管理器选择对应的离线 RUN。Actions 下载包保留 30 天；即使发布步骤失败，已上传的下载包仍可使用。`Static check` 只检查源码，不生成安装包；必须等 `build` 的编译和上传步骤成功。

## 界面主题与响应式（QM UI v2）

在 **高级 → 外观主题** 中切换配色，默认使用蓝绿渐变；提供清爽蓝、暮光紫和跟随系统主题，以及自动 / 浅色 / 深色模式。选择立即生效并保存到当前浏览器，所有移动网络页面共用，不需要重启模组。

高级页只保留外观、支持库、能力诊断和专有硬件设置；网络模式、网络优选与锁频统一在「无线与小区」，重启统一在「模组与 SIM 卡」，AT 调试统一在「AT 终端」。连接示意图使用可换行的中文节点，手机上纵向排列；SIM 未就绪或状态未知时不显示活动连接动画，系统要求减少动态效果时保留静态连接线。

前端视觉层统一由 `htdocs/luci-static/resources/qmodem-generic/theme.js` 提供，只改前端、
不动任何数据链路：

- **兼容任意 LuCI 主题**：颜色走 `--qm-*` 令牌；自动明暗时表面与文字跟随 LuCI，主色使用所选配色。选择「跟随系统主题」后，主色也跟随 LuCI；支持 `color-mix()` 的浏览器会同步派生柔和背景与边框。
- **明暗自适应**：探测主题底色亮度 → `body` 加 `qm-dark`，内置调色板随之切换；
  老主题（无 CSS 变量）与系统深色偏好同样生效。
- **响应式**：栅格 `auto-fit` + 断点 1280 / 1024 / 820 / 560，手机端表单上下堆叠、
  表格可横滑、按钮触摸目标 ≥ 38px，SMS 双栏会话在窄屏改单栏。
- **历史页面免重写**：8 个视图的旧私有类名由统一适配层换肤，SVG 内嵌颜色通过
  属性选择器（`[stroke="#0072f5"]`）令牌化，无需改动 SVG 字符串。

新页面建议直接使用标准件：`.qm-shell` / `.qm-grid` / `.qm-card` / `.qm-stat` /
`.qm-badge` / `.qm-kv` / `.qm-btn` / `.qm-alert`（`theme.card()` 等 helper 亦可）。
详见 [QM UI v2 设计与落地说明](docs/QMODEM_UI_THEME.md)。

## 数据获取与降级（直连官方接口）

自 3.0.0 起，前端与 QModem 官方 `luci-app-qmodem-next` 采用完全相同的接线方式：

- **直连官方 ubus 对象**：`qmodem` / `qmodem.sms` / `qmodem.uplink` / `rc` / `luci` / `network.*`。
  不经过任何私有快照层或任务队列，方法映射见
  [docs/QMODEM_OFFICIAL_WIRING.md](docs/QMODEM_OFFICIAL_WIRING.md)。
- **QModem rpcd 自带 10 秒缓存**（`/tmp/cache_*`）：页面轮询不会击穿模组 AT 串口，
  数据新鲜度与官方 LuCI 完全一致。
- **读写失败如实上报**：所有读路径带客户端超时并降级显示 `--`；所有写路径显式
  `reject` 并校验官方返回的 `status` / `success` / 退出码，失败直接提示，绝不静默成功。
- **轮询不堆叠**：上一次采集未完成绝不发起下一次；切后台自动降频，离开页面自动停止。
- 模组失联 / AT 口不存在 / 正在 reset 时页面照常打开；未就绪字段显示 `--`。

本地验证：

```sh
node tests/run-frontend-tests.js               # 前端 247 项（需要 node）
sh tests/run-frontend-tests.sh                 # 无 node 时自动跳过
python3 tests/check-po.py po/zh_Hans/qmodem-generic.po
```

## 已知事项

- 前端命名空间（资源目录、JS 模块、菜单路由、CSS 类名）统一为 `qmodem-generic`，与具体模组型号彻底解耦；`po/zh_Hans/qmodem-generic.po` 已与当前 JavaScript UI 字符串同步。
- **字段未上报时的降级显示**：部分模组不会上报全部字段，QModem 会以占位值回填（如 FM350-GL 温度回 `"0°C"`、带宽回 `"M"`）。本包对占位值做归一化，未上报字段统一显示 `--`。
- **上下行调制信息**：3.0.0 起随私有 `qos` 插件一并移除；QModem 官方 `network_info` 未提供该字段，页面不再显示 MCS / 调制方式。
- **LuCI 26.x（Master 26.246+）**：移除了 `String.prototype.format` 与全局 `E()` / `findParent()`。本包在 `controls.js` 顶部带有按需注入的兼容层（缺失才注入，不覆盖已有实现）。
- **QModem rpcd 缓存**：信息类方法由 QModem rpcd 侧缓存约 10 秒（`/tmp/cache_*`），页面轮询直接命中缓存；rpcd 未加载该插件时按官方接口实际返回处理。
- **短信列表按需读取**：旧通道（`qmodem.get_sms`）读取在部分模组上极慢，前端带 30 秒 TTL 与在途去重；数据库模式（`qmodem.sms`）分页读取，删除前回读模组确认。
- **`settings` 与 `terminal` 页不做轮询重绘**：避免把用户未保存的表单内容 / AT 会话日志冲掉。

## 相关文档

- [逐页修复与验证范围（2.5.0-3）](docs/QMODEM_PAGE_REVIEW.md)

- [官方 ubus 接口对接说明（3.0.0 起）](docs/QMODEM_OFFICIAL_WIRING.md)
- [QModem 通用美化版 UI 重构与自我审查报告](docs/QMODEM_GENERIC_UI_REPORT.md)
- [QM UI v2 视觉层设计与落地说明](docs/QMODEM_UI_THEME.md)
- [重构契约（数据层 API 约定）](docs/QMODEM_REFACTOR_CONTRACT.md)
- [更新日志 CHANGELOG.md](CHANGELOG.md)

## 致谢

- [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m) — 本项目的前身，鼎桥 MT5700M 专用 LuCI 界面
- [FUjr/QModem](https://github.com/FUjr/QModem) — 后端与 `luci-app-qmodem-next` 的权威实现参考
- [immortalwrt/immortalwrt](https://github.com/immortalwrt/immortalwrt) — 编译所用 SDK

## 许可

Apache License 2.0，见 [LICENSE](LICENSE)。
