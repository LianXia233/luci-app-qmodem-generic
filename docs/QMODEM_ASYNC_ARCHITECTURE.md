# QModem Generic 异步化架构（Async Architecture）

> 目标：**后端任务绝不阻塞 LuCI 页面加载**。
> 页面首屏只读缓存，慢活全部在后台跑；rpcd 是薄 API 层，worker 是唯一工作层，
> `/tmp/qmodem-cache` 是唯一状态层。

本文是这次改造的设计与验收记录，配套的可执行验证在
`tests/run-backend-tests.sh`（后端 67 项）与
`tests/run-frontend-tests.js`（前端 94 项，用 Node 加载真实的 `controls.js` 与 8 个视图模块驱动）。

---

## 1. 为什么原架构一定会卡

改造前，LuCI 首屏的调用链是这样的：

```
浏览器 ── load() ──▶ rpc.declare(...) × N     ← 同一 tick 内全部合并成 1 个 HTTP POST
                          │
                     rpcd / ubus（顺序执行同一批请求）
                          │
              ┌───────────┴────────────────────────────┐
              ▼                                        ▼
      ubus call qmodem.base_info            /usr/libexec/rpcd/qos
              │                                        │
         AT 指令（ttyUSB）                     tom_modem -t 8 × 3
              │                                        │
        模组无响应 → 挂到超时                   ~24 秒
```

三个硬事实（均来自 LuCI 上游 `luci-base/htdocs/luci-static/resources/rpc.js`，已核对源码）：

1. **`rpc.js` 会批处理**：同一 tick 内发出的所有 `rpc.declare` 调用被合并成
   `POST /ubus/obj1.method1;obj1.method2;…`，rpcd 在**同一个 ubus 请求里顺序执行**。
   → 一个慢方法会拖住同批次的**全部**请求，**包括其它页面**的请求。
   这就是「打开一个页面，其它页面也一起卡」的根因。
2. **`rpc.declare` 不支持按调用设置超时**，`declare()` 只转发
   `expect / filter / params / priv / object / method / reject / nobatch`。
   整批共用 `L.env.rpctimeout`（默认 20 秒）。20 秒一到整批 Promise 一起 reject → **白屏**。
3. **LuCI 在 `load()` resolve 之前一直显示 “Loading view …”**。
   → 只要 `load()` 里有 `await` 一个慢 RPC，首屏就一定被后端拖住。

改造前实测的阻塞点（已全部消除）：

| 位置 | 同步执行的慢操作 | 典型耗时 |
| --- | --- | --- |
| `rpcd/qos` `qos_info` | `tom_modem -t 8` × 3（AT 探测 QCI/速率） | ~24 s |
| `rpcd/qos` `radio_info` | `tom_modem -t 8` × 2 | ~16 s |
| `rpcd/qmodem_stats` `daily_stats` | 同步跑 `qmodem-stats-collect run` | 秒级 |
| `rpcd/qmodem_support` `status` / `sync` | awk 扫库 + 文件锁 | 秒级 |
| `qmodem.*` 全部方法 | rpcd 直连 QModem，QModem 内部走 AT | 无上界 |
| 各视图 `load()` | `await` 上述 RPC | 首屏被拖到 20 s 超时 |

---

## 2. 改造后的三层结构

```
┌─ 浏览器 ───────────────────────────────────────────────────────────┐
│  view.load()  ──▶ controls.bootstrap(domains)                      │
│        │            · uci.load('qmodem')                           │
│        │            · qmodem_cache.snapshot   ← 纯文件读，< 100 ms │
│        ▼                                                           │
│  view.render() ──▶ controls.liveView()  立即画出整页（骨架+缓存值） │
│        └─ createPoller: 非重叠轮询，页面隐藏降频，卸载自动停        │
│                                                                    │
│  写操作 ──▶ qmodem_cache.action / send_at ──▶ 立即拿到 task_id      │
│             └─ 轮询 qmodem_cache.get_task 直到 success/failed       │
└────────────────────────────────────────────────────────────────────┘
                 │  只读 / 只建任务，永不碰 modem
                 ▼
┌─ rpcd（API 层）────────────────────────────────────────────────────┐
│  qmodem_cache / qmodem_stats / qmodem_support / qos                │
│  只做：cat 缓存 JSON、写任务描述文件。没有 ubus call qmodem、       │
│  没有 tty 读写、没有 sleep、没有 uqmi/mmcli/ifstatus/logread。      │
└────────────────────────────────────────────────────────────────────┘
                 │  读
                 ▼
┌─ 状态层 /tmp/qmodem-cache ─────────────────────────────────────────┐
│  <section>/<domain>.json   原子写入（tmp + mv），带信封字段         │
│  tasks/<task_id>.json      任务状态机                               │
│  locks/                    flock 互斥（AT 通道 / 支持库 / 单实例）  │
│  worker.json               worker 心跳                              │
└────────────────────────────────────────────────────────────────────┘
                 ▲  唯一写入者
                 │
┌─ 工作层 qmodem-worker（procd 常驻，周期 15 s）─────────────────────┐
│  唯一允许访问 modem / AT / netifd 的进程。                         │
│  每次外部调用都有硬超时；串口访问经 qm_lock 串行化。               │
└────────────────────────────────────────────────────────────────────┘
```

