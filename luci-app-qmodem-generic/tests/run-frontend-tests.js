/*
 * QModem Generic — LuCI 前端直连链路测试
 *
 * 用最小化的 luci 运行时替身加载真实的 controls.js 与视图模块，
 * 验证「数据直连官方 qmodem/qmodem.sms 接口、写操作直调官方方法、
 * 轮询不堆叠」确实成立。自 3.0.0 起前端不再有 qmodem_cache 快照层
 * 与任务队列，所有 rpc.declare 都直连官方 ubus 对象。
 *
 * 运行：node tests/run-frontend-tests.js [模块名...]
 * 由 tests/run-frontend-tests.sh 包装（没有 node 时自动跳过）。
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var RES = path.join(ROOT, 'htdocs', 'luci-static', 'resources');

var passed = 0, failed = 0;
function ok(name, cond, extra) {
	if (cond) { passed++; console.log('  ok   - ' + name); }
	else { failed++; console.log('  FAIL - ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
function assertLt(name, actual, max, unit) {
	ok(name + ' (' + actual + (unit || 'ms') + ' <= ' + max + (unit || 'ms') + ')', actual <= max, actual);
}
function assertEq(name, actual, expect) {
	ok(name, actual === expect, 'got ' + JSON.stringify(actual) + ' want ' + JSON.stringify(expect));
}

/* ------------------------------------------------------------------ 运行时替身 */

