# luci-app-qmodem-generic

[![Build IPK & APK](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml/badge.svg)](https://github.com/LianXia233/luci-app-qmodem-generic/actions/workflows/build.yml)

QModem 的**通用美化版 LuCI Web UI**。所有界面数据都通过 QModem 的 `qmodem` ubus 对象读取，
不绑定任何具体模组型号 —— QModem 识别到什么模组、返回什么字段，界面就显示什么。

> 本项目由 `luci-app-mt5700m`（鼎桥 MT5700M 专用界面）重构而来，已完全去除私有文本后端
> `/usr/sbin/mt5700m-at`，改为纯 `qmodem` ubus 链路。

## 功能

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

多模组设备会在页面顶部出现模组选择器，切换后本地持久化。

## 安装

运行时依赖 [`qmodem`](https://github.com/FUjr/QModem)，请先安装 QModem。

```sh
# opkg（ImmortalWrt 23.05 / 24.10）
opkg install luci-app-qmodem-generic_*.ipk

# apk（ImmortalWrt 25.12 / snapshot）
apk add --allow-untrusted ./luci-app-qmodem-generic-*.apk
```

> ⚠️ 若设备上此前安装过 `luci-app-mt5700m`，请先 `opkg remove luci-app-mt5700m` 再安装本包，
> 两者会在 `luci-static/resources/mt5700m/` 下产生文件冲突。

安装后在 LuCI 菜单 **移动网络 → 模组管理** 下使用。

## 自行编译

作为 feed 加入 OpenWrt / ImmortalWrt 源码树：

```sh
echo 'src-git qmodem_generic https://github.com/LianXia233/luci-app-qmodem-generic.git' >> feeds.conf.default
./scripts/feeds update qmodem_generic
./scripts/feeds install -a -p qmodem_generic
make menuconfig   # LuCI -> Applications -> luci-app-qmodem-generic
make package/luci-app-qmodem-generic/compile V=s
```

## GitHub Actions

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

- `po/zh_Hans/qmodem-generic.po` 与当前代码尚未完全同步：约 322 条 UI 字符串缺翻译条目，
  另有约 678 条为旧版本遗留的陈旧条目。不影响编译与运行，但英文界面下部分文案会显示为中文源串。
- 内部资源路径 / 菜单路由 / CSS 类名仍沿用 `mt5700m` 前缀，属历史包袱，改动会破坏加载与导航，故保留。
- `sms.js` 的导入导出文件名与 `localStorage` 键仍含 `mt5700m-` 前缀（为兼容既有备份）。

## 文档

- [QModem 通用美化版 UI 重构与自我审查报告](docs/QMODEM_GENERIC_UI_REPORT.md)
- [重构契约（数据层 API 约定）](docs/QMODEM_REFACTOR_CONTRACT.md)

## 致谢

- [FUjr/QModem](https://github.com/FUjr/QModem) — 后端与 `luci-app-qmodem-next` 的权威实现参考
- [immortalwrt/immortalwrt](https://github.com/immortalwrt/immortalwrt) — 编译所用 SDK

## 许可

Apache License 2.0，见 [LICENSE](LICENSE)。
