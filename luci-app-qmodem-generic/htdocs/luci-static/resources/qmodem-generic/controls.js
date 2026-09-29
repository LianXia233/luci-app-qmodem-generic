'use strict';
'require baseclass';
'require ui';
'require uci';
'require rpc';

/*
 * 通用 QModem LuCI 前端 — QModem 数据层（美化版 UI 的数据桥梁）
 *
 * 本文件把原先基于私有文本后端输出的数据获取方式，全面替换为
 * 经由 QModem 的 `qmodem` ubus 对象读取/下发。"显示的数据"与"控制动作"全部来自 QModem，
 * 不再依赖任何模组私有的文本后端。
 *
 * 设计原则（通用、不绑定任何具体模组型号）：
 *  - 本包对 QModem 管理的"任意模组"生效：QModem 识别到什么模组，这里就显示什么。
 *    UI 不假定任何具体模组型号，所有字段、能力、模式都按 QModem 实际返回渲染。
 *  - 信息方法（base_info/sim_info/network_info/cell_info/info）返回
 *    { "modem_info": [ { key, value, full_name, type, class, extra_info }, ... ] }，
 *    使用 findEntry(arr, key) 取字段，使用 groupByClass(arr) 按 class 分组渲染"全部信息"。
 *  - 其它方法返回各自的具体 JSON（见各封装函数说明）。
 *  - config_section 指向 /etc/config/qmodem 中的 modem-device 配置节
 *    （多模组时由模组选择器切换，见 renderModemBar / getModemList）。
 */

/* ------------------------------------------------------------------ */
/* QModem ubus RPC 声明                                                */
/* ------------------------------------------------------------------ */

/*
 * ------------------------------------------------------------------ *
 * LuCI 26.x（OpenWrt/ImmortalWrt Master 26.246+）旧 API 兼容层            *
 * ------------------------------------------------------------------ *
 * 新版 LuCI 已移除两个历史全局辅助：
 *   1) String.prototype.format —— 仅保留 String.prototype.format.call()，
 *      直接写 'x'.format(...) 会抛 ".format is not a function"；
 *   2) 全局 E()（旧 dom.create 别名）与 findParent()。
 * 本包视图仍沿用这些写法（共计数百处），在 26.x 上会出现"菜单正常、内容区
 * 永远停在 Loading view"的现象。这里在本模块被 require 时（早于任何视图体
 * 执行）按需补齐，缺失才注入、已存在绝不覆盖，避免影响其它插件。
 * 后续若视图整体迁移到 L.dom.create / 模板字符串，本段可直接删除。
 */
