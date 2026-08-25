# QModem 通用美化版 UI — 视图改写规范（重构契约）

本文件是 `luci-app-mt5700m` 重构为"完全兼容 QModem"时，**所有视图改写子代理必须遵守的契约**。
目标：界面"显示的数据"与"控制动作"全部经由 QModem 的 `qmodem` ubus 对象，不再使用旧的 `mt5700m-at` 文本后端。

## 0. 铁律（必须）
- **禁止**出现 `fs.exec('/usr/sbin/mt5700m-at'`, `rpc.declare({ object: 'mt5700m' ...})`, `rpc.declare({ object: 'mt5700m-traffic' ...})`, `uci.load('mt5700m')`, `form.Map('mt5700m')`, `/usr/sbin/mt5700m-manager`, `mt5700m-traffic`。这些已全部移除。
- 保留 `'require mt5700m.controls as controls';`（controls.js 已被重写为 QModem 数据层，见第 1 节）。
- 保留原有 UI 结构、卡片、CSS 类名、中文文案与排版；**只替换数据来源与动作链路**。
- 所有数据一律来自 `controls.<方法>(section)`，其中 `section` 是 `/etc/config/qmodem` 中 modem-device 配置节的 id。多模组时由模组选择器（`controls.renderModemBar` + `controls.getModemSectionsSync`）切换，**不绑定任何具体型号**。

## 1. controls.js 数据层 API（已写好，子代理请阅读该文件确认）
返回 Promise。模块路径：`resources/mt5700m/controls.js`，视图内以 `controls.xxx` 调用。

### 信息读取（返回结构见下）
- `getBaseInfo(section)` → 数组 `[{key,value,full_name,type,class}...]`
- `getInfo(section)` → 同上（base+sim+network+cell 合并）
- `getSimInfo(section)` → 数组
- `getNetworkInfo(section)` → 数组（**部分模组可能为空**）
- `getCellInfo(section)` → 数组（含信号/小区/频段）
- `getDns(section)` → `{ dns: { ipv4_dns1, ipv4_dns2, ipv6_dns1, ipv6_dns2 } }`
- `getMode(section)` → `{ mode: { ecm:'1'/'0', ncm:'1'/'0', rndis:'0'/'1', ... } }`
- `getLockBand(section)` → `{ lockband: { GW:{available_band:[{band_id,band_name}],lock_band:[]}, LTE:{...}, NRNSA:{...}, NRSA:{...} } }`
- `getNetworkPrefer(section)` → `{ network_prefer: { '3G':'1'/'0', '4G':'1'/'0', '5G':'1'/'0' } }`
- `getNeighborCell(section)` → 邻区数据（huawei 部分特性被禁用，见 getDisabledFeatures）
- `getCurrentBand(section)` → `{ current_band: { status, network_mode, cells:[{role,rat,band,band_name,channel,channel_type,pci,ul_bandwidth,dl_bandwidth,scs}] } }`
- `getCurrentBandCapabilities(section)` → `{ current_band_capabilities: { supported, vendor, method, schema } }`
- `getConnectStatus(section)` → 数组，含 `connect_status`（`Yes`/`No`）
- `getDialStatus(section)` → 拨号状态对象
- `getDialLog(section)` → 拨号日志对象
- `getDisabledFeatures(section)` → `{ disabled_features: [ "LockBand", "NeighborCell", ... ] }`
- `getRebootCaps(section)` → `{ reboot_caps: { soft_reboot_caps:1/0, hard_reboot_caps:1/0 } }`
- `getCopyright(section)` → `{ copyright: { Vendor, Author, Maintainer } }`
- `getAtCfg(section)` → `{ at_cfg: { at_port, ports:[...], ... } }`（取 at_port 用于 sendAt）
- `getImei(section)` → `{ imei: '...' }`
- `getSimSlot(section)` → `{ sim_slot: '0'/'1' }`
- `getSimSwitchCapabilities(section)` → `{ supportSwitch:'1'/'0', simSlots:['0','1'], ExtraInfo:'...' }`
- `getSms(section)` → `{ sms: [ { index, status, sender, content, time, ... } ] }`
- `getUsageStats(section)` → `{ available:0/1, updated_at, total_rx_bytes, total_tx_bytes }`（**部分模组返回 available:0**）
- `getTrafficResetSchedule(section)` → QModem 流量统计自动清零计划
- `getInterfaceStatus(name)` → 网络接口状态（`ipv4-address`,`ipv6-address`,`up`,`mtu`,`proto` 等；name 为接口名）
- `getModemSections()` → `[{id,name,model,manufacturer,at_port,enabled}]`
- `resolveSection()` → 返回当前模组配置节 id（优先采用用户上次在模组选择器中的选择，否则第一个启用模组）；无模组返回 null。通用辅助新增：`getModemSectionsSync()`（同步读列表）、`getModemList()`、`getStoredSection()/setStoredSection()`、`renderModemBar(sections,currentId,onSwitch)`（模组选择器）、`groupByClass(entries)`、`renderInfoGrouped(entries)`（按 class 渲染 QModem 返回的全部字段）、`formatSignal(value,type)`（信号分级文案）。

