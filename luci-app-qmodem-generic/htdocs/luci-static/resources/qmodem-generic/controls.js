'use strict';
'require baseclass';
'require ui';
'require uci';
'require rpc';
'require dom';
'require qmodem-generic.theme as theme';

/*
 * 通用 QModem LuCI 前端 — QModem 官方接口数据层
 *
 * 本文件是视图与 QModem 之间的唯一数据桥梁：所有"显示的数据"与"控制动作"
 * 全部直连 QModem 的官方 ubus 接口（与官方 luci-app-qmodem-next 相同的接线方式）：
 *
 *   qmodem          — 模组信息 / 射频控制 / 拨号 / 短信直连通道 / 设备扫描
 *   qmodem.sms      — qmodem_smsd 短信守护进程（数据库收发 / 存储管理 / 同步）
 *   qmodem.uplink   — 上联管理状态（qmodem-uplink-manager）
 *   rc / luci       — procd 服务状态与启停（qmodem_network 等）
 *   network.* / uci — netifd 接口状态 / UCI 配置
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
 *  - QModem rpcd 自带 10 秒文件缓存（/tmp/cache_*），页面轮询不会击穿 AT 串口；
 *    本层不做额外缓存，数据新鲜度与官方 LuCI 完全一致。
 */

/* ------------------------------------------------------------------ */
/* LuCI 26.x 旧 API 兼容层                                              */
/* ------------------------------------------------------------------ */

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

/* 本插件局部使用的 DOM 工厂，不修改 LuCI 的全局 E。
 * 25.12 的 dom.append 会将数组中的 null/undefined 转成文字；先展开并过滤
 * 条件节点，再交给 dom.create 绑定事件和属性。纯文本总以数组传入，避免把
 * 模组名称、短信和 AT 返回值当作 HTML。数值 0 必须保留。 */
function E(tag, attrs, children) {
	var nodes = [];
	function add(value) {
		if (Array.isArray(value)) value.forEach(add);
		else if (value != null && value !== false) nodes.push(value);
	}
	add(children);
	return dom.create(tag, attrs || {}, nodes);
}

/* 空值只影响展示，不改变 RPC 原始数据或 UCI 配置。false/0 是有效上报。 */
function hasValue(value) {
	if (value == null) return false;
	if (typeof value === 'number') return isFinite(value);
	if (typeof value === 'boolean') return true;
	if (Array.isArray(value)) return value.some(hasValue);
	if (typeof value === 'object') {
		if (value.nodeType) return true;
		return Object.keys(value).some(function(k) { return hasValue(value[k]); });
	}
	return !/^(?:\s*|[-–—]+|n\s*\/\s*a|none|null|undefined|nan|unknown|not available|not supported|unsupported)$/i.test(String(value).trim());
}