(function installLuCILegacyCompat() {
	if (typeof window === 'undefined')
		return;

	if (!String.prototype.format) {
		var NUM_TYPES = 'diouxXfFeEgG';
		String.prototype.format = function() {
			var args = arguments, idx = 0;
			return String(this).replace(/%(\d+\$)?([-+ #0]*)(\d+|\*)?(?:\.(\d+|\*))?([diouxXfFeEgGcs%])/g,
				function(m, pos, flags, width, prec, conv) {
					if (conv === '%') return '%';
					if (pos) idx = parseInt(pos, 10) - 1;
					var v = args[idx++];
					if (v === undefined || v === null) return m;
					if (width === '*') width = args[idx++];
					if (prec === '*') prec = args[idx++];
					var s;
					if (NUM_TYPES.indexOf(conv) >= 0) {
						var n;
						if ('diu'.indexOf(conv) >= 0) n = parseInt(v, 10);
						else if (conv === 'o') n = parseInt(v, 10).toString(8);
						else if (conv === 'x') n = parseInt(v, 10).toString(16);
						else if (conv === 'X') n = parseInt(v, 10).toString(16).toUpperCase();
						else n = parseFloat(v);
						if (prec !== undefined && 'fFeE'.indexOf(conv) >= 0)
							s = parseFloat(v).toFixed(parseInt(prec, 10));
						else
							s = String(n);
					} else if (conv === 'c') {
						s = String(v).charAt(0);
					} else {
						s = String(v);
						if (prec !== undefined) s = s.substring(0, parseInt(prec, 10));
					}
					var w = width ? parseInt(width, 10) : 0;
					if (s.length >= w) return s;
					if (flags && flags.indexOf('-') < 0 && flags.indexOf('0') >= 0 && NUM_TYPES.indexOf(conv) >= 0) {
						var sign = /^[+-]/.test(s) ? s.charAt(0) : '';
						var body = sign ? s.substring(1) : s;
						while (body.length + sign.length < w) body = '0' + body;
						return sign + body;
					}
					while (s.length < w)
						s = (flags && flags.indexOf('-') >= 0) ? s + ' ' : ' ' + s;
					return s;
				});
		};
	}

	if (typeof window.E === 'undefined') {
		window.E = function(elem, attrs, data) {
			if (elem instanceof Node)
				return elem;
			var e = document.createElement(String(elem));
			if (attrs != null && typeof attrs === 'object') {
				for (var k in attrs)
					e.setAttribute(k, attrs[k]);
			}
			if (data != null) {
				if (data instanceof Array)
					data.forEach(function(x) {
						e.appendChild(x instanceof Node ? x : document.createTextNode(String(x)));
					});
				else if (data instanceof Node)
					e.appendChild(data);
				else
					e.innerHTML = String(data);
			}
			return e;
		};
	}

	if (typeof window.findParent === 'undefined') {
		window.findParent = function(node, selector) {
			while (node && node.parentNode) {
				node = node.parentNode;
				if (node instanceof Element && node.matches(selector))
					return node;
			}
			return null;
		};
	}

	/*
	 * 26.x 的 ui.js 在错误提示路径（LuCI.prototype.error → ui.addNotification）
	 * 里直接引用全局 `_()`，而该版本并不提供它：一旦视图加载抛错，先崩在
	 * 提示逻辑上，真正的原因被吞掉，只剩 "_ is not defined"。这里给出轻量兜底
	 * （原样返回，不做翻译），让被掩盖的错误文本能正常显示出来。
	 */
	if (typeof window._ === 'undefined') {
		window._ = function(s) { return String(s == null ? '' : s); };
	}
})();

var callBaseInfo = rpc.declare({ object: 'qmodem', method: 'base_info', params: ['config_section'], expect: { }, nobatch: true });
var callCellInfo = rpc.declare({ object: 'qmodem', method: 'cell_info', params: ['config_section'], expect: { }, nobatch: true });
var callInfo = rpc.declare({ object: 'qmodem', method: 'info', params: ['config_section'], expect: { }, nobatch: true });
var callNetworkInfo = rpc.declare({ object: 'qmodem', method: 'network_info', params: ['config_section'], expect: { }, nobatch: true });
var callSimInfo = rpc.declare({ object: 'qmodem', method: 'sim_info', params: ['config_section'], expect: { }, nobatch: true });

var callGetAtCfg = rpc.declare({ object: 'qmodem', method: 'get_at_cfg', params: ['config_section'], expect: { }, nobatch: true });
var callGetImei = rpc.declare({ object: 'qmodem', method: 'get_imei', params: ['config_section'], expect: { }, nobatch: true });
var callGetMode = rpc.declare({ object: 'qmodem', method: 'get_mode', params: ['config_section'], expect: { }, nobatch: true });
var callGetLockband = rpc.declare({ object: 'qmodem', method: 'get_lockband', params: ['config_section'], expect: { }, nobatch: true });
var callGetNeighborcell = rpc.declare({ object: 'qmodem', method: 'get_neighborcell', params: ['config_section'], expect: { }, nobatch: true });
var callGetNetworkPrefer = rpc.declare({ object: 'qmodem', method: 'get_network_prefer', params: ['config_section'], expect: { }, nobatch: true });
var callGetDns = rpc.declare({ object: 'qmodem', method: 'get_dns', params: ['config_section'], expect: { }, nobatch: true });
var callGetSms = rpc.declare({ object: 'qmodem', method: 'get_sms', params: ['config_section'], expect: { }, nobatch: true });
var callGetDisabledFeatures = rpc.declare({ object: 'qmodem', method: 'get_disabled_features', params: ['config_section'], expect: { }, nobatch: true });
var callGetRebootCaps = rpc.declare({ object: 'qmodem', method: 'get_reboot_caps', params: ['config_section'], expect: { }, nobatch: true });
var callGetCopyright = rpc.declare({ object: 'qmodem', method: 'get_copyright', params: ['config_section'], expect: { }, nobatch: true });
var callGetCurrentBand = rpc.declare({ object: 'qmodem', method: 'get_current_band', params: ['config_section'], expect: { }, nobatch: true });
var callGetCurrentBandCapabilities = rpc.declare({ object: 'qmodem', method: 'get_current_band_capabilities', params: ['config_section'], expect: { }, nobatch: true });
var callGetConnectStatus = rpc.declare({ object: 'qmodem', method: 'get_connect_status', params: ['config_section'], expect: { }, nobatch: true });
var callGetDialStatus = rpc.declare({ object: 'qmodem', method: 'dial_status', params: ['config_section'], expect: { }, nobatch: true });
var callGetDialLog = rpc.declare({ object: 'qmodem', method: 'get_dial_log', params: ['config_section'], expect: { }, nobatch: true });
var callGetSimSlot = rpc.declare({ object: 'qmodem', method: 'get_sim_slot', params: ['config_section'], expect: { }, nobatch: true });
var callGetSimSwitchCapabilities = rpc.declare({ object: 'qmodem', method: 'get_sim_switch_capabilities', params: ['config_section'], expect: { }, nobatch: true });
var callGetUsageStats = rpc.declare({ object: 'qmodem', method: 'get_stats', params: ['config_section'], expect: { }, nobatch: true });
var callGetTrafficResetSchedule = rpc.declare({ object: 'qmodem', method: 'get_traffic_reset_schedule', params: ['config_section'], expect: { }, nobatch: true });
// 持久化分天流量统计（/usr/libexec/rpcd/qmodem_stats 提供）：
// daily_stats 采样一次并返回今日/历史/累计；stats_reset 清零本地分天记录
var callDailyStats = rpc.declare({ object: 'qmodem_stats', method: 'daily_stats', params: ['config_section'], expect: { }, nobatch: true });
var callStatsReset = rpc.declare({ object: 'qmodem_stats', method: 'stats_reset', params: ['config_section'], expect: { }, nobatch: true });

// 模组支持库注入（/usr/libexec/rpcd/qmodem_support 提供）：
// status 查询内置型号是否已存在于 QModem 支持库；sync 执行一次合并
var callSupportStatus = rpc.declare({ object: 'qmodem_support', method: 'status', expect: { }, nobatch: true });
var callSupportSync = rpc.declare({ object: 'qmodem_support', method: 'sync', expect: { }, nobatch: true });

var callSendAt = rpc.declare({ object: 'qmodem', method: 'send_at', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSendSms = rpc.declare({ object: 'qmodem', method: 'send_sms', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSendRawPdu = rpc.declare({ object: 'qmodem', method: 'send_raw_pdu', params: ['config_section', 'cmd'], expect: { }, nobatch: true });
var callDeleteSms = rpc.declare({ object: 'qmodem', method: 'delete_sms', params: ['config_section', 'index'], expect: { }, nobatch: true });
var callSetMode = rpc.declare({ object: 'qmodem', method: 'set_mode', params: ['config_section', 'mode'], expect: { }, nobatch: true });
var callSetImei = rpc.declare({ object: 'qmodem', method: 'set_imei', params: ['config_section', 'imei'], expect: { }, nobatch: true });
var callSetLockband = rpc.declare({ object: 'qmodem', method: 'set_lockband', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSetNetworkPrefer = rpc.declare({ object: 'qmodem', method: 'set_network_prefer', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSetSimSlot = rpc.declare({ object: 'qmodem', method: 'set_sim_slot', params: ['config_section', 'slot'], expect: { }, nobatch: true });
var callDoReboot = rpc.declare({ object: 'qmodem', method: 'do_reboot', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callClearDialLog = rpc.declare({ object: 'qmodem', method: 'clear_dial_log', params: ['config_section'], expect: { }, nobatch: true });
var callClearStats = rpc.declare({ object: 'qmodem', method: 'clear_stats', params: ['config_section'], expect: { }, nobatch: true });
var callSetTrafficResetSchedule = rpc.declare({ object: 'qmodem', method: 'set_traffic_reset_schedule', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSetNeighborCell = rpc.declare({ object: 'qmodem', method: 'set_neighborcell', params: ['config_section', 'params'], expect: { }, nobatch: true });
var callSetSmsStorage = rpc.declare({ object: 'qmodem', method: 'set_sms_storage', params: ['config_section', 'storage'], expect: { }, nobatch: true });
var callModemDial = rpc.declare({ object: 'qmodem', method: 'modem_dial', params: ['config_section'], expect: { }, nobatch: true });
var callModemHang = rpc.declare({ object: 'qmodem', method: 'modem_hang', params: ['config_section'], expect: { }, nobatch: true });
var callModemRedial = rpc.declare({ object: 'qmodem', method: 'modem_redial', params: ['config_section'], expect: { }, nobatch: true });

var callRcList = rpc.declare({ object: 'rc', method: 'list', params: ['name'], expect: { }, nobatch: true });
// 网络接口批量状态：netifd 的裸 network.interface 对象只提供 dump（status 需要具体的
// network.interface.<name> 对象），因此这里统一用 dump 一次取回全部接口再按名匹配。
var callInterfaceDump = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] }, nobatch: true });
// 网络设备状态（用于获取网口链路速率，作为签约速率参考）
var callDeviceStatus = rpc.declare({ object: 'network.device', method: 'status', params: ['name'], expect: { }, nobatch: true });
// QOS 信息（QCI / 签约速率），由 /usr/libexec/rpcd/qos 提供
var callQosInfo = rpc.declare({ object: 'qos', method: 'qos_info', params: ['config_section'], expect: { }, nobatch: true });
// 无线电调制信息（上下行调制 / MCS / MIMO 层数），同一 rpcd 插件提供
var callRadioInfo = rpc.declare({ object: 'qos', method: 'radio_info', params: ['config_section'], expect: { }, nobatch: true });

/* ================================================================== */
/* 状态缓存层 —— 首屏与后台耗时任务彻底解耦                            */
/* ================================================================== */
/*
 * 为什么必须解耦（LuCI rpc.js 的两个硬事实）
 * ----------------------------------------
 * 1) rpc.js 的 call() 会把「同一 tick 内发出的所有 rpc.declare 调用」合并成
 *    一个 HTTP POST（rpcBaseURL + '/obj.method;obj.method;...'），rpcd 在同一个
 *    ubus 请求里**顺序**执行。也就是说：一个慢方法会拖住同批次的**所有**请求，
 *    包括其它页面的请求 —— 这就是「一个慢请求拖慢整个 LuCI」的根因。
 * 2) rpc.declare 不支持按调用设置超时，整批共用 L.env.rpctimeout（默认 20 秒）。
 *    20 秒一到，整批 promise 一起 reject，页面直接白屏。
 *
 * 改造后的数据链路：
 *
 *   浏览器 → LuCI 视图 load()
 *              │  只读 UCI + qmodem_cache.snapshot（纯文件 IO，正常 < 50 ms）
 *              ▼
 *        立即渲染页面骨架 + 已有缓存数据
 *              │
 *              └── 后台：qmodem-worker 周期采集 / qmodem-task 执行按需任务
 *                        （所有 ubus / AT / netifd 调用都在那里，带硬超时）
 *              │
 *              ▼
 *        非重叠轮询 snapshot → 局部重绘
 *
 * 所有慢动作（refresh / send_at / 拨号 / 重启 / 改模式…）都改成
 * 「创建任务 → 立即返回 task_id → 轮询 get_task」，rpcd 永不等待 modem。
 */

/* 快速读取（A 类）：只读 /tmp/qmodem-cache，绝不访问 modem */
var callSnapshot = rpc.declare({ object: 'qmodem_cache', method: 'snapshot', params: ['config_section', 'domains'], expect: { }, nobatch: true });
/* 后台任务（B 类）：立即返回 task_id */
var callTaskGet = rpc.declare({ object: 'qmodem_cache', method: 'get_task', params: ['task_id'], expect: { }, nobatch: true });
var callTaskRefresh = rpc.declare({ object: 'qmodem_cache', method: 'refresh', params: ['config_section', 'domains'], expect: { }, nobatch: true });
var callTaskAction = rpc.declare({ object: 'qmodem_cache', method: 'action', params: ['config_section', 'object', 'method', 'args'], expect: { }, nobatch: true });
var callTaskSendAt = rpc.declare({ object: 'qmodem_cache', method: 'send_at', params: ['config_section', 'at'], expect: { }, nobatch: true });
/* stats_reset 已改为后台任务（需要读一次模组计数器建立新基准） */
var callStatsResetTask = rpc.declare({ object: 'qmodem_stats', method: 'stats_reset', params: ['config_section'], expect: { }, nobatch: true });

/* 超时预算（毫秒）—— rpc 本身不提供按调用超时，必须在客户端兜住 */
var CACHE_RPC_TIMEOUT = 6000;     /* 读缓存：正常 < 50 ms */
var TASK_RPC_TIMEOUT = 8000;      /* 建任务 / 查任务：纯文件操作 */
var DIRECT_RPC_TIMEOUT = 8000;    /* 缓存层不可用时的直连兜底 */
var TASK_POLL_INTERVAL = 400;     /* 任务轮询间隔（request→完成→等待→下一次） */
var SNAPSHOT_TTL = 3000;          /* 同一页面多个 getter 共享一次快照读取 */
var REFRESH_DEDUP_MS = 15000;     /* 客户端侧刷新去重窗口 */
var CACHE_RETRY_MS = 60000;       /* 缓存层不可用后的重试间隔 */

/* 给 promise 加客户端超时：超时/失败都返回 fallback，**永不 reject**。
 * 用于所有「读」路径 —— 读失败只该降级显示，不该让页面崩掉。 */
function withTimeout(promise, ms, fallback) {
	return new Promise(function(resolve) {
		var settled = false;
		var timer = window.setTimeout(function() {
			if (settled) return;
			settled = true;
			resolve(fallback);
		}, ms);

		Promise.resolve(promise).then(function(v) {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(v === undefined ? fallback : v);
		}, function() {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(fallback);
		});
	});
}

/* 与 withTimeout 相同，但失败时 reject —— 用于任务链路，
 * 让 UI 能把「超时 / 失败」如实告诉用户而不是静默成功。 */
function withTimeoutReject(promise, ms, message) {
	return new Promise(function(resolve, reject) {
		var settled = false;
		var timer = window.setTimeout(function() {
			if (settled) return;
			settled = true;
			reject(new Error(message || 'timeout'));
		}, ms);

		Promise.resolve(promise).then(function(v) {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(v);
		}, function(err) {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			reject(err instanceof Error ? err : new Error((err && err.message) || String(err)));
		});
	});
}

var snapshotStore = {};      /* section -> { ts, snap } */
var snapshotInflight = {};   /* section -> Promise（并发去重） */
var refreshQueued = {};      /* section|domains -> ts（客户端侧刷新去重） */
var cacheBrokenAt = 0;       /* 缓存层探测失败的时间戳 */

function cacheLayerUsable() {
	return !cacheBrokenAt || (Date.now() - cacheBrokenAt > CACHE_RETRY_MS);
}

function snapshotCovers(snap, domains) {
	if (!snap || !snap.domains) return false;
	if (!domains || !domains.length) return true;
	for (var i = 0; i < domains.length; i++)
		if (!snap.domains[domains[i]]) return false;
	return true;
}

/* 让下一次读取重新拉取（写操作完成后调用） */
function touch(section) {
	if (section) delete snapshotStore[section];
}

/* 读取快照。永不 reject：缓存层不可用时返回 null，由调用方降级。 */
function fetchSnapshot(section, domains, force) {
	if (!section)
		return Promise.resolve(null);

	var now = Date.now();
	var cached = snapshotStore[section];

	if (!force && cached && (now - cached.ts) < SNAPSHOT_TTL && snapshotCovers(cached.snap, domains))
		return Promise.resolve(cached.snap);
	/* 并发去重：同一 section 的多个 getter 共用一次 RPC，避免请求堆积 */
	if (!force && snapshotInflight[section])
		return snapshotInflight[section];

	var p = withTimeoutReject(callSnapshot(section, (domains && domains.length) ? domains : null),
		CACHE_RPC_TIMEOUT, 'snapshot timeout').then(function(snap) {
			cacheBrokenAt = 0;
			snapshotStore[section] = { ts: Date.now(), snap: snap || null };
			delete snapshotInflight[section];
			return snap || null;
		}, function() {
			delete snapshotInflight[section];
			if (!snapshotStore[section])
				cacheBrokenAt = Date.now();
			return snapshotStore[section] ? snapshotStore[section].snap : null;
		});

	snapshotInflight[section] = p;
	return p;
}

/* 缓存信封访问：{ updated, stale, status, ttl, error, data } */
function envelopeOf(snap, domain) {
	return (snap && snap.domains && snap.domains[domain]) || null;
}

function domainData(snap, domain) {
	var env = envelopeOf(snap, domain);
	return (env && env.data && typeof env.data === 'object') ? env.data : {};
}

function domainMeta(snap, domain) {
	var env = envelopeOf(snap, domain) || {};
	var now = (snap && snap.now) ? Number(snap.now) : Math.floor(Date.now() / 1000);
	var updated = Number(env.updated) || 0;
	var age = updated ? (now - updated) : -1;
	var status = env.status || 'missing';
	return {
		updated: updated,
		age: age,
		status: status,
		error: env.error || '',
		stale: env.stale === true || status === 'missing' || status === 'offline' ||
			(env.ttl > 0 && age > Number(env.ttl))
	};
}

/* 后台补采：只在缺失/过期时排队一次，客户端 + 服务端（任务去重）双重防重复 */
function requestRefresh(section, domains, force) {
	if (!section || !cacheLayerUsable())
		return Promise.resolve(null);

	var key = section + '|' + (domains || []).join(',');
	var now = Date.now();
	if (!force && refreshQueued[key] && (now - refreshQueued[key]) < REFRESH_DEDUP_MS)
		return Promise.resolve(null);
	refreshQueued[key] = now;

	return withTimeout(callTaskRefresh(section, (domains && domains.length) ? domains : null),
		TASK_RPC_TIMEOUT, null);
}

/*
 * 统一的「缓存优先」读取。
 *   命中缓存      → 直接返回（不产生任何 modem 访问）
 *   缓存缺失/过期 → 返回旧值/兜底值 + 后台排队补采
 *   缓存层不可用  → 退化为直连 QModem（带超时；调用方须传 nobatch 的声明）
 */
function cachedValue(section, domain, key, fallback, directFn, transform) {
	var map = transform || function(v) { return v; };

	return fetchSnapshot(section, [domain]).then(function(snap) {
		if (snap) {
			var data = domainData(snap, domain);
			var meta = domainMeta(snap, domain);
			if (meta.status === 'missing' || meta.stale)
				requestRefresh(section, [domain]);
			var v = data[key];
			return map(v === undefined || v === null ? fallback : v, meta);
		}

		/* 没有缓存层（旧固件 / 服务未启用）：直连，但必须有超时上限 */
		if (typeof directFn === 'function')
			return withTimeout(directFn(), DIRECT_RPC_TIMEOUT, fallback).then(function(v) {
				return map(v === undefined || v === null ? fallback : v, { status: 'direct', stale: false });
			});

		return map(fallback, { status: 'missing', stale: true });
	});
}

/* ------------------------------------------------------------------ */
/* 后台任务（异步动作）                                                */
/* ------------------------------------------------------------------ */

/* 轮询任务状态：request → 完成 → 等待 → 下一次 request，绝不重叠、绝不堆积 */
function waitForTask(taskId, timeoutMs) {
	var started = Date.now();
	var budget = timeoutMs || 120000;

	return new Promise(function(resolve, reject) {
		function expired() {
			return (Date.now() - started) > budget;
		}
		function retry() {
			if (expired()) { reject(new Error(_('Task timed out'))); return; }
			window.setTimeout(step, TASK_POLL_INTERVAL);
		}
		function step() {
			withTimeoutReject(callTaskGet(taskId), TASK_RPC_TIMEOUT, 'get_task timeout').then(function(task) {
				if (!task || task.state === 'missing') { reject(new Error(_('Task not found'))); return; }
				if (task.state === 'success') { touch(task.config_section); resolve(task.result); return; }
				if (task.state === 'failed') {
					touch(task.config_section);
					reject(new Error(task.error || _('Task failed')));
					return;
				}
				retry();
			}, retry);
		}
		window.setTimeout(step, 150);
	});
}

/* createFn 立即返回 { task_id }，随后轮询直到 success/failed */
function runTask(createFn, timeoutMs) {
	return withTimeoutReject(createFn(), TASK_RPC_TIMEOUT, _('Failed to create task')).then(function(res) {
		if (!res || !res.task_id)
			return Promise.reject(new Error((res && res.error) || _('Task rejected by backend')));
		return waitForTask(res.task_id, timeoutMs);
	});
}

/*
 * 把任意 QModem ubus 方法包装成后台任务执行。
 * 对调用方保持与旧版一致的语义：返回一个最终 resolve 出 ubus 结果的 Promise，
 * 但底层不再让 rpcd 同步等待 modem。缓存层不可用时自动退回直连。
 */
function qmodemAction(section, method, args, directFn, timeoutMs) {
	if (!cacheLayerUsable())
		return withTimeoutReject(directFn(), DIRECT_RPC_TIMEOUT, _('Modem request timed out'));

	return runTask(function() {
		return callTaskAction(section, 'qmodem', method, args || {});
	}, timeoutMs || 150000).then(function(result) {
		touch(section);
		return result;
	}, function(err) {
		touch(section);
		return Promise.reject(err);
	});
}

/* ------------------------------------------------------------------ */
/* 安全轮询（不产生请求堆积）                                          */
/* ------------------------------------------------------------------ */

/*
 * createPoller({ fn, interval, hiddenInterval, node })
 *   fn               每次轮询执行的函数（返回 Promise）
 *   interval         前台间隔（毫秒）
 *   hiddenInterval   页面隐藏时的间隔（降频，默认 interval × 4）
 *   node             关联的 DOM 节点；节点从文档移除后自动停止轮询
 *
 * 保证：
 *   - 上一次 fn 未完成时绝不发起下一次（request→完成→等待→下一次）
 *   - 页面隐藏时降频
 *   - 节点被移除（LuCI 切换视图）后自动 stop，不留定时器
 */
function createPoller(opts) {
	var timer = null;
	var busy = false;
	var stopped = false;
	var interval = opts.interval || 5000;
	var hiddenInterval = opts.hiddenInterval || (interval * 4);

	function alive() {
		if (stopped) return false;
		if (opts.node && typeof document !== 'undefined' && document.body &&
			!document.body.contains(opts.node)) {
			stop();
			return false;
		}
		return true;
	}

	function schedule() {
		if (!alive()) return;
		var iv = (typeof document !== 'undefined' && document.hidden) ? hiddenInterval : interval;
		timer = window.setTimeout(tick, iv);
	}

	function tick() {
		timer = null;
		if (!alive()) return;
		if (busy) { schedule(); return; }   /* 绝不重叠 */

		busy = true;
		Promise.resolve().then(function() {
			return opts.fn();
		}).catch(function() {
			return null;                    /* 单次失败不影响后续轮询 */
		}).then(function() {
			busy = false;
			schedule();
		});
	}

	function start() {
		if (stopped) return;
		if (timer === null && !busy) schedule();
	}
	function stop() {
		stopped = true;
		if (timer !== null) { window.clearTimeout(timer); timer = null; }
	}

	return { start: start, stop: stop, isRunning: function() { return !stopped; } };
}

/*
 * liveView —— 视图的通用 render：
 *   1) 立即用 load() 拿到的数据画出完整页面（骨架 + 已有数据）
 *   2) 启动安全轮询，后台数据到位后**局部重绘**（只替换本视图的子树）
 *   3) 视图节点被移除 / 页面卸载时自动停止轮询
 */
function liveView(view, res, opts) {
	opts = opts || {};
	var holder = E('div', { 'class': 'qmodem-generic-live' });

	/*
	 * 用户正在编辑时跳过本轮重绘，避免轮询把用户还没提交的内容
	 * （短信草稿、AT 命令输入、下拉框选择…）冲掉。
	 * 判定方式：焦点在本视图的表单控件里，或任一控件的值与上次重绘后不同。
	 */
	var formState = null;

	function snapshotForm() {
		var out = [];
		var nodes = holder.querySelectorAll('input, textarea, select');
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			out.push((n.type === 'checkbox' || n.type === 'radio') ? n.checked : n.value);
		}
		return out;
	}

	function editing() {
		if (opts.skipIfEditing === false)
			return false;

		var active = (typeof document !== 'undefined') ? document.activeElement : null;
		if (active && holder.contains(active) &&
			/^(input|textarea|select)$/i.test(active.tagName || ''))
			return true;

		var now = snapshotForm();
		if (!formState) { formState = now; return false; }
		if (now.length !== formState.length) { formState = now; return false; }
		for (var i = 0; i < now.length; i++)
			if (now[i] !== formState[i])
				return true;
		return false;
	}

	function paint(data) {
		/* paint 回调可能同步返回节点，也可能（如 connection 借助 CBI
		 * form.Map.render()）返回 Promise —— 统一 await，避免把 Promise
		 * 直接 appendChild 到 DOM 抛 "not of type Node"。 */
		var p;
		try {
			p = opts.paint.call(view, data);
		} catch (err) {
			p = E('div', { 'class': 'alert-message danger' },
				_('页面渲染失败：') + ((err && err.message) || String(err)));
		}
		return Promise.resolve(p).then(function(node) {
			if (node) {
				while (holder.firstChild)
					holder.removeChild(holder.firstChild);
				holder.appendChild(node);
			}
			formState = snapshotForm();
		});
	}

	paint(res);

	if (res && res.section && opts.paint && opts.domains) {
		if (view.poller && view.poller.stop) view.poller.stop();
		view.poller = createPoller({
			node: holder,
			interval: opts.interval || 5000,
			fn: function() {
				return fetchSnapshot(res.section, opts.domains, true).then(function(snap) {
					if (!snap) return null;
					/* 用与 load() 完全相同的 collect() 重新组装数据，
					 * 保证首屏与轮询走的是同一条代码路径 */
					var next = opts.collect.call(view, {
						section: res.section,
						sections: res.sections || [],
						snap: snap,
						errors: []
					});
					return Promise.resolve(next).then(function(data) {
						if (editing()) return data;   /* 用户正在输入，本轮不重绘 */
						return paint(data).then(function() { return data; });
					});
				});
			}
		});
		view.poller.start();
	}

	if (view.poller)
		registerLivePoller(view.poller);

	return holder;
}

/*
 * 所有活跃轮询器的登记表 + 一次性注册的全局卸载钩子。
 * 之前的写法用 liveView.bound 只绑一次 pagehide，闭包里捕获的是「第一个视图」，
 * 于是切到第二个页面后 pagehide 停不掉它的轮询 —— 这里改成停掉全部。
 */
var livePollers = [];

function registerLivePoller(poller) {
	livePollers = livePollers.filter(function(p) { return p && p.isRunning && p.isRunning(); });
	livePollers.push(poller);

	if (typeof window === 'undefined' || window.__qmodemLiveBound)
		return;
	window.__qmodemLiveBound = true;

	function stopAll() {
		livePollers.forEach(function(p) {
			try { p.stop(); } catch (e) { /* 忽略：卸载阶段不再抛错 */ }
		});
		livePollers = [];
	}

	/* pagehide 覆盖跳转/关闭；visibilitychange 覆盖切到后台标签页（降频由 poller 自己处理） */
	if (window.addEventListener) {
		window.addEventListener('pagehide', stopAll);
		window.addEventListener('beforeunload', stopAll);
	}
}

/* ------------------------------------------------------------------ */
/* 通用辅助                                                            */
/* ------------------------------------------------------------------ */

// 从 { modem_info: [ {key,value,...} ] } 数组中按 key 取出 value
function findEntry(arr, key) {
	if (!Array.isArray(arr)) return undefined;
	for (var i = 0; i < arr.length; i++) {
		if (arr[i] && arr[i].key === key) return arr[i].value;
	}
	return undefined;
}

// 确保是数组
function entryList(v) {
	return Array.isArray(v) ? v : [];
}

// 把 modem_info 数组转成 { key: value } 字典，方便取用
function entryMap(arr) {
	var map = {};
	entryList(arr).forEach(function(item) {
		if (item && item.key != null) map[item.key] = item.value;
	});
	return map;
}

/*
 * 温度归一化：模组未上报温度时，QModem 会回填 "0°C"（实测 Fibocom FM350-GL 即如此），
 * 直接展示会把"未上报"误导成真实的工作在 0°C。0 不是有效工作温度，这里一律按
 * "未上报"处理，返回 ''（调用方原本就会渲染成 --）。
 * 保留原始单位（"45°C"），仅对无数值/非正数做拦截。
 */
function normalizeTemperature(value) {
	var text = String(value == null ? '' : value).trim();
	if (text === '')
		return '';
	var num = parseFloat(text.replace(/[^0-9.\-]/g, ''));
	if (isNaN(num) || num <= 0)
		return '';
	return text;
}

/* ------------------------------------------------------------------ */
/* 移动数据连接判定（多来源，任一可靠来源肯定即视为已连接）             */
/* ------------------------------------------------------------------ */

/*
 * 背景：部分模组（ECM/NCM/RNDIS 或内置自动拨号的 mbim/qmi 固件）由模组自身
 * 维持数据连接，QModem 的 get_connect_status 只反映"QModem 是否执行过拨号"，
 * 此类模组上恒返回 No，但接口已获取 IP、实际有网——只看该字段必然误报
 * "模组在线，移动数据未连接"。因此按可靠性依次采信三个来源：
 *   1) 接口证据（最强）：netifd 逻辑接口 up 且持有全局 IPv4/IPv6 地址
 *   2) 模组自报：base_info 的 connect_status（QModem AT 探测，模组视角）
 *   3) QModem 拨号状态：get_connect_status（connection_status / connect_status）
 */

// 各来源 connect_status 的肯定写法归一化（去空白、大小写、1/true 等变体）
function isConnectedValue(v) {
	var s = String(v == null ? '' : v).trim().toLowerCase();
	return s === 'yes' || s === 'y' || s === '1' || s === 'true' ||
		s === 'connected' || s === 'online' || s === 'connect' || s === '已连接';
}

// netifd 接口是否持有全局地址（IPv4 任一 / IPv6 排除链路本地 fe80::/10）
function hasGlobalAddress(iface) {
	if (!iface || typeof iface !== 'object')
		return false;
	var lists = [ iface['ipv4-address'], iface['ipv6-address'], iface['ipv6-prefix'] ];
	for (var i = 0; i < lists.length; i++) {
		var list = Array.isArray(lists[i]) ? lists[i] : [];
		for (var j = 0; j < list.length; j++) {
			var addr = list[j] && list[j].address;
			if (addr && !/^fe[89ab][0-9a-f]?:/i.test(String(addr)))
				return true;
		}
	}
	return false;
}

/*
 * 综合判定移动数据是否已连接。入参（均可选）：
 *   conn  — get_connect_status 的原始返回（对象或 modem_info 数组）
 *   base  — base_info 的 modem_info 数组（模组 AT 自报 connect_status）
 *   iface — getInterfaceStatus 的合并接口视图（netifd）
 * 返回 { connected: bool, source: 'iface'|'at'|'dial'|'' }，source 为采信的来源。
 */
function evalConnectionStatus(opts) {
	opts = opts || {};

	// 1) 接口证据：接口 up 且持有全局地址 —— 实际有网的最强证据
	if (opts.iface && opts.iface.up === true && hasGlobalAddress(opts.iface))
		return { connected: true, source: 'iface' };

	// 2) 模组自报：base_info 里的 connect_status（不同 QModem 版本键名不一）
	var atStatus = findEntry(opts.base, 'connect_status') ||
		findEntry(opts.base, 'connection_status');
	if (isConnectedValue(atStatus))
		return { connected: true, source: 'at' };

	// 3) QModem 拨号状态：对象直取字段，数组走 modem_info。每个来源独立判定，
	//    绝不用 || 串接原始值——"No" 也是真值字符串，串接会让后面的 "Yes" 失效。
	var c = opts.conn;
	var dialStatus = c && c.connect_status != null ? c.connect_status :
		(c && c.connection_status != null ? c.connection_status :
		findEntry(c, 'connect_status') || findEntry(c, 'connection_status'));
	if (isConnectedValue(dialStatus))
		return { connected: true, source: 'dial' };

	return { connected: false, source: '' };
}

/* ------------------------------------------------------------------ */
/* 数据获取封装（返回 Promise）—— 全部改为「缓存优先」                 */
/* ------------------------------------------------------------------ */
/*
 * 每个 getter 的语义与旧版完全一致（返回同样的数据形状），但数据来源变了：
 *
 *   旧：直接 ubus call qmodem <method>   → 每次都是一次 modem/AT 查询，
 *                                          首屏必须等它，modem 无响应就白屏
 *   新：qmodem_cache.snapshot            → 只读 /tmp/qmodem-cache 的 JSON 快照
 *                                          缺失/过期时后台补采，页面先显示旧值
 *
 * 只有在缓存层不可用（老固件没装 worker / rpcd 未重启）时，才退化为直连
 * QModem，且那条路径带 DIRECT_RPC_TIMEOUT 上限、不参与 HTTP 批量。
 */

/* QModem 的信息类方法统一返回 { modem_info: [...] }，这里摊平成数组 */
function modemInfo(v) {
	return unwrapModemInfo(v);
}
function unwrapModemInfo(v) {
	if (v && Array.isArray(v.modem_info)) return v.modem_info;
	return Array.isArray(v) ? v : (v ? [v] : []);
}

/* 读取整个域名的 data（用于 qos / radio / support 这类「data 即结果」的域） */
function cachedDomain(section, domain, fallback, directFn) {
	return fetchSnapshot(section, [domain]).then(function(snap) {
		if (snap) {
			var env = envelopeOf(snap, domain);
			var meta = domainMeta(snap, domain);
			if (meta.status === 'missing' || meta.stale)
				requestRefresh(section, [domain]);
			if (!env || !env.data || typeof env.data !== 'object' || !Object.keys(env.data).length)
				return fallback;
			var out = {};
			Object.keys(env.data).forEach(function(k) { out[k] = env.data[k]; });
			out.cache_status = meta.status;
			out.cache_age = meta.age;
			out.cache_stale = meta.stale;
			return out;
		}
		if (typeof directFn === 'function')
			return withTimeout(directFn(), DIRECT_RPC_TIMEOUT, fallback);
		return fallback;
	});
}

function getBaseInfo(section) {
	return cachedValue(section, 'status', 'base_info', [], function() { return callBaseInfo(section); }, unwrapModemInfo);
}
function getInfo(section) {
	return cachedValue(section, 'device', 'info', [], function() { return callInfo(section); }, unwrapModemInfo);
}
function getSimInfo(section) {
	return cachedValue(section, 'sim', 'sim_info', [], function() { return callSimInfo(section); }, unwrapModemInfo);
}
function getNetworkInfo(section) {
	return cachedValue(section, 'network', 'network_info', [], function() { return callNetworkInfo(section); }, unwrapModemInfo);
}
function getCellInfo(section) {
	return cachedValue(section, 'signal', 'cell_info', [], function() { return callCellInfo(section); }, unwrapModemInfo);
}
function getAtCfg(section) {
	return cachedValue(section, 'device', 'at_cfg', {}, function() { return callGetAtCfg(section); });
}
function getImei(section) {
	return cachedValue(section, 'sim', 'imei', {}, function() { return callGetImei(section); });
}
function getMode(section) {
	return cachedValue(section, 'network', 'mode', {}, function() { return callGetMode(section); });
}
function getLockBand(section) {
	return cachedValue(section, 'network', 'lockband', {}, function() { return callGetLockband(section); });
}
function getNeighborCell(section) {
	return cachedValue(section, 'network', 'neighborcell', {}, function() { return callGetNeighborcell(section); });
}
function getNetworkPrefer(section) {
	return cachedValue(section, 'network', 'network_prefer', {}, function() { return callGetNetworkPrefer(section); });
}
function getDns(section) {
	return cachedValue(section, 'status', 'dns', {}, function() { return callGetDns(section); });
}

/*
 * 短信列表不在 worker 的周期采集范围内（部分模组读短信很慢），
 * 因此：缓存命中就直接用；没有缓存则后台排任务 + 先返回空列表，
 * 由页面的轮询在数据到位后补上。绝不为了首屏去同步读 SIM。
 */
function getSms(section) {
	return fetchSnapshot(section, ['sms']).then(function(snap) {
		var env = envelopeOf(snap, 'sms');
		if (snap && env && env.data && env.data.get_sms)
			return env.data.get_sms;

		if (!snap)
			return withTimeout(callGetSms(section), DIRECT_RPC_TIMEOUT, {});

		requestRefresh(section, ['sms'], true);
		return {};
	});
}

function getDisabledFeatures(section) {
	return cachedValue(section, 'network', 'disabled_features', {}, function() { return callGetDisabledFeatures(section); });
}
function getRebootCaps(section) {
	return cachedValue(section, 'device', 'reboot_caps', {}, function() { return callGetRebootCaps(section); });
}
function getCopyright(section) {
	return cachedValue(section, 'device', 'copyright', {}, function() { return callGetCopyright(section); });
}
function getCurrentBand(section) {
	return cachedValue(section, 'signal', 'current_band', {}, function() { return callGetCurrentBand(section); },
		function(r) {
			/* 部分模组返回 { status: "unsupported" }，统一为空载波列表 */
			if (r && r.status === 'unsupported' && !Array.isArray(r.cells))
				return { cells: [], status: 'unsupported' };
			return r;
		});
}
function getCurrentBandCapabilities(section) {
	return cachedValue(section, 'network', 'current_band_capabilities', {}, function() { return callGetCurrentBandCapabilities(section); });
}

/* 兼容实机差异：部分 QModem 版本返回 connection_status 而非 connect_status */
function getConnectStatus(section) {
	return cachedValue(section, 'status', 'connect_status', {}, function() { return callGetConnectStatus(section); },
		function(r) {
			if (r && r.connection_status != null && r.connect_status == null)
				r.connect_status = r.connection_status;
			return r;
		});
}
function getDialStatus(section) {
	return cachedValue(section, 'status', 'dial_status', {}, function() { return callGetDialStatus(section); });
}

/* 拨号日志体量大且只在用户点开时读取，不进周期缓存；直连但带超时 */
function getDialLog(section) {
	return withTimeout(callGetDialLog(section), DIRECT_RPC_TIMEOUT, {});
}

function getSimSlot(section) {
	return cachedValue(section, 'sim', 'sim_slot', {}, function() { return callGetSimSlot(section); });
}
function getSimSwitchCapabilities(section) {
	return cachedValue(section, 'sim', 'sim_switch_capabilities', {}, function() { return callGetSimSwitchCapabilities(section); });
}
function getUsageStats(section) {
	return cachedValue(section, 'stats', 'usage', { available: 0 }, function() { return callGetUsageStats(section); });
}
function getDailyStats(section) {
	return cachedValue(section, 'stats', 'daily', null, function() { return callDailyStats(section); });
}

/* 清零需要读一次模组计数器建立新基准 → 走后台任务，不让 rpcd 同步等 modem */
function statsReset(section) {
	if (!cacheLayerUsable())
		return withTimeout(callStatsReset(section), DIRECT_RPC_TIMEOUT, null);
	return runTask(function() { return callStatsResetTask(section); }, 60000).then(function(res) {
		touch(section);
		refreshQueued = {};
		return res;
	});
}
function getTrafficResetSchedule(section) {
	return cachedValue(section, 'stats', 'traffic_reset_schedule', {}, function() { return callGetTrafficResetSchedule(section); });
}

/*
 * 模组支持库（/usr/share/qmodem/modem_support.json）注入状态与同步。
 * 该能力与具体模组无关，即使 QModem 尚未识别到任何模组也应可调用。
 * status 由 worker 周期写入缓存（内容是纯文件扫描结果）；
 * sync 改为后台任务：仍然返回 { available, added, skipped, missing, error }，
 * 调用方无需改动，但不再让 rpcd 同步执行文件合并。
 */
function getSupportStatus() {
	return supportFromAnySection();
}

/* support 域与模组无关：从当前 section 的快照里取；拿不到再直连一次 */
function supportFromAnySection() {
	return resolveSection().then(function(section) {
		if (!section)
			return withTimeout(callSupportStatus(), DIRECT_RPC_TIMEOUT, supportUnavailable());
		return fetchSnapshot(section, ['support']).then(function(snap) {
			var env = envelopeOf(snap, 'support');
			if (env && env.data && (env.data.available != null || env.data.path))
				return env.data;
			if (!snap)
				return withTimeout(callSupportStatus(), DIRECT_RPC_TIMEOUT, supportUnavailable());
			return withTimeout(callSupportStatus(), CACHE_RPC_TIMEOUT, supportUnavailable());
		});
	});
}

function supportUnavailable() {
	return { available: 0, path: '', added: [], skipped: [], missing: [],
		error: 'qmodem_support 不可用（请确认 rpcd 已重启并已升级本插件）' };
}

function syncSupport(section) {
	var direct = function() { return withTimeout(callSupportSync(), DIRECT_RPC_TIMEOUT, supportUnavailable()); };
	if (!cacheLayerUsable())
		return direct();

	var target = section || null;
	return resolveSection().then(function(sec) {
		target = section || sec || '';
		return runTask(function() {
			return callTaskAction(target, 'qmodem_support', 'sync', {});
		}, 60000);
	}).then(function(res) {
		if (res && (res.available != null || res.added)) {
			touch(target);
			refreshQueued = {};
			return res;
		}
		return direct();
	}, direct);
}


/* ------------------------------------------------------------------ */
/* 控制动作封装（写操作，返回 Promise）                                */
/* ------------------------------------------------------------------ */

/*
 * 所有会碰 modem 的写操作都改为「后台任务」：
 *   controls.xxx()  →  qmodem_cache.action（立即返回 task_id）
 *                   →  qmodem-task 在持有 AT 互斥锁的子进程里执行 ubus call
 *                   →  前端轮询 get_task，完成后 resolve 出 ubus 原始结果
 * 对调用方来说签名和返回值都没变，但 rpcd 不再同步等待 modem，
 * 而且同类任务自动去重（点两次「重启模组」不会真的重启两次）。
 * 缓存层不可用时自动退回直连（带超时）。
 */

/* 发送 AT 命令。atPort 可为空，由 QModem 自行选择默认端口。 */
function sendAt(section, atPort, command, useUbus) {
	var params = { at: command };
	if (atPort) params.port = atPort;
	if (useUbus !== undefined && useUbus !== null) params.use_ubus = useUbus;
	var direct = function() { return withTimeoutReject(callSendAt(section, params), DIRECT_RPC_TIMEOUT, _('AT command timed out')); };

	if (!cacheLayerUsable())
		return direct();

	/* 无端口/无 use_ubus 时走 qmodem_cache.send_at（后端串行化 AT 通道） */
	if (!atPort && (useUbus === undefined || useUbus === null)) {
		return runTask(function() { return callTaskSendAt(section, command); }, 30000).then(function(res) {
			touch(section);
			return res;
		}, direct);
	}
	return qmodemAction(section, 'send_at', params, direct, 30000);
}

function sendSms(section, phoneNumber, content) {
	var args = { phone_number: phoneNumber, message_content: content };
	return qmodemAction(section, 'send_sms', args,
		function() { return withTimeoutReject(callSendSms(section, args), DIRECT_RPC_TIMEOUT, _('Sending SMS timed out')); }, 60000);
}
function sendRawPdu(section, command) {
	return qmodemAction(section, 'send_raw_pdu', { cmd: command },
		function() { return withTimeoutReject(callSendRawPdu(section, command), DIRECT_RPC_TIMEOUT, _('PDU request timed out')); }, 60000);
}
function deleteSms(section, index) {
	return qmodemAction(section, 'delete_sms', { index: index },
		function() { return withTimeoutReject(callDeleteSms(section, index), DIRECT_RPC_TIMEOUT, _('Deleting SMS timed out')); }, 60000);
}
function setMode(section, mode) {
	return qmodemAction(section, 'set_mode', { mode: mode },
		function() { return withTimeoutReject(callSetMode(section, mode), DIRECT_RPC_TIMEOUT, _('Setting mode timed out')); }, 120000);
}
function setImei(section, imei) {
	return qmodemAction(section, 'set_imei', { imei: imei },
		function() { return withTimeoutReject(callSetImei(section, imei), DIRECT_RPC_TIMEOUT, _('Setting IMEI timed out')); }, 120000);
}
function setLockBand(section, params) {
	return qmodemAction(section, 'set_lockband', { params: params },
		function() { return withTimeoutReject(callSetLockband(section, params), DIRECT_RPC_TIMEOUT, _('Locking band timed out')); }, 120000);
}
function setNetworkPrefer(section, params) {
	return qmodemAction(section, 'set_network_prefer', { params: params },
		function() { return withTimeoutReject(callSetNetworkPrefer(section, params), DIRECT_RPC_TIMEOUT, _('Setting network preference timed out')); }, 120000);
}
function setSimSlot(section, slot) {
	return qmodemAction(section, 'set_sim_slot', { slot: slot },
		function() { return withTimeoutReject(callSetSimSlot(section, slot), DIRECT_RPC_TIMEOUT, _('Switching SIM slot timed out')); }, 120000);
}
function doReboot(section, method) {
	var args = { method: method || 'soft' };
	return qmodemAction(section, 'do_reboot', args,
		function() { return withTimeoutReject(callDoReboot(section, args), DIRECT_RPC_TIMEOUT, _('Reboot request timed out')); }, 180000);
}
function clearDialLog(section) {
	return qmodemAction(section, 'clear_dial_log', {},
		function() { return withTimeoutReject(callClearDialLog(section), DIRECT_RPC_TIMEOUT, _('Clearing log timed out')); }, 60000);
}
function clearStats(section) {
	return qmodemAction(section, 'clear_stats', {},
		function() { return withTimeoutReject(callClearStats(section), DIRECT_RPC_TIMEOUT, _('Clearing counters timed out')); }, 60000);
}
function setTrafficResetSchedule(section, params) {
	return qmodemAction(section, 'set_traffic_reset_schedule', { params: params },
		function() { return withTimeoutReject(callSetTrafficResetSchedule(section, params), DIRECT_RPC_TIMEOUT, _('Saving schedule timed out')); }, 60000);
}
function setNeighborCell(section, params) {
	return qmodemAction(section, 'set_neighborcell', { params: params },
		function() { return withTimeoutReject(callSetNeighborCell(section, params), DIRECT_RPC_TIMEOUT, _('Neighbour cell request timed out')); }, 120000);
}
function setSmsStorage(section, storage) {
	return qmodemAction(section, 'set_sms_storage', { storage: storage },
		function() { return withTimeoutReject(callSetSmsStorage(section, storage), DIRECT_RPC_TIMEOUT, _('Setting SMS storage timed out')); }, 60000);
}
function modemDial(section) {
	return qmodemAction(section, 'modem_dial', {},
		function() { return withTimeoutReject(callModemDial(section), DIRECT_RPC_TIMEOUT, _('Dial request timed out')); }, 180000);
}
function modemHang(section) {
	return qmodemAction(section, 'modem_hang', {},
		function() { return withTimeoutReject(callModemHang(section), DIRECT_RPC_TIMEOUT, _('Hangup request timed out')); }, 120000);
}
function modemRedial(section) {
	return qmodemAction(section, 'modem_redial', {},
		function() { return withTimeoutReject(callModemRedial(section), DIRECT_RPC_TIMEOUT, _('Redial request timed out')); }, 180000);
}

/* 与 modem 无关：直接调用即可 */
function rcList(name) { return withTimeout(callRcList(name), DIRECT_RPC_TIMEOUT, {}); }
function getDeviceStatus(name) { return withTimeout(callDeviceStatus(name), DIRECT_RPC_TIMEOUT, {}); }

/*
 * 物理网口状态：worker 已在 status 域里一并采好（network.device status），
 * 视图应优先用这个缓存版本，避免为了拿一个 MTU 再发一次 RPC。
 */
function getDeviceStatusCached(section) {
	return cachedValue(section, 'status', 'device', {}, function() { return Promise.resolve({}); });
}

/* QoS / 调制信息：AT 探测已搬到 qmodem-worker，这里只读缓存 */
function getQosInfo(section) {
	return cachedDomain(section, 'qos', { qci: 0, status: 'unavailable' },
		function() { return callQosInfo(section); });
}
function getRadioInfo(section) {
	return cachedDomain(section, 'radio', { status: 'unavailable' },
		function() { return callRadioInfo(section); });
}

/*
 * 把 worker 采集到的 { names: [...], entries: { name: <status> } } 合并成
 * 单一接口视图。QModem 为同一模组生成的 IPv4 与 IPv6 地址分布在两个逻辑接口上，
 * 这里把地址/前缀/DNS 等合并，UI 直接取字段展示即可。
 */
function mergeIfaceEntries(entries, names) {
	var merged = {};
	var list = [];

	if (entries && typeof entries === 'object') {
		Object.keys(entries).forEach(function(name) { list.push(entries[name]); });
	} else if (Array.isArray(entries)) {
		list = entries;
	}

	list.forEach(function(e) {
		Object.keys(e || {}).forEach(function(k) {
			switch (k) {
				case 'ipv4-address':
				case 'ipv6-address':
				case 'ipv6-prefix':
				case 'ipv6-prefix-assignment':
				case 'dns-server':
					merged[k] = (merged[k] || []).concat(Array.isArray(e[k]) ? e[k] : []);
					break;
				case 'uptime':
					merged[k] = Math.max(merged[k] || 0, e[k] || 0);
					break;
				case 'up':
					merged[k] = (merged[k] === true) || e[k] === true;
					break;
				default:
					if (merged[k] == null && e[k] != null)
						merged[k] = e[k];
			}
		});
	});

	if (!merged.interface && Array.isArray(names) && names.length)
		merged.interface = names[0];

	return merged;
}

/*
 * 解析某个模组配置节对应的 netifd 逻辑接口。
 * QModem 会为每个模组自动创建 IPv4 / IPv6 两个逻辑接口（命名由配置节派生，与模组
 * 型号无关），因此这里不写死任何型号，按以下顺序自动推导、适配所有模组：
 *   1) /etc/config/network 中 modem_config 指向该配置节的接口（QModem 的标准关联方式）
 *   2) 回退：与配置节同名及 <section>v6 后缀的接口（兼容旧命名规则）
 *   3) 回退：三层设备等于 qmodem 配置中物理网口（network 选项）的接口
 * 返回 { names: [接口名...], entries: [各接口的 status 对象...] }
 *
 * 解析结果由 qmodem-worker 周期写入 status 域的 ifaces 字段，
 * 这里优先读缓存；缓存层不可用时才回退到「uci.load('network') + interface dump」。
 */
function getModemInterfaces(section) {
	return fetchSnapshot(section, ['status']).then(function(snap) {
		if (snap) {
			var ifaces = domainData(snap, 'status').ifaces || {};
			var names = Array.isArray(ifaces.names) ? ifaces.names : [];
			var entries = [];
			Object.keys(ifaces.entries || {}).forEach(function(n) { entries.push(ifaces.entries[n]); });
			return { names: names, entries: entries };
		}
		return resolveModemInterfacesDirect(section);
	});
}

/* 缓存层不可用时的原始解析路径（带超时，绝不无限等待） */
function resolveModemInterfacesDirect(section) {
	return Promise.all([
		withTimeout(uci.load('network'), DIRECT_RPC_TIMEOUT, null),
		withTimeout(callInterfaceDump(), DIRECT_RPC_TIMEOUT, [])
	]).then(function(res) {
		var dump = Array.isArray(res[1]) ? res[1] : [];
		var byName = {};
		dump.forEach(function(e) { if (e && e.interface) byName[e.interface] = e; });

		var names = [];
		try {
			uci.sections('network', 'interface', function(s) {
				if (s && s['.name'] && s.modem_config === section && byName[s['.name']])
					names.push(s['.name']);
			});
		} catch (e) { names = []; }

		if (!names.length)
			[section, section + 'v6'].forEach(function(n) { if (byName[n]) names.push(n); });

		if (!names.length) {
			var dev = '';
			try { dev = uci.get('qmodem', section, 'network') || ''; } catch (e) { dev = ''; }
			if (dev)
				dump.forEach(function(e) {
					if ((e.l3_device === dev || e.device === dev) && names.indexOf(e.interface) === -1)
						names.push(e.interface);
				});
		}

		return { names: names, entries: names.map(function(n) { return byName[n]; }) };
	});
}

/*
 * 取模组数据接口的合并状态：优先用 worker 已采集好的 status.ifaces（纯缓存读），
 * 缓存层不可用时才现场解析 netifd。
 */
function getInterfaceStatus(section) {
	return fetchSnapshot(section, ['status']).then(function(snap) {
		if (snap) {
			var data = domainData(snap, 'status');
			var ifaces = data.ifaces || {};
			var merged = mergeIfaceEntries(ifaces.entries, ifaces.names);
			if (!merged.l3_device && !merged.device && ifaces.netdev)
				merged.l3_device = ifaces.netdev;
			return merged;
		}
		return resolveModemInterfacesDirect(section).then(function(r) {
			return mergeIfaceEntries(r.entries, r.names);
		});
	});
}

/* ------------------------------------------------------------------ */
/* 配置节解析                                                          */
/* ------------------------------------------------------------------ */

// 列出 /etc/config/qmodem 中所有 modem-device 配置节
function getModemSections() {
	return uci.load('qmodem').then(function() {
		var sections = [];
		uci.sections('qmodem', 'modem-device', function(s) {
			sections.push({
				id: s['.name'],
				name: s.name || s.model || s['.name'],
				model: s.model || '',
				manufacturer: s.manufacturer || '',
				at_port: s.at_port || '',
				enabled: s.enabled !== '0'
			});
		});
		return sections;
	});
}

// 模组选择器的持久化键（localStorage）：记住用户上次查看的模组
var SECTION_KEY = 'qmodem-generic_active_section';

function getStorage() {
	try { return window.localStorage; } catch (e) { return null; }
}
function getStoredSection() {
	var s = getStorage();
	return s ? s.getItem(SECTION_KEY) : null;
}
function setStoredSection(id) {
	var s = getStorage();
	if (s && id) s.setItem(SECTION_KEY, id);
}

// 供模组选择器使用：仅返回已启用且提供了 AT 端口的模组（与 QModem-next 的判定一致）
function getModemList() {
	return getModemSections().then(function(sections) {
		return sections.filter(function(s) {
			return s.enabled && s.at_port;
		});
	});
}

// 同步读取模组列表（在 load 之后、render 内调用；此时 uci 已加载）。
// 供视图在 render 中直接构建模组选择器，无需再次异步加载。
function getModemSectionsSync() {
	var sections = [];
	try {
		uci.sections('qmodem', 'modem-device', function(s) {
			sections.push({
				id: s['.name'],
				name: s.name || s.model || s['.name'],
				model: s.model || '',
				manufacturer: s.manufacturer || '',
				enabled: s.enabled !== '0',
				at_port: s.at_port || ''
			});
		});
	} catch (e) { sections = []; }
	return sections;
}

// 解析当前要展示的模组配置节 id：优先使用用户上次在模组选择器中的选择，
// 否则回退到第一个启用的模组。不绑定任何具体型号。
function resolveSection() {
	return getModemSections().then(function(sections) {
		if (!sections.length) return null;
		var stored = getStoredSection();
		if (stored) {
			for (var i = 0; i < sections.length; i++) {
				if (sections[i].id === stored && sections[i].enabled) return stored;
			}
		}
		var enabled = sections.filter(function(s) { return s.enabled; });
		return (enabled[0] || sections[0]).id;
	});
}

// 通用模组选择器：多于一个模组时渲染下拉框，切换时回调 onSwitch(sectionId)。
function renderModemBar(sections, currentId, onSwitch) {
	if (!sections || sections.length <= 1) return null;
	var select = E('select', { 'class': 'cbi-input-select mt-modem-select' }, sections.map(function(s) {
		var label = s.name;
		if (s.manufacturer && String(s.manufacturer).toLowerCase() !== String(s.name).toLowerCase()) {
			label = String(s.manufacturer).toUpperCase() + ' ' + s.name;
		}
		return E('option', { 'value': s.id }, label);
	}));
	select.value = currentId || (sections[0] && sections[0].id);
	if (onSwitch) {
		select.addEventListener('change', function() {
			onSwitch(select.value);
		});
	}
	return E('div', { 'class': 'mt-modem-bar' }, [
		E('label', { 'class': 'mt-modem-bar-label' }, _('Modem')),
		select
	]);
}

// 把 QModem 返回的 modem_info 数组按 class 分组（用于"全部信息"动态渲染）
function groupByClass(entries) {
	var grouped = {};
	entryList(entries).forEach(function(item) {
		if (!item || item.type === 'warning_message') return;
		var cls = item['class'] || 'General';
		if (!grouped[cls]) grouped[cls] = [];
		grouped[cls].push(item);
	});
	return grouped;
}

// 信号质量分级（与 QModem-next 一致），把原始 dBm/dB 值加上 优/良/中/差 文案
function formatSignal(value, type) {
	if (!value || value === 'N/A') return String(value || '--');
	var num = parseInt(value, 10);
	if (isNaN(num)) return String(value);
	switch (type) {
		case 'rssi':
			if (num >= -70) return value + ' dBm (' + _('Excellent') + ')';
			if (num >= -85) return value + ' dBm (' + _('Good') + ')';
			if (num >= -100) return value + ' dBm (' + _('Fair') + ')';
			return value + ' dBm (' + _('Poor') + ')';
		case 'rsrp':
			if (num >= -80) return value + ' dBm (' + _('Excellent') + ')';
			if (num >= -90) return value + ' dBm (' + _('Good') + ')';
			if (num >= -100) return value + ' dBm (' + _('Fair') + ')';
			return value + ' dBm (' + _('Poor') + ')';
		case 'rsrq':
			if (num >= -10) return value + ' dB (' + _('Excellent') + ')';
			if (num >= -15) return value + ' dB (' + _('Good') + ')';
			if (num >= -20) return value + ' dB (' + _('Fair') + ')';
			return value + ' dB (' + _('Poor') + ')';
		case 'sinr':
		case 'snr':
			if (num >= 20) return value + ' dB (' + _('Excellent') + ')';
			if (num >= 13) return value + ' dB (' + _('Good') + ')';
			if (num >= 0) return value + ' dB (' + _('Fair') + ')';
			return value + ' dB (' + _('Poor') + ')';
		default:
			return String(value);
	}
}

// 设备信息参数中文标签映射表
var LABEL_ZH = {
	'Name': '型号名称',
	'Manufacturer': '制造商',
	'Revision': '固件版本',
	'AT Port': 'AT 端口',
	'Connect Status': '连接状态',
	'Temperature': '温度',
	'Network Mode': '网络模式',
	'MCC': '移动国家码 (MCC)',
	'MNC': '移动网络码 (MNC)',
	'Cell ID': '小区 ID',
	'PCI': '物理小区 ID (PCI)',
	'TAC': '跟踪区码 (TAC)',
	'ARFCN': '绝对频点号 (ARFCN)',
	'EARFCN': '下行频点号 (EARFCN)',
	'NR-ARFCN': 'NR 频点号 (NR-ARFCN)',
	'RSRP': '参考信号接收功率 (RSRP)',
	'RSRQ': '参考信号接收质量 (RSRQ)',
	'SINR': '信号干扰噪声比 (SINR)',
	'SCS': '子载波间隔 (SCS)',
	'SIM Status': 'SIM 状态',
	'SIM Slot': 'SIM 卡槽',
	'IMEI': '国际移动设备识别码 (IMEI)',
	'IMSI': '国际移动用户识别码 (IMSI)',
	'ICCID': '集成电路卡识别码 (ICCID)',
	'Band': '频段',
	'Bandwidth': '带宽',
	'DL Bandwidth': '下行带宽',
	'UL Bandwidth': '上行带宽',
	'RSSI': '接收信号强度指示 (RSSI)',
	'CQI': '信道质量指示 (CQI)',
	'Serving Cell': '服务小区',
	'Neighbor Cell': '邻区',
	'Network Type': '网络类型',
	'LAC': '位置区码 (LAC)',
	'RAC': '路由区码 (RAC)',
	'eNodeB ID': 'eNodeB ID',
	'gNodeB ID': 'gNodeB ID',
	'Sector ID': '扇区 ID',
	'UTRAN Cell ID': 'UTRAN 小区 ID',
	'NR Cell ID': 'NR 小区 ID',
	'Physical Cell ID': '物理小区 ID (PCI)',
	'Mobile Country Code': '移动国家码 (MCC)',
	'Mobile Network Code': '移动网络码 (MNC)',
	'Absolute Radio-Frequency Channel Number': '绝对频点号 (ARFCN)',
	'Reference Signal Received Power': '参考信号接收功率 (RSRP)',
	'Reference Signal Received Quality': '参考信号接收质量 (RSRQ)',
	'Signal to Interference plus Noise Ratio': '信号干扰噪声比 (SINR)',
	'Signal to Interference plus Noise Ratio Bandwidth': '信号干扰噪声比带宽 (SINR BW)',
	'MTU': '最大传输单元 (MTU)',
	'International Mobile Equipment Identity': '国际移动设备识别码 (IMEI)',
	'International Mobile Subscriber Identity': '国际移动用户识别码 (IMSI)',
	'Tracking Area Code': '跟踪区码 (TAC)',
	'Tracking area code of cell served by neighbor Enb': '跟踪区码 (TAC)',
	'Subcarrier Spacing': '子载波间隔 (SCS)',
	'APN': '接入点名称 (APN)',
	'PLMN': '公共陆地移动网 (PLMN)',
	'MSISDN': '电话号码 (MSISDN)',
	'Radio Access Technology': '无线接入技术',
	'Registration Status': '注册状态'
};

// 把 QModem 的 modem_info 渲染为分组卡片（每 class 一张 mt-ui-card），
// 用于"完整信息"面板——QModem 返回什么就显示什么。
function renderInfoGrouped(entries) {
	var grouped = groupByClass(entries);
	var cards = [];
	Object.keys(grouped).forEach(function(cls) {
		var rows = grouped[cls].map(function(item) {
			var rawName = item.full_name || item.key || '';
			var name = LABEL_ZH[rawName] || _(rawName);
			var display = item.extra_info ? (name + ' (' + item.extra_info + ')') : name;
			var val = (item.value == null || item.value === '') ? '--' : String(item.value);
			return E('div', { 'class': 'mt-info-row' }, [
				E('span', { 'class': 'mt-info-key' }, display),
				E('strong', { 'class': 'mt-info-val' }, val)
			]);
		});
		cards.push(E('section', { 'class': 'mt-info-card mt-ui-card' }, [
			E('h3', {}, _(cls)),
			E('div', { 'class': 'mt-info-body' }, rows)
		]));
	});
	return cards;
}

/* ------------------------------------------------------------------ */
/* UI 辅助（保留原 styles/排版/中文文案）                              */
/* ------------------------------------------------------------------ */

function formatBytes(value) {
	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], index = 0;
	value = Math.max(0, Number(value) || 0);
	while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
	return (index ? value.toFixed(value >= 10 ? 1 : 2) : String(Math.round(value))) + ' ' + units[index];
}

function formatDuration(seconds) {
	seconds = Math.max(0, Number(seconds) || 0);
	var days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
	return (days ? days + _('d') + ' ' : '') + (hours ? hours + _('h') + ' ' : '') + minutes + _('min');
}

function formatRate(value) {
	value = Number(value) || 0;
	if (value >= 1000000000) return (value / 1000000000).toFixed(2) + ' Gbps';
	if (value >= 1000000) return (value / 1000000).toFixed(1) + ' Mbps';
	return value ? Math.round(value / 1000) + ' Kbps' : '--';
}

function select(options, value) {
	var node = E('select', { 'class': 'cbi-input-select' }, options.map(function(item) {
		return E('option', { 'value': item[0] }, item[1]);
	}));
	if (value != null)
		node.value = String(value);
	return node;
}

function row(label, input) {
	return E('div', { 'class': 'mt-control-row' }, [ E('label', {}, label), input ]);
}

function action(label, handler) {
	return E('div', { 'class': 'mt-control-actions' }, E('button', {
		'type': 'button',
		'class': 'btn cbi-button-apply',
		'click': handler
	}, label));
}

function card(title, desc, body, wide) {
	return E('section', { 'class': 'mt-control-card mt-ui-card' + (wide ? ' wide' : '') }, [
		E('h3', {}, title),
		E('div', { 'class': 'mt-control-desc' }, desc)
	].concat(body));
}

function state(label, value) {
	return E('div', { 'class': 'mt-control-state' }, [ E('span', {}, label), E('strong', {}, value || '--') ]);
}

function styleNode() {
	return E('style', {}, [
		'.mt-ui-page{--mt-ui-accent:#1264d8;--mt-ui-teal:#07988e;--mt-ui-border:var(--border-color-medium,#d9dde4);--mt-ui-border-soft:var(--border-color-low,#edf0f4);--mt-ui-surface:var(--background-color-high,#fff);--mt-ui-muted:var(--text-color-medium,#69717d);max-width:1120px;margin:0 auto;color:var(--text-color-high,#20242a)}',
		'.mt-ui-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;margin:0 0 16px;border:0;border-radius:16px;background:linear-gradient(135deg,#1264d8 0%,#087eae 58%,#07988e 100%);color:#fff;box-shadow:0 10px 28px rgba(14,92,155,.16)}.mt-ui-hero h2{margin:0 0 6px;color:#fff;font-size:24px;line-height:1.2}.mt-ui-hero p,.mt-ui-hero [class*="-sub"]{margin:0;color:rgba(255,255,255,.78);font-size:12px;line-height:1.5}.mt-ui-hero [class*="kicker"],.mt-ui-hero [class*="eyebrow"]{color:rgba(255,255,255,.68);font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}',
		'.mt-ui-card{border:1px solid var(--mt-ui-border);border-radius:14px;background:var(--mt-ui-surface);box-shadow:0 3px 12px rgba(20,32,50,.04)}',
		'.mt-ui-page .btn{border-radius:9px}.mt-ui-page input,.mt-ui-page select,.mt-ui-page textarea{border-radius:8px}',
		'.mt-ui-details{margin-top:14px;border:1px solid var(--mt-ui-border);border-radius:14px;background:var(--mt-ui-surface);overflow:hidden}.mt-ui-details>summary{display:grid;grid-template-columns:minmax(0,1fr) 34px;align-items:center;gap:14px;min-height:54px;padding:10px 12px 10px 18px;cursor:pointer;list-style:none;transition:background-color .16s ease}.mt-ui-details>summary::-webkit-details-marker{display:none}.mt-ui-details>summary:hover{background:var(--background-color-low,#f6f8fa)}.mt-ui-summary-copy{min-width:0}.mt-ui-summary-title{display:block;font-size:14px;font-weight:700;line-height:1.35}.mt-ui-summary-desc{display:block;margin-top:3px;color:var(--mt-ui-muted);font-size:11px;font-weight:400;line-height:1.45}.mt-ui-chevron{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--mt-ui-border-soft);border-radius:9px;background:var(--background-color-low,#f5f7f9);color:var(--mt-ui-muted);font-size:22px;line-height:1;transform:rotate(0deg);transition:transform .18s ease,background-color .18s ease,color .18s ease}.mt-ui-details[open]>summary .mt-ui-chevron{transform:rotate(90deg);background:#eaf4ff;color:#176bc1}.mt-ui-details[open]>summary{border-bottom:1px solid var(--mt-ui-border-soft)}.mt-ui-details:not([open])>.mt-ui-details-body{display:none}',
		'.mt-control-section{margin-top:20px}.mt-control-section-head{margin:0 0 11px}.mt-control-section-head h3{margin:0 0 4px;font-size:17px}.mt-control-section-head p{margin:0;color:var(--text-color-medium,#6e7783);font-size:12px;line-height:1.5}',
		'.mt-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.mt-control-card{padding:18px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-control-card.wide{grid-column:1/-1}',
		'.mt-control-card h3{margin:0 0 5px;font-size:15px}.mt-control-desc{font-size:12px;color:var(--text-color-medium,#6e7783);margin-bottom:14px;line-height:1.5}.mt-control-row{display:grid;grid-template-columns:145px 1fr;gap:10px;align-items:center;margin:11px 0}.mt-control-row label{font-size:12px;color:var(--text-color-medium,#6e7783)}.mt-control-row input,.mt-control-row select{width:100%;box-sizing:border-box}',
		'.mt-control-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.mt-control-note{padding:10px 12px;border-radius:8px;background:#fff7e5;color:#795300;font-size:11px;line-height:1.5;margin-top:12px}.mt-control-state{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4);font-size:12px}.mt-control-state:last-child{border-bottom:0}.mt-control-state span{color:var(--text-color-medium,#6e7783)}.mt-control-state strong{text-align:right}.mt-control-state-current{background:#f2f8ff;border:1px solid #d3e7fb;border-radius:8px;padding:9px 12px;margin:8px 0}.mt-control-state-current span{color:#3a6ea5}.mt-control-state-current strong{color:#176bc1;font-weight:700}',
		'.mt-control-card.mt-ui-card{border-radius:14px}',
		'.mt-modem-bar{display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:10px 14px;border:1px solid var(--mt-ui-border);border-radius:12px;background:var(--mt-ui-surface)}.mt-modem-bar-label{font-size:12px;font-weight:700;color:var(--mt-ui-muted);white-space:nowrap}.mt-modem-select{min-width:220px;max-width:420px}',
		'.mt-info-all{margin-top:14px}.mt-info-all>h3{margin:0 0 4px;font-size:16px}.mt-info-all>p{margin:0 0 12px;color:var(--mt-ui-muted);font-size:12px;line-height:1.5}.mt-info-grid-all{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
		'.mt-info-card{padding:15px 17px}.mt-info-card h3{margin:0 0 10px;font-size:13px;font-weight:750;color:#176bc1}.mt-info-body{display:flex;flex-direction:column}.mt-info-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--mt-ui-border-soft,#edf0f4);font-size:12px}.mt-info-row:last-child{border-bottom:0}.mt-info-key{color:var(--mt-ui-muted)}.mt-info-val{text-align:right;word-break:break-all;font-weight:600;font-variant-numeric:tabular-nums}',
		'@media(max-width:760px){.mt-ui-hero{display:block;padding:20px}.mt-ui-card{border-radius:13px}.mt-ui-page .btn{min-height:36px}.mt-ui-page input:not([type="checkbox"]):not([type="radio"]),.mt-ui-page select{min-height:36px}.mt-ui-details>summary{grid-template-columns:minmax(0,1fr) 32px;padding-left:15px}.mt-control-grid{grid-template-columns:1fr}.mt-control-row{grid-template-columns:1fr;gap:5px}.mt-info-grid-all{grid-template-columns:1fr}}'
	].join(''));
}

// 确认弹窗（替代原 confirmRun）。onConfirm 回调中执行 QModem ubus 动作。
function confirmModal(title, message, onConfirm, restartRequired) {
	return ui.showModal(title, [
		E('p', {}, message),
		restartRequired ? E('div', { 'class': 'alert-message warning' }, _('A module restart or airplane-mode cycle is required before this change takes effect.')) : null,
		E('div', { 'class': 'right' }, [
			E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button-negative',
				'click': function() {
					ui.hideModal();
					Promise.resolve(onConfirm()).then(function() {
						ui.addNotification(null, E('p', {}, _('Settings applied.')));
						window.setTimeout(function() { window.location.reload(); }, 900);
					}, function(err) {
						ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				}
			}, _('Apply'))
		])
	]);
}

// 根据 MCC/MNC（或运营商名）返回中文名 + logo。
function operatorInfo(name, mcc, mnc) {
	var n = (name || '').toUpperCase().replace(/\s+/g, ' ').trim();
	var code = (mcc && mnc) ? String(mcc) + String(mnc) : '';
	if (!code && /^\d{5,6}$/.test(n)) code = n;
	if (/^4600[02478]$/.test(code)) n = 'CHINA MOBILE';
	else if (/^4600[169]$/.test(code)) n = 'CHINA UNICOM';
	else if (/^460(03|05|11)$/.test(code)) n = 'CHINA TELECOM';
	else if (/^46015$/.test(code)) n = 'CHINA BROADNET';
	if (n.indexOf('CHINA MOBILE') !== -1 || n.indexOf('CMCC') !== -1)
		return { name: '中国移动', logo: null };
	if (n.indexOf('CHINA UNICOM') !== -1 || n.indexOf('UNICOM') !== -1)
		return { name: '中国联通', logo: null };
	if (n.indexOf('CHINA TELECOM') !== -1 || n.indexOf('TELECOM') !== -1)
		return { name: '中国电信', logo: null };
	if (n.indexOf('BROADNET') !== -1 || n.indexOf('CBN') !== -1)
		return { name: '中国广电', logo: null };
	return { name: name || _('Mobile Network'), logo: null };
}

/* ------------------------------------------------------------------ */
/* 视图入口：首屏加载                                                  */
/* ------------------------------------------------------------------ */

/*
 * bootstrap(domains) —— 所有视图 load() 的统一入口。
 *
 * 只做两件**都不会碰 modem** 的事：
 *   1) uci.load('qmodem')         读配置（本地文件，毫秒级）
 *   2) qmodem_cache.snapshot      读状态缓存（纯文件 IO，正常 < 50 ms）
 * 两者都带客户端超时，且**永不 reject** —— 无论 QModem 是否已识别模组、
 * modem 是否失联、worker 是否在跑，页面框架都能立刻渲染出来。
 *
 * 返回 { section, sections, snap, errors }。
 * 若缓存缺失/过期，会自动排一个后台 refresh 任务，由页面的轮询补上数据。
 */
function bootstrap(domains) {
	var ctx = { section: null, sections: [], snap: null, errors: [] };

	return withTimeout(uci.load('qmodem'), CACHE_RPC_TIMEOUT, null).then(function() {
		ctx.sections = getModemSectionsSync();
		return resolveSection();
	}).then(function(section) {
		ctx.section = section || null;
		if (!ctx.section)
			return ctx;

		return fetchSnapshot(ctx.section, domains).then(function(snap) {
			ctx.snap = snap;
			if (!snap || !snapshotCovers(snap, domains))
				requestRefresh(ctx.section, domains, true);
			return ctx;
		});
	}).then(function() {
		return ctx;
	}, function(err) {
		ctx.errors.push((err && err.message) || String(err));
		return ctx;
	});
}

/*
 * 缓存健康度汇总，供页面顶部显示「离线 / 数据过期」而不是白屏。
 * 返回 { offline, stale, oldest, statuses: { domain: meta } }
 */
function dataStatus(snap, domains) {
	var out = { offline: false, stale: false, oldest: -1, statuses: {}, available: !!snap };
	(domains || []).forEach(function(d) {
		var meta = domainMeta(snap, d);
		out.statuses[d] = meta;
		if (meta.status === 'offline') out.offline = true;
		if (meta.stale) out.stale = true;
		if (meta.age > out.oldest) out.oldest = meta.age;
	});
	return out;
}

return baseclass.extend({
	/* ---- 异步化基础设施（视图直接复用，避免各自实现轮询/超时） ---- */
	bootstrap: bootstrap,
	dataStatus: dataStatus,
	fetchSnapshot: fetchSnapshot,
	snapshotCovers: snapshotCovers,
	envelopeOf: envelopeOf,
	domainData: domainData,
	domainMeta: domainMeta,
	requestRefresh: requestRefresh,
	touch: touch,
	cacheLayerUsable: cacheLayerUsable,
	runTask: runTask,
	waitForTask: waitForTask,
	qmodemAction: qmodemAction,
	createPoller: createPoller,
	liveView: liveView,
	withTimeout: withTimeout,
	withTimeoutReject: withTimeoutReject,
	mergeIfaceEntries: mergeIfaceEntries,
	modemInfo: modemInfo,
	getDeviceStatusCached: getDeviceStatusCached,

	findEntry: findEntry,
	entryList: entryList,
	entryMap: entryMap,
	isConnectedValue: isConnectedValue,
	hasGlobalAddress: hasGlobalAddress,
	evalConnectionStatus: evalConnectionStatus,

	getBaseInfo: getBaseInfo,
	getInfo: getInfo,
	getSimInfo: getSimInfo,
	getNetworkInfo: getNetworkInfo,
	getCellInfo: getCellInfo,
	getAtCfg: getAtCfg,
	getImei: getImei,
	getMode: getMode,
	getLockBand: getLockBand,
	getNeighborCell: getNeighborCell,
	getNetworkPrefer: getNetworkPrefer,
	getDns: getDns,
	getSms: getSms,
	getDisabledFeatures: getDisabledFeatures,
	getRebootCaps: getRebootCaps,
	getCopyright: getCopyright,
	getCurrentBand: getCurrentBand,
	getCurrentBandCapabilities: getCurrentBandCapabilities,
	getConnectStatus: getConnectStatus,
	getDialStatus: getDialStatus,
	getDialLog: getDialLog,
	getSimSlot: getSimSlot,
	getSimSwitchCapabilities: getSimSwitchCapabilities,
	getUsageStats: getUsageStats,
	getDailyStats: getDailyStats,
	statsReset: statsReset,
	getTrafficResetSchedule: getTrafficResetSchedule,
	getSupportStatus: getSupportStatus,
	syncSupport: syncSupport,

	sendAt: sendAt,
	sendSms: sendSms,
	sendRawPdu: sendRawPdu,
	deleteSms: deleteSms,
	setMode: setMode,
	setImei: setImei,
	setLockBand: setLockBand,
	setNetworkPrefer: setNetworkPrefer,
	setSimSlot: setSimSlot,
	doReboot: doReboot,
	clearDialLog: clearDialLog,
	clearStats: clearStats,
	setTrafficResetSchedule: setTrafficResetSchedule,
	setNeighborCell: setNeighborCell,
	setSmsStorage: setSmsStorage,
	modemDial: modemDial,
	modemHang: modemHang,
	modemRedial: modemRedial,
	rcList: rcList,
	getModemInterfaces: getModemInterfaces,
	getInterfaceStatus: getInterfaceStatus,
	getDeviceStatus: getDeviceStatus,
	getQosInfo: getQosInfo,
	getRadioInfo: getRadioInfo,

	getModemSections: getModemSections,
	resolveSection: resolveSection,
	getModemList: getModemList,
	getModemSectionsSync: getModemSectionsSync,
	getStoredSection: getStoredSection,
	setStoredSection: setStoredSection,
	renderModemBar: renderModemBar,
	groupByClass: groupByClass,
	formatSignal: formatSignal,
	renderInfoGrouped: renderInfoGrouped,
	normalizeTemperature: normalizeTemperature,

	formatBytes: formatBytes,
	formatDuration: formatDuration,
	formatRate: formatRate,
	select: select,
	row: row,
	action: action,
	card: card,
	state: state,
	styleNode: styleNode,
	confirmModal: confirmModal,
	operatorInfo: operatorInfo
});