function makeRuntime() {
	var calls = [];            /* 所有 rpc 调用记录 */
	var ubusDelayMs = 0;       /* 模拟 qmodem 对象（AT 驱动）的慢速 */
	var failAll = false;       /* 模拟模组完全失联：所有 qmodem 调用 reject */
	var smsApi = null;
	var modemSmsApi = null;
	var modemImeiApi = null;
	var uciCommitError = null;
	var dialResultStatus = '1';
	var deleteResult = { result: { status: '1' } };
	var imeiResult = { imei: '860000000000002', result: { status: '1' } };
	var scanResult = { code: 0, message: 'scan queued' };
	var statsResetResult = null;    /* 覆盖 qmodem_stats/stats_reset 的返回（测失败载荷） */
	var removeModemResult = null;   /* 覆盖 qmodem/remove_modem 的返回（测退出码语义） */
	var qmodemOverrides = {};       /* 按方法覆盖 qmodem 返回（测失败载荷） */

	var NOW = Math.floor(Date.now() / 1000);

	/* 官方 qmodem 对象各方法的 canned 返回（形状与 QModem rpcd 一致） */
	var qmodemData = {
		base_info: { modem_info: [ { key: 'model', value: 'RM520N-GL' },
					   { key: 'at_port', value: '/dev/ttyUSB2' },
					   { key: 'connect_status', value: 'Yes' } ] },
		cell_info: { modem_info: [ { key: 'RSRP', value: '-85' },
					   { key: 'Network Type', value: 'LTE' } ] },
		info: { modem_info: [] },
		network_info: { modem_info: [ { key: 'QCI', value: '9' },
					      { key: 'AMBR DL', value: '100' },
					      { key: 'AMBR UL', value: '50' } ] },
		sim_info: { modem_info: [ { key: 'imsi', value: '460010000000001' } ] },
		get_at_cfg: { at_cfg: { at_port: '/dev/ttyUSB2', ports: [ '/dev/ttyUSB2' ],
					cmds: [ { name: '信号', value: 'AT+CSQ' } ] } },
		get_imei: { imei: '860000000000001' },
		get_mode: { mode: { ecm: '1', qmi: '0' } },
		get_lockband: { lockband: { LTE: { available_band: [ { band_id: 3, band_name: 'B3' } ], lock_band: [ '3' ] } } },
		get_neighborcell: { neighborcell: {} },
		get_network_prefer: { network_prefer: { '4G': '1', '5G': '0' } },
		get_dns: { dns: { ipv4_dns1: '1.1.1.1', ipv6_dns1: '' } },
		get_sms: { msg: [] },
		get_disabled_features: { disabled_features: [] },
		get_reboot_caps: { reboot_caps: { soft_reboot_caps: '1', hard_reboot_caps: '0' } },
		get_copyright: { copyright: { Vendor: 'QModem' } },
		get_current_band: { current_band: { status: 'unsupported' } },
		get_current_band_capabilities: { current_band_capabilities: { supported: false } },
		get_connect_status: { connection_status: 'No' },
		dial_status: { dial_status: { running: 'false' } },
		get_dial_log: { log: 'dial log line' },
		get_sim_slot: { sim_slot: '1' },
		get_sim_switch_capabilities: { supportSwitch: '0' },
		get_stats: { available: 1, updated_at: NOW, total_rx_bytes: 1024, total_tx_bytes: 2048 },
		get_traffic_reset_schedule: { enabled: false, reset_type: 'monthly', hour: 0, day: 1, minute: 0 },
		get_monitor_status: { enabled: false, running: false },
		get_5g_lan: { supported: false }
	};

	var qmodemSupportData = {
		status: { available: 42, path: '/usr/share/qmodem/modem_support.json',
			  added: [], skipped: [], missing: [], error: null },
		sync: { available: 42, added: 1, skipped: 0, missing: 0, error: null },
		ports: { ports: [ { port: '/dev/ttyUSB2', bus: 'usb', model: '', id: '2c7c:0900', confirmed: true } ] },
		custom_list: { entries: [], presets: {} },
		custom_save: { success: true, synced: true },
		custom_delete: { success: true },
		probe_port: { success: true, model: 'RG502Q-EA' }
	};

	function delay(ms) {
		return new Promise(function(res) { setTimeout(res, ms); });
	}

	/* rpc.declare 的替身：直连分发，只支持测试用到的形态 */
	function declare(def) {
		var object = def.object, method = def.method;
		var expect = def.expect || {};
		var expectKey = null, expectVal;
		Object.keys(expect).forEach(function(k) { expectKey = k; expectVal = expect[k]; });

		/* 真实 LuCI 的 declare 会把位置参数按 params 数组映射成命名参数 */
		var names = def.params || [];
		return function() {
			var args = Array.prototype.slice.call(arguments);
			var p = {};
			for (var i = 0; i < names.length; i++)
				if (args[i] !== undefined) p[names[i]] = args[i];
			calls.push({ object: object, method: method, params: p, t: Date.now() });

			var body;
			if (object === 'uci' && method === 'commit') {
				body = uciCommitError ? { __rpcError: uciCommitError } : {};
			} else if (object === 'qmodem.sms') {
				body = smsApi ? smsApi(method, p) : { __rpcError: 'RPC call to qmodem.sms/config_get failed with ubus code 4: Not found' };
			} else if (object === 'qmodem_stats') {
				body = method === 'daily_stats'
					? { config_section: p.config_section, updated_at: NOW, available: 1,
					    today_rx: 1, today_tx: 2, total_rx: 10, total_tx: 20, swapped: 0,
					    days: [ { date: '2026-09-27', rx: 10, tx: 20 } ] }
					: (statsResetResult || { config_section: p.config_section, result: 1, success: true });
			} else if (object === 'qmodem_support') {
				body = qmodemSupportData[method] || { success: true };
			} else if (object === 'qmodem.uplink') {
				body = { enabled: false };
			} else if (object === 'rc') {
				body = { name: p.name || 'qmodem_network', enabled: true, running: false };
			} else if (object === 'luci') {
				body = {};
			} else if (object === 'network.interface') {
				body = { interface: [] };
			} else if (object === 'network.device') {
				body = { up: true, mtu: 1500 };
			} else if (object === 'qmodem' && method === 'get_sms' && modemSmsApi) {
				body = modemSmsApi(method, p);
			} else if (object === 'qmodem' && method === 'get_imei' && modemImeiApi) {
				body = modemImeiApi(method, p);
			} else if (object === 'qmodem') {
				body = qmodemOverrides[method] !== undefined ? qmodemOverrides[method] :
					(qmodemData[method] !== undefined ? qmodemData[method] : qmodemWrite(method, p));
			} else {
				body = {};
			}

			return Promise.resolve().then(function() {
				return object === 'qmodem' ? (ubusDelayMs ? delay(ubusDelayMs) : null) : null;
			}).then(function() {
				if (failAll && (object === 'qmodem' || object === 'qmodem.uplink'))
					throw new Error('modem offline');
				if (body && body.__rpcError) throw new Error(body.__rpcError);
				if (expectKey && body && body[expectKey] === undefined) {
					var wrapped = {};
					wrapped[expectKey] = expectVal;
					return wrapped;
				}
				return body;
			});
		};
	}

	function qmodemWrite(method, p) {
		switch (method) {
			case 'send_at': {
				var command = p.params && p.params.at;
				if (command === 'AT+BAD')
					return { at_cfg: { status: '1', res: '\r\n+CME ERROR: 10\r\n' } };
				return { at_cfg: { status: '1', res: 'Fibocom\r\nFM350-GL\r\nOK' } };
			}
			case 'send_sms':
			case 'send_raw_pdu':
			case 'delete_sms':
				return method === 'delete_sms' ? deleteResult : { result: { status: '1' } };
			case 'set_imei':
				return imeiResult;
			case 'set_mode':
				/* 官方 rpcd 仅回显 {"result":"<mode>"}，不带状态字段 */
				return { result: p.mode };
			case 'do_reboot':
			case 'clear_dial_log':
			case 'clear_stats':
				return { result: { status: '1' } };
			case 'set_traffic_reset_schedule':
				return { result: true };
			case 'modem_dial':
			case 'modem_hang':
			case 'modem_redial':
				return { result: { status: dialResultStatus,
					message: dialResultStatus === '0' ? 'Dial command failed' : 'Dial command executed successfully' } };
			case 'save_stats':
				return { result: { status: '1' } };
			case 'set_5g_lan':
				return { supported: true, enabled: !!p.enabled };
			case 'remove_modem':
				return removeModemResult || { status: '0' };
			case 'scan_pcie':
			case 'scan_usb':
			case 'scan_all':
				return scanResult;
			default:
				return { success: true };
		}
	}

	var rpc = {
		declare: declare,
		getData: function() { return Promise.resolve({ result: 0 }); },
		setData: function() { return Promise.resolve(); }
	};

	var baseclass = {
		extend: function(props) {
			var obj = Object.create(this);
			Object.keys(props || {}).forEach(function(k) { obj[k] = props[k]; });
			return obj;
		},
		instantiate: function(props) { return this.extend(props || {}); }
	};

	/* 极简 DOM 替身 */
	function El(tag, attrs, children) {
		this.nodeType = 1;
		this.tagName = String(tag || 'div').toUpperCase();
		this.attributes = attrs || {};
		this.children = [];
		this.parentNode = null;
		this.style = {};
		this.classList = { add: function() {}, remove: function() {}, toggle: function() {} };
		this.type = (attrs && attrs.type) || '';
		this.value = (attrs && attrs.value !== undefined) ? String(attrs.value) : '';
		this.defaultValue = this.value;
		this.checked = !!(attrs && attrs.checked);
		this.defaultChecked = this.checked;
		var self = this;
		/* 真实 LuCI 的 E() 接受单个子节点、数组或字符串 */
		var list = (children === null || children === undefined) ? []
			: (Array.isArray(children) ? children : [children]);
		list.forEach(function(c) { self.appendChild(c); });
	}
	El.prototype.appendChild = function(c) {
		if (c === null || c === undefined) return c;
		if (typeof c === 'string' || typeof c === 'number') c = { nodeType: 3, text: String(c), parentNode: null };
		c.parentNode = this; this.children.push(c); return c;
	};
	El.prototype.removeChild = function(c) {
		var i = this.children.indexOf(c);
		if (i >= 0) this.children.splice(i, 1);
		return c;
	};
	El.prototype.querySelectorAll = function() { return []; };
	El.prototype.contains = function() { return false; };
	El.prototype.addEventListener = function(ev, callback) {
		(this._handlers = this._handlers || {})[ev] = callback;
	};
	El.prototype.fire = function(ev) { if (this._handlers && this._handlers[ev]) this._handlers[ev](); };
	El.prototype.setAttribute = function(k, v) { this.attributes[k] = v; };
	El.prototype.getAttribute = function(k) { return this.attributes[k]; };
	El.prototype.focus = function() {};
	Object.defineProperty(El.prototype, 'firstChild', { get: function() { return this.children[0] || null; } });

	var listeners = {};
	var documentStub = {
		hidden: false,
		visibilityState: 'visible',
		activeElement: null,
		createElement: function(t) { return new El(t); },
		createElementNS: function(ns, t) { return new El(t); },
		createTextNode: function(t) { return { nodeType: 3, text: String(t) }; },
		addEventListener: function(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
		removeEventListener: function() {},
		fire: function(ev, e) { (listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); }
	};

	var notifications = [];
	var ui = {
		addNotification: function(title, body, cls) { notifications.push({ title: title, cls: cls }); },
		showModal: function() { return new El('div'); },
		hideModal: function() {}
	};

	var dom = {
		content: function(node, children) {
			node.children = [];
			(Array.isArray(children) ? children : [children]).forEach(function(c) { node.appendChild(c); });
			return node;
		},
		create: function(tag, attrs, children) { return new El(tag, attrs, children); },
		append: function(node, child) { return node.appendChild(child); }
	};

	var uciSections = {
		modem1: { '.name': 'modem1', name: 'RM520N-GL', model: 'RM520N-GL',
			    manufacturer: 'quectel', enabled: '1', network: 'wan',
			    at_port: '/dev/ttyUSB2', disabled_features: [] }
	};
	var uci = {
		load: function(cfg) { return Promise.resolve(); },
		/* 真实 LuCI 的 uci.sections 是回调式的 */
		sections: function(cfg, type, cb) {
			var keys = Object.keys(uciSections);
			if (typeof cb === 'function') {
				for (var i = 0; i < keys.length; i++) cb(uciSections[keys[i]]);
				return null;
			}
			return keys.map(function(k) { return uciSections[k]; });
		},
		get: function(cfg, sec, opt) { return sec && uciSections[sec] ? uciSections[sec][opt] : null; },
		set: function() {}, unset: function() {}, save: function() { return Promise.resolve(); }
	};
	var localStorage = {
		_data: {},
		getItem: function(k) { return this._data[k] || null; },
		setItem: function(k, v) { this._data[k] = String(v); }
	};

	var fsStub = { read: function() { return Promise.resolve(null); }, trim: function(s) { return String(s || '').trim(); } };
	var pollStub = { add: function() {}, remove: function() {}, start: function() {}, stop: function() {} };

	function makeRequire(modules) {
		return function(name) {
			if (modules[name] !== undefined) return modules[name];
			throw new Error('unexpected require: ' + name);
		};
	}

	var themeModuleCache = null;

	function loadModule(relPath, extraModules) {
		var src = fs.readFileSync(path.join(RES, relPath), 'utf8');
		var isThemeModule = /theme\.js$/.test(relPath);
		var modules = {
			'luci': { view: baseclass },
			'luci/baseclass': baseclass,
			'luci/rpc': rpc,
			'luci/uci': uci,
			'luci/ui': ui,
			'luci/dom': dom,
			'luci/fs': fsStub,
			'luci/poll': pollStub,
			'luci/validation': { parseIPv4: function() { return true; } },
			'luci/form': {},
			'luci/widgets': {},
			'luci/xhr': {},
			'luci/request': {},
			'luci/session': {},
			'luci/qmodem-generic/controls': null
		};
		Object.keys(extraModules || {}).forEach(function(k) { modules[k] = extraModules[k]; });
		modules['luci/qmodem-generic/controls'] = modules['luci/qmodem-generic/controls'] || null;

		/*
		 * LuCI 的模块加载器会把 'require xxx' 声明的模块注入为同名局部变量，
		 * 并把 E / _ 作为全局提供。这里用函数参数完整复刻这套作用域。
		 */
		var E = function(tag, attrs, children) { return new El(tag, attrs, children); };
		var _ = function(s) { return String(s); };
		var form = {
			Map: function(cfg, sec) {
				return {
					load: function() { return Promise.resolve(); },
					render: function() { return new El('div'); },
					save: function() { return Promise.resolve(); },
					section: function() { return { option: function() { return {}; }, tab: function() {} }; },
					tab: function() {}, option: function() { return {}; }
				};
			},
			NamedSection: function() {}, Value: function() {}, ListValue: function() {},
			Flag: function() {}, DummyValue: function() {}, TextValue: function() {}
		};
		var widgets = { NetworkSelect: function() {}, DeviceSelect: function() {} };
		var validation = { parseIPv4: function() { return true; } };
		var request = { poll: { add: function() {}, remove: function() {} } };
		var session = {};
		var xhr = { get: function() { return Promise.resolve({ json: function() { return {}; } }); } };

		/* 'require qmodem-generic.controls as controls' 注入的局部变量 */
		var controlsModule = modules['luci/qmodem-generic/controls'];
		/* 'require qmodem-generic.theme as theme' 注入的局部变量（懒加载一次并缓存） */
		if (!isThemeModule && !themeModuleCache)
			themeModuleCache = loadModule('qmodem-generic/theme.js');
		var themeModule = isThemeModule ? null : themeModuleCache;

		var fn = new Function(
			'require', 'L', 'window', 'document', 'E', '_',
			'baseclass', 'view', 'rpc', 'uci', 'ui', 'dom', 'fs', 'poll',
			'form', 'widgets', 'validation', 'request', 'session', 'xhr', 'controls', 'theme',
			src);
		return fn(
			makeRequire(modules), { env: { rpctimeout: 20 } },
			{ location: { protocol: 'http:' }, setTimeout: setTimeout, clearTimeout: clearTimeout,
			  localStorage: localStorage,
			  addEventListener: function(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
			  removeEventListener: function(ev, cb) {
				var a = listeners[ev] || [], i = a.indexOf(cb);
				if (i >= 0) a.splice(i, 1);
			  } },
			documentStub, E, _,
			baseclass, baseclass, rpc, uci, ui, dom, fsStub, pollStub,
			form, widgets, validation, request, session, xhr, controlsModule, themeModule);
	}

	return {
		loadModule: loadModule,
		calls: calls,
		notifications: notifications,
		document: documentStub,
		listeners: listeners,
		El: El,
		setUbusDelay: function(ms) { ubusDelayMs = ms; },
		setFailAll: function(v) { failAll = !!v; },
		setSmsApi: function(handler) { smsApi = handler; },
		setModemSmsApi: function(handler) { modemSmsApi = handler; },
		setModemImeiApi: function(handler) { modemImeiApi = handler; },
		setUciCommitError: function(error) { uciCommitError = error; },
		setDeleteResult: function(result) { deleteResult = result; },
		setImeiResult: function(result) { imeiResult = result; },
		setDialResultStatus: function(value) { dialResultStatus = String(value); },
		setStatsResetResult: function(result) { statsResetResult = result; },
		setRemoveModemResult: function(result) { removeModemResult = result; },
		setQmodemResult: function(method, body) {
			if (body === undefined) delete qmodemOverrides[method];
			else qmodemOverrides[method] = body;
		},
		setSections: function(s) { uciSections = s; },
		countCalls: function(obj, method) {
			return calls.filter(function(c) {
				return c.object === obj && (method === undefined || c.method === method);
			}).length;
		},
		resetCalls: function() { calls.length = 0; }
	};
}

/* ------------------------------------------------------------------ 用例 */

function loadControls(rt) {
	return rt.loadModule('qmodem-generic/controls.js');
}

async function testLegacyUciCommit() {
	console.log('\n[0] 旧版 LuCI 没有 uci.commit 时仍能保存 QModem 配置');
	var rt = makeRuntime(), controls = loadControls(rt);
	await controls.commitConfig('qmodem');
	assertEq('仅提交指定的 QModem 配置', JSON.stringify(rt.calls[0].params), '{"config":"qmodem"}');
	assertEq('使用旧版共同支持的 UCI commit RPC', rt.countCalls('uci', 'commit'), 1);
	assertEq('保存配置不调用全局 apply 或重拨', rt.calls.length, 1);
	rt.setUciCommitError('Permission denied');
	var rejected = false;
	try { await controls.commitConfig('qmodem'); } catch (error) { rejected = /Permission denied/.test(error.message); }
	ok('提交失败向页面传播错误', rejected);
}

function testBootstrap(rt) {
	console.log('\n[1] bootstrap：只读 UCI 解析配置节，不产生任何 RPC');
	var controls = loadControls(rt);
	rt.resetCalls();

	var t0 = Date.now();
	return controls.bootstrap().then(function(ctx) {
		var elapsed = Date.now() - t0;

		assertLt('bootstrap 完成耗时', elapsed, 500);
		assertEq('解析出配置节', ctx.section, 'modem1');
		assertEq('bootstrap 只读 UCI，不产生任何 rpc 调用', rt.calls.length, 0);

		console.log('\n[2] 读取器直连官方 qmodem 方法并解包');
		rt.resetCalls();
		var t1 = Date.now();
		return Promise.all([
			controls.getBaseInfo(ctx.section),
			controls.getMode(ctx.section),
			controls.getSimInfo(ctx.section),
			controls.getAtCfg(ctx.section),
			controls.getCellInfo(ctx.section)
		]).then(function(vals) {
			var base = vals[0], mode = vals[1], sim = vals[2], at = vals[3], cell = vals[4];
			var elapsed2 = Date.now() - t1;

			assertLt('5 个读取器总耗时', elapsed2, 500);
			assertEq('每个读取器各产生一次直连调用', rt.countCalls('qmodem'), 5);
			assertEq('base_info 直接返回数组（向后兼容）', Array.isArray(base), true);
			assertEq('base_info 内容来自官方 modem_info', controls.findEntry(base, 'model'), 'RM520N-GL');
			assertEq('findEntry 兼容对象数组', controls.findEntry(sim, 'imsi'), '460010000000001');
			assertEq('getMode 官方 flag 形状解包正常', !!(mode && mode.mode && mode.mode.ecm === '1'), true);
			assertEq('getAtCfg 保留 at_cfg 包装', !!(at && at.at_cfg), true);
			assertEq('cell_info 摊平为数组', Array.isArray(cell) && cell.length, 2);
			return controls;
		});
	});
}

function testActions(rt, controls) {
	console.log('\n[4] 写操作直连官方方法（无任务队列）');
	rt.resetCalls();

	return controls.sendAt('modem1', '', 'AT+CGMI').then(function(res) {
		assertEq('send_at 直连官方方法', rt.countCalls('qmodem', 'send_at'), 1);
		assertEq('无端口时不携带 port 参数', JSON.stringify(rt.calls[0].params.params), JSON.stringify({ at: 'AT+CGMI' }));
		assertEq('任务结果带回 AT 响应', res.response.indexOf('OK') >= 0, true);

		rt.resetCalls();
		return controls.statsReset('modem1').then(function(r2) {
			assertEq('stats_reset 直连 qmodem_stats', rt.countCalls('qmodem_stats', 'stats_reset'), 1);
			assertEq('stats_reset 携带配置节', rt.calls[0].params.config_section, 'modem1');
			assertEq('stats_reset 返回 success', !!(r2 && r2.success), true);

			rt.resetCalls();
			return controls.doReboot('modem1', 'hard').then(function(r3) {
				var call = rt.calls.filter(function(c) { return c.method === 'do_reboot'; })[0];
				assertEq('reboot 直连官方方法', rt.countCalls('qmodem', 'do_reboot'), 1);
				assertEq('reboot 携带 method 参数', JSON.stringify(call.params.params), JSON.stringify({ method: 'hard' }));
				assertEq('reboot 结果 status=1', r3.result.status, '1');
			});
		});
	});
}

function testFailurePayloads() {
	console.log('\n[4f] 官方失败载荷必须 reject（不静默成功）');
	var rt = makeRuntime(), controls = loadControls(rt);

	rt.setStatsResetResult({ config_section: 'modem1', result: 0, success: false, error: 'stats collector missing' });
	return controls.statsReset('modem1').then(function() {
		ok('stats_reset success:false 必须失败', false);
	}, function(err) {
		ok('stats_reset success:false 返回实际错误',
			/stats collector missing|清零/i.test((err && err.message) || ''));
	}).then(function() {
		rt.setStatsResetResult(null);
		rt.setRemoveModemResult({ status: '1' });
		return controls.removeModem('modem1').then(function() {
			ok('remove_modem 非零退出码必须失败', false);
		}, function(err) {
			ok('remove_modem 非零退出码返回实际错误', /exit|失败/i.test((err && err.message) || ''));
		});
	}).then(function() {
		rt.setRemoveModemResult({ status: '0' });
		rt.resetCalls();
		return controls.removeModem('modem1').then(function(res) {
			assertEq('remove_modem 退出码 0 视为成功', String(res.status), '0');
			assertEq('remove_modem 直连官方方法', rt.countCalls('qmodem', 'remove_modem'), 1);
		});
	}).then(function() {
		/* clear_dial_log 官方返回 {"result":{"status":"0"}} 表示文件不存在等失败 */
		rt.setQmodemResult('clear_dial_log', { result: { status: '0' } });
		return controls.clearDialLog('modem1').then(function() {
			ok('clear_dial_log status=0 必须失败', false);
		}, function(err) {
			ok('clear_dial_log status=0 返回实际错误', /失败|拒绝/i.test((err && err.message) || ''));
		});
	}).then(function() {
		/* set_sim_slot 官方返回 {"success":false,...} */
		rt.setQmodemResult('set_sim_slot', { success: false, error: 'SIM switch failed' });
		return controls.setSimSlot('modem1', '1').then(function() {
			ok('set_sim_slot success:false 必须失败', false);
		}, function(err) {
			ok('set_sim_slot success:false 返回实际错误', /SIM switch failed|失败/i.test((err && err.message) || ''));
		});
	}).then(function() {
		/* set_mode 官方仅回显 {"result":"<mode>"}（无状态字段），不得误伤 */
		rt.resetCalls();
		return controls.setMode('modem1', 'auto').then(function(res) {
			assertEq('set_mode 无状态字段回显视为成功', res.result, 'auto');
			assertEq('set_mode 直连官方方法', rt.countCalls('qmodem', 'set_mode'), 1);
		});
	}).then(function() {
		rt.setQmodemResult('clear_dial_log', undefined);
		rt.setQmodemResult('set_sim_slot', undefined);
	});
}

function testSmsCountryCode() {
	console.log('\n[4g] 短信设置保存时国家码随 configure 一次下发');
	var rt = makeRuntime(), controls = loadControls(rt);
	rt.setSmsApi(function(method, p) {
		if (method === 'config_get')
			return { modem_id: p.modem_id, mode: 'database_poll', poll_interval: 300,
				forwarding: false, auto_delete: false, country_code: '' };
		return { status: 'success' };
	});
	rt.resetCalls();
	return controls.configureSmsService('modem1', {
		mode: 'database_poll', pollInterval: 120, forwarding: true,
		autoDelete: true, countryCode: ' 86 '
	}).then(function(res) {
		assertEq('configure 返回成功', res.status, 'success');
		var call = rt.calls.filter(function(c) {
			return c.object === 'qmodem.sms' && c.method === 'configure';
		})[0];
		ok('configure 被调用', !!call);
		assertEq('configure 携带 country_code（去空白）', call && call.params.country_code, '86');
		assertEq('configure 携带 mode', call && call.params.mode, 'database_poll');
		assertEq('configure 携带 poll_interval', call && call.params.poll_interval, 120);
		assertEq('configure 携带 forwarding', call && call.params.forwarding, true);
		assertEq('configure 携带 auto_delete', call && call.params.auto_delete, true);
	}).then(function() {
		rt.resetCalls();
		return controls.configureSmsService('modem1', { countryCode: '' }).then(function() {
			var call = rt.calls.filter(function(c) {
				return c.object === 'qmodem.sms' && c.method === 'configure';
			})[0];
			assertEq('空国家码按清除语义下发空串', call && call.params.country_code, '');
		});
	});
}

function testDialResults() {
	console.log('\n[4c] QModem 拨号/挂断/重拨返回值校验');
	var rt = makeRuntime(), controls = loadControls(rt);
	var names = [ [ 'modemDial', 'modem_dial' ], [ 'modemHang', 'modem_hang' ],
		[ 'modemRedial', 'modem_redial' ] ];
	return names.reduce(function(chain, pair) {
		return chain.then(function() {
			rt.setDialResultStatus('1');
			rt.resetCalls();
			return controls[pair[0]]('8_1').then(function(res) {
				assertEq(pair[1] + ' status=1 正常成功', res.result.status, '1');
				var call = rt.calls.filter(function(x) {
					return x.object === 'qmodem' && x.method === pair[1];
				})[0];
				assertEq(pair[1] + ' 直连官方方法并传递动态配置节', call.params.config_section, '8_1');
				rt.setDialResultStatus('0');
				return controls[pair[0]]('8_1').then(function() {
					ok(pair[1] + ' status=0 必须失败', false);
				}, function(err) {
					ok(pair[1] + ' status=0 返回实际失败错误',
						/fail|失败|拒绝/i.test((err && err.message) || ''));
				});
			});
		});
	}, Promise.resolve());
}

function testActionPayloads() {
	console.log('\n[4b] 真实 QModem 参数形态：动态模组、指定端口、嵌套 params 与返回错误');
	var rt = makeRuntime(), controls = loadControls(rt);
	var cases = [
		{ method:'send_at', run:function() { return controls.sendAt('6_1', '/dev/ttyUSB1', 'ATI'); }, section:'6_1', key:'params', value:{at:'ATI',port:'/dev/ttyUSB1'} },
		{ method:'send_at', run:function() { return controls.sendAt('6_2', '/dev/ttyUSB2', 'AT+CSQ', true); }, section:'6_2', key:'params', value:{at:'AT+CSQ',port:'/dev/ttyUSB2',use_ubus_flag:'1'} },
		{ method:'send_sms', run:function() { return controls.sendSms('6_1', '10010', '测试短信'); }, section:'6_1', key:'params', value:{phone_number:'10010',message_content:'测试短信'} },
		{ method:'set_mode', run:function() { return controls.setMode('6_2', 'ncm'); }, section:'6_2', key:'mode', value:'ncm' },
		{ method:'set_lockband', run:function() { return controls.setLockBand('6_1', {band_class:'LTE',lock_band:'3,7'}); }, section:'6_1', key:'params', value:{band_class:'LTE',lock_band:'3,7'} },
		{ method:'do_reboot', run:function() { return controls.doReboot('6_1', 'soft'); }, section:'6_1', key:'params', value:{method:'soft'} },
		{ method:'modem_dial', run:function() { return controls.modemDial('6_2'); }, section:'6_2' }
	];
	return cases.reduce(function(chain, c) {
		return chain.then(function() {
			rt.resetCalls();
			return c.run().then(function(result) {
				var call = rt.calls.filter(function(x) { return x.object === 'qmodem' && x.method === c.method; })[0];
				ok(c.method + ' 直连官方方法', !!call);
				assertEq(c.method + ' 保留动态配置节', call.params.config_section, c.section);
				if (c.key) assertEq(c.method + ' 参数结构与 RPC 约定一致', JSON.stringify(call.params[c.key]), JSON.stringify(c.value));
				if (c.method === 'send_at') assertEq('官方 at_cfg.res 被解析为响应正文', result.response, 'Fibocom\r\nFM350-GL\r\nOK');
			});
		});
	}, Promise.resolve()).then(function() {
		assertEq('平铺 response 优先于 result 状态', controls.atResponseText({result:'success',response:'OK'}), 'OK');
		assertEq('兼容旧版 result 字符串', controls.atResponseText({result:'ATI\r\nOK'}), 'ATI\r\nOK');
		assertEq('兼容数组响应', controls.atResponseText(['ATI','OK']), 'ATI\nOK');
		return controls.sendAt('6_1', '/dev/ttyUSB1', 'AT+BAD').then(function() {
			ok('模组 CME ERROR 必须 reject', false);
		}, function(err) { ok('模组 CME ERROR 被如实返回', /CME ERROR: 10/.test(err.message)); });
	}).then(function() {
		/* 自定义模组的四组频段必须沿 LuCI RPC 完整传递，不能被退回固定 0。 */
		rt.resetCalls();
		var cfg = {
			bus:'usb', model:'test-modem', manufacturer:'quectel', manufacturer_id:'2c7c',
			platform:'qualcomm', modes:'qmi,mbim,ecm', pdp_index:'1',
			wcdma_band:'1/5/8', lte_band:'1/3/5/8/41', nsa_band:'41/78', sa_band:'41/78/79'
		};
		return controls.saveCustomModel(cfg).then(function() {
			var call = rt.calls.filter(function(x) {
				return x.object === 'qmodem_support' && x.method === 'custom_save';
			})[0];
			ok('自定义模组调用官方支持库保存 RPC', !!call);
			if (!call) return;
			[ 'modes', 'wcdma_band', 'lte_band', 'nsa_band', 'sa_band' ].forEach(function(key) {
				assertEq('自定义模组 RPC 保留 ' + key, call.params[key], cfg[key]);
			});
			assertEq('普通新增默认非编辑', call.params.edit, '0');
		});
	});
}

async function testImeiReadback() {
	console.log('\n[4d] IMEI 写入后直接回读官方接口确认');
	var newImei = '860000000000002', oldImei = '860000000000001';
	var rt = makeRuntime(), controls = loadControls(rt);
	rt.setModemImeiApi(function() { return { imei: newImei }; });
	var fresh = await controls.setImei('8_1', newImei);
	assertEq('IMEI 实际回读值被返回', fresh.imei, newImei);
	var write = rt.calls.filter(function(c) { return c.object === 'qmodem' && c.method === 'set_imei'; })[0];
	assertEq('写入使用官方模组节', write.params.config_section, '8_1');
	assertEq('写入携带目标 IMEI', write.params.imei, newImei);
	assertEq('写入后直接读取模组确认', rt.countCalls('qmodem','get_imei'), 1);

	var stale = makeRuntime(), staleControls = loadControls(stale);
	stale.setModemImeiApi(function() { return { imei: oldImei }; });
	try {
		await staleControls.setImei('8_1', newImei);
		ok('QModem 仅回显新值时不能误报成功', false);
	} catch (err) {
		ok('QModem 仅回显新值时不能误报成功', /尚未确认生效/.test(err.message), err.message);
	}
	assertEq('旧值出现时重试一次回读', stale.countCalls('qmodem','get_imei'), 2);

	var denied = makeRuntime(), deniedControls = loadControls(denied);
	denied.setImeiResult({ imei: newImei, result: { status: '0' } });
	try {
		await deniedControls.setImei('8_1', newImei);
		ok('明确拒绝写入不回读', false);
	} catch (err) {
		ok('明确拒绝写入不回读', /拒绝/.test(err.message), err.message);
	}
	assertEq('明确失败时不读取旧 IMEI', denied.countCalls('qmodem','get_imei'), 0);
}

async function testSmsSources() {
	console.log('\n[4e] 短信数据库、旧版模组存储与错误隔离');
	function runtime(handler) {
		var rt = makeRuntime();
		if (handler) rt.setSmsApi(handler);
		return { rt:rt, controls:loadControls(rt) };
	}
	async function rejects(name, promise, pattern) {
		try { await promise; ok(name, false); }
		catch (err) { ok(name, pattern.test(err.message), err.message); }
	}
	var received = { id:71, type:'received', sender:'10010', content:'数据库接收短信', timestamp:1792239000, is_read:0 };
	var sent = { id:72, type:'sent', recipient:'10010', content:'数据库发送短信', timestamp:1792239060, success:1 };
	var db = runtime(function(method) {
		if (method === 'config_get') return { mode:'database_poll', auto_delete:true, poll_interval:300 };
		if (method === 'list') return { mode:'database_poll', messages:[received,sent] };
		return { status:'success' };
	});
	var inbox = await db.controls.getSmsInbox('6_2');
	assertEq('自动删除 SIM 后仍读取路由器数据库', inbox._smsSource, 'database');
	assertEq('数据库保留接收和发送记录', inbox.messages.length, 2);
	ok('数据库列表使用动态模组标识 modem_id', db.rt.calls.every(function(c) { return c.params.modem_id === '6_2'; }));
	assertEq('读取数据库不调用旧版 get_sms', db.rt.countCalls('qmodem','get_sms'), 0);
	assertEq('数据库页面加载不主动同步串口', db.rt.countCalls('qmodem.sms','sync'), 0);
	await db.controls.sendSmsInbox('6_2','10010','测试发送','database');
	var send = db.rt.calls.filter(function(c) { return c.object === 'qmodem.sms' && c.method === 'send'; })[0];
	assertEq('发送使用短信服务并保存数据库历史', JSON.stringify(send.params), JSON.stringify({modem_id:'6_2',recipient:'10010',content:'测试发送'}));
	assertEq('数据库发送不重复调用旧发送接口', db.rt.countCalls('qmodem','send_sms'), 0);
	await db.controls.deleteSmsMessage('6_2',{source:'database',index:'72'});
	var deletion = db.rt.calls.filter(function(c) { return c.method === 'delete'; })[0];
	assertEq('数据库删除使用记录 id 而非 SIM 序号', JSON.stringify(deletion.params), JSON.stringify({modem_id:'6_2',id:72}));
	await db.controls.markSmsRead('6_2',[{source:'database',index:'71',unread:true},{source:'database',index:'72',unread:false}]);
	assertEq('仅标记未读数据库短信', db.rt.countCalls('qmodem.sms','mark_read'), 1);
	await db.controls.refreshSmsInbox('6_2','database');
	assertEq('用户刷新时才请求数据库同步', db.rt.countCalls('qmodem.sms','sync'), 1);
	await rejects('无效数据库 id 不发出删除请求', db.controls.deleteSmsMessage('6_2',{source:'database',index:'-1'}), /无效/);

	/* 老版本 QModem delete_sms.index 必须是字符串；分段短信一次传递所有索引。 */
	var oldDelete = runtime();
	oldDelete.rt.setModemSmsApi(function() { return { sms: { msg: [] } }; });
	await oldDelete.controls.deleteSmsMessage('8_1', {source:'modem',index:'1',indexes:['1','2','3']});
	var deletionCalls = oldDelete.rt.calls.filter(function(c) {
		return c.object === 'qmodem' && c.method === 'delete_sms';
	});
	assertEq('旧版多段短信只产生一次删除调用', deletionCalls.length, 1);
	assertEq('旧版短信删除索引按官方要求降序传入字符串', deletionCalls[0].params.index, '3 2 1');
	assertEq('模组动态配置节传递正确', deletionCalls[0].params.config_section, '8_1');
	assertEq('多段删除即使返回成功也重新读取核对', oldDelete.rt.countCalls('qmodem','get_sms'), 1);
	await oldDelete.controls.deleteSmsMessage('8_1', {source:'modem',index:'0',indexes:['0']});
	var deleteZero = oldDelete.rt.calls.filter(function(c) {
		return c.object === 'qmodem' && c.method === 'delete_sms';
	})[1];
	assertEq('模组短信槽位 0 有效', deleteZero.params.index, '0');
	var partial = runtime();
	partial.rt.setModemSmsApi(function() { return { sms: { msg: [{ index: 2, sender: '10010' }] } }; });
	await rejects('多段中有一段仍存在不能误报删除成功', partial.controls.deleteSmsMessage('8_1',
		{source:'modem',index:'1',indexes:['1','2','3']}), /仍返回/);
	var noStatus = runtime();
	noStatus.rt.setDeleteResult({ result: {} });
	noStatus.rt.setModemSmsApi(function() { return { sms: { msg: [] } }; });
	await noStatus.controls.deleteSmsMessage('8_1', {source:'modem',index:'7',indexes:['7']});
	assertEq('无确认状态时重新读取模组核对删除', noStatus.rt.countCalls('qmodem','get_sms'), 1);
	var stillThere = runtime();
	stillThere.rt.setDeleteResult({ result: {} });
	stillThere.rt.setModemSmsApi(function() { return { sms: { msg: [{ index: '7', sender: '10010' }] } }; });
	await rejects('无确认状态且短信仍存在不能误报成功', stillThere.controls.deleteSmsMessage('8_1',
		{source:'modem',index:'7',indexes:['7']}), /仍返回/);
	var reportedSuccess = runtime();
	reportedSuccess.rt.setDeleteResult({ result: { status: '1' } });
	reportedSuccess.rt.setModemSmsApi(function() { return { sms: { msg: [{ index: '7', sender: '10010' }] } }; });
	await rejects('旧脚本单条返回成功但模组仍有短信时不能隐藏消息', reportedSuccess.controls.deleteSmsMessage('8_1',
		{source:'modem',index:'7',indexes:['7']}), /仍返回/);
	assertEq('单条状态成功仍回读模组核对', reportedSuccess.rt.countCalls('qmodem','get_sms'), 1);
	var rejected = runtime();
	rejected.rt.setDeleteResult({ result: { status: '0' } });
	await rejects('官方明确拒绝删除时如实报错', rejected.controls.deleteSmsMessage('8_1',
		{source:'modem',index:'7',indexes:['7']}), /拒绝/);
	await rejects('非法索引直接拒绝删除', oldDelete.controls.deleteSmsMessage('8_1',
		{source:'modem',index:'-5',indexes:[]}), /索引/);
	assertEq('非法索引不会触发额外删除请求', oldDelete.rt.calls.filter(function(c) {
		return c.object === 'qmodem' && c.method === 'delete_sms';
	}).length, 2);

	var legacy = runtime();
	assertEq('旧版没有短信服务时回退模组存储', (await legacy.controls.getSmsInbox('6_1'))._smsSource, 'modem');
	await legacy.controls.getSmsInbox('6_1');
	assertEq('服务缺失在冷却期间不反复探测', legacy.rt.countCalls('qmodem.sms','config_get'), 1);
	/* 西瓜皮等旧版 QModem 的 LuCI 25.12 返回 -32000，不是旧的 ubus code 4。 */
	var noObject = runtime(function() { return {__rpcError:'RPC call to qmodem.sms/config_get failed with error -32000: Object not found at ClassConstructor.handleCallReply'}; });
	assertEq('LuCI -32000 对象缺失自动回退旧版短信', (await noObject.controls.getSmsInbox('6_1'))._smsSource, 'modem');
	await noObject.controls.getSmsInbox('6_1');
	assertEq('LuCI -32000 缺失期间不会反复探测', noObject.rt.countCalls('qmodem.sms','config_get'), 1);
	var noMethod = runtime(function() { return {__rpcError:'RPC call to qmodem.sms/config_get failed with error -32601: Method not found'}; });
	assertEq('缺少新版短信方法时也回退旧版', (await noMethod.controls.getSmsInbox('6_1'))._smsSource, 'modem');
	var rpcDenied = runtime(function() { return {__rpcError:'RPC call to qmodem.sms/config_get failed with error -32000: Access denied'}; });
	await rejects('LuCI -32000 非缺失类错误不得误回退', rpcDenied.controls.getSmsInbox('6_1'), /Access denied/);
	assertEq('权限故障不会触发旧版短信读取', rpcDenied.rt.countCalls('qmodem','get_sms'), 0);
	/* 西瓜皮实机：get_sms 直读模组存储。 */
	var directRead = runtime();
	directRead.rt.setModemSmsApi(function() {
		return { msg: [{ index:0, sender:'10010', content:'西瓜皮真实接口短信' }] };
	});
	var legacyReply = await directRead.controls.getSmsInbox('8_1');
	assertEq('旧版直读返回模组短信', legacyReply.msg[0].content, '西瓜皮真实接口短信');
	var legacyCall = directRead.rt.calls.filter(function(c) { return c.object === 'qmodem' && c.method === 'get_sms'; });
	assertEq('旧版读取携带动态模组配置节', legacyCall[0].params.config_section, '8_1');
	await directRead.controls.getSmsInbox('8_1');
	assertEq('30 秒内不重复访问 AT 短信串口', directRead.rt.countCalls('qmodem','get_sms'), 1);

	var oldError = runtime();
	oldError.rt.setModemSmsApi(function() { return {__rpcError:'old sms port failed'}; });
	await rejects('旧版接口读取失败会正确显示错误', oldError.controls.getSmsInbox('8_1'), /old sms port failed/);
	await rejects('后台失败限流期间继续给出明确错误', oldError.controls.getSmsInbox('8_1'), /稍后自动重试|old sms port failed/);
	assertEq('失败后 30 秒内不重试串口', oldError.rt.countCalls('qmodem','get_sms'), 1);

	var direct = runtime(function() { return {mode:'direct'}; });
	assertEq('direct 模式继续直读模组存储', (await direct.controls.getSmsInbox('6_1'))._smsSource, 'modem');
	assertEq('direct 模式不调用数据库 list', direct.rt.countCalls('qmodem.sms','list'), 0);
	assertEq('direct 模式读取一次模组短信', direct.rt.countCalls('qmodem','get_sms'), 1);

	var empty = runtime(function(method) { return method === 'config_get' ? {mode:'database_urc'} : {messages:[]}; });
	assertEq('数据库为空仍保留正确数据源', (await empty.controls.getSmsInbox('6_1'))._smsSource, 'database');
	var denied2 = runtime(function() { return {__rpcError:'RPC call failed with ubus code 6: Permission denied'}; });
	await rejects('权限失败如实显示，不伪装为无短信', denied2.controls.getSmsInbox('6_1'), /Permission denied/);
	assertEq('权限失败不切换到旧接口', denied2.rt.countCalls('qmodem','get_sms'), 0);
	var broken = runtime(function(method) { return method === 'config_get' ? {mode:'database_poll'} : {status:'error',error:'database unavailable'}; });
	await rejects('数据库读取故障保留原错误', broken.controls.getSmsInbox('6_1'), /database unavailable/);
	await rejects('发送故障保留原错误', broken.controls.sendSmsInbox('6_1','10010','测试','database'), /database unavailable/);
	assertEq('失败的数据库发送不会切换接口重发', broken.rt.countCalls('qmodem','send_sms'), 0);
	var invalid = runtime(function(method) { return method === 'config_get' ? {mode:'database_poll'} : {}; });
	await rejects('无效列表不能当成空收件箱', invalid.controls.getSmsInbox('6_1'), /消息列表/);
	await rejects('缺少成功状态不能当成发送成功', invalid.controls.sendSmsInbox('6_1','10010','测试','database'), /未确认操作成功/);

	var paged = runtime(function(method,p) {
		if (method === 'config_get') return {mode:'database_poll'};
		return {messages:p.offset === 0 ? Array.from({length:500},function(_,i) { return {id:i+1,type:'received'}; }) : [{id:500},{id:501}]};
	});
	var all = await paged.controls.getSmsInbox('6_1');
	assertEq('超过一页的短信继续读取并去重', all.messages.length, 501);
	assertEq('短信分页传递 offset', paged.rt.calls.filter(function(c) { return c.method === 'list'; })[1].params.offset, 500);
	var acl = JSON.parse(fs.readFileSync(path.join(ROOT,'root/usr/share/rpcd/acl.d/luci-app-qmodem-generic.json'),'utf8'))['luci-app-qmodem-generic'];
	ok('短信数据库读权限齐全', ['status','config_get','sync_status','list','get','modem_list','storage_get'].every(function(m) { return acl.read.ubus['qmodem.sms'].includes(m); }));
	ok('短信数据库写权限齐全', ['configure','sync','send','delete','mark_read','modem_delete','storage_set'].every(function(m) { return acl.write.ubus['qmodem.sms'].includes(m); }));
	ok('上联与统计/支持库权限齐全', !!acl.read.ubus['qmodem.uplink'] && !!acl.read.ubus['qmodem_stats'] && !!acl.read.ubus['qmodem_support']);
}

function testNoSlowPathDeclared(rt, controls) {
	console.log('\n[5] 慢对象方法都带 nobatch（不会被拖进批量 POST）');
	var src = fs.readFileSync(path.join(RES, 'qmodem-generic/controls.js'), 'utf8');
	var decls = src.match(/rpc\.declare\(\{[^\n]*\}\);/g) || [];
	var withNobatch = decls.filter(function(d) { return /nobatch:\s*true/.test(d); });
	ok('所有 rpc.declare 都声明了 nobatch (' + withNobatch.length + '/' + decls.length + ')',
	   decls.length > 0 && withNobatch.length === decls.length,
	   withNobatch.length + '/' + decls.length);
}

function testLiveView(rt, controls) {
	console.log('\n[6] liveView：不堆叠轮询、隐藏时降频、离开页面停止');
	rt.resetCalls();

	var paints = 0, collects = 0;
	var view1 = {
		section: 'modem1',
		renderInto: function(res) { paints++; return new rt.El('div'); }
	};

	var node1 = controls.liveView(view1, { section: 'modem1' }, {
		interval: 120,
		paint: function(res) { return view1.renderInto(res); },
		collect: function(ctx) { collects++; return { section: ctx.section }; }
	});
	ok('liveView 立即返回可挂载的节点（不等待任何后台数据）', !!node1 && !!node1.appendChild);

	return new Promise(function(resolve) { setTimeout(resolve, 700); }).then(function() {
		ok('轮询确实在跑 (collect 次数=' + collects + ')', collects >= 2, collects);
		ok('首屏已绘制 (paints=' + paints + ')', paints >= 1, paints);

		/* 非重叠：collect 比间隔慢得多时，轮询次数必须远小于线性外推 */
		var slowCollects = 0;
		var view2 = { section: 'modem1', renderInto: function() { return new rt.El('div'); } };
		controls.liveView(view2, { section: 'modem1' }, {
			interval: 60,
			paint: function(res) { return new rt.El('div'); },
			collect: function(ctx) {
				slowCollects++;
				return new Promise(function(r) {
					setTimeout(function() { r({ section: ctx.section }); }, 300);
				});
			}
		});

		return new Promise(function(resolve) { setTimeout(resolve, 1000); }).then(function() {
			ok('慢 collect 不会堆叠 (1000ms 内 ' + slowCollects + ' 次，线性外推应为 16 次)',
			   slowCollects <= 4, slowCollects);

			/* 页面卸载：所有活跃轮询器一起停（含后开的第二个视图） */
			(rt.listeners['pagehide'] || []).forEach(function(fn) { fn({}); });

			/* 先等在途的那一轮跑完，再取基线，避免把 in-flight 的回调算成新一轮 */
			return new Promise(function(resolve) { setTimeout(resolve, 400); }).then(function() {
				var before = collects, before2 = slowCollects;
				return new Promise(function(resolve) { setTimeout(resolve, 500); }).then(function() {
					assertEq('pagehide 后第一个视图不再轮询', collects, before);
					assertEq('pagehide 后第二个视图也停止（不再泄漏）', slowCollects, before2);
				});
			});
		});
	});
}

function testViews(rt) {
	console.log('\n[7] 视图模块：load() 快速完成并解析配置节');
	rt.setUbusDelay(60);

	var controls = loadControls(rt);
	var views = [ 'status', 'connection', 'network', 'system', 'sms', 'advanced', 'terminal', 'settings' ];

	return views.reduce(function(chain, name) {
		return chain.then(function() {
			var mod = rt.loadModule('view/qmodem-generic/' + name + '.js',
				{ 'luci/qmodem-generic/controls': controls });
			if (typeof mod.load !== 'function') {
				ok(name + '.js 有 load()', false);
				return;
			}
			rt.resetCalls();
			var t0 = Date.now();
			return Promise.resolve(mod.load.call(mod)).then(function(res) {
				var elapsed = Date.now() - t0;
				assertLt(name + '.load() 首屏耗时', elapsed, 1500);
				if (name === 'sms')
					ok('sms.load() 的模组调用仅为读取类且短信至多读一次', rt.calls.filter(function(c) {
						return c.object === 'qmodem';
					}).every(function(c) { return /^(get_sms|sim_info|get_at_cfg)$/.test(c.method); }) &&
					rt.countCalls('qmodem', 'get_sms') <= 1);
				assertEq(name + '.load() 未调用已删除的 qos 对象', rt.countCalls('qos'), 0);
				assertEq(name + '.load() 未调用 luci-rpc', rt.countCalls('luci-rpc'), 0);
				ok(name + '.load() 解析出 section', !!res && res.section === 'modem1',
				   res && res.section);
			}).catch(function(err) {
				ok(name + '.load() 未抛异常', false, (err && err.message) || String(err));
			});
		});
	}, Promise.resolve());
}

/* 签约速率与 QCI/5QI 展示：验证官方 AMBR kbps → 前端 'N M/G/Kbps'，未知 → '--' */
function testQosDisplay(rt, controls) {
	console.log('\n[7.5] 签约速率 / QoS 等级前端格式化');
	function freshStatus(controls) {
		return rt.loadModule('view/qmodem-generic/status.js',
			{ 'luci/qmodem-generic/controls': controls });
	}
	/* formatRate 把 kbps 折成 G/M/Kbps */
	var rateCases = [
		[102400, '100 Mbps'],
		[51200, '50 Mbps'],
		[102400000, '97.66 Gbps'],
		[0, '--'],
		[null, '--'],
		['abc', '--']
	];
	rateCases.forEach(function(c) {
		var got = controls.formatRate(c[0]);
		ok('formatRate(' + (c[0] === null ? 'null' : c[0]) + ')', got === c[1], got);
	});

	var mod = freshStatus(controls);
	/* LTE：只看 QCI */
	var lte = mod.qosExplain({ qci: 9, five_qi: null });
	ok('LTE 显示 QCI 9', lte.label === 'QCI 9', lte.label);
	/* 5G：只看 5QI */
	var nr = mod.qosExplain({ qci: null, five_qi: 9 });
	ok('5G 显示 5QI 9', nr.label === '5QI 9', nr.label);
	/* 两侧同时存在：分别列出，不互相覆盖 */
	var both = mod.qosExplain({ qci: 9, five_qi: 9 });
	ok('QCI/5QI 同时存在时不覆盖', both.label.indexOf('QCI 9') >= 0 && both.label.indexOf('5QI 9') >= 0, both.label);
	/* 未知：label 为空 → 卡片回退 '--'，绝不显示 'QCI 0' */
	var none = mod.qosExplain({ qci: null, five_qi: null });
	ok('未知时 label 为空（不显示 QCI 0）', none.label === '', none.label);
	var bothKnownNull = mod.qosExplain({ qci: 0, five_qi: 0 });
	ok('0 视为未知（不显示成等级）', bothKnownNull.label === '', bothKnownNull.label);

	/* 签约速率：有数据格式化，只有下行、只有上行、都无 */
	var subOk = mod.subscriptionRate({ downlink_rate_kbps: 102400, uplink_rate_kbps: 51200 });
	ok('签约速率 混合文本', subOk === '下行 100 Mbps / 上行 50 Mbps', subOk);
	var subNone = mod.subscriptionRate({ downlink_rate_kbps: null, uplink_rate_kbps: null });
	ok('无签约速率 → null（前端走双横线）', subNone == null, subNone);
	var subDownOnly = mod.subscriptionRate({ downlink_rate_kbps: 102400, uplink_rate_kbps: null });
	ok('只有下行时上行显示双横线', subDownOnly === '下行 100 Mbps / 上行 --', subDownOnly);

	rt.resetCalls();
	return Promise.resolve();
}

function testOptionalData() {
	console.log('\n[7.6] 不同品牌的空值、零值与字段别名');
	var rt = makeRuntime(), controls = loadControls(rt);
	[null, undefined, '', '  ', '--', 'N/A', 'null', 'undefined', 'unknown', NaN, [], {}].forEach(function(value) {
		ok('空值不展示 ' + String(value), !controls.hasValue(value));
	});
	[0, '0', false, 'No', -11.5, '8986012345'].forEach(function(value) {
		ok('有效上报保留 ' + String(value), controls.hasValue(value));
	});
	assertEq('缺失字段不生成数据行', controls.dataRow('QoS', null), null);
	ok('零值生成数据行', !!controls.dataRow('PCI', 0));
	ok('false 生成数据行', !!controls.dataRow('running', false));
	var node = controls.element('div', {}, [null, undefined, [controls.element('b', {}, 'ok'), null], 0]);
	assertEq('条件节点展开并过滤 null/undefined，保留 0', node.children.length, 2);
	var entries = [{key:'model', value:'FM350-GL'}, {key:'sim_status', value:'READY'}, {key:'ICCID', value:'N/A'},
		{key:'iccid', value:'8986012345'}, {key:'sinr', value:0}, {key:'PCI', value:0}];
	assertEq('型号别名', controls.findEntry(entries, 'name'), 'FM350-GL');
	assertEq('SIM 状态别名', controls.entryMap(entries)['SIM Status'], 'READY');
	assertEq('空字段允许回退到有效的大小写别名', controls.findEntry(entries, 'ICCID'), '8986012345');
	assertEq('数值 SINR 0 不丢失', controls.findEntry(entries, 'SINR'), 0);
	assertEq('PCI 别名与 0', controls.findEntry(entries, 'Physical Cell ID'), 0);
	assertEq('数字 MNC 1 补齐中国运营商编码', controls.operatorInfo(null, 460, 1).name, '中国联通');
	assertEq('数字 MNC 0 不丢失', controls.operatorInfo(null, 460, 0).name, '中国移动');
	assertEq('空信息组不显示卡片', controls.renderInfoGrouped([{key:'QCI',value:'N/A'}]).length, 0);
	assertEq('没有凭空增加网络能力', controls.flagKeys({rndis:'1',error:'timeout'}).join(','), 'rndis');
	ok('识别原生布尔能力', controls.isEnabled(true));
	ok('FM350 不展示华为私有 AT 设置', !controls.supportsTdTechAt('modem1', entries));
	ok('MT5700 保留专有设置', controls.supportsTdTechAt('modem1', [{key:'name',value:'MT5700M-CN'}]));
	var status = rt.loadModule('view/qmodem-generic/status.js', {'luci/qmodem-generic/controls':controls});
	assertEq('概览解析保留 SINR 0', status.parseStatus({cell:entries}).sinr, '0');
	assertEq('概览缺失字段隐藏', status.infoRow('签约速率', '--'), null);

	/* QModem 官方支持库的部分型号（例如 FM350-GL）不提供频段；
	 * 这些空值必须隐藏，而不是在详情下方生成 nullnull... */
	function allNodes(root) {
		if (!root || typeof root !== 'object') return [];
		var arr = [root], children = root.children || [];
		children.forEach(function(child) { arr = arr.concat(allNodes(child)); });
		return arr;
	}
	var adv = rt.loadModule('view/qmodem-generic/advanced.js', {'luci/qmodem-generic/controls':controls});
	var readOnly = adv.supportCard({path:'/usr/share/qmodem/modem_support.json'}, {
		presets:{pcie:{'fm350-gl':{
			manufacturer:'fibocom',platform:'mediatek',modes:['mbim'],pdp_index:'0',
			wcdma_band:null,lte_band:'nullnullnullnull',nsa_band:undefined,sa_band:'0'
		}}}
	});
	var selector = allNodes(readOnly).filter(function(el) {
		return el.tagName === 'SELECT';
	})[0];
	ok('QModem 官方库只读型号可查看', !!selector && !!selector.fire);
	selector.value = '0';
	selector.fire('change');
	var nodes = allNodes(readOnly);
	var details = nodes.map(function(el) { return el.text || ''; }).join(' ');
	ok('空频段及 nullnullnullnull 不生成节点', details.indexOf('nullnullnullnull') === -1
		&& details.indexOf('WCDMA 频段') === -1 && details.indexOf('SA 频段') === -1);
	ok('PDP 0 和已知厂商正常显示', details.indexOf('fibocom') >= 0 && details.indexOf('0') >= 0);
	ok('官方库没有任何修改按钮', !nodes.some(function(el) { return el.tagName === 'BUTTON'; }));

	var network = rt.loadModule('view/qmodem-generic/network.js', {'luci/qmodem-generic/controls':controls});
	assertEq('无线页缺失字段隐藏', network.row('RSRQ', 'N/A'), null);
	assertEq('无线页缺失仪表隐藏', network.metricGauge('RSRQ', 'rsrq', null, 'dB'), null);
	var system = rt.loadModule('view/qmodem-generic/system.js', {'luci/qmodem-generic/controls':controls});
	assertEq('SIM 页缺失字段隐藏', system.row('ICCID', ''), null);
}

function testAdvancedNonblocking() {
	console.log('\n[7.7] 高级页首次打开不等待完整支持库');
	var rt = makeRuntime(), controls = loadControls(rt), resolveCustom;
	controls.getCustomModels = function() {
		return new Promise(function(resolve) { resolveCustom = resolve; });
	};
	var adv = rt.loadModule('view/qmodem-generic/advanced.js',
		{'luci/qmodem-generic/controls':controls});
	return Promise.race([
		adv.load().then(function(res) { return !!(res && res.section); }),
		new Promise(function(resolve) { setTimeout(function() { resolve(false); }, 2000); })
	]).then(function(fast) {
		ok('完整自定义库请求挂起时高级页仍可先显示', fast);
		resolveCustom({entries: [],presets:{}});
		return adv.initialAuxPromise.then(function() {
			ok('异步支持库最终补充缓存', !!adv.auxData && !!adv.auxData.custom);
		});
	});
}

function testRender(rt) {
	console.log('\n[8] 视图渲染：模组失联（RPC 全部失败）也不能抛异常（白屏）');
	rt.setUbusDelay(5);

	var controls = loadControls(rt);
	var views = [ 'status', 'connection', 'network', 'system', 'sms', 'advanced', 'terminal' ];

	return views.reduce(function(chain, name) {
		return chain.then(function() {
			var mod = rt.loadModule('view/qmodem-generic/' + name + '.js',
				{ 'luci/qmodem-generic/controls': controls });
			return Promise.resolve(mod.load.call(mod)).then(function(res) {
				var node = null, err = null;
				try {
					node = mod.render.call(mod, res);
				} catch (e) {
					err = e;
				}
				ok(name + '.render() 未抛异常（不会白屏）', !err, err && (err.stack || err.message));
				ok(name + '.render() 返回了可挂载节点', !!node && typeof node.appendChild === 'function');
			}).then(function() {
				/* 模组完全失联（所有 qmodem 调用失败）时同样必须能渲染 */
				rt.setFailAll(true);
				var mod2 = rt.loadModule('view/qmodem-generic/' + name + '.js',
					{ 'luci/qmodem-generic/controls': controls });
				return Promise.resolve(mod2.load.call(mod2)).then(function(res) {
					var err = null;
					try { mod2.render.call(mod2, res); } catch (e) { err = e; }
					ok(name + ' 在模组失联（RPC 全失败）时仍能渲染', !err, err && (err.stack || err.message));
				});
			}).catch(function(e) {
				rt.setFailAll(false);
				ok(name + ' 渲染链路无未捕获异常', false, (e && e.stack) || String(e));
			}).then(function() { rt.setFailAll(false); });
		});
	}, Promise.resolve());
}

/* ------------------------------------------------------------------ main */

/* 保险丝：整套用例必须在 60 秒内跑完，否则按失败退出（避免 CI 挂死） */
var watchdog = setTimeout(function() {
	console.log('\nFRONTEND TESTS TIMED OUT (60s)');
	process.exit(1);
}, 60000);

var rt = makeRuntime();

testLegacyUciCommit().then(function() { return testBootstrap(rt); })
	.then(function(controls) { return testActions(rt, controls); })
	.then(testActionPayloads)
	.then(testDialResults)
	.then(testFailurePayloads)
	.then(testImeiReadback)
	.then(testSmsSources)
	.then(testSmsCountryCode)
	.then(function() { testNoSlowPathDeclared(rt); return testLiveView(rt, loadControls(rt)); })
	.then(function() { return testViews(makeRuntime()); })
	.then(function() { return testQosDisplay(makeRuntime(), loadControls(makeRuntime())); })
	.then(testOptionalData)
	.then(testAdvancedNonblocking)
	.then(function() { return testRender(makeRuntime()); })
	.then(function() {
		console.log('\n----------------------------------------');
		console.log('passed: ' + passed + '   failed: ' + failed);
		clearTimeout(watchdog);
		if (failed) { console.log('FRONTEND TESTS FAILED'); process.exit(1); }
		console.log('ALL FRONTEND TESTS PASSED');
		/* 停掉用例里启动的所有轮询器，让事件循环自然收尾 */
		process.exit(0);
	})
	.catch(function(err) {
		console.log('\n----------------------------------------');
		console.log('passed: ' + passed + '   failed: ' + failed + ' (+1 harness error)');
		console.log('harness error: ' + ((err && err.stack) || err));
		clearTimeout(watchdog);
		process.exit(1);
	});