### 缓存信封（每个域一个文件）

```json
{ "updated": 1780000000, "stale": false, "status": "ready",
  "ttl": 90, "error": null, "data": { } }
```

`status` 取值 `ready | offline | error | missing`；文件缺失时 rpcd 直接合成
`{status:"missing", stale:true, data:{}}`，**不会**去等 worker。

### 域名划分

| 域 | 内容 | 采集方式 |
| --- | --- | --- |
| `status` | `base_info` / `connect_status` / `dial_status` / `dns` / `ifaces` / `device` | 周期 |
| `network` | `network_info` / `mode` / `lockband` / `neighborcell` / `network_prefer` / `disabled_features` / `current_band_capabilities` | 周期 |
| `signal` | `cell_info` / `current_band` | 周期 |
| `registration` | 注册/运营商 | 周期 |
| `sim` | `sim_info` / `imei` / `sim_slot` / `sim_switch_capabilities` | 周期 |
| `device` | `info` / `at_cfg` / `reboot_caps` / `copyright` | 周期 |
| `stats` | `usage` / `daily` / `traffic_reset_schedule` | 周期 |
| `qos` / `radio` | QCI、签约速率、调制/MCS/MIMO（AT 探测） | 周期，慢域每 4 轮一次 |
| `support` | 支持库扫描结果（纯文件） | 周期 |
| `sms` | 短信列表 | **只按需**（部分模组读短信极慢） |

---

## 3. RPC 分层与 API

### A 类：快速读取（只读缓存，目标 < 50 ms）

`qmodem_cache` 提供：

```
snapshot        { config_section, domains[] }   首屏一次拿回多个域
get_status / get_network / get_signal / get_registration / get_sim
get_device / get_stats / get_qos / get_radio / get_sms
get_task        { task_id }
get_tasks       { config_section? }
worker_status   {}
```

实测（`tests/run-backend-tests.sh`，模组完全失联的场景）：

```
qmodem_cache.snapshot  < 200ms (83ms)
get_status             (30ms)
get_signal             (27ms)
worker_status          (48ms)
qos.qos_info           (83ms)
qmodem_stats.daily_stats (76ms)
read-only RPCs issued 0 ubus calls
rpcd snapshot still fast while modem dead (61ms)
```

### B 类：后台任务（立即返回 `task_id`）

```
refresh         { config_section, domains[]? }
refresh_all     { domains[]? }
send_at         { config_section, at, args? }
action          { config_section, object?, method, args? }
sync_support    { config_section }
collect_stats   { config_section }
```

返回：

```json
{ "success": true, "task_id": "t…", "state": "queued" }
{ "success": true, "running": true, "deduplicated": true, "task_id": "t…", "state": "running" }
```

### 向后兼容

`qmodem` / `qos` / `qmodem_stats` / `qmodem_support` 的**旧方法名与签名全部保留**，
只是实现从「同步干活」换成「读缓存 / 建任务」。
`controls.js` 里对应的 `callXxx` 声明也全部保留，作为缓存层不可用时的直连兜底
（带客户端超时，且 `nobatch: true`，见 §5）。
前端 API 同样保持签名不变：`controls.sendAt()` 等仍然 resolve 出 ubus 原始结果，
`controls.syncSupport()` 仍然 resolve 出 `{available, added, skipped, missing, error}`。

---

## 4. 超时预算（无一处无界等待）

