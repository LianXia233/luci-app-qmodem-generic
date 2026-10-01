# luci-app-qmodem-generic

[![Build IPK & APK](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml/badge.svg)](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Target](https://img.shields.io/badge/LuCI-PKGARCH%3Aall-green.svg)

> **QModem 的通用美化版 LuCI Web UI。** 界面数据全部经由 QModem 的 `qmodem` ubus 对象读取，不绑定任何具体模组型号 —— QModem 识别到什么模组、返回什么字段，界面就显示什么。
>
> 本项目由 [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m)（鼎桥 MT5700M 专用界面）重构而来，已完全去除私有文本后端，改为纯 `qmodem` ubus 链路。

## 目录

- [功能特性](#功能特性)
- [文件布局](#文件布局)
- [依赖与版本](#依赖与版本)
- [安装](#安装)
- [流量统计](#流量统计)
- [MT5700 系列 SIM 初始化](#mt5700-系列-sim-初始化)
- [模组支持库自动注入](#模组支持库自动注入)
- [自行编译](#自行编译)
- [GitHub Actions 自动构建](#github-actions-自动构建)
- [页面加载与后台任务（异步化）](#页面加载与后台任务异步化)
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
| 短信 Messages | 基于 SIM 的收发与会话视图 |
| 模组与 SIM | 模组身份、SIM 信息与维护操作 |
| 高级 Advanced | 模组支持库同步、诊断控制台、IP 透传 / Post-Route / DMZ 等 |
| AT 控制台 | 经 `qmodem` ubus 下发 AT 命令（从「高级」页进入） |
| 设备参数设置 | QModem `modem-device` 配置节（从「高级 / 模组与 SIM」页进入） |

**亮点**

- 纯 `qmodem` ubus 链路，无私有后端，全模组通用；动态字段自适应，内置字段使用中文标签映射。
- 自带流量统计后台采集服务，重启不丢数据，按中国时区（UTC+8）分天记录。
- MT5700 系列海思模组 SIM 卡槽上电自动初始化（开机服务 + 首次安装脚本）。
- 内置模组定义自动注入 QModem 支持库（当前含 Quectel RG520N-CN），替代手工编辑 `modem_support.json`。

## 文件布局

本包除 LuCI 前端资源外，还附带若干后端脚本与服务，均使用 `qmodem-generic` 命名空间：

```
/etc/config/qmodem                  # QModem 配置（本包读取的 modem-device 节）
/etc/init.d/qmodem-worker           # 后台采集 procd 服务（唯一访问 modem 的常驻进程）
/etc/init.d/qmodem-stats-collect    # 流量采样 procd 服务（开机自启）
/etc/init.d/qmodem-mt5700-fix       # MT5700 SIM 初始化开机服务（START=99）
/etc/init.d/qmodem-modem-support    # 模组支持库同步开机服务（START=90）
/etc/uci-defaults/99_luci-app-qmodem-generic  # 首次安装：执行修复/同步并 enable 服务
/tmp/qmodem-cache/                  # 状态缓存（原子写入的 JSON 快照 + 任务 + 锁）
/usr/bin/qmodem-task                # 后台任务队列（new/get/list/prune/_run，带去重与超时）
/usr/bin/qmodem-stats-collect       # 流量采样 / 落盘 / 输出 JSON / 清零
/usr/bin/qmodem-stats-loop          # 按间隔驱动采集器的常驻循环
/usr/sbin/qmodem-worker             # 后台采集器（周期采集缓存域，硬超时 + AT 串行化）
/usr/sbin/qmodem-mt5700-fix         # SIM 初始化修复脚本（幂等）
/usr/sbin/qmodem-modem-support      # 模组支持库合并脚本（幂等，写入前备份）
/usr/lib/qmodem/qmodem-lib.sh       # 公共库：JSON 原子写、flock 互斥、带超时 ubus 调用
/usr/lib/qmodem/qmodem-at-probe     # 带超时的 AT 探测工具
/usr/libexec/rpcd/qmodem_cache      # rpcd 插件：快速读缓存 + 后台任务
/usr/libexec/rpcd/qmodem_stats      # rpcd 插件：daily_stats / stats_history / stats_reset
/usr/libexec/rpcd/qmodem_support    # rpcd 插件：status / sync
/usr/libexec/rpcd/qos               # rpcd 插件：qos_info / radio_info
/usr/share/qmodem-generic/extra_modem_support.json  # 内置待注入模组定义
/www/luci-static/resources/qmodem-generic/          # 前端资源
```

## 依赖与版本

| 目标系统 | 包格式 | 状态 |
| --- | --- | --- |
| ImmortalWrt 25.12 | `.apk` | 支持 |
| ImmortalWrt snapshot | `.apk` | 允许失败 |

**兼容基线**：OpenWrt / ImmortalWrt **25.12 及更新版本**，不支持 24.10 及更早。**前置依赖**：运行时依赖 [`qmodem`](https://github.com/FUjr/QModem) 后端，请先安装 QModem 再安装本包。本包是 `LUCI_PKGARCH:=all` 的纯前端包，一个架构编译出的产物可用于所有架构。

## 安装

```sh
# apk（ImmortalWrt 25.12 / snapshot）
apk add --allow-untrusted ./luci-app-qmodem-generic-*.apk
```

> 若设备上此前安装过旧版 `luci-app-mt5700m`，请先 `opkg remove luci-app-mt5700m` 再安装本包，避免旧包残留的菜单与 ACL 条目干扰。

安装后在 LuCI 菜单 **移动网络 → 模组管理** 下使用。

## 流量统计

概览页「流量统计」卡片由本包自带的采集服务驱动，与模组侧计数相互独立：

- **后台采样**：procd 服务开机自启，每 60 秒采样一次，无论 LuCI 是否打开都不漏记。
- **重启不丢失**：落盘于 overlay 持久分区，自动保留最近 90 天。
- **按中国时区（UTC+8）切日**：日期边界由 `epoch+28800` 计算，不受系统时区影响；跨零点增量归属相邻日。
- **上下行方向自动识别**：累计流量超过 50MB 且 `tx > rx` 时判定方向颠倒，前端自动交换下载/上传显示。
- **全模组通用计数器**：优先 QModem `get_stats`，未实现时回退内核 netdev 计数器；重拨/回绕时按新值起算。
- **自动 / 手动清零**：「流量自动清零」卡片设置定时清零计划（QModem 原生能力）；「立即清零」同步清零本机累计与分天记录，保留计数器基准。

相关文件：`/usr/bin/qmodem-stats-collect`（run/show/reset）、`/usr/bin/qmodem-stats-loop`、`/etc/init.d/qmodem-stats-collect`、`/usr/libexec/rpcd/qmodem_stats`、数据目录 `/etc/qmodem-stats/`。

## MT5700 系列 SIM 初始化

MT5700M-CN 等海思平台模组上电后 SIM 卡槽处于未初始化状态，QModem 拨号不会主动发送 `AT^SCICHG=0,1`，导致 `AT+CPIN?` 返回 `+CME ERROR: 10`（SIM 未识别）。

本包通过开机服务（`/etc/init.d/qmodem-mt5700-fix`，`START=99`）自动遍历 `/etc/config/qmodem` 中的 `modem-device` 配置节：凡型号匹配 `MT5700`（不区分大小写）的模组，自动向其 `pre_dial_at_cmds` 列表追加 `AT^SCICHG=0,1` 并提交，QModem 拨号前会逐条执行。

- 修复逻辑：`/usr/sbin/qmodem-mt5700-fix`（幂等，重复运行不重复添加）
- 开机服务监听 `qmodem` 配置变更后自动重跑，以应对模组在更晚阶段才被识别
- 手动触发（无需重启）：
  ```sh
  /usr/sbin/qmodem-mt5700-fix
  ```

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

**生效条件**：QModem 只在启动 / 重扫时读取支持库，注入后需 `/etc/init.d/qmodem restart` 或重启设备。追加其它型号：编辑 `/usr/share/qmodem-generic/extra_modem_support.json`（结构同 QModem 支持库），再执行 `/usr/sbin/qmodem-modem-support`。

相关文件：`/usr/share/qmodem-generic/extra_modem_support.json`、`/usr/sbin/qmodem-modem-support`（`--status` 只查询，`--json` 机器可读）、`/etc/init.d/qmodem-modem-support`、`/usr/libexec/rpcd/qmodem_support`。

## 自行编译

作为 feed 加入 OpenWrt / ImmortalWrt 源码树：

```sh
echo 'src-git qmodem_generic https://github.com/LianXia233/luci-app-qmodem-generic.git' >> feeds.conf.default
./scripts/feeds update qmodem_generic
./scripts/feeds install -a -p qmodem_generic
make menuconfig   # LuCI -> Applications -> luci-app-qmodem-generic
make package/luci-app-qmodem-generic/compile V=s
```

## GitHub Actions 自动构建

仓库内置 [`.github/workflows/build.yml`](.github/workflows/build.yml)，**手动触发**（Actions → Build IPK & APK → Run workflow）：

1. `lint` — JS 语法（`node --check`）、JSON 解析、`msgfmt` 校验、ACL/菜单一致性检查
2. `build` — ImmortalWrt SDK 矩阵编译：`immortalwrt-25.12-apk`（必需）、`immortalwrt-snapshot-apk`（允许失败）
3. `release` — 把所有产物上传到 Release（tag 可在触发时指定，留空则自动生成）

## 页面加载与后台任务（异步化）

自 2.4.11-16 起，**LuCI 首屏不再等待任何 modem 查询**：

- 页面 `load()` 只读 UCI + 一次 `qmodem_cache.snapshot`（纯文件 IO，实测 < 100 ms），随后立即渲染整页；数据未就绪的字段显示 `--`，并标注「离线 / 数据过期」。
- 所有慢活（模组探测、AT、SIM、IMEI、信号、注册、运营商、邻区、拨号、接口检查、初始化、重启、流量统计）都在后台任务里执行；写操作立即返回 `task_id`，前端轮询进度，同类任务自动去重。
- 模组失联 / AT 口不存在 / 正在 reset 时页面照常打开；轮询不堆叠，切后台自动降频，离开页面自动停止。

设计与 12 项验收结论见 [docs/QMODEM_ASYNC_ARCHITECTURE.md](docs/QMODEM_ASYNC_ARCHITECTURE.md)。

本地验证：

```sh
sh tests/run-backend-tests.sh                  # 后端 67 项（dash / busybox sh 均可）
TEST_SH="busybox sh" sh tests/run-backend-tests.sh
sh tests/run-frontend-tests.sh                 # 前端 94 项（需要 node）
python3 tests/check-po.py po/zh_Hans/qmodem-generic.po
```

## 已知事项

- 前端命名空间（资源目录、JS 模块、菜单路由、CSS 类名）统一为 `qmodem-generic`，与具体模组型号彻底解耦；`po/zh_Hans/qmodem-generic.po` 已与当前 JavaScript UI 字符串同步。
- **字段未上报时的降级显示**：部分模组不会上报全部字段，QModem 会以占位值回填（如 FM350-GL 温度回 `"0°C"`、带宽回 `"M"`）。本包对占位值做归一化，未上报字段统一显示 `--`。
- **上下行调制**：来自 `qos` 对象的 `radio_info`；模组/固件不支持时返回 `{"status":"unavailable"}`，页面显示 `--` 属预期降级。
- **LuCI 26.x（Master 26.246+）**：移除了 `String.prototype.format` 与全局 `E()` / `findParent()`。本包在 `controls.js` 顶部带有按需注入的兼容层（缺失才注入，不覆盖已有实现）。
- **缓存层不可用时自动降级**：若 `qmodem_cache` 插件未安装或 rpcd 未重启，前端会在 60 s 冷却窗口内退回直连 QModem。升级后请执行 `/etc/init.d/rpcd restart` 与 `/etc/init.d/qmodem-worker restart`。
- **短信列表按需采集**：读短信在部分模组上极慢，`sms` 域不进周期采集；进入「短信」页时后台排队，数据到位后自动补上。
- **`settings` 与 `terminal` 页不做轮询重绘**：避免把用户未保存的表单内容 / AT 会话日志冲掉。

## 相关文档

- [异步化架构（后端任务不阻塞页面加载）](docs/QMODEM_ASYNC_ARCHITECTURE.md)
- [QModem 通用美化版 UI 重构与自我审查报告](docs/QMODEM_GENERIC_UI_REPORT.md)
- [重构契约（数据层 API 约定）](docs/QMODEM_REFACTOR_CONTRACT.md)
- [更新日志 CHANGELOG.md](CHANGELOG.md)

## 致谢

- [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m) — 本项目的前身，鼎桥 MT5700M 专用 LuCI 界面
- [FUjr/QModem](https://github.com/FUjr/QModem) — 后端与 `luci-app-qmodem-next` 的权威实现参考
- [immortalwrt/immortalwrt](https://github.com/immortalwrt/immortalwrt) — 编译所用 SDK

## 许可

Apache License 2.0，见 [LICENSE](LICENSE)。