### 控制动作（写）
- `sendAt(section, atPort, command, useUbus)` → 经 QModem 发 AT 命令（atPort 可空，由 QModem 选默认端口）
- `sendSms(section, phoneNumber, content)`
- `sendRawPdu(section, command)`
- `deleteSms(section, index)`
- `setMode(section, mode)`（mode 按 `getMode` 实际返回的模式列表决定，如 'ecm'/'ncm'/'rndis'/...，不写死）
- `setImei(section, imei)`
- `setLockBand(section, params)`（params: `{ band_class:'LTE'/'NRNSA'/'NRSA'/'GW', lock_band:'1,3,41' }`）
- `setNetworkPrefer(section, params)`（params: `['3G','4G','5G']` 数组的 JSON 字符串，例如 `'["4G","5G"]'`）
- `setSimSlot(section, slot)`（slot: '0'/'1'）
- `doReboot(section, method)`（method: 'soft'/'hard'）
- `clearDialLog(section)`
- `clearStats(section)` / `setTrafficResetSchedule(section, params)`
- `setNeighborCell(section, params)` / `setSmsStorage(section, storage)`
- `modemDial(section)` / `modemHang(section)` / `modemRedial(section)`

### 辅助
- `findEntry(arr, key)` → 从信息数组取 value；`entryMap(arr)` → `{key:value}`；`entryList(v)` → 数组
- `operatorInfo(name, mcc, mnc)` → `{name:'中国移动'|'中国联通'|'中国电信'|'中国广电'|name, logo:null}`
- `formatBytes/formatDuration/formatRate/select/row/action/card/state/styleNode/confirmModal` 等 UI 辅助保留
- `confirmModal(title, message, onConfirm, restartRequired)` → 替代旧 `confirmRun`，在 onConfirm 回调里执行 QModem ubus 动作

## 2. load() 标准范式
```js
load: function() {
    var self = this;
    return controls.resolveSection().then(function(section) {
        self.section = section;
        if (!section) return { section: null };
        return Promise.all([
            controls.getBaseInfo(section),
            controls.getCellInfo(section),
            controls.getSimInfo(section),
            controls.getConnectStatus(section)
        ]).then(function(results) {
            return {
                section: section,
                base: results[0], cell: results[1], sim: results[2], conn: results[3]
            };
        });
    });
}
```
render() 中若 `res.section` 为 null，显示"未检测到模组（请确认 QModem 已识别该设备）"提示。

## 3. 字段映射（通用；示例取自 huawei / MT5700M / FM350-GL 实测）
- 基本信息（getBaseInfo 数组）：`name`(型号), `manufacturer`(制造商), `revision`(固件), `at_port`(AT 端口), `connect_status`, `temperature`(如 `42 °C`)
- SIM（getSimInfo 数组）：`SIM Status`, `SIM Slot`, `SIM Number`(手机号), `ISP`(运营商), `IMEI`, `IMSI`，`ICCID`（**部分模组不返回 ICCID/手机号**，显示 `--`；ICCID/ISP 值中的换行与控制字符由 `cleanText()` 清洗）
- 小区/信号（getCellInfo 数组）：`network_mode`(如 `LTE Mode`/`NR5G-SA Mode`/`EN-DC Mode`), `RSRP`(进度条值,`'-95'`), `RSRQ`, `SINR`, `Physical Cell ID`, `TAC`, `EARFCN`(LTE)或`ARFCN`(NR), `Band`, `DL Bandwidth`, `UL Bandwidth`, `MCC`, `MNC`, `SCS`
- 网络（getNetworkInfo 数组）：`Network Type` 等；作为接入技术/运营商/APN 的回退数据源
- 连接（getConnectStatus 数组）：`connect_status`(`Yes`/`No`)
- DNS（getDns）：`dns.ipv4_dns1` 等（值中可能带换行+杂散数据，用 `cleanDns()` 取首个有效地址）
- 模式（getMode）：`mode.ecm`/`mode.ncm` 为 `'1'` 表示当前模式
- 运营商（全模组通用解析链）：① 小区 MCC/MNC（`operatorInfo(name, mcc, mnc)` 映射中国运营商）→ ② SIM/网络信息上报的运营商名称（`ISP`/`operator`/`Operator` 键，经 `cleanText()` 清洗后传入 `operatorInfo()` 第一参数做关键字映射）→ ③ 均无时 SIM 卡片显示 `--`
- 接入技术（通用解析链）：小区 `network_mode` → 各信息源 `Network Type` → `Radio Access Technology`
- APN（通用解析链）：UCI 配置值 → QoS 上报（rpcd `qos qos_info` 的 `apn` 字段，来自 AT+CGCONTRDP）→ 网络信息的 `APN` 键
- QoS Level 与签约速率（两级数据源，**优先 QModem 上报**）：
  1) QModem `network_info` 的 `AMBR UL` / `AMBR DL` 键（vendor 脚本口径，单位 Mbps，前端 ×1000 换算 kbps）与 `QCI` / `5QI` 键（Quectel / Meig / Neoway 等已导出）；
  2) 缺失时回退 rpcd 插件 `/usr/libexec/rpcd/qos` 的 AT 探测（`AT+CGEQOSRDP=<cid>` → `AT+CGCONTRDP` 兜底），模组不支持则显示 `--`。
