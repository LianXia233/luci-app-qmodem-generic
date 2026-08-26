# luci-app-qmodem-generic

[![Build IPK & APK](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml/badge.svg)](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml)
![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![Target](https://img.shields.io/badge/LuCI-PKGARCH%3Aall-green.svg)

> **QModem 的通用美化版 LuCI Web UI。** 界面数据全部经由 QModem 的 `qmodem` ubus 对象读取，不绑定任何具体模组型号 —— QModem 识别到什么模组、返回什么字段，界面就显示什么。
>
> 本项目由 [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m)（鼎桥 MT5700M 专用界面）重构而来，已完全去除私有文本后端 `/usr/sbin/mt5700m-at`，改为纯 `qmodem` ubus 链路。

## 目录

- [功能特性](#功能特性)
- [安装后文件布局](#安装后文件布局)
- [依赖与支持的版本](#依赖与支持的版本)
- [安装](#安装)
- [流量统计（本机持久化分天记录）](#流量统计本机持久化分天记录)
- [MT5700 系列 SIM 初始化（自动修复）](#mt5700-系列-sim-初始化自动修复)
- [自行编译](#自行编译)
- [GitHub Actions 自动构建](#github-actions-自动构建)
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
| 高级 Advanced | 诊断控制台、IP 透传 / Post-Route / DMZ 等 |
| AT 控制台 | 经 `qmodem` ubus 下发 AT 命令（从「高级」页进入） |
| 设备参数设置 | QModem `modem-device` 配置节（从「高级 / 模组与 SIM」页进入） |

**亮点**

- 纯 `qmodem` ubus 链路，无私有后端，全模组通用。
- 动态字段自适应：QModem 返回的任何未知字段按 `full_name` 原样展示，内置字段使用中文标签映射。
- 自带流量统计后台采集服务，重启不丢数据，按中国时区（UTC+8）分天记录。
- MT5700 系列海思模组 SIM 卡槽上电自动初始化（开机服务 + 首次安装脚本）。

## 安装后文件布局

本包除 LuCI 前端资源外，还附带若干后端脚本与服务。关键文件分布如下：

```
/etc/
  config/qmodem                 # QModem 配置（本包读取的 modem-device 节）
  init.d/
    qmodem-stats-collect        # 流量采样 procd 服务（开机自启）
    qmodem-mt5700-fix           # MT5700 SIM 初始化开机服务（START=99）
  uci-defaults/
    99_luci-app-qmodem-generic  # 首次安装：执行修复并 enable 上述服务
  qmodem-stats/                 # 流量数据目录（overlay 持久分区，可直接备份）
/usr/
  bin/
    qmodem-stats-collect        # 采样 / 落盘 / 输出 JSON / 清零（run/show/reset）
    qmodem-stats-loop           # 按间隔驱动采集器的常驻循环
  sbin/
    qmodem-mt5700-fix           # SIM 初始化修复脚本（幂等）
  libexec/rpcd/
    qmodem_stats                # rpcd 插件：daily_stats / stats_history / stats_reset
/www/luci-static/resources/mt5700m/   # 前端资源（历史前缀，见「已知事项」）
```

> 注意：内部资源路径 / 菜单路由 / CSS 类名仍沿用 `mt5700m` 前缀，属历史包袱，改动会破坏加载与导航，故保留。

## 依赖与支持的版本

| 目标系统 | 包格式 | 状态 |
| --- | --- | --- |
| ImmortalWrt 23.05 | `.ipk` | ✅ 支持 |
| ImmortalWrt 24.10 | `.ipk` | ✅ 支持 |
| ImmortalWrt 25.12 | `.apk` | ✅ 支持 |
| ImmortalWrt snapshot | `.apk` | ⚠️ 允许失败 |

**前置依赖**：运行时依赖 [`qmodem`](https://github.com/FUjr/QModem) 后端，请**先安装 QModem** 再安装本包。本包是 `LUCI_PKGARCH:=all` 的纯前端包，一个架构编译出的产物可用于所有架构。

## 安装

```sh
# opkg（ImmortalWrt 23.05 / 24.10）
opkg install luci-app-qmodem-generic_*.ipk

# apk（ImmortalWrt 25.12 / snapshot）
apk add --allow-untrusted ./luci-app-qmodem-generic-*.apk
```

> ⚠️ 若设备上此前安装过 `luci-app-mt5700m`，请先 `opkg remove luci-app-mt5700m` 再安装本包，两者会在 `luci-static/resources/mt5700m/` 下产生文件冲突。

安装后在 LuCI 菜单 **移动网络 → 模组管理** 下使用。

## 流量统计（本机持久化分天记录）

概览页「流量统计」卡片由本包自带的采集服务驱动，与模组侧计数相互独立：

- **后台采样**：procd 服务 `/etc/init.d/qmodem-stats-collect` 开机自启，`/usr/bin/qmodem-stats-loop` 每 60 秒调用一次 `/usr/bin/qmodem-stats-collect run <配置节>`，无论 LuCI 是否打开都不漏记。
- **重启不丢失**：记录落盘于 overlay 持久分区 `/etc/qmodem-stats/<配置节>.stats`，自动保留最近 90 天。
- **按中国时区（UTC+8）切日**：日期边界由 `epoch+28800` 计算，不受路由器系统时区影响；跨零点采样的增量归属相邻日。
- **上下行方向自动识别（兼容所有模组）**：正常模组 `rx`(下行) 远大于 `tx`(上行)；个别驱动把两个计数器接反。累计流量超过 50MB 且 `tx > rx` 时判定方向颠倒（`swapped=1`），前端自动交换下载/上传显示并给出提示。
- **全模组通用计数器来源**：优先 QModem `get_stats`，未实现时回退内核 netdev 计数器（`/sys/class/net/<dev>/statistics/*_bytes`）；模组重拨/计数器回绕时按新值起算，不会误录增量。
- **自动 / 手动清零**：「流量自动清零」卡片设置定时清零计划（QModem 原生能力）；「立即清零」在模组侧清零的同时同步清零本机累计与分天记录（rpcd 方法 `qmodem_stats.stats_reset`），清零保留计数器基准，不会把清零前的差额误记为新流量。

相关文件：

| 文件 | 作用 |
| --- | --- |
| `/usr/bin/qmodem-stats-collect` | 采样 / 落盘 / 输出 JSON / 清零（`run` / `show` / `reset`） |
| `/usr/bin/qmodem-stats-loop` | 按间隔驱动采集器的常驻循环 |
| `/etc/init.d/qmodem-stats-collect` | procd 服务，为每个启用的 modem-device 启动一个循环实例 |
| `/usr/libexec/rpcd/qmodem_stats` | rpcd 插件：`daily_stats` / `stats_history` / `stats_reset` |
| `/etc/qmodem-stats/` | 数据目录（持久分区，可直接备份） |

## MT5700 系列 SIM 初始化（自动修复）

MT5700M-CN 等海思平台模组上电后 SIM 卡槽处于未初始化状态，QModem 拨号流程不会主动发送 `AT^SCICHG=0,1`，导致 `AT+CPIN?` 返回 `+CME ERROR: 10`（SIM 未识别）。

本包通过 OpenWrt 的 `init.d` 服务（`/etc/init.d/qmodem-mt5700-fix`，`START=99`）在**每次开机**自动遍历 `/etc/config/qmodem` 中的 `modem-device` 配置节：凡 `model` / `name` / `manufacturer` 字段匹配 `MT5700`（不区分大小写）的模组，自动向其 `pre_dial_at_cmds` 列表追加 `AT^SCICHG=0,1` 并提交：

```sh
uci add_list qmodem.<section>.pre_dial_at_cmds='AT^SCICHG=0,1'
uci commit qmodem
```

QModem 在拨号前会逐条执行 `pre_dial_at_cmds`，从而在上电后正确初始化 SIM 卡槽。

- 修复逻辑：`/usr/sbin/qmodem-mt5700-fix`（被开机服务与首次安装脚本共同调用）
- 开机服务：`/etc/init.d/qmodem-mt5700-fix`，并监听 `qmodem` 配置变更后自动重跑，以应对模组在更晚阶段才被识别的情况
- 首次安装：`/etc/uci-defaults/99_luci-app-qmodem-generic` 会立即执行一次修复并 `enable` 上述开机服务
- 幂等：重复运行不会重复添加同一命令
- 手动触发（无需重启）：
  ```sh
  /usr/sbin/qmodem-mt5700-fix
  ```

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
2. `build` — 用 ImmortalWrt SDK 矩阵编译

   | 矩阵 | SDK | 包格式 | 必需 |
   | --- | --- | --- | --- |
   | `immortalwrt-23.05-ipk` | 23.05.7 | `.ipk` | ✅ |
   | `immortalwrt-24.10-ipk` | 24.10.6 | `.ipk` | ✅ |
   | `immortalwrt-25.12-apk` | 25.12.1 | `.apk` | ✅ |
   | `immortalwrt-snapshot-apk` | snapshots | `.apk` | 允许失败 |

3. `release` — 把所有产物上传到 Release（tag 可在触发时指定，留空则自动生成）

本包是 `LUCI_PKGARCH:=all` 的纯前端包，一个架构编译出的产物可用于所有架构。

## 已知事项

- `po/zh_Hans/qmodem-generic.po` 已与当前 JavaScript UI 字符串同步；QModem 动态返回的未知字段会按 `full_name` 原样显示，内置字段使用中文标签映射。
- 内部资源路径 / 菜单路由 / CSS 类名仍沿用 `mt5700m` 前缀，属历史包袱，改动会破坏加载与导航，故保留。
- `sms.js` 的导入导出文件名与 `localStorage` 键仍含 `mt5700m-` 前缀（为兼容既有备份）。

## 相关文档

- [QModem 通用美化版 UI 重构与自我审查报告](docs/QMODEM_GENERIC_UI_REPORT.md)
- [重构契约（数据层 API 约定）](docs/QMODEM_REFACTOR_CONTRACT.md)
- [更新日志 CHANGELOG.md](CHANGELOG.md)

## 致谢

- [FAN789/luci-app-mt5700m](https://github.com/FAN789/luci-app-mt5700m) — 本项目的前身，鼎桥 MT5700M 专用 LuCI 界面
- [FUjr/QModem](https://github.com/FUjr/QModem) — 后端与 `luci-app-qmodem-next` 的权威实现参考
- [immortalwrt/immortalwrt](https://github.com/immortalwrt/immortalwrt) — 编译所用 SDK

## 许可

Apache License 2.0，见 [LICENSE](LICENSE)。
