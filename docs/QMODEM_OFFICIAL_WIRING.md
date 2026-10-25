# QModem 官方接口对接说明（3.0.0 起）

本文档描述 `luci-app-qmodem-generic` 与 QModem 官方 LuCI 接口（ubus）的完整对接关系。
自 3.0.0 起，本插件与官方 `luci-app-qmodem-next` 采用相同的接线方式：**直连官方 ubus
对象，不经过任何私有快照层 / 任务队列**。QModem 的 rpcd 插件（`/usr/libexec/rpcd/qmodem`）
对信息类方法自带 10 秒文件缓存（`/tmp/cache_*`），页面轮询不会击穿模组 AT 串口。

QModem 接口契约见官方文档：QModem 仓库 `docs/qmodem-rpcd-interface.md`。

## ubus 对象与本插件功能的对应关系

### `qmodem`（核心模组对象，QModem 主包提供）

| 官方方法 | 类型 | 本插件功能 | 所在页面 |
|---|---|---|---|
| base_info / cell_info / sim_info / network_info / info | 读 | 概览信号/载波/SIM/网络卡、完整模组信息 | status |
| get_at_cfg | 读 | AT 端口列表 + 官方快捷命令表（cmds） | terminal / sms |
| send_at | 写 | AT 终端、短信中心/存储/IMS 透传、MT5700 专有设置 | terminal / sms / advanced / system |
| get_imei / set_imei | 读/写 | IMEI 查看/写入（写入后回读校验） | system |
| get_mode / set_mode | 读/写 | 网络/拨号模式 | network |
| get_lockband / set_lockband | 读/写 | 频段锁定 | network |
| get_network_prefer / set_network_prefer | 读/写 | 网络优选 | network |
| get_neighborcell / set_neighborcell | 读/写 | 邻区扫描与锁小区 | network |
| get_current_band(_capabilities) | 读 | 当前频段与载波聚合（PCC/SCC/NSA） | status / network |
| get_connect_status / dial_status | 读 | 连接判定（三来源合并）与拨号服务状态 | status / connection |
| get_dns | 读 | 移动 IP / DNS | status / connection |
| get_dial_log / clear_dial_log | 读/写 | 拨号日志查看与清除 | connection |
| get_sim_slot / set_sim_slot / get_sim_switch_capabilities | 读/写 | SIM 卡槽切换 | system |
| get_reboot_caps / do_reboot | 读/写 | 模组软/硬重启 | system |
| get_stats / save_stats / clear_stats | 读/写 | 流量统计、开启模组自动落盘、清零 | status |
| get_traffic_reset_schedule / set_traffic_reset_schedule | 读/写 | 流量自动清零计划 | status |
| get_sms / send_sms / delete_sms / send_raw_pdu | 读/写 | 旧通道短信（qmodem.sms 缺失时回退）、PDU 直发 | sms |
| set_sms_storage | 写 | 存储位置切换（旧通道回退） | sms |
| modem_dial / modem_hang / modem_redial | 写 | 开始拨号 / 挂断 / 重拨 | connection |
| get_5g_lan / set_5g_lan | 读/写 | 5G LAN 开关（不支持的模组优雅降级） | connection |
| get_monitor_status | 读 | qmodem_monitor 断线监测状态 | connection |
| scan_pcie / scan_usb / scan_all | 写 | 设备扫描 | settings |
| get_pcie_devices / get_usb_devices / get_available_devices | 读 | 可添加设备列表 | settings |
| get_tty_ports / get_leds / get_network_interfaces | 读 | AT 端口提示、设备下拉数据源 | settings |
| remove_modem | 写 | 移除模组（挂断 + 删节 + 清理网络配置） | settings |
| get_disabled_features | 读 | 特性限制胶囊（锁定相关卡片自动禁用） | network / advanced |
| get_copyright | 读 | 版权信息 | advanced |

### `qmodem.sms`（短信守护进程 qmodem_smsd）

| 官方方法 | 本插件功能 |
|---|---|
| config_get | 探测服务与接收模式（direct / database_poll / database_urc） |
| list / get | 数据库收发记录（分页加载） |
| send / delete / mark_read | 数据库模式收发、删除、已读标记 |
| sync / sync_status | 立即同步与最近同步状态（sms 设置弹窗） |
| status / modem_list | 服务状态（sms 设置弹窗） |
| storage_get / storage_set | ME/SM 存储占用与三槽位切换（sms 设置弹窗） |
| configure | 接收模式 / 轮询间隔 / 自动删除 / 转发 / 国家码 |

服务缺失或 direct 模式时自动回退 `qmodem.get_sms` / `send_sms` / `delete_sms` 旧通道。

### 其它官方对象

| 对象.方法 | 本插件功能 |
|---|---|
| `qmodem.uplink status` | 上联管理（多上行负载均衡/故障切换）状态卡 |
| `rc list` + `luci setInitAction` | qmodem_network 拨号服务启停 / 自启 / 全局 enable_dial |
| `network.interface dump` / `network.device status` | 模组逻辑接口地址 / DNS / MTU（连接判定来源之一） |
| `uci`（qmodem, network） | 设备参数、APN/PDP、全局扫描开关、添加模组配置节 |

## 随包附带的两个增值组件（只依赖官方接口）

1. **分天流量统计**（`qmodem_stats` rpcd 插件 + `qmodem-stats-collect` 采样服务）
   - 数据源仅为官方 `qmodem get_stats`（vendor AT 计数），缺失时回退 netdev 内核计数器；
   - 60 秒后台采样写 `/etc/qmodem-stats/<section>.stats`（UTC+8 切日，重启保留）；
   - rpcd `daily_stats` 只读文件（毫秒级）；`stats_reset` 用户显式触发，带硬超时。
2. **模组支持库**（`qmodem_support` rpcd 插件 + `qmodem-modem-support` 合并服务）
   - 官方 `modem_support.json` 只读查看、插件预设注入、用户自定义型号管理、候选串口 AT 探测；
   - 合并/探测均在 rpcd 侧带硬超时并自动备份回滚。

## 已移除的私有架构（3.0.0）

- `qmodem_cache` rpcd 插件（快照 + 任务队列）与 `qmodem-worker` / `qmodem-task`
  —— 读写改为直连官方接口，QModem rpcd 自带缓存兜底；
- `qos` rpcd 插件（AT 探测 QCI/调制）—— QCI/5QI/签约速率改用官方 `network_info` 字段；
- `qmodem-mt5700-fix` 服务 —— 设备相关 UCI 修补不再随包携带；
- 相关的 `qmodem-lib.sh` 缓存/锁封装仅保留支持库与统计组件所需的最小用法。

升级安装时 `uci-defaults` 钩子会自动 `disable`/`stop` 上述旧服务并清理注册。