- 调制信息（rpcd 插件同一对象的 `radio_info` 方法）：返回 `{ rat, band, dl_modulation, ul_modulation, dl_mimo, ul_mimo, dl_mcs?, ul_mcs?, status }`；
  探测链：Fibocom 系 `AT+GTCAINFO?`（PCC 行含 band 编码 50x=NR x / 101+N=LTE N、MIMO 层数、调制枚举 0=BPSK…4=256QAM）
  → Quectel 系 `AT+QNWCFG="nr5g_csi"`（下行 PDSCH MCS）。前端载波卡片渲染为 `NR · MCS 20 · 64QAM`
  形式（MCS 与调制任一缺失时自动省略对应段，均缺失显示 `--`）。

## 4. 旧动作 → QModem 方法 映射表
| 旧 mt5700m-at 动作 | 新实现 |
|---|---|
| `mt5700m-at status` / `advanced session` | getBaseInfo + getCellInfo + getConnectStatus + getInterfaceStatus |
| `mt5700m-at system` | getSimInfo + getBaseInfo |
| `mt5700m-at sms-list`/`sms-info` | getSms |
| `mt5700m-at sms-send` | sendSms |
| `mt5700m-at sms-delete` | deleteSms |
| `mt5700m-at command <cmd>`（终端） | sendAt(section, atPort, cmd) |
| `mt5700m-at sim-pin ...` | sendAt(section, atPort, 'AT+CPIN="<pin>"')（解锁）/ 'AT+CPWD=...'（改 PIN） |
| `mt5700m-at set-imei <v>` | setImei(section, v) |
| `mt5700m-at advanced-set led ...` | sendAt(section, atPort, 模块 AT 命令)（无通用方法，走 sendAt） |
| `mt5700m-at advanced-set thermal-*` | sendAt（热保护阈值，huawei 仅能读取温度；写操作走 sendAt，失败时提示） |
| `mt5700m-at advanced-set sim-slot <n>` | setSimSlot(section, n)（huawei 支持） |
| `mt5700m-at advanced-set sim-activation ...` | sendAt（模块 AT） |
| `mt5700m-at airplane <0|1>` | sendAt(section, atPort, 'AT+CFUN=0'/'AT+CFUN=1,1') 或 doReboot |
| `mt5700m-at factory-reset` | sendAt(section, atPort, 'AT+CFUN=1') 或 doReboot(section,'hard') |
| `mt5700m manager connect/disconnect/redial` | modemDial / modemHang / modemRedial |
| `mt5700m-at network`(radio 策略) | getMode/setMode, getNetworkPrefer/setNetworkPrefer, getLockBand/setLockBand |
| `mt5700m-at advanced radio`(锁频/邻区/扫描) | getLockBand/setLockBand, getNeighborCell, getCurrentBand；扫描用 sendAt(section,atPort,'AT^CELLSCAN') 并解析返回行 |

## 5. 防御式渲染
- 某字段对当前模组不可用（如 ICCID、部分邻区、流量统计）：显示 `--` 或给出"本模组经 QModem 暂不支持/暂无数据"的提示，不要调用旧后端。
- `getUsageStats` 部分模组返回 `available:0`：流量面板显示"本模组经 QModem 暂未提供流量统计（部分模组驱动未实现 usage_stats）"，不要报错。
- `getDisabledFeatures` 含 `"LockBand"`/`"NeighborCell"` 时，隐藏对应设置 UI（保留展示）。
- 所有 `.then` 加 `.catch` 兜底，出错时显示告警而非白屏。

## 6. 各视图具体要求（见各子代理任务）
务必保留原视图的卡片/分区/按钮语义与中文文案，仅改数据源与动作。改写后直接覆盖写回原文件路径。