| 层 | 参数 | 默认 |
| --- | --- | --- |
| worker | `QMODEM_UBUS_TIMEOUT` 单次 ubus/AT 调用 | 8 s |
| worker | `QMODEM_AT_TIMEOUT` AT 探测（`qmodem-at-probe`） | 8 s |
| worker | `QMODEM_WORKER_CYCLE_TIMEOUT` 单模组单轮总超时 | 60 s |
| worker | `QMODEM_WORKER_INTERVAL` 采集周期（下限 5 s） | 15 s |
| 缓存 | `QMODEM_STALE_AFTER` stale 阈值 | 90 s |
| 任务 | `task_timeout`：`send_at` 20 s / `sync_support` 30 s / `collect_stats` 30 s / `action` 120 s / `refresh` 90 s / `refresh_all` 180 s | — |
| 前端 | `CACHE_RPC_TIMEOUT` 读快照 | 6 s |
| 前端 | `TASK_RPC_TIMEOUT` 建/查任务 | 8 s |
| 前端 | `DIRECT_RPC_TIMEOUT` 直连兜底 | 8 s |
| 前端 | `SNAPSHOT_TTL` 同页多 getter 共享一次快照 | 3 s |
| 前端 | `TASK_POLL_INTERVAL` 任务轮询间隔 | 400 ms（首次 150 ms） |
| 前端 | `REFRESH_DEDUP_MS` 客户端刷新去重窗口 | 15 s |
| 前端 | `CACHE_RETRY_MS` 缓存层失败后重试间隔 | 60 s |

前端超时是**客户端**兜底（`withTimeout` / `withTimeoutReject`），因为 LuCI 的
`rpc.declare` 不支持按调用超时；读路径永不 reject（降级显示 `--`），
写路径 reject 以便把「超时/失败」如实告诉用户。

---

## 5. 并发控制

### 后端

* **单实例 worker**：`qm_lock worker` 抢不到就直接退出（测试：`second worker exits (single instance)`）。
* **AT 通道串行化**：所有串口访问经 `qm_lock at`，同一时刻只有一个进程持有；
  超时后自动释放，不会永久占坑（测试：`no overlapping modem transactions`、
  `worker released its lock on exit`、`no lock dirs left behind`）。
* **任务去重**：`qmodem-task new` 先查同 `(type, config_section)` 是否已有
  `queued/running` 任务，有则复用其 `task_id` 并回 `deduplicated:true`
  （测试：`concurrent refresh deduplicated`）。
* **僵尸任务回收**：`qmodem-task get` 会判定「running 但已超时」的任务并标记失败
  （测试：`send_at task terminated instead of hanging (failed)`）。
* **原子写入**：`qm_atomic_write` = 写临时文件 + `mv`，读端永远看不到半个 JSON
  （测试：`no leftover temp files`）。

### 前端

* **`nobatch: true` 覆盖全部 58 个 `rpc.declare`**
  （测试：`所有 rpc.declare 都声明了 nobatch (58/58)`）。
  这一条是「跨页面互相等待」的直接解药：快请求不再被合并进慢请求所在的 HTTP POST。
* **快照去重**：`fetchSnapshot` 对同一 section 的并发调用复用同一个 in-flight Promise
  （`snapshotInflight`），并在 `SNAPSHOT_TTL` 内直接复用结果 → 一页 7 个 getter 只发 1 次 RPC
  （测试：`qmodem_cache.snapshot 调用次数 = 1`、`读取器未产生任何额外 RPC`）。
* **刷新去重**：`requestRefresh` 在 `REFRESH_DEDUP_MS` 窗口内对同一 `(section, domains)` 只排队一次。
* **轮询不堆叠**：`createPoller` 用 `busy` 标志 + 「等本次完成后再 `setTimeout`」，
  慢回调不会累积
  （测试：`慢 collect 不会堆叠 (1000ms 内 3 次，线性外推应为 16 次)`）。
* **隐藏降频**：`document.hidden` 时间隔变为 4 倍。
* **自动停止**：视图节点从 DOM 移除（`alive()`）或 `pagehide`/`beforeunload` 时停止。
  `liveView` 维护 `livePollers` 登记表，一次卸载停掉**所有**活跃轮询器
  （测试：`pagehide 后第二个视图也停止（不再泄漏）`）。
* **不打断用户输入**：`liveView` 在重绘前检查表单焦点/值变化，正在输入就跳过本轮
  （短信草稿、AT 命令输入不会被轮询冲掉）。
  `settings.js`（CBI 表单）与 `terminal.js`（AT 会话日志）**完全不轮询**。

---

## 6. LuCI 首屏加载流程（改造后）