function valueText(value) {
	if (!hasValue(value)) return '';
	if (Array.isArray(value)) return value.filter(hasValue).map(valueText).join(', ');
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/*
 * svgNode() 走的是 innerHTML，动态值（AT 回读的频段名、stats 文件里的日期、
 * UCI 里的接口名）一旦被插入到 <text> 或属性里，就能改写这段 SVG 结构。
 * 所有拼进 SVG 字符串的外部数据都必须先过这里。
 */
function xmlText(value) {
	return String(value == null ? '' : value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function dataRow(label, value, rowClass, keyClass, valClass) {
	if (!hasValue(value)) return null;
	return E('div', { 'class': rowClass || 'qm-kv-row' }, [
		E('span', { 'class': keyClass || '' }, label),
		value && value.nodeType ? value : E('strong', { 'class': valClass || '' }, valueText(value))
	]);
}

/* 23.05 / 24.10 的 uci.js 没有 commit()；使用各版本共有的官方 UCI RPC。
 * 调用前仍由 CBI Map.save() 校验并保存当前表单，不应用其它配置。 */
var callUciCommit = rpc.declare({ object: 'uci', method: 'commit', params: ['config'], expect: { }, reject: true, nobatch: true });
function commitConfig(config) {
	return callUciCommit(config);
}

/* ------------------------------------------------------------------ */
/* QModem ubus RPC 声明（全部单行 + nobatch，见测试约定）               */
/* ------------------------------------------------------------------ */

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
var callSaveStats = rpc.declare({ object: 'qmodem', method: 'save_stats', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callGetTrafficResetSchedule = rpc.declare({ object: 'qmodem', method: 'get_traffic_reset_schedule', params: ['config_section'], expect: { }, nobatch: true });
// 持久化分天流量统计（/usr/libexec/rpcd/qmodem_stats 提供，数据源为官方 get_stats）：
// daily_stats 只读落盘记录；stats_reset 清零本地分天记录并重建基准（带硬超时）
var callDailyStats = rpc.declare({ object: 'qmodem_stats', method: 'daily_stats', params: ['config_section'], expect: { }, nobatch: true });
var callStatsReset = rpc.declare({ object: 'qmodem_stats', method: 'stats_reset', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callGetMonitorStatus = rpc.declare({ object: 'qmodem', method: 'get_monitor_status', params: ['config_section'], expect: { }, nobatch: true });
var callGet5gLan = rpc.declare({ object: 'qmodem', method: 'get_5g_lan', params: ['config_section'], expect: { }, nobatch: true });
var callSet5gLan = rpc.declare({ object: 'qmodem', method: 'set_5g_lan', params: ['config_section', 'enabled'], expect: { }, nobatch: true, reject: true });

/* 设备扫描 / 模组接入（官方 settings 页同款接口） */
var callScanPcie = rpc.declare({ object: 'qmodem', method: 'scan_pcie', expect: { }, nobatch: true, reject: true });
var callScanUsb = rpc.declare({ object: 'qmodem', method: 'scan_usb', expect: { }, nobatch: true, reject: true });
var callScanAll = rpc.declare({ object: 'qmodem', method: 'scan_all', expect: { }, nobatch: true, reject: true });
var callGetPcieDevices = rpc.declare({ object: 'qmodem', method: 'get_pcie_devices', expect: { }, nobatch: true });
var callGetUsbDevices = rpc.declare({ object: 'qmodem', method: 'get_usb_devices', expect: { }, nobatch: true });
var callGetAvailableDevices = rpc.declare({ object: 'qmodem', method: 'get_available_devices', expect: { }, nobatch: true });
var callGetTtyPorts = rpc.declare({ object: 'qmodem', method: 'get_tty_ports', expect: { }, nobatch: true });
var callGetLeds = rpc.declare({ object: 'qmodem', method: 'get_leds', expect: { }, nobatch: true });
var callGetNetworkInterfaces = rpc.declare({ object: 'qmodem', method: 'get_network_interfaces', expect: { }, nobatch: true });
var callRemoveModem = rpc.declare({ object: 'qmodem', method: 'remove_modem', params: ['config_section'], expect: { }, nobatch: true, reject: true });

/* 短信守护进程 qmodem.sms（qmodem_smsd） */
var callSmsConfig = rpc.declare({ object: 'qmodem.sms', method: 'config_get', params: ['modem_id'], expect: { }, nobatch: true, reject: true });
var callSmsList = rpc.declare({ object: 'qmodem.sms', method: 'list', params: ['modem_id', 'limit', 'offset'], expect: { }, nobatch: true, reject: true });
var callSmsSend = rpc.declare({ object: 'qmodem.sms', method: 'send', params: ['modem_id', 'recipient', 'content'], expect: { }, nobatch: true, reject: true });
var callSmsDelete = rpc.declare({ object: 'qmodem.sms', method: 'delete', params: ['modem_id', 'id'], expect: { }, nobatch: true, reject: true });
var callSmsMarkRead = rpc.declare({ object: 'qmodem.sms', method: 'mark_read', params: ['modem_id', 'id'], expect: { }, nobatch: true, reject: true });
var callSmsSync = rpc.declare({ object: 'qmodem.sms', method: 'sync', params: ['modem_id'], expect: { }, nobatch: true, reject: true });
var callSmsServiceStatus = rpc.declare({ object: 'qmodem.sms', method: 'status', expect: { }, nobatch: true, reject: true });
var callSmsSyncStatus = rpc.declare({ object: 'qmodem.sms', method: 'sync_status', expect: { }, nobatch: true, reject: true });
var callSmsModemList = rpc.declare({ object: 'qmodem.sms', method: 'modem_list', expect: { }, nobatch: true, reject: true });
/* 官方 qmodem_smsd 的 configure 用同一份 policy 解析全部字段（main.c configure_method）：
 * country_code 与 mode/poll_interval/forwarding/auto_delete 可在同一次调用中并存，
 * country_code 传空串即清除。不要拆成两次调用——设置弹窗保存时两路都会走。 */
var callSmsConfigure = rpc.declare({ object: 'qmodem.sms', method: 'configure', params: ['modem_id', 'mode', 'poll_interval', 'forwarding', 'auto_delete', 'country_code'], expect: { }, nobatch: true, reject: true });
var callSmsStorageGet = rpc.declare({ object: 'qmodem.sms', method: 'storage_get', params: ['modem_id'], expect: { }, nobatch: true, reject: true });
var callSmsStorageSet = rpc.declare({ object: 'qmodem.sms', method: 'storage_set', params: ['modem_id', 'mem1', 'mem2', 'mem3'], expect: { }, nobatch: true, reject: true });

/* 上联管理（qmodem-uplink-manager） */
var callUplinkStatus = rpc.declare({ object: 'qmodem.uplink', method: 'status', expect: { }, nobatch: true, reject: true });

/* 模组支持库（/usr/libexec/rpcd/qmodem_support 提供）：
 * status 查询内置型号是否已存在于 QModem 支持库；sync 执行一次合并；
 * ports 列出系统里候选的模组串口；custom_* 管理用户自定义型号 JSON。 */
var callSupportStatus = rpc.declare({ object: 'qmodem_support', method: 'status', expect: { }, nobatch: true });
var callSupportSync = rpc.declare({ object: 'qmodem_support', method: 'sync', expect: { }, nobatch: true });
var callSupportPorts = rpc.declare({ object: 'qmodem_support', method: 'ports', expect: { }, nobatch: true });
var callCustomList = rpc.declare({ object: 'qmodem_support', method: 'custom_list', expect: { }, nobatch: true });
var callCustomSave = rpc.declare({ object: 'qmodem_support', method: 'custom_save',
	params: ['model', 'bus', 'manufacturer', 'manufacturer_id', 'platform', 'modes', 'pdp_index',
		'wcdma_band', 'lte_band', 'nsa_band', 'sa_band', 'edit'], expect: { }, nobatch: true });
var callCustomDelete = rpc.declare({ object: 'qmodem_support', method: 'custom_delete', params: ['model', 'bus'], expect: { }, nobatch: true });
var callProbePort = rpc.declare({ object: 'qmodem_support', method: 'probe_port', params: ['port'], expect: { }, nobatch: true });

/* 控制动作（写操作）。全部显式 reject: true：ubus 层错误（权限/参数/对象缺失）
 * 必须以 reject 交给上层 UI 提示，不能像读路径那样被吞成 null 静默降级。 */
var callSendAt = rpc.declare({ object: 'qmodem', method: 'send_at', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSendSms = rpc.declare({ object: 'qmodem', method: 'send_sms', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSendRawPdu = rpc.declare({ object: 'qmodem', method: 'send_raw_pdu', params: ['config_section', 'cmd'], expect: { }, nobatch: true, reject: true });
var callDeleteSms = rpc.declare({ object: 'qmodem', method: 'delete_sms', params: ['config_section', 'index'], expect: { }, nobatch: true, reject: true });
var callSetMode = rpc.declare({ object: 'qmodem', method: 'set_mode', params: ['config_section', 'mode'], expect: { }, nobatch: true, reject: true });
var callSetImei = rpc.declare({ object: 'qmodem', method: 'set_imei', params: ['config_section', 'imei'], expect: { }, nobatch: true, reject: true });
var callSetLockband = rpc.declare({ object: 'qmodem', method: 'set_lockband', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSetNetworkPrefer = rpc.declare({ object: 'qmodem', method: 'set_network_prefer', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSetSimSlot = rpc.declare({ object: 'qmodem', method: 'set_sim_slot', params: ['config_section', 'slot'], expect: { }, nobatch: true, reject: true });
var callDoReboot = rpc.declare({ object: 'qmodem', method: 'do_reboot', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callClearDialLog = rpc.declare({ object: 'qmodem', method: 'clear_dial_log', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callClearStats = rpc.declare({ object: 'qmodem', method: 'clear_stats', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callSetTrafficResetSchedule = rpc.declare({ object: 'qmodem', method: 'set_traffic_reset_schedule', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSetNeighborCell = rpc.declare({ object: 'qmodem', method: 'set_neighborcell', params: ['config_section', 'params'], expect: { }, nobatch: true, reject: true });
var callSetSmsStorage = rpc.declare({ object: 'qmodem', method: 'set_sms_storage', params: ['config_section', 'storage'], expect: { }, nobatch: true, reject: true });
var callModemDial = rpc.declare({ object: 'qmodem', method: 'modem_dial', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callModemHang = rpc.declare({ object: 'qmodem', method: 'modem_hang', params: ['config_section'], expect: { }, nobatch: true, reject: true });
var callModemRedial = rpc.declare({ object: 'qmodem', method: 'modem_redial', params: ['config_section'], expect: { }, nobatch: true, reject: true });

/* 服务与系统 */
var callRcList = rpc.declare({ object: 'rc', method: 'list', params: ['name'], expect: { }, nobatch: true });
var callSetInitAction = rpc.declare({ object: 'luci', method: 'setInitAction', params: ['name', 'action'], expect: { }, nobatch: true, reject: true });
// 网络接口批量状态：netifd 的裸 network.interface 对象只提供 dump（status 需要具体的
// network.interface.<name> 对象），因此这里统一用 dump 一次取回全部接口再按名匹配。
var callInterfaceDump = rpc.declare({ object: 'network.interface', method: 'dump', expect: { 'interface': [] }, nobatch: true });
// 网络设备状态（用于获取 MTU / 链路速率等物理设备属性）
var callDeviceStatus = rpc.declare({ object: 'network.device', method: 'status', params: ['name'], expect: { }, nobatch: true });

/* ------------------------------------------------------------------ */
/* 客户端超时                                                           */
/* ------------------------------------------------------------------ */

/* rpc.declare 不支持按调用设置超时（整批共用 L.env.rpctimeout）。
 * 对拨号 / 重启 / 锁频这类长动作，在客户端按操作语义给出更宽的上限，
 * 对普通读给出更紧的上限，避免单次请求拖死整页。 */
var DIRECT_RPC_TIMEOUT = 8000;    /* 普通读 / 短动作 */

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

/* 与 withTimeout 相同，但失败时 reject —— 用于写动作链路，
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
			settled = true;
			window.clearTimeout(timer);
			reject(err instanceof Error ? err : new Error((err && err.message) || String(err)));
		});
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
	var lastOp = Promise.resolve();
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
		var op = Promise.resolve().then(function() {
			return opts.fn();
		}).catch(function() {
			return null;                    /* 单次失败不影响后续轮询 */
		}).then(function(result) {
			busy = false;
			schedule();
			return result;
		});
		lastOp = op;
		return op;
	}

	function start() {
		if (stopped) return;
		/* render() 返回后 LuCI 才把节点挂进 document。首次启动时不能
		 * 调用 alive()，否则所有页面的轮询器都会在挂载前被永久停止。 */
		if (timer === null && !busy) {
			var iv = (typeof document !== 'undefined' && document.hidden) ? hiddenInterval : interval;
			timer = window.setTimeout(tick, iv);
		}
	}
	function kick() {
		if (stopped) return lastOp;
		if (busy) return lastOp;
		if (timer !== null) { window.clearTimeout(timer); timer = null; }
		return tick();
	}
	function stop() {
		stopped = true;
		if (timer !== null) { window.clearTimeout(timer); timer = null; }
	}

	return { start: start, stop: stop, kick: kick, isRunning: function() { return !stopped; } };
}

/*
 * liveView —— 视图的通用 render：
 *   1) 用 load() 拿到的数据画出完整页面
 *   2) 启动安全轮询，周期执行 collect 并**局部重绘**（只替换本视图的子树）
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
		if (opts.skipIfFocused !== false && active && holder.contains(active) &&
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

	var initialPaint = paint(res);

	if (res && res.section && opts.paint && opts.collect) {
		if (view.poller && view.poller.stop) view.poller.stop();
		view.poller = createPoller({
			node: holder,
			interval: opts.interval || 5000,
			fn: function() {
				/* 用与 load() 完全相同的 collect() 重新组装数据，
				 * 保证首屏与轮询走的是同一条代码路径 */
				return Promise.resolve(opts.collect.call(view, {
					section: res.section,
					sections: res.sections || [],
					errors: []
				})).then(function(data) {
					if (editing()) return data;   /* 用户正在输入，本轮不重绘 */
					return paint(data).then(function() { return data; });
				});
			}
		});
		view.poller.start();
		/* 旧版短信首屏先显示读取中；AT 返回后立即补画，无需用户点刷新。
		 * 失败也补画一次，让 collect() 的错误提示及时出现。 */
		if (opts.wakeOn) Promise.resolve(opts.wakeOn).then(function() {}, function() {}).then(function() {
			return initialPaint;
		}).then(function() {
			window.setTimeout(function() {
				if (view.poller && view.poller.isRunning()) view.poller.kick();
			}, 0);
		});
	}

	if (view.poller)
		registerLivePoller(view.poller);
	activeLive = { view: view, poller: view.poller || null, holder: holder };

	return holder;
}

/*
 * 所有活跃轮询器的登记表 + 一次性注册的全局卸载钩子。
 * 之前的写法用 liveView.bound 只绑一次 pagehide，闭包里捕获的是「第一个视图」，
 * 于是切到第二个页面后 pagehide 停不掉它的轮询 —— 这里改成停掉全部。
 */
var livePollers = [];
var activeLive = null;

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

/* 立即重新采集并重绘当前视图（"刷新"按钮的执行体） */
function kickPoller() {
	if (activeLive && activeLive.poller && activeLive.poller.isRunning())
		return Promise.resolve(activeLive.poller.kick());
	return Promise.resolve(null);
}

/* ------------------------------------------------------------------ */
/* 通用辅助                                                            */
/* ------------------------------------------------------------------ */

// 从 { modem_info: [ {key,value,...} ] } 数组中按 key 取出 value
var INFO_KEYS = [
	[ 'name', 'model', 'Model Name' ],
	[ 'manufacturer', 'vendor' ],
	[ 'revision', 'firmware', 'Firmware Version' ],
	[ 'at_port', 'AT Port' ],
	[ 'connect_status', 'connection_status' ],
	[ 'SIM Status', 'sim_status' ],
	[ 'SIM Slot', 'sim_slot' ],
	[ 'SIM Number', 'MSISDN', 'Phone Number', 'phone_number' ],
	[ 'ISP', 'operator', 'Operator Name' ],
	[ 'network_mode', 'Network Type', 'Radio Access Technology' ],
	[ 'Physical Cell ID', 'PCI', 'physical_cell_id' ],
	[ 'Cell ID', 'CID', 'cell_id', 'NR Cell ID' ],
	[ 'DL Bandwidth', 'dl_bandwidth' ], [ 'UL Bandwidth', 'ul_bandwidth' ],
	[ 'IMEI' ], [ 'IMSI' ], [ 'ICCID' ], [ 'temperature' ]
];

function infoKey(key) { return String(key).toLowerCase().replace(/[\s_-]/g, ''); }

function flagKeys(obj) {
	return Object.keys(obj || {}).filter(function(k) { return /^(?:0|1|true|false)$/i.test(String(obj[k])); });
}

function isEnabled(value) { return /^(?:1|true)$/i.test(String(value)); }

/* 下列 AT^ 私有设置仅在已知的 MT5700 系列上提供；其它品牌仍可用 AT 终端。 */
function supportsTdTechAt(section, base) {
	var model = findEntry(base, 'name') || '';
	if (!model) try { model = uci.get('qmodem', section, 'model') || ''; } catch (e) {}
	return /\bMT5700M?(?:[-\s]|$)/i.test(model);
}

function findEntry(arr, key) {
	if (!Array.isArray(arr)) return undefined;
	for (var i = 0; i < arr.length; i++) {
		if (arr[i] && arr[i].key === key && hasValue(arr[i].value)) return arr[i].value;
	}
	var wanted = [ infoKey(key) ];
	INFO_KEYS.forEach(function(keys) {
		if (keys.some(function(k) { return infoKey(k) === wanted[0]; }))
			wanted = keys.map(infoKey);
	});
	for (var j = 0; j < arr.length; j++)
		if (arr[j] && wanted.indexOf(infoKey(arr[j].key)) !== -1 && hasValue(arr[j].value))
			return arr[j].value;
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
		if (item && item.key != null && hasValue(item.value)) map[item.key] = item.value;
	});
	INFO_KEYS.forEach(function(keys) {
		keys.forEach(function(key) {
			if (!hasValue(map[key])) {
				var value = findEntry(arr, key);
				if (hasValue(value)) map[key] = value;
			}
		});
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
/* 数据获取封装（返回 Promise）—— 直连官方 qmodem 接口                 */
/* ------------------------------------------------------------------ */

/* QModem 的信息类方法统一返回 { modem_info: [...] }，这里摊平成数组 */
function unwrapModemInfo(v) {
	if (v && Array.isArray(v.modem_info)) return v.modem_info;
	return Array.isArray(v) ? v : (v ? [v] : []);
}

function getBaseInfo(section) { return callBaseInfo(section).then(unwrapModemInfo); }
function getInfo(section) { return callInfo(section).then(unwrapModemInfo); }
function getSimInfo(section) { return callSimInfo(section).then(unwrapModemInfo); }
function getNetworkInfo(section) { return callNetworkInfo(section).then(unwrapModemInfo); }
function getCellInfo(section) { return callCellInfo(section).then(unwrapModemInfo); }
function getAtCfg(section) { return callGetAtCfg(section); }
function getImei(section) { return callGetImei(section); }
function getMode(section) { return callGetMode(section); }
function getLockBand(section) { return callGetLockband(section); }
function getNeighborCell(section) { return callGetNeighborcell(section); }

/* 用户主动扫描时立即读取实时邻区信息（rpcd 侧 get_neighborcell 自带 10s 缓存） */
function getNeighborCellFresh(section) {
	return withTimeoutReject(callGetNeighborcell(section), 30000, _('扫描邻区超时'));
}
function getNetworkPrefer(section) { return callGetNetworkPrefer(section); }
function getDns(section) { return callGetDns(section); }
function getDisabledFeatures(section) { return callGetDisabledFeatures(section); }
function getRebootCaps(section) { return callGetRebootCaps(section); }
function getCopyright(section) { return callGetCopyright(section); }

function getCurrentBand(section) {
	return callGetCurrentBand(section).then(function(r) {
		/* 部分模组返回 { status: "unsupported" }，统一为空载波列表 */
		if (r && r.status === 'unsupported' && !Array.isArray(r.cells))
			return { cells: [], status: 'unsupported' };
		return r;
	});
}
function getCurrentBandCapabilities(section) { return callGetCurrentBandCapabilities(section); }

/* 兼容实机差异：部分 QModem 版本返回 connection_status 而非 connect_status */
function getConnectStatus(section) {
	return callGetConnectStatus(section).then(function(r) {
		if (r && r.connection_status != null && r.connect_status == null)
			r.connect_status = r.connection_status;
		return r;
	});
}
function getDialStatus(section) { return callGetDialStatus(section); }

/* 拨号日志体量大且只在用户点开时读取；直读但带超时 */
function getDialLog(section) {
	return withTimeout(callGetDialLog(section), DIRECT_RPC_TIMEOUT, {});
}

function getSimSlot(section) { return callGetSimSlot(section); }
function getSimSwitchCapabilities(section) { return callGetSimSwitchCapabilities(section); }
function getUsageStats(section) { return callGetUsageStats(section); }
function getTrafficResetSchedule(section) { return callGetTrafficResetSchedule(section); }

/* 分天流量统计（采样由 qmodem-stats-collect 后台服务周期完成，这里只读结果） */
function getDailyStats(section) {
	return withTimeout(callDailyStats(section), DIRECT_RPC_TIMEOUT, null);
}
/* 清零本地分天记录并重建基准；rpcd 侧带硬超时，失败（{"success":false,"error":...}）
 * 或超时都如实上抛，不能让确认弹窗误报成功。 */
function statsReset(section) {
	return withTimeoutReject(callStatsReset(section), 30000, _('清零流量记录超时')).then(function(res) {
		if (!res || typeof res !== 'object' || res.success === false || res.error)
			throw new Error(String((res && res.error) || _('流量记录清零未确认成功，请刷新后核对。')));
		return res;
	});
}

/* 网络监测状态（qmodem_monitor 提供数据；未安装时返回空对象，页面显示未启用） */
function getMonitorStatus(section) {
	return withTimeout(callGetMonitorStatus(section), DIRECT_RPC_TIMEOUT, {});
}

/* 5G LAN（部分模组支持；不支持时返回 { supported: false }） */
function get5gLan(section) { return callGet5gLan(section); }

/* 上联管理状态（qmodem-uplink-manager；未安装该服务时 ubus 对象不存在，返回空） */
function getUplinkStatus() {
	return withTimeout(callUplinkStatus(), DIRECT_RPC_TIMEOUT, {}).then(function(r) {
		return (r && typeof r === 'object') ? r : {};
	});
}

/* ------------------------------------------------------------------ */
/* 模组支持库（qmodem_support rpcd；合并/探测均在 rpcd 侧带硬超时）      */
/* ------------------------------------------------------------------ */

function supportUnavailable() {
	return { available: 0, path: '', added: [], skipped: [], missing: [],
		error: 'qmodem_support 不可用（请确认 rpcd 已重启并已升级本插件）' };
}

function getSupportStatus() {
	return withTimeout(callSupportStatus(), 15000, supportUnavailable());
}

function syncSupport(section) {
	/* 同步执行一次合并（rpcd 侧带超时并自动备份/回滚），完成后返回
	 * { available, added, skipped, missing, error }。 */
	return withTimeoutReject(callSupportSync(), 60000, _('同步支持库超时'));
}

function getSupportPorts() { return withTimeout(callSupportPorts(), 15000,
	{ ports: [], error: '串口映射服务未响应，请检查 rpcd 与本插件安装状态' }); }
function getCustomModels() { return withTimeout(callCustomList(), 15000,
	{ entries: [], error: '自定义模组服务未响应，请检查 rpcd 与本插件安装状态' }); }
function saveCustomModel(data) {
	return callCustomSave(data.model, data.bus, data.manufacturer, data.manufacturer_id,
		data.platform, data.modes, data.pdp_index, data.wcdma_band, data.lte_band,
		data.nsa_band, data.sa_band, data.edit || '0');
}
function deleteCustomModel(model, bus) { return callCustomDelete(model, bus); }
function probeSupportPort(port) { return withTimeoutReject(callProbePort(port), 30000, _('读取型号超时')); }

/* ------------------------------------------------------------------ */
/* 设备扫描 / 模组接入（官方 QModem 设置页同款接口）                    */
/* ------------------------------------------------------------------ */

/* kind: 'pcie' | 'usb' | 'all'。QModem 把请求排队给 modem_scand，结果靠 UCI 变化体现。 */
function scanDevices(kind) {
	var fn = kind === 'pcie' ? callScanPcie : kind === 'usb' ? callScanUsb : callScanAll;
	var label = kind === 'pcie' ? _('PCIe 设备扫描') : kind === 'usb' ? _('USB 设备扫描') : _('全总线扫描');
	return withTimeoutReject(fn(), 60000, _('扫描请求超时，请稍后刷新页面查看结果。'))
		.then(function(res) { return requireScanResult(res, label); });
}
function getPcieDevices() { return withTimeout(callGetPcieDevices(), DIRECT_RPC_TIMEOUT, { devices: [] }); }
function getUsbDevices() { return withTimeout(callGetUsbDevices(), DIRECT_RPC_TIMEOUT, { devices: [] }); }
function getAvailableDevices() { return withTimeout(callGetAvailableDevices(), DIRECT_RPC_TIMEOUT, { devices: {} }); }
function getTtyPorts() { return withTimeout(callGetTtyPorts(), DIRECT_RPC_TIMEOUT, { ports: [] }); }
function getLeds() { return withTimeout(callGetLeds(), DIRECT_RPC_TIMEOUT, { leds: [] }); }
function getNetworkInterfacesList() { return withTimeout(callGetNetworkInterfaces(), DIRECT_RPC_TIMEOUT, { interfaces: [] }); }

/*
 * 移除模组配置节。官方 remove_modem 会先挂断连接、再删除 UCI 节并重建网络配置，
 * 因此前端不能在确认后只删 UCI；返回 { status: "<退出码>" }（退出码语义，0=成功），
 * 非零退出码必须如实报错，否则设置页会误报“已移除”。
 */
function removeModem(section) {
	return withTimeoutReject(callRemoveModem(section), 60000, _('移除模组超时。'))
		.then(function(res) { return requireExitCodeZero(res, _('移除模组')); });
}

/* ------------------------------------------------------------------ */
/* 短信（官方 qmodem.sms 守护进程优先，qmodem.get_sms 直连兜底）        */
/* ------------------------------------------------------------------ */

/*
 * 旧版 QModem 没有 qmodem.sms 服务，只有 qmodem.get_sms 直连 AT 读取。
 * 30 秒内存 TTL + 在途去重，避免周期轮询占用 AT 串口；读取失败也限流。
 */
var LEGACY_SMS_TTL = 30000;
var LEGACY_SMS_TIMEOUT = 18000;
var legacySmsStore = {};
var legacySmsInFlight = {};
var legacySmsLastAttempt = {};
var legacySmsError = {};

function smsReadInFlight(section) {
	return legacySmsInFlight[section] || null;
}

function readLegacySms(section) {
	var saved = legacySmsStore[section];
	if (legacySmsInFlight[section])
		return legacySmsInFlight[section];
	if (saved && Date.now() - saved.ts < LEGACY_SMS_TTL)
		return Promise.resolve(saved.value);
	/* 缓存存在时的后台读取若失败，30 秒内不再占用 AT 端口重试。
	 * 缓存缺失的首次读取仍然给出实际错误，防止静默显示 0 条短信。 */
	if (legacySmsLastAttempt[section] && Date.now() - legacySmsLastAttempt[section] < LEGACY_SMS_TTL)
		return saved ? Promise.resolve(saved.value) :
			Promise.reject(new Error(_('旧版短信读取失败，稍后自动重试。')));
	legacySmsLastAttempt[section] = Date.now();

	var task = withTimeoutReject(callGetSms(section), LEGACY_SMS_TIMEOUT,
		_('读取旧版 QModem 短信超时，请检查模组 AT 端口。')).then(function(result) {
		if (!result || typeof result !== 'object' ||
			(Array.isArray(result) && !result.length) ||
			result.error || result.status === 'error')
			throw new Error((result && result.error) || _('旧版 QModem 未返回有效短信数据。'));
		legacySmsStore[section] = { ts: Date.now(), value: result };
		delete legacySmsError[section];
		return result;
	});
	legacySmsInFlight[section] = task.then(function(result) {
		delete legacySmsInFlight[section];
		return result;
	}, function(err) {
		delete legacySmsInFlight[section];
		legacySmsError[section] = (err && err.message) || String(err);
		throw err;
	});
	return legacySmsInFlight[section];
}

function invalidateLegacySms(section) {
	delete legacySmsStore[section];
	delete legacySmsLastAttempt[section];
}

/* 兼容导出：直读模组短信（旧通道） */
function getSms(section) {
	return readLegacySms(section);
}

var smsServiceMissingUntil = 0;

function smsServiceResult(result) {
	if (!result || typeof result !== 'object' || result.error || result.status === 'error' || result.success === false)
		throw new Error((result && (result.error || result.modem_response)) || _('短信服务未返回有效结果。'));
	return result;
}

function smsServiceAction(result) {
	result = smsServiceResult(result);
	if (result.status !== 'success') throw new Error(_('短信服务未确认操作成功，请检查结果后再重试。'));
	return result;
}

/*
 * 不同版本的 rpc.js 对“对象不存在”有两种错误格式：
 * 旧版 ubus code 4 / 3；LuCI 25.12 为 -32000: Object not found。
 * 只在明确缺少服务/方法时回退旧版 qmodem.get_sms，避免隐藏权限与数据库错误。
 */
function isMissingSmsService(err) {
	var message = String((err && err.message) || err || '');
	return !!(err && (err.code === 3 || err.code === 4)) ||
		/ubus code [34](?::|\b)/i.test(message) ||
		/(?:error\s+)?(?:-32000|-32601)\s*:\s*(?:Object|Method) not found\b/i.test(message);
}

/* 短信守护进程是否可用及其接收模式（direct / database_poll / database_urc） */
function getSmsServiceConfig(section) {
	if (Date.now() < smsServiceMissingUntil) return Promise.resolve(null);
	return withTimeoutReject(callSmsConfig(section), 10000, _('读取短信服务超时')).then(function(result) {
		result = smsServiceResult(result);
		if (!/^(?:direct|database_poll|database_urc)$/.test(result.mode || ''))
			throw new Error(_('短信服务返回了未知接收模式。'));
		return result;
	}, function(err) {
		if (isMissingSmsService(err)) {
			smsServiceMissingUntil = Date.now() + 60000;
			return null;
		}
		throw err;
	});
}

/* 守护进程服务状态 / 最近同步状态 / 模组配置列表（sms 设置卡片用） */
function getSmsServiceStatus() {
	return withTimeout(callSmsServiceStatus(), 10000, {}).then(function(r) {
		return (r && typeof r === 'object' && r.status) ? r : null;
	});
}
function getSmsSyncStatus() {
	return withTimeout(callSmsSyncStatus(), 10000, {}).then(function(r) {
		return (r && typeof r === 'object' && r.modem_id != null) ? r : null;
	});
}
function getSmsModemList() {
	return withTimeout(callSmsModemList(), 10000, {}).then(function(r) {
		return (r && Array.isArray(r.modems)) ? r.modems : [];
	});
}

function getSmsInbox(section) {
	return getSmsServiceConfig(section).then(function(config) {
		/* direct 模式与旧版固件都直读模组（带 TTL 与在途去重）。 */
		if (!config || config.mode === 'direct')
			return readLegacySms(section).then(function(raw) {
				if (raw && raw.error) throw new Error(raw.error);
				return Object.assign({}, Array.isArray(raw) ? { messages: raw } : (raw || {}), {
					_smsSource: 'modem', _smsConfig: config
				});
			});

		var messages = [], seen = Object.create(null);
		function page(offset) {
			return withTimeoutReject(callSmsList(section, 500, offset), 10000, _('读取短信数据库超时')).then(function(raw) {
				raw = smsServiceResult(raw);
				if (raw.mode && raw.mode !== config.mode)
					throw new Error(_('短信接收模式已改变，请刷新后重试。'));
				var list = raw.messages || raw.received || raw.msg;
				if (!Array.isArray(list)) throw new Error(_('短信服务未返回消息列表。'));
				var before = messages.length;
				list.forEach(function(item) {
					if (!item || typeof item !== 'object' || item.id == null || seen[String(item.id)]) return;
					seen[String(item.id)] = true; messages.push(item);
				});
				var more = list.length === 500;
				if (more && messages.length > before && offset < 4500) return page(offset + list.length);
				return { messages: messages, _smsSource: 'database', _smsConfig: config, _smsTruncated: more };
			});
		}
		return page(0);
	});
}

function refreshSmsInbox(section, source) {
	if (source !== 'database') {
		invalidateLegacySms(section);
		return readLegacySms(section);
	}
	return withTimeoutReject(callSmsSync(section), 45000, _('短信同步超时')).then(smsServiceAction);
}

/* 数据库模式的发送不做旧接口重试，超时/失败后交由用户核对发送结果。 */
function sendSmsInbox(section, phoneNumber, content, source) {
	if (source !== 'database') return sendSms(section, phoneNumber, content).then(smsServiceResult);
	return withTimeoutReject(callSmsSend(section, phoneNumber, content), 60000, _('短信发送超时，请核对发送记录后再决定是否重试。')).then(smsServiceAction);
}

/*
 * 老版本 qmodem.delete_sms 的 index 属于 ubus String（并非 Integer），
 * 支持 "1 2 3" 同时删除一条分段短信；0 也是合法的模组槽位。
 * 失败必须保留原消息和错误，不能当作成功后只刷新页面。
 */
function modemSmsDeleteResult(result) {
	if (!result || typeof result !== 'object')
		throw new Error(_('QModem 没有返回删除结果。'));
	var body = result.delete_sms && typeof result.delete_sms === 'object' ? result.delete_sms :
		(result.result && typeof result.result === 'object' ? result.result : result);
	var status = body.status === undefined ? result.status : body.status;
	var reason = body.error || result.error || body.modem_response || result.modem_response;
	if (reason || body.success === false || result.success === false ||
		status === false || status === 0 || status === '0' ||
		typeof status === 'string' && /^(?:error|failed|failure)$/i.test(status))
		throw new Error(String(reason || _('模组拒绝删除短信，请检查短信存储位置。')));
	/* 官方响应 result.status="1"；没有状态时不能仅凭任务完成判断成功，
	 * 后续将重新读取模组短信并核对存储索引。 */
	return status === '1' || status === 1 || status === true || status === 'success' ||
		body.success === true || result.success === true || result.result === 'success';
}

function modemSmsItems(raw) {
	if (Array.isArray(raw)) return raw;
	if (!raw || typeof raw !== 'object') return null;
	var keys = [ 'sms', 'msg', 'messages', 'received' ];
	for (var i = 0; i < keys.length; i++)
		if (raw[keys[i]] && typeof raw[keys[i]] === 'object')
			return modemSmsItems(raw[keys[i]]);
	return null;
}

function smsStorageIndexes(indexes) {
	var tokens = [];
	(indexes || []).forEach(function(item) {
		String(item).trim().split(/[\s,;]+/).forEach(function(value) {
			if (/^\d+$/.test(value) && tokens.indexOf(value) === -1) tokens.push(value);
		});
	});
	return tokens;
}
function deleteSmsMessage(section, message) {
	if (message.source === 'database') {
		var id = Number(message.index);
		if (!Number.isSafeInteger(id) || id <= 0) return Promise.reject(new Error(_('无效的短信记录编号。')));
		return withTimeoutReject(callSmsDelete(section, id), 10000, _('删除短信超时')).then(smsServiceAction);
	}
	var rawIndexes = message.indexes && message.indexes.length ? message.indexes : [message.index];
	var indexes = smsStorageIndexes(rawIndexes);
	if (!indexes.length)
		return Promise.reject(new Error(_('短信缺少有效的模组存储索引，不能删除。')));
	/* 与 QModem 官方短信页一致，先删较大的槽位，避免较小槽位删除后
	 * 模组重新编排索引而删错后续分段。 */
	indexes.sort(function(a, b) { return Number(b) - Number(a); });
	/* 先等已有读取结束，避免它在删除后把旧数据重新写入内存缓存。 */
	var reading = legacySmsInFlight[section];
	return (reading ? reading.catch(function() {}) : Promise.resolve()).then(function() {
		return deleteSms(section, indexes.join(' '));
	}).then(function(result) {
		modemSmsDeleteResult(result);
		/* 官方旧界面的脚本可能只报告命令已执行；单条、多段均需回读确认。
		 * 验证完成前保留页面原消息，不凭 status=1 隐藏短信。 */
		var previous = legacySmsInFlight[section];
		return (previous ? previous.catch(function() {}) : Promise.resolve()).then(function() {
			invalidateLegacySms(section);
			return readLegacySms(section).then(function(fresh) {
				var items = modemSmsItems(fresh);
				if (!items) throw new Error(_('删除命令已发送，但无法核对模组短信列表。'));
				var remaining = items.some(function(item) {
					return item && smsStorageIndexes([ item.index, item.indexes || '' ]).some(function(index) {
						return indexes.indexOf(index) !== -1;
					});
				});
				if (remaining) throw new Error(_('模组仍返回这条短信，删除未生效。'));
				return result;
			});
		});
	});
}

function markSmsRead(section, messages) {
	return (messages || []).filter(function(item) { return item.source === 'database' && item.unread; }).reduce(function(chain, item) {
		return chain.then(function() {
			return withTimeoutReject(callSmsMarkRead(section, Number(item.index)), 10000, _('标记短信已读超时')).then(smsServiceAction);
		});
	}, Promise.resolve());
}

/* 短信守护进程配置：mode / poll_interval / forwarding / auto_delete / country_code。
 * 参照官方封装：先读当前配置补齐未提交项，再一次 configure 全量下发
 * （官方 configure_method 允许 country_code 与其它字段并存，空串即清除国家码）。 */
function configureSmsService(section, opts) {
	opts = opts || {};
	return getSmsServiceConfig(section).then(function(config) {
		if (!config)
			throw new Error(_('短信服务不可用（qmodem_smsd 未安装或未运行）。'));
		return withTimeoutReject(callSmsConfigure(
			section,
			opts.mode || config.mode,
			opts.pollInterval != null ? opts.pollInterval : (config.poll_interval != null ? config.poll_interval : null),
			opts.forwarding !== undefined ? (opts.forwarding ? true : false) : !!config.forwarding,
			opts.autoDelete !== undefined ? (opts.autoDelete ? true : false) : !!config.auto_delete,
			opts.countryCode != null ? String(opts.countryCode).trim() : ''
		), 15000, _('保存短信服务配置超时'));
	}).then(function(result) {
		result = smsServiceResult(result);
		if (result.status === 'pending') return result;
		return smsServiceAction(result);
	});
}

/* 短信存储：官方 storage_get 返回 AT+CPMS? 原始响应；storage_set 写入 ME/SM。
 * 与官方封装一致的响应解析，供 UI 展示占用并提交更改。 */
function parseSmsStorage(result) {
	var storage = { mem1: (result && result.configured) || 'SM', mem2: 'SM', mem3: 'SM',
		ME: { used: 0, total: 0 }, SM: { used: 0, total: 0 }, raw: '' };
	var text = String((result && result.response) || '');
	storage.raw = text;
	var match = text.match(/\+CPMS:\s*"?([^",]+)"?,(\d+),(\d+),"?([^",]+)"?,(\d+),(\d+)(?:,"?([^",]+)"?,(\d+),(\d+))?/);
	if (!match) return storage;
	storage.mem1 = match[1]; storage.mem2 = match[4]; storage.mem3 = match[7] || match[4];
	[ [ match[1], match[2], match[3] ], [ match[4], match[5], match[6] ], [ match[7], match[8], match[9] ] ].forEach(function(values) {
		if (values[0] === 'SM' || values[0] === 'ME') storage[values[0]] = { used: +values[1] || 0, total: +values[2] || 0 };
	});
	return storage;
}
function getSmsStorageService(section) {
	return withTimeoutReject(callSmsStorageGet(section), 15000, _('读取短信存储超时')).then(parseSmsStorage);
}
function setSmsStorageService(section, mem1, mem2, mem3) {
	return withTimeoutReject(callSmsStorageSet(section, mem1, mem2, mem3 || mem2), 15000, _('设置短信存储超时')).then(smsServiceResult);
}

/* ------------------------------------------------------------------ */
/* 控制动作封装（写操作，直连官方方法）                                 */
/* ------------------------------------------------------------------ */

/*
 * 官方 QModem 写操作的失败信号并不统一（实测官方 rpcd 源码）：
 *   clear_dial_log → {"result":{"status":"1"|"0"}}      status 语义，1=成功
 *   set_sim_slot   → {"success":true|false,...}         success 布尔
 *   set_mode       → {"result":"auto"}                  只回显，无状态字段
 *   set_5g_lan / set_sms_storage / set_traffic_reset_schedule / clear_stats
 *                  → 内部函数拼 JSON，失败以 {"error":...} 体现
 * 这里只拦截明确的失败信号，不对缺少状态字段的响应误伤；
 * 退出码语义（{"status":"<exit code>"}，0=成功）只有 remove_modem / scan_* 使用，
 * 由 requireExitCodeZero 单独处理，两者不可混用。
 */
function requireSuccess(raw, operation) {
	if (raw == null)
		throw new Error(operation + _('：QModem 未返回操作结果。'));
	var body = raw.result && typeof raw.result === 'object' ? raw.result : raw;
	var status = raw.status !== undefined ? raw.status : body.status;
	var reason = raw.error || body.error || raw.modem_response || body.modem_response;
	if (reason || raw.success === false || body.success === false ||
		status === '0' || status === 0 || status === false ||
		(typeof status === 'string' && /^(?:error|failed|failure)$/i.test(status)))
		throw new Error(operation + _('失败：') + String(reason || body.message || _('QModem 拒绝执行该操作。')));
	return raw;
}

/* remove_modem 返回 {"status":"<退出码>"}：0 才是成功（与 status 语义方向相反） */
function requireExitCodeZero(raw, operation) {
	if (raw == null)
		throw new Error(operation + _('：QModem 未返回操作结果。'));
	var code = Number(raw.status !== undefined ? raw.status : (raw.result && raw.result.status));
	if (!isFinite(code) || code !== 0)
		throw new Error(operation + _('失败：') + String(raw.error || raw.message || ('exit ' + raw.status)));
	return raw;
}

/*
 * scan_pcie / scan_usb / scan_all 的契约与 remove_modem 不同：官方 rpcd 返回
 * {"code":<整数退出码>,"message":"..."}，异常分支还可能只返回 {"error":"..."}。
 * 早先这里的注释把两者混为一谈，调用方只在 settings.js 里顺手看了一眼 code，
 * 于是 modem_scan.sh 缺失（code=127）之外的一切失败都会提示「扫描完成」。
 * 现在统一在这里判定，失败一律 reject。
 */
function requireScanResult(raw, operation) {
	if (raw == null)
		throw new Error(operation + _('：QModem 未返回扫描结果。'));
	var body = (raw.result && typeof raw.result === 'object') ? raw.result : raw;
	var reason = body.error || raw.error || body.message || raw.message;
	var code = (body.code !== undefined) ? body.code : raw.code;
	if (code === undefined) {
		if (reason)
			throw new Error(operation + _('失败：') + String(reason));
		return raw;
	}
	if (Number(code) !== 0)
		throw new Error(operation + _('失败：') + String(reason || ('scan exit ' + code)));
	return raw;
}

/* 兼容官方 at_cfg.res、平铺 response 及旧版 result 字符串。 */
function atResponseText(raw) {
	if (raw == null) return '';
	if (typeof raw === 'string') return raw;
	if (Array.isArray(raw)) return raw.map(atResponseText).filter(Boolean).join('\n');
	if (typeof raw !== 'object') return String(raw);
	var keys = [ 'response', 'at_response', 'res', 'output', 'stdout' ];
	for (var i = 0; i < keys.length; i++)
		if (typeof raw[keys[i]] === 'string' && raw[keys[i]] !== '') return raw[keys[i]];
	if (raw.at_cfg && typeof raw.at_cfg === 'object') return atResponseText(raw.at_cfg);
	for (var j = 0; j < 2; j++) {
		var value = raw[j ? 'data' : 'result'];
		if (value != null && (typeof value === 'object' || (typeof value === 'string' && !/^(?:success|error|failed)$/i.test(value))))
			return atResponseText(value);
	}
	if (typeof raw.message === 'string') return raw.message;
	return '';
}

function normalizeAtResult(raw) {
	var text = atResponseText(raw);
	var cfg = raw && typeof raw === 'object' && raw.at_cfg;
	var error = raw && typeof raw === 'object' && (raw.error || raw.success === false || /^(?:error|failed)$/i.test(raw.result || ''));
	if (cfg && (cfg.status === '0' || cfg.status === 0 || cfg.status === false)) error = true;
	if (/(?:^|[\r\n])\s*(?:ERROR|\+(?:CME|CMS) ERROR[^\r\n]*)\s*(?:$|[\r\n])/i.test(text)) error = true;
	if (error) {
		var reason = (typeof error === 'string' ? error : '') || text || _('模组未返回有效响应，请检查 AT 端口。');
		var err = new Error(reason);
		err.response = raw;
		throw err;
	}
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.assign({}, raw, { response: text }) : raw;
}

/* 发送 AT 命令。atPort 可为空，由 QModem 自行选择默认端口。 */
function sendAt(section, atPort, command, useUbus) {
	var params = { at: command };
	if (atPort) params.port = atPort;
	if (useUbus !== undefined && useUbus !== null) params.use_ubus_flag = isEnabled(useUbus) ? '1' : '0';
	return withTimeoutReject(callSendAt(section, params), 30000, _('AT command timed out')).then(normalizeAtResult);
}

function sendSms(section, phoneNumber, content) {
	return withTimeoutReject(callSendSms(section, { phone_number: phoneNumber, message_content: content }),
		60000, _('Sending SMS timed out'));
}
function sendRawPdu(section, command) {
	return withTimeoutReject(callSendRawPdu(section, command), 60000, _('PDU request timed out'));
}
function deleteSms(section, index) {
	/* qmodem.delete_sms index 的 ubus 签名是 String，即便仅一个槽位也不能传数字。 */
	var value = String(index);
	if (!/^\d+(?: \d+)*$/.test(value))
		return Promise.reject(new Error(_('无效的模组短信索引。')));
	return withTimeoutReject(callDeleteSms(section, value), 60000, _('删除模组短信超时'));
}
function setMode(section, mode) {
	return withTimeoutReject(callSetMode(section, mode), 120000, _('Setting mode timed out')).then(function(res) { return requireSuccess(res, _('切换网络模式')); });
}
function setImei(section, imei) {
	return withTimeoutReject(callSetImei(section, imei), 120000, _('Setting IMEI timed out')).then(function(result) {
		var body = result && result.result && typeof result.result === 'object' ? result.result : result;
		if (!result || result.error || body && (body.error || body.success === false || body.status === '0' || body.status === 0 || body.status === false))
			throw new Error(String(result && (result.error || body && body.error) || _('QModem 拒绝写入 IMEI。')));
		/* QModem 部分版本会回显提交值及 status=1，不能据此认为已生效。
		 * 直接回读同一模组确认。 */
		function readBack(retry) {
			return withTimeoutReject(callGetImei(section), DIRECT_RPC_TIMEOUT,
				_('IMEI 写入命令已完成，但模组回读超时，尚无法确认结果。')).then(function(fresh) {
				var actual = String(fresh && fresh.imei || '').trim();
				if (actual === imei)
					return { imei: actual };
				if (retry) return new Promise(function(resolve) { window.setTimeout(resolve, 800); }).then(function() { return readBack(false); });
				throw new Error(_('写入命令已完成，但模组回读的 IMEI 仍为 %s，尚未确认生效。').format(actual || '--'));
			});
		}
		return readBack(true);
	});
}
function setLockBand(section, params) {
	return withTimeoutReject(callSetLockband(section, params), 120000, _('Locking band timed out')).then(function(res) { return requireSuccess(res, _('锁定频段')); });
}
function setNetworkPrefer(section, params) {
	return withTimeoutReject(callSetNetworkPrefer(section, params), 120000, _('Setting network preference timed out')).then(function(res) { return requireSuccess(res, _('设置网络优选')); });
}
function setSimSlot(section, slot) {
	return withTimeoutReject(callSetSimSlot(section, slot), 120000, _('Switching SIM slot timed out')).then(function(res) { return requireSuccess(res, _('切换 SIM 卡槽')); });
}
function doReboot(section, method) {
	return withTimeoutReject(callDoReboot(section, { method: method || 'soft' }), 180000, _('Reboot request timed out')).then(function(res) { return requireSuccess(res, _('重启模组')); });
}
function clearDialLog(section) {
	return withTimeoutReject(callClearDialLog(section), 30000, _('Clearing log timed out')).then(function(res) { return requireSuccess(res, _('清除拨号日志')); });
}
function clearStats(section) {
	return withTimeoutReject(callClearStats(section), 60000, _('Clearing counters timed out')).then(function(res) { return requireSuccess(res, _('清零流量计数')); });
}
function setTrafficResetSchedule(section, params) {
	return withTimeoutReject(callSetTrafficResetSchedule(section, params), 60000, _('Saving schedule timed out')).then(function(res) { return requireSuccess(res, _('保存流量清零计划')); });
}
function setNeighborCell(section, params) {
	return withTimeoutReject(callSetNeighborCell(section, params), 120000, _('Neighbour cell request timed out')).then(function(res) { return requireSuccess(res, _('锁小区')); });
}
function setSmsStorage(section, storage) {
	return withTimeoutReject(callSetSmsStorage(section, storage), 60000, _('Setting SMS storage timed out')).then(function(res) { return requireSuccess(res, _('切换短信存储')); });
}

/*
 * 官方 QModem 对拨号/挂断/重拨的响应为 {"result":{"status":"1"|"0"}}。
 * rpc 完成只代表 ubus 请求执行完，不能误认 status=0 的失败为成功。
 */
function requireDialActionSuccess(raw, operation) {
	var result = raw && raw.result && typeof raw.result === 'object' ? raw.result : raw;
	if (!result || typeof result !== 'object')
		throw new Error(operation + _('：QModem 未返回操作结果。'));
	var status = result.status;
	if (raw.error || result.error || raw.success === false || result.success === false ||
		status === '0' || status === 0 || status === false ||
		typeof status === 'string' && /^(error|failed|failure)$/i.test(status))
		throw new Error(operation + _('失败：') + String(result.error || raw.error || result.message || _('QModem 拒绝执行该操作。')));
	if (!(status === '1' || status === 1 || status === true ||
		status === 'success' || result.success === true || raw.success === true))
		throw new Error(operation + _('：QModem 未确认操作成功。'));
	return raw;
}
function modemDial(section) {
	return withTimeoutReject(callModemDial(section), 120000, _('开始拨号超时，操作可能仍在执行，请检查连接状态。'))
		.then(function(result) { return requireDialActionSuccess(result, _('开始拨号')); });
}
function modemHang(section) {
	return withTimeoutReject(callModemHang(section), 90000, _('挂断连接超时，操作可能仍在执行，请检查连接状态。'))
		.then(function(result) { return requireDialActionSuccess(result, _('挂断连接')); });
}
function modemRedial(section) {
	return withTimeoutReject(callModemRedial(section), 120000, _('重新拨号超时，操作可能仍在执行，请检查连接状态。'))
		.then(function(result) { return requireDialActionSuccess(result, _('重新拨号')); });
}

/* 开启模组流量计数自动落盘（官方 save_stats；部分厂商不支持时返回 error） */
function saveStats(section) {
	return withTimeoutReject(callSaveStats(section), 30000, _('保存流量统计超时')).then(function(res) {
		var body = res && res.result && typeof res.result === 'object' ? res.result : res;
		if (!res || res.error || (body && (body.status === '0' || body.status === 0 || body.success === false)))
			throw new Error(String((res && res.error) || (body && body.error) || _('模组不支持自动统计上报。')));
		return res;
	});
}

/* 5G LAN 开关（仅支持的模组返回 supported=true） */
function set5gLan(section, enabled) {
	return withTimeoutReject(callSet5gLan(section, !!enabled), 60000, _('设置 5G LAN 超时')).then(function(res) {
		if (res && res.supported === false)
			throw new Error(String(res.error || _('当前模组不支持 5G LAN。')));
		return res;
	});
}

/* procd 服务 */
function rcList(name) { return withTimeout(callRcList(name), DIRECT_RPC_TIMEOUT, {}); }
/* luci.setInitAction 成功返回 result:true（不同版本可能是裸 true 或 {"result":...}）；
 * 失败如 restart 不存在的服务时必须报错，不能提示“已执行”。 */
function setInitAction(name, action) {
	return callSetInitAction(name, action).then(function(res) {
		var ok = res === true || (res && typeof res === 'object' &&
			(res.result === true || res.success === true || res.status === 'success'));
		if (!ok)
			throw new Error(_('服务操作未被确认成功（%s / %s）。').format(name, action));
		return res;
	});
}
function getDeviceStatus(name) { return withTimeout(callDeviceStatus(name), DIRECT_RPC_TIMEOUT, {}); }

/*
 * 解析某个模组配置节对应的 netifd 逻辑接口。
 * QModem 会为每个模组自动创建 IPv4 / IPv6 两个逻辑接口（命名由配置节派生，与模组
 * 型号无关），因此这里不写死任何型号，按以下顺序自动推导、适配所有模组：
 *   1) /etc/config/network 中 modem_config 指向该配置节的接口（QModem 的标准关联方式）
 *   2) 回退：与配置节同名及 <section>v6 后缀的接口（兼容旧命名规则）
 *   3) 回退：三层设备等于 qmodem 配置中物理网口（network 选项）的接口
 * 返回 { names: [接口名...], entries: [各接口的 status 对象...] }
 */
function getModemInterfaces(section) {
	return withTimeout(uci.load('network'), DIRECT_RPC_TIMEOUT, null).then(function() {
		return withTimeout(callInterfaceDump(), DIRECT_RPC_TIMEOUT, []);
	}).then(function(dump) {
		dump = Array.isArray(dump) ? dump : [];
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
 * 取模组数据接口的合并状态：把 IPv4 / IPv6 两个逻辑接口的地址、DNS、
 * 在线状态等合并为单一视图，UI 直接取字段展示。
 */
function getInterfaceStatus(section) {
	return getModemInterfaces(section).then(function(r) {
		return mergeIfaceEntries(r.entries, r.names);
	});
}

/*
 * 把 netifd 接口状态合并成单一接口视图。
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
	var grouped = groupByClass(entryList(entries).filter(function(item) { return item && hasValue(item.value); }));
	var cards = [];
	Object.keys(grouped).forEach(function(cls) {
		var rows = grouped[cls].map(function(item) {
			var rawName = item.full_name || item.key || '';
			var name = LABEL_ZH[rawName] || _(rawName);
			var display = item.extra_info ? (name + ' (' + item.extra_info + ')') : name;
			var val = valueText(item.value);
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

/* LuCI 的 addNotification 默认一直保留。只清理由本插件创建的提示，
 * 不影响其它插件或 LuCI 自己的通知。 */
function notify(title, children) {
	var classes = Array.prototype.slice.call(arguments, 2);
	var node = ui.addNotification.apply(ui, [ title, children ].concat(classes));
	if (node && node.parentNode) {
		var delay = classes.indexOf('danger') !== -1 ? 10000 :
			classes.indexOf('warning') !== -1 ? 8000 : 5000;
		window.setTimeout(function() {
			if (!node.parentNode) return;
			node.classList.add('fade-out');
			node.classList.remove('fade-in');
			/* 兼容没有过渡动画的主题与旧版 LuCI。 */
			window.setTimeout(function() {
				if (node.parentNode) node.parentNode.removeChild(node);
			}, 350);
		}, delay);
	}
	return node;
}

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

/* 签约速率（AMBR）格式化：后端统一以 kbps 上报（QModem network_info 的 AMBR 为
 * Mbps，视图换算后传入）。null / 0 / 非数字一律显示 '--'，绝不把「未知」显示成有效速率。 */
function formatRate(value) {
	var n = Number(value);
	if (!isFinite(n) || n <= 0) return '--';
	if (n >= 1048576) return (n / 1048576).toFixed(2) + ' Gbps';
	if (n >= 1024) return (n % 1024 ? (n / 1024).toFixed(1) : String(n / 1024)) + ' Mbps';
	return Math.round(n) + ' Kbps';
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
	return dataRow(label, value, 'mt-control-state');
}

/* 保留历史导出：视图仍在调用 controls.styleNode()。
 * 现在它只负责注入"控件级"的局部样式，全局皮肤（令牌 / 组件 / 响应式）
 * 统一由 theme.js 提供，因此这里先确保主题层已注入再返回本模块的样式节点。 */
/* ------------------------------------------------------------------
 * 样式注入：只向 document.head 注入一次（幂等），返回 null。
 * 历史写法是每个视图的 styleNode() 返回 <style> 节点、随轮询重绘反复插入，
 * 导致每 5~8 秒整段 CSS 被重新创建并解析一次。现在统一注入 head：
 * 首次调用注入，之后命中 #id 直接跳过；E() 会过滤 null 子节点，
 * 视图节点数组不需要任何改动。非浏览器环境（Node 单元测试）静默跳过。 */
var injectedStyles = {};
function injectStyleOnce(id, css) {
	if (typeof document === 'undefined' || !document.createElement)
		return null;
	if (typeof css !== 'string' || !css)
		return null;
	if (!injectedStyles[id])
		injectedStyles[id] = css;
	if (typeof document.getElementById === 'function' && document.getElementById(id))
		return null;
	try {
		var style = document.createElement('style');
		style.id = id;
		style.type = 'text/css';
		style.appendChild(document.createTextNode(injectedStyles[id]));
		(document.head || document.documentElement).appendChild(style);
	} catch (e) { /* 注入失败不影响页面功能 */ }
	return null;
}

function styleNode() {
	theme.apply();
	return injectStyleOnce('qm-controls-ui-style', [
		':root{--qm-glass:rgba(255,255,255,0.72);--qm-glass-blur:blur(28px) saturate(200%) contrast(96%);--qm-glass-border:rgba(255,255,255,0.86);--qm-glass-inner:rgba(255,255,255,0.58);--qm-glass-inner-border:rgba(255,255,255,0.75);--qm-shadow:0 10px 30px -5px rgba(22,34,64,0.06), inset 0 1px 1.5px rgba(255,255,255,0.95);--qm-radius:22px}',
		'.mt-ui-page{--mt-ui-accent:var(--qm-accent);--mt-ui-teal:var(--qm-accent-3);--mt-ui-border:var(--qm-glass-border);--mt-ui-border-soft:var(--qm-border-soft);--mt-ui-surface:var(--qm-glass);--mt-ui-muted:var(--qm-text-muted);max-width:1220px;margin:0 auto;color:var(--qm-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}',
		'.mt-ui-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:26px 32px;margin:0 0 20px;border:1px solid var(--qm-glass-border);border-radius:var(--qm-radius);background:linear-gradient(135deg,rgba(0,114,245,0.9) 0%,rgba(9,88,217,0.85) 50%,rgba(16,185,129,0.8) 100%);color:#fff;backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);box-shadow:0 14px 34px -8px rgba(0,114,245,0.32), inset 0 1px 2px rgba(255,255,255,0.45);position:relative;overflow:hidden}',
		'.mt-ui-hero::before{content:"";position:absolute;top:-50%;right:-20%;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.25) 0%,transparent 70%);pointer-events:none}',
		'.mt-ui-hero h2{margin:0 0 6px;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.02em;line-height:1.2}',
		'.mt-ui-hero p,.mt-ui-hero [class*="-sub"]{margin:0;color:rgba(255,255,255,0.88);font-size:12.5px;line-height:1.5;font-weight:500}',
		'.mt-ui-hero [class*="kicker"],.mt-ui-hero [class*="eyebrow"]{color:rgba(255,255,255,0.95);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;display:inline-block;margin-bottom:4px}',
		'.mt-ui-card{border:1px solid var(--qm-glass-border)!important;border-radius:var(--qm-radius)!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;-webkit-backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important;position:relative;overflow:hidden;transition:all 0.25s cubic-bezier(0.16,1,0.3,1)}',
		'.mt-ui-card:hover{box-shadow:0 16px 36px -4px rgba(22,34,64,0.08), inset 0 1px 1.5px rgba(255,255,255,0.95)!important;transform:translateY(-1px)}',
		'.mt-ui-page .btn{border-radius:12px!important;padding:8px 18px!important;font-weight:700!important;font-size:12.5px!important;letter-spacing:0.01em!important;transition:all .2s cubic-bezier(0.16,1,0.3,1)!important;border:1px solid var(--qm-glass-inner-border)!important;background:var(--qm-glass-inner)!important;color:var(--qm-text)!important;cursor:pointer}',
		'.mt-ui-page .btn:hover{background:rgba(255,255,255,0.85)!important;transform:translateY(-1px);box-shadow:0 4px 12px rgba(22,34,64,0.06)}',
		'.mt-ui-page .btn-primary{background:linear-gradient(135deg, #0072f5 0%, #0050b3 100%)!important;border-color:transparent!important;color:#fff!important;box-shadow:0 4px 14px rgba(0,114,245,0.25)!important}',
		'.mt-ui-page .btn-primary:hover{box-shadow:0 6px 20px rgba(0,114,245,0.38)!important;transform:translateY(-1.5px)!important}',
		'.mt-ui-page input,.mt-ui-page select,.mt-ui-page textarea{border-radius:12px!important;border:1px solid var(--qm-glass-inner-border)!important;background:var(--qm-glass-inner)!important;backdrop-filter:blur(10px)!important;color:var(--qm-text)!important;padding:8px 12px!important;font-size:12.5px!important;transition:all .18s ease!important;box-sizing:border-box}',
		'.mt-ui-page input:focus,.mt-ui-page select:focus,.mt-ui-page textarea:focus{border-color:var(--qm-accent)!important;box-shadow:0 0 0 3px var(--qm-accent-soft)!important;outline:none!important;background:#fff!important}',
		'.mt-ui-details{margin-top:16px;border:1px solid var(--qm-glass-border)!important;border-radius:var(--qm-radius)!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;-webkit-backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important;overflow:hidden}',
		'.mt-ui-details>summary{display:grid;grid-template-columns:minmax(0,1fr) 36px;align-items:center;gap:14px;min-height:56px;padding:12px 20px;cursor:pointer;list-style:none;transition:background-color .16s ease}',
		'.mt-ui-details>summary::-webkit-details-marker{display:none}',
		'.mt-ui-details>summary:hover{background:rgba(255,255,255,0.85)}',
		'.mt-ui-summary-copy{min-width:0}',
		'.mt-ui-summary-title{display:block;font-size:14.5px;font-weight:750;line-height:1.35;color:var(--qm-text)}',
		'.mt-ui-summary-desc{display:block;margin-top:3px;color:var(--qm-text-muted);font-size:11.5px;line-height:1.45}',
		'.mt-ui-chevron{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:1px solid var(--qm-glass-inner-border);border-radius:10px;background:var(--qm-glass-inner);color:var(--qm-text-muted);font-size:20px;line-height:1;transition:all .18s ease}',
		'.mt-ui-details[open]>summary .mt-ui-chevron{transform:rotate(90deg);background:var(--qm-accent-soft);color:var(--qm-accent)}',
		'.mt-ui-details[open]>summary{border-bottom:1px solid var(--qm-border-soft)}',
		'.mt-control-section{margin-top:22px}',
		'.mt-control-section-head{margin:0 0 12px;display:flex;align-items:center;justify-content:space-between}',
		'.mt-control-section-head h3{margin:0;font-size:17px;font-weight:800;letter-spacing:-0.01em;color:var(--qm-text)}',
		'.mt-control-section-head p{margin:2px 0 0;color:var(--qm-text-muted);font-size:12px;line-height:1.5}',
		'.mt-control-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px}',
		'.mt-control-card{padding:20px;border:1px solid var(--qm-glass-border)!important;border-radius:var(--qm-radius)!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;-webkit-backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important;position:relative;overflow:hidden}',
		'.mt-control-card.wide{grid-column:1/-1}',
		'.mt-control-card h3{margin:0 0 6px;font-size:15px;font-weight:800;color:var(--qm-text)}',
		'.mt-control-desc{font-size:12px;color:var(--qm-text-muted);margin-bottom:16px;line-height:1.5}',
		'.mt-control-row{display:grid;grid-template-columns:145px 1fr;gap:12px;align-items:center;margin:12px 0}',
		'.mt-control-row label{font-size:12px;font-weight:650;color:var(--qm-text-soft)}',
		'.mt-control-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}',
		'.mt-control-note{padding:12px 16px;border-radius:14px;background:var(--qm-warn-soft);border:1px solid var(--qm-warn-border);color:var(--qm-warn);font-size:11.5px;line-height:1.5;margin-top:14px}',
		'.mt-control-state{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
		'.mt-control-state:last-child{border-bottom:0}',
		'.mt-control-state span{color:var(--qm-text-muted);font-weight:600}',
		'.mt-control-state strong{text-align:right;font-weight:750;color:var(--qm-text)}',
		'.mt-control-state-current{background:var(--qm-accent-soft);border:1px solid var(--qm-accent-border);border-radius:14px;padding:10px 14px;margin:10px 0}',
		'.mt-control-state-current span{color:var(--qm-accent);font-weight:650}',
		'.mt-control-state-current strong{color:var(--qm-accent);font-weight:800}',
		'.mt-control-card.mt-ui-card{border-radius:var(--qm-radius)!important}',
		'.mt-modem-bar{display:flex;align-items:center;gap:12px;margin:0 0 18px;padding:12px 20px;border:1px solid var(--qm-glass-border)!important;border-radius:18px!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;-webkit-backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important}',
		'.mt-modem-bar-label{font-size:12px;font-weight:750;color:var(--qm-text-soft);white-space:nowrap;letter-spacing:0.04em;text-transform:uppercase}',
		'.mt-modem-select{min-width:220px;max-width:420px}',
		'.mt-info-all{margin-top:18px}',
		'.mt-info-all>h3{margin:0 0 4px;font-size:16px;font-weight:800;color:var(--qm-text)}',
		'.mt-info-all>p{margin:0 0 14px;color:var(--qm-text-muted);font-size:12px;line-height:1.5}',
		'.mt-info-grid-all{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:14px}',
		'.mt-info-card{padding:18px 20px;border:1px solid var(--qm-glass-border)!important;border-radius:var(--qm-radius)!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important}',
		'.mt-info-card h3{margin:0 0 12px;font-size:13.5px;font-weight:800;color:var(--qm-accent)}',
		'.mt-info-body{display:flex;flex-direction:column}',
		'.mt-info-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
		'.mt-info-row:last-child{border-bottom:0}',
		'.mt-info-key{color:var(--qm-text-muted);font-weight:600}',
		'.mt-info-val{text-align:right;word-break:break-all;font-weight:700;color:var(--qm-text);font-variant-numeric:tabular-nums}',
		'@media(max-width:760px){.mt-ui-hero{display:block;padding:20px}.mt-control-grid{grid-template-columns:1fr}.mt-control-row{grid-template-columns:1fr;gap:6px}.mt-info-grid-all{grid-template-columns:1fr}}'
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
					Promise.resolve().then(onConfirm).then(function() {
						notify(null, E('p', {}, _('Settings applied.')));
						window.setTimeout(function() { window.location.reload(); }, 900);
					}, function(err) {
						notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				}
			}, _('Apply'))
		])
	]);
}

// 根据 MCC/MNC（或运营商名）返回中文名 + logo。
function operatorInfo(name, mcc, mnc) {
	var n = valueText(name).toUpperCase().replace(/\s+/g, ' ').trim();
	var country = valueText(mcc), network = valueText(mnc);
	if (country === '460' && /^\d$/.test(network)) network = '0' + network;
	var code = country && network ? country + network : '';
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
	return { name: valueText(name) || _('Mobile Network'), logo: null };
}

/* ------------------------------------------------------------------ */
/* 视图入口：首屏加载                                                  */
/* ------------------------------------------------------------------ */

/*
 * bootstrap() —— 所有视图 load() 的统一入口。
 *
 * 只读 UCI 配置（本地文件，毫秒级），解析当前模组配置节；
 * 页面数据由各视图在 collect() 里直连官方 qmodem 接口获取。
 * 返回 { section, sections, errors }，永不 reject —— 无论 QModem 是否已
 * 识别模组，页面框架都能立刻渲染出来。
 */
function bootstrap() {
	var ctx = { section: null, sections: [], errors: [] };

	return withTimeout(uci.load('qmodem'), DIRECT_RPC_TIMEOUT, null).then(function() {
		ctx.sections = getModemSectionsSync();
		return resolveSection();
	}).then(function(section) {
		ctx.section = section || null;
		return ctx;
	}, function(err) {
		ctx.errors.push((err && err.message) || String(err));
		return ctx;
	});
}

/* ------------------------------------------------------------------ */
/* 视图刷新                                                            */
/* ------------------------------------------------------------------ */

/* 立即重新采集并重绘；没有轮询器的页面（如静态表单页）退化为整页刷新。
 * 第二个参数为 3.0.0 前的缓存域列表，已废弃，仅为兼容既有调用保留占位。 */
function refreshPage(section, domains, button) {
	if (button && button.disabled) return Promise.resolve(null);
	var live = activeLive;
	if (live && live.poller && live.poller.isRunning()) {
		var label = button && button.textContent;
		if (button) {
			button.disabled = true;
			button.textContent = _('正在刷新…');
			button.setAttribute('aria-busy', 'true');
		}
		return Promise.resolve(live.poller.kick()).then(function() {
			if (button) {
				button.disabled = false;
				button.textContent = label || _('刷新');
				button.removeAttribute('aria-busy');
			}
			return null;
		}, function() {
			if (button) {
				button.disabled = false;
				button.textContent = label || _('刷新');
				button.removeAttribute('aria-busy');
			}
			return null;
		});
	}
	window.location.reload();
	return Promise.resolve(null);
}

return baseclass.extend({
	/* ---- 基础设施（视图直接复用，避免各自实现轮询/超时） ---- */
	bootstrap: bootstrap,
	liveView: liveView,
	createPoller: createPoller,
	refreshPage: refreshPage,
	kickPoller: kickPoller,
	notify: notify,
	withTimeout: withTimeout,
	withTimeoutReject: withTimeoutReject,
	commitConfig: commitConfig,
	mergeIfaceEntries: mergeIfaceEntries,

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
	getNeighborCellFresh: getNeighborCellFresh,
	getNetworkPrefer: getNetworkPrefer,
	getDns: getDns,
	getSms: getSms,
	getSmsInbox: getSmsInbox,
	smsReadInFlight: smsReadInFlight,
	refreshSmsInbox: refreshSmsInbox,
	sendSmsInbox: sendSmsInbox,
	deleteSmsMessage: deleteSmsMessage,
	markSmsRead: markSmsRead,
	getSmsServiceConfig: getSmsServiceConfig,
	getSmsServiceStatus: getSmsServiceStatus,
	getSmsSyncStatus: getSmsSyncStatus,
	getSmsModemList: getSmsModemList,
	configureSmsService: configureSmsService,
	getSmsStorageService: getSmsStorageService,
	setSmsStorageService: setSmsStorageService,
	parseSmsStorage: parseSmsStorage,
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
	saveStats: saveStats,
	getDailyStats: getDailyStats,
	statsReset: statsReset,
	getTrafficResetSchedule: getTrafficResetSchedule,
	getMonitorStatus: getMonitorStatus,
	get5gLan: get5gLan,
	getUplinkStatus: getUplinkStatus,

	getSupportStatus: getSupportStatus,
	syncSupport: syncSupport,
	getSupportPorts: getSupportPorts,
	getCustomModels: getCustomModels,
	saveCustomModel: saveCustomModel,
	deleteCustomModel: deleteCustomModel,
	probeSupportPort: probeSupportPort,

	/* 设备扫描 / 模组接入 */
	scanDevices: scanDevices,
	getPcieDevices: getPcieDevices,
	getUsbDevices: getUsbDevices,
	getAvailableDevices: getAvailableDevices,
	getTtyPorts: getTtyPorts,
	getLeds: getLeds,
	getNetworkInterfaces: getNetworkInterfacesList,
	removeModem: removeModem,

	sendAt: sendAt,
	atResponseText: atResponseText,
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
	setInitAction: setInitAction,
	getModemInterfaces: getModemInterfaces,
	getInterfaceStatus: getInterfaceStatus,
	getDeviceStatus: getDeviceStatus,

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
	pageTitle: theme.pageTitle,
	element: E,
	hasValue: hasValue,
	valueText: valueText,
	xmlText: xmlText,
	dataRow: dataRow,
	flagKeys: flagKeys,
	isEnabled: isEnabled,
	supportsTdTechAt: supportsTdTechAt,
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
	injectStyleOnce: injectStyleOnce,
	confirmModal: confirmModal,
	operatorInfo: operatorInfo
});
