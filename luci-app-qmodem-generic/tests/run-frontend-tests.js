/*
 * QModem Generic — LuCI 前端异步链路测试
 *
 * 用最小化的 luci 运行时替身加载真实的 controls.js 与视图模块，
 * 验证「首屏只读缓存、写操作走任务、轮询不堆叠」确实成立。
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
	var tasks = {};            /* task_id -> {op,state,...} */
	var taskSeq = 0;
	var ubusDelayMs = 0;       /* 模拟 qmodem 对象（AT 驱动）的慢速 */
	var cacheDelayMs = 0;

	var NOW = Math.floor(Date.now() / 1000);

	/* 与 /usr/libexec/rpcd/qmodem_cache 的 snapshot 输出完全一致：
	 * { config_section, now, domains: { <domain>: {status,updated,stale,ttl,error,data} } } */
	var cacheEmpty = false;
	var cacheDomains = {
		status: {
			status: 'ok', updated: NOW, stale: false, ttl: 30, error: '',
			data: {
				base_info: [ { key: 'model', value: 'RM520N-GL' },
					     { key: 'at_port', value: '/dev/ttyUSB2' },
					     { key: 'imei', value: '860000000000001' } ],
				device: { dev: 'wwan0', mtu: 1500, up: true },
				ifaces: { names: [ 'wan_modem1' ],
					  entries: { wan_modem1: { l3_device: 'wwan0', up: true } } },
				connect_status: { connected: true }
			}
		},
		network: {
			status: 'ok', updated: NOW, stale: false, ttl: 60, error: '',
			data: { mode: { mode: 'manual' },
				lockband: { '4G': [ { band_id: 3, band_name: 'B3' } ] } }
		},
		signal: { status: 'missing', updated: 0, stale: true, ttl: 0, error: '', data: {} },
		sim: {
			status: 'ok', updated: NOW, stale: false, ttl: 300, error: '',
			data: { sim_info: [ { key: 'imsi', value: '460010000000001' } ],
				imei: { imei: '860000000000001' } }
		},
		device: {
			status: 'ok', updated: NOW, stale: false, ttl: 300, error: '',
			data: { at_cfg: { at_cfg: { at_port: '/dev/ttyUSB2', ports: [ '/dev/ttyUSB2' ] } } }
		},
		stats: {
			status: 'ok', updated: NOW, stale: false, ttl: 60, error: '',
			data: { usage: { rx: 1024, tx: 2048 }, daily: [ { date: '2026-09-27', rx: 10, tx: 20 } ] }
		},
		support: {
			status: 'ok', updated: NOW, stale: false, ttl: 3600, error: '',
			data: { available: 42, path: '/usr/share/qmodem/modem_support.json',
				added: [], skipped: [], missing: [], error: null }
		}
	};

	function buildSnapshot(section, domains) {
		var out = { config_section: section, now: Math.floor(Date.now() / 1000), domains: {} };
		if (cacheEmpty) return out;      /* 模拟模组离线 / 缓存尚未建立 */
		var want = (domains && domains.length) ? domains : Object.keys(cacheDomains);
		for (var i = 0; i < want.length; i++) {
			var d = want[i];
			out.domains[d] = cacheDomains[d] || {
				status: 'missing', updated: 0, stale: true, ttl: 0, error: '', data: {}
			};
		}
		return out;
	}

	function delay(ms) {
		return new Promise(function(res) { setTimeout(res, ms); });
	}

	/* rpc.declare 的替身：只支持测试用到的形态 */
	function declare(def) {
		var object = def.object, method = def.method;
		var expect = def.expect || {};
		var expectSingle = expect.single === true;
		var expectKey = null, expectVal;
		Object.keys(expect).forEach(function(k) { if (k !== 'single') { expectKey = k; expectVal = expect[k]; } });

		/* 真实 LuCI 的 declare 会把位置参数按 params 数组映射成命名参数 */
		var names = def.params || [];
		return function() {
			var args = Array.prototype.slice.call(arguments);
			var p = {};
			for (var i = 0; i < names.length; i++)
				if (args[i] !== undefined) p[names[i]] = args[i];
			calls.push({ object: object, method: method, params: p, t: Date.now() });

			var body;
			if (object === 'qmodem_cache' || object === 'qmodem_stats' || object === 'qmodem_support') {
				body = handleCache(method, p);
			} else if (object === 'qmodem' || object === 'qos' ||
				   object === 'luci-rpc' || object === 'system' || object === 'network') {
				/* 这些方法都代表「会摸 modem / 起子进程」的慢路径，测试里必须为 0 次 */
				body = { __slow__: true };
			} else {
				body = {};
			}

			return Promise.resolve().then(function() {
				var d = (object === 'qmodem_cache' || object === 'qmodem_stats' ||
					 object === 'qmodem_support') ? cacheDelayMs : ubusDelayMs;
				return d ? delay(d) : null;
			}).then(function() {
				if (expectKey && body && body[expectKey] === undefined) {
					var wrapped = {};
					wrapped[expectKey] = expectVal;
					return expectSingle ? wrapped : [wrapped];
				}
				if (expectSingle && body && Array.isArray(body[expectKey])) {
					var out = {};
					out[expectKey] = body[expectKey];
					return out;
				}
				return body;
			});
		};
	}

	function handleCache(method, p) {
		if (method === 'snapshot')
			return buildSnapshot((p && p.config_section) || 'modem1', p && p.domains);

		if (method === 'stats_reset') {
			var sid = 'task-' + (++taskSeq);
			tasks[sid] = {
				task_id: sid, config_section: (p && p.config_section) || 'modem1',
				operation: 'stats_reset', state: 'running', progress: 0,
				started: Date.now(), result: null, error: null, _polls: 0
			};
			return { task_id: sid, state: 'running', deduplicated: false };
		}

		if (method === 'status')
			return buildSnapshot('modem1', [ 'support' ]).domains.support.data;

		if (method === 'refresh' || method === 'refresh_all')
			return { queued: (p && p.domains) || [], running: 0 };

		if (method === 'action' || method === 'send_at') {
			var id = 'task-' + (++taskSeq);
			tasks[id] = {
				task_id: id,
				config_section: (p && p.config_section) || 'modem1',
				operation: (method === 'send_at') ? 'send_at' : ((p && p.method) || ''),
				state: 'running',
				progress: 0,
				started: Date.now(),
				result: null,
				error: null,
				_polls: 0
			};
			return { task_id: id, state: 'running', deduplicated: false };
		}

		if (method === 'get_task') {
			var t = tasks[p && p.task_id];
			if (!t) return { task_id: (p && p.task_id), state: 'missing' };
			/* 第 3 次轮询完成：模拟 worker 真实处理耗时 */
			t._polls++;
			if (t._polls >= 3) {
				t.state = 'success';
				t.progress = 100;
				if (t.operation === 'send_at')
					t.result = { response: 'AT+CGMI\r\nQuectel\r\n\r\nOK', result: 'success', ret: 0 };
				else if (t.operation === 'stats_reset')
					t.result = { success: true, reset: true };
				else if (t.operation === 'support_sync')
					t.result = { available: 42, added: 1, skipped: 0, missing: 0, error: null };
				else
					t.result = { success: true };
			}
			return t;
		}

		return { success: true };
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
	El.prototype.addEventListener = function() {};
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

	function loadModule(relPath, extraModules) {
		var src = fs.readFileSync(path.join(RES, relPath), 'utf8');
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

		var fn = new Function(
			'require', 'L', 'window', 'document', 'E', '_',
			'baseclass', 'view', 'rpc', 'uci', 'ui', 'dom', 'fs', 'poll',
			'form', 'widgets', 'validation', 'request', 'session', 'xhr', 'controls',
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
			form, widgets, validation, request, session, xhr, controlsModule);
	}

	return {
		loadModule: loadModule,
		calls: calls,
		tasks: tasks,
		notifications: notifications,
		document: documentStub,
		listeners: listeners,
		El: El,
		setUbusDelay: function(ms) { ubusDelayMs = ms; },
		setCacheDelay: function(ms) { cacheDelayMs = ms; },
		setSnapshot: function(s) { snapshot = s; },
		setSnapshotEmpty: function() { cacheEmpty = true; },
		setSnapshotFull: function() { cacheEmpty = false; },
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

function testBootstrap(rt) {
	console.log('\n[1] bootstrap：首屏只读缓存，不等 modem');
	var controls = loadControls(rt);
	rt.setUbusDelay(8000);       /* qmodem/qos 等慢对象：一旦被调用测试就会超时 */
	rt.setCacheDelay(5);
	rt.resetCalls();

	var t0 = Date.now();
	return controls.bootstrap([ 'status', 'network', 'signal', 'sim', 'device' ]).then(function(ctx) {
		var elapsed = Date.now() - t0;

		assertLt('bootstrap 完成耗时', elapsed, 1500);
		assertEq('解析出配置节', ctx.section, 'modem1');
		assertEq('qmodem_cache.snapshot 调用次数', rt.countCalls('qmodem_cache', 'snapshot'), 1);
		assertEq('未调用任何 qmodem 对象方法（AT 驱动）', rt.countCalls('qmodem'), 0);
		assertEq('未调用 qos 对象方法', rt.countCalls('qos'), 0);
		assertEq('未调用 luci-rpc 对象方法', rt.countCalls('luci-rpc'), 0);
		assertEq('未调用 system 对象方法', rt.countCalls('system'), 0);
		assertEq('未调用 network 对象方法', rt.countCalls('network'), 0);

		console.log('\n[2] 缓存读取器：零 RPC');
		rt.resetCalls();
		var t1 = Date.now();
		return Promise.all([
			controls.getBaseInfo(ctx.section),
			controls.getMode(ctx.section),
			controls.getSimInfo(ctx.section),
			controls.getAtCfg(ctx.section),
			controls.getDeviceStatusCached(ctx.section)
		]).then(function(vals) {
			var base = vals[0], mode = vals[1], sim = vals[2], at = vals[3], dev = vals[4];
			var elapsed2 = Date.now() - t1;

			assertLt('5 个读取器总耗时', elapsed2, 50);
			assertEq('读取器未产生任何额外 RPC（共用 bootstrap 的快照）',
				   rt.countCalls('qmodem_cache') + rt.countCalls('qmodem'), 0);
			assertEq('base_info 直接返回数组（向后兼容）', Array.isArray(base), true);
			assertEq('base_info 内容来自缓存', controls.findEntry(base, 'model'), 'RM520N-GL');
			assertEq('findEntry 兼容对象数组', controls.findEntry(sim, 'imsi'), '460010000000001');
			assertEq('getMode 解包正常', mode && mode.mode, 'manual');
			assertEq('getAtCfg 保留 at_cfg 包装', !!(at && at.at_cfg), true);
			assertEq('设备状态从缓存读出 netdev', dev && dev.dev, 'wwan0');

			console.log('\n[3] 缓存缺失时降级为默认值，不阻塞');
			return controls.getCellInfo(ctx.section).then(function(cell) {
				assertEq('缺失的 signal 域降级为空数组（不阻塞、不报错）', JSON.stringify(cell), '[]');
				assertEq('缺失域会后台排队补采（而不是同步去查 modem）',
					   rt.countCalls('qmodem_cache', 'refresh') >= 1, true);
				assertEq('补采没有触发任何 qmodem 对象调用', rt.countCalls('qmodem'), 0);
				return controls;
			});
		});
	});
}

function testActions(rt, controls) {
	console.log('\n[4] 写操作走任务队列，不同步打 modem');
	rt.setUbusDelay(8000);
	rt.setCacheDelay(2);
	rt.resetCalls();

	return controls.sendAt('modem1', '', 'AT+CGMI').then(function(res) {
		assertEq('send_at 未直接调用 qmodem.send_at', rt.countCalls('qmodem', 'send_at'), 0);
		ok('send_at 走了 qmodem_cache.send_at（AT 通道由后端串行化）',
		   rt.countCalls('qmodem_cache', 'send_at') >= 1);
		ok('send_at 轮询了 get_task', rt.countCalls('qmodem_cache', 'get_task') >= 1);
		assertEq('任务结果带回 AT 响应', res.response.indexOf('OK') >= 0, true);

		rt.resetCalls();
		return controls.statsReset('modem1').then(function(r2) {
			assertEq('stats_reset 未直接调用 qmodem.stats_reset', rt.countCalls('qmodem', 'stats_reset'), 0);
			assertEq('stats_reset 返回 success', !!(r2 && r2.success), true);
			/* statsReset 会 touch(section) + 清空刷新去重窗口：
			 * 下一次读取必须重新拉快照，而不是继续用清零前的旧数据 */
			var snapsBefore = rt.countCalls('qmodem_cache', 'snapshot');
			return controls.getUsageStats('modem1').then(function() {
				assertEq('stats_reset 后缓存被作废，读取会重新拉快照',
					   rt.countCalls('qmodem_cache', 'snapshot') > snapsBefore, true);
			});

			rt.resetCalls();
			return controls.doReboot('modem1', 'cfun').then(function(r3) {
				assertEq('reboot 未直接调用 qmodem.do_reboot', rt.countCalls('qmodem', 'do_reboot'), 0);
				assertEq('reboot 结果 success', !!(r3 && r3.success), true);
			});
		});
	});
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
	rt.setCacheDelay(1);
	rt.resetCalls();

	var paints = 0, collects = 0;
	var view1 = {
		section: 'modem1',
		renderInto: function(res) { paints++; return new rt.El('div'); }
	};

	var node1 = controls.liveView(view1, { section: 'modem1' }, {
		domains: [ 'status' ],
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
			domains: [ 'status' ],
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
	console.log('\n[7] 视图模块：load() 不碰 modem');
	rt.setUbusDelay(8000);
	rt.setCacheDelay(5);

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
				assertEq(name + '.load() 未调用 qmodem 对象', rt.countCalls('qmodem'), 0);
				assertEq(name + '.load() 未调用 qos 对象', rt.countCalls('qos'), 0);
				assertEq(name + '.load() 未调用 luci-rpc', rt.countCalls('luci-rpc'), 0);
				ok(name + '.load() 解析出 section', !!res && res.section === 'modem1',
				   res && res.section);
			}).catch(function(err) {
				ok(name + '.load() 未抛异常', false, (err && err.message) || String(err));
			});
		});
	}, Promise.resolve());
}