```
LuCI 路由到 /admin/modem/qmodem-generic/status
  └─ view.load()
       └─ controls.bootstrap(['status','network','signal','sim','stats','qos','radio'])
            ├─ uci.load('qmodem')                       （本地内存，微秒级）
            ├─ resolveSection()                          （uci.sections，无 RPC）
            └─ qmodem_cache.snapshot(section, domains)   （1 次 HTTP POST，读文件）
       └─ view.collect(ctx)  ← 7 个 getter，全部命中同一份快照，0 次额外 RPC
  └─ view.render(res) → controls.liveView()
       ├─ 立即绘制整页（有数据显示数据，无数据显示 -- / 离线 / 过期）
       └─ createPoller.start()  → 5 s 后第一次后台刷新
```

前端测试对 8 个视图逐一验证（模组慢对象被人为设成 8 s 延迟，一旦被调用断言就会失败）：

```
status.load()     首屏耗时 6ms   未调用 qmodem / qos / luci-rpc
connection.load() 首屏耗时 1ms   …
network.load()    首屏耗时 5ms   …
system.load()     首屏耗时 6ms   …
sms.load()        首屏耗时 5ms   …
advanced.load()   首屏耗时 5ms   …
terminal.load()   首屏耗时 0ms   …
settings.load()   首屏耗时 0ms   …
```

渲染路径同样验证过「缓存全空（模组离线）」时不抛异常：

```
status / connection / network / system / sms / advanced / terminal
  在缓存全空（模组离线）时仍能渲染   ok
```

---

## 7. 启动阶段（服务不再同步探测模组）

| 服务 | START | 行为 |
| --- | --- | --- |
| `qmodem-modem-support` | 90 | 只做支持库文件合并/校验，纯文件操作，带锁与超时 |
| `qmodem-stats-collect` | 97 | 只启动采集循环，`start` 立即返回 |
| `qmodem-worker` | — | procd 常驻；`start` 只是 fork，不在 init 里探测模组 |
| `qmodem-mt5700-fix` | 99 | 原有的 MT5700 兼容处理，未改动 |

测试：`support sync bounded (126ms < 15000ms)`、`dead-modem cycle bounded (3s <= 12s)`。

---

## 8. 验收：12 个问题的答复

| # | 问题 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 首屏是否还有同步 RPC？ | 没有。首屏只有 1 次 `qmodem_cache.snapshot`（读文件） | 前端测试 §6 |
| 2 | rpcd 是否还在等 modem？ | 没有。4 个插件里无 `ubus call qmodem`、无 tty 读写、无 `sleep` | `read-only RPCs issued 0 ubus calls` |
| 3 | AT 是否可能无限阻塞？ | 不会。`qmodem-at-probe` 与 `qm_ubus` 都带 `-t` 硬超时 | `QMODEM_AT_TIMEOUT=8` |
| 4 | 多页面是否重复查询模组？ | 不会。所有页面读同一份缓存；worker 是唯一采集者 | 架构 §2 |
| 5 | 轮询是否会堆叠？ | 不会。`busy` 标志 + 完成后再排下一次 | `慢 collect 不会堆叠` |
| 6 | 模组卡死时 LuCI 是否可用？ | 可用。缓存缺失返回 `missing/offline + stale`，页面正常渲染 | `rpcd snapshot still fast while modem dead (61ms)` |
| 7 | 服务启动是否阻塞？ | 不阻塞。init 脚本只做文件操作/fork | §7 |
| 8 | 统计是否已后台化？ | 是。采集器写缓存，`get_stats` 只读 | `daily_stats … issued 0 modem calls` |
| 9 | 是否有残留 shell 子进程？ | 没有 | `no orphaned task runners` |
| 10 | 是否有未释放的锁？ | 没有 | `no lock dirs left behind`、`worker released its lock on exit` |
| 11 | RPC 超时后 worker 是否会僵死？ | 不会。僵尸任务由 `qmodem-task get` 回收 | `send_at task terminated instead of hanging` |
| 12 | 是否存在串口竞争？ | 不存在。AT 通道单锁串行 | `no overlapping modem transactions` |

---

## 9. 如何验证

```sh
# 后端（纯 shell，dash 与 busybox sh 都要过）
sh tests/run-backend-tests.sh
TEST_SH="busybox sh" sh tests/run-backend-tests.sh

# 前端（需要 node；用真实的 controls.js + 8 个视图跑）
sh tests/run-frontend-tests.sh

# 翻译文件格式（msgfmt 的最小替代）
python3 tests/check-po.py po/zh_Hans/qmodem-generic.po
```

> 说明：`msgfmt` 在精简的构建环境里可能不存在，`tests/check-po.py` 做等价校验
> （头部、成对性、转义、重复 msgid、占位符一致性、UTF-8）。