/* 签约速率与 QCI/5QI 展示：验证后端 kbps → 前端 'N M/G/Kbps'，未知 → '--' */
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

function testRender(rt) {
	console.log('\n[8] 视图渲染：首屏数据不全也不能抛异常（白屏）');
	rt.setUbusDelay(8000);
	rt.setCacheDelay(5);

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
				/* 渲染阶段也不允许去摸 modem（骨架里全是缓存值） */
				return node;
			}).then(function() {
				/* 数据完全缺失（modem 死透 / 缓存为空）时同样必须能渲染 */
				rt.setSnapshotEmpty();
				var mod2 = rt.loadModule('view/qmodem-generic/' + name + '.js',
					{ 'luci/qmodem-generic/controls': controls });
				return Promise.resolve(mod2.load.call(mod2)).then(function(res) {
					var err = null;
					try { mod2.render.call(mod2, res); } catch (e) { err = e; }
					rt.setSnapshotFull();
					ok(name + ' 在缓存全空（模组离线）时仍能渲染', !err, err && (err.stack || err.message));
				});
			}).catch(function(e) {
				ok(name + ' 渲染链路无未捕获异常', false, (e && e.stack) || String(e));
			});
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

testBootstrap(rt)
	.then(function(controls) { return testActions(rt, controls); })
	.then(function() { testNoSlowPathDeclared(rt); return testLiveView(rt, loadControls(rt)); })
	.then(function() { return testViews(makeRuntime()); })
	.then(function(rt2) { return testQosDisplay(makeRuntime(), loadControls(makeRuntime())); })
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
