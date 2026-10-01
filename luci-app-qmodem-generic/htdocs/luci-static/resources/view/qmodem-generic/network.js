'use strict';
'require view';
'require ui';
'require dom';
'require form';
'require uci';
'require qmodem-generic.controls as controls';

/*
 * 网络与小区（Radio & Cells）— 现代白色毛玻璃 (Glassmorphism) + 动态 SVG 射频仪表重构
 * 数据源全部来自 QModem 的 `qmodem` ubus 对象（经 qmodem-generic.controls 封装）：
 *    get_mode / get_network_prefer / get_lockband / get_neighborcell /
 *    get_current_band / cell_info / get_disabled_features / get_at_cfg
 * 控制动作：set_mode / set_network_prefer / set_lockband / send_at。
 */

function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

function entriesOf(raw) {
	if (Array.isArray(raw))
		return raw;
	if (raw && Array.isArray(raw.modem_info))
		return raw.modem_info;
	if (raw && Array.isArray(raw.connect_status))
		return raw.connect_status;
	if (raw && typeof raw === 'object')
		return Object.keys(raw).map(function(k) { return { key: k, value: raw[k] }; });
	return [];
}

function ci(obj, names) {
	if (!obj || typeof obj !== 'object')
		return undefined;
	var keys = Object.keys(obj);
	for (var i = 0; i < names.length; i++) {
		var want = String(names[i]).toLowerCase().replace(/[\s_\-]/g, '');
		for (var j = 0; j < keys.length; j++) {
			if (keys[j].toLowerCase().replace(/[\s_\-]/g, '') === want)
				return obj[keys[j]];
		}
	}
	return undefined;
}

function pick(map, names) {
	var v = ci(map, names);
	if (v === undefined || v === null)
		return '';
	if (typeof v === 'object')
		return '';
	return String(v).trim();
}

function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	var inner = ci(raw, [ key ]);
	if (inner && typeof inner === 'object' && !Array.isArray(inner))
		return inner;
	return {};
}

function num(value) {
	if (value === undefined || value === null || value === '')
		return NaN;
	return parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
}

function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

function isNode(v) {
	return v && typeof v === 'object' && (v instanceof HTMLElement || v.nodeType === 1);
}

function disabledSet(raw) {
	var list = (raw && (ci(raw, [ 'disabled_features' ]) || raw)) || [];
	if (!Array.isArray(list))
		list = [];
	return list.map(function(x) { return String(x).toLowerCase(); });
}

function isDisabled(list, name) {
	return list.indexOf(String(name).toLowerCase()) !== -1;
}

function atText(raw) {
	if (raw === undefined || raw === null)
		return '';
	if (typeof raw === 'string')
		return raw;
	if (Array.isArray(raw))
		return raw.map(function(x) { return atText(x); }).filter(Boolean).join('\n');
	if (typeof raw === 'object') {
		var v = ci(raw, [ 'response', 'result', 'at_response', 'output', 'data', 'stdout', 'message', 'ret' ]);
		if (typeof v === 'string')
			return v;
		if (Array.isArray(v))
			return v.map(function(x) { return atText(x); }).filter(Boolean).join('\n');
		try { return JSON.stringify(raw, null, 2); } catch (e) { return String(raw); }
	}
	return String(raw);
}

function atLines(text) {
	return String(text || '').split(/\r?\n/).map(function(l) { return l.trim(); })
		.filter(function(l) { return l && l !== 'OK'; });
}

function bandItem(item) {
	if (item === undefined || item === null)
		return null;
	if (typeof item !== 'object') {
		var id = String(item).trim();
		return id ? { id: id, name: id } : null;
	}
	var bid = ci(item, [ 'band_id', 'bandid', 'id', 'band' ]);
	var bname = ci(item, [ 'band_name', 'bandname', 'name' ]);
	if (bid === undefined && bname === undefined)
		return null;
	var idStr = String(bid !== undefined ? bid : bname).trim();
	return idStr ? { id: idStr, name: String(bname !== undefined && bname !== '' ? bname : idStr) } : null;
}

function bandItems(list) {
	if (!Array.isArray(list))
		return [];
	return list.map(bandItem).filter(Boolean);
}

function neighborList(raw) {
	if (!raw || typeof raw !== 'object')
		return [];
	var node = raw;
	var wrappers = [ 'neighbor_cell', 'neighborcell', 'neighbour_cell', 'neighbor_cells',
		'neighbourcell', 'neighbor', 'cells', 'list' ];
	for (var i = 0; i < wrappers.length; i++) {
		var v = ci(raw, [ wrappers[i] ]);
		if (v && typeof v === 'object') { node = v; break; }
	}
	var out = [];
	function walk(v, group) {
		if (!v || typeof v !== 'object')
			return;
		if (Array.isArray(v)) {
			v.forEach(function(x) { walk(x, group); });
			return;
		}
		var keys = Object.keys(v);
		if (!keys.length)
			return;
		var nested = keys.filter(function(k) { return v[k] && typeof v[k] === 'object'; });
		if (nested.length === keys.length) {
			keys.forEach(function(k) { walk(v[k], group || k); });
			return;
		}
		out.push({ group: group || '', data: v });
	}
	walk(node, '');
	return out;
}

function signalColorClass(value, kind) {
	var v = num(value);
	if (isNaN(v)) return 'unknown';
	if (kind === 'rsrp') { if (v >= -80) return 'excellent'; if (v >= -90) return 'good'; if (v >= -100) return 'fair'; return 'weak'; }
	if (kind === 'rsrq') { if (v >= -10) return 'excellent'; if (v >= -15) return 'good'; if (v >= -20) return 'fair'; return 'weak'; }
	if (v >= 20) return 'excellent'; if (v >= 13) return 'good'; if (v >= 0) return 'fair'; return 'weak';
}

function signalPercent(value, kind) {
	var v = num(value);
	if (isNaN(v)) return 0;
	if (kind === 'rsrp') return Math.max(0, Math.min(100, (v + 140) * 1.67));
	if (kind === 'rsrq') return Math.max(0, Math.min(100, (v + 35) * 2.86));
	return Math.max(0, Math.min(100, (v + 10) * 3.33));
}

function signalBar(value, kind, label) {
	var has = !isNaN(num(value));
	var cls = signalColorClass(value, kind);
	var pct = signalPercent(value, kind);
	return E('div', { 'class': 'mt-sbar ' + cls }, [
		label ? E('span', { 'class': 'mt-sbar-label' }, label) : null,
		E('div', { 'class': 'mt-sbar-track', 'role': 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' },
			E('div', { 'class': 'mt-sbar-fill', 'style': 'width:' + pct.toFixed(1) + '%' })),
		E('span', { 'class': 'mt-sbar-value' }, has ? (String(value) + (kind === 'rsrp' ? ' dBm' : ' dB')) : '--')
	]);
}

function scsText(value) {
	var raw = String(value || '').trim();
	if (!raw) return '';
	if (/[a-zA-Z]/.test(raw)) return raw;
	var table = { '0': '15', '1': '30', '2': '60', '3': '120', '4': '240' };
	if (table[raw]) return raw + ' · ' + table[raw] + ' kHz';
	return raw;
}

var BAND_CLASS_LABEL = {
	GW: _('2G / 3G（GSM / WCDMA）'),
	UMTS: _('3G UMTS'),
	LTE: _('4G 长期演进（LTE）'),
	Lte: _('4G 长期演进（LTE）'),
	NR: _('5G 新空口（NR）'),
	NR_NSA: _('5G NR（NSA 非独立组网）'),
	NRNSA: _('5G NR（NSA 非独立组网）'),
	NR_SA: _('5G NR（SA 独立组网）'),
	NRSA: _('5G NR（SA 独立组网）')
};

var BAND_CLASS_ORDER = [ 'GW', 'UMTS', 'LTE', 'Lte', 'NR', 'NR_NSA', 'NRNSA', 'NR_SA', 'NRSA' ];

function bandClassLabel(k) { return BAND_CLASS_LABEL[k] || k; }

function bandSortKey(id) {
	var n = parseInt(String(id).replace(/[^0-9].*$/, ''), 10);
	return isNaN(n) ? null : n;
}

function sortBands(items) {
	return items.slice().sort(function(a, b) {
		var na = bandSortKey(a.id), nb = bandSortKey(b.id);
		if (na !== null && nb !== null) return na - nb;
		if (na !== null) return -1;
		if (nb !== null) return 1;
		return String(a.id).localeCompare(String(b.id));
	});
}

var MODE_LABEL = {
	auto: _('自动'), ecm: _('以太网控制模型（ECM）'), ncm: _('网络控制模型（NCM）'), rndis: _('远程网络驱动接口规范（RNDIS）'),
	mbim: _('移动宽带接口模型（MBIM）'), qmi: _('高通调制解调器接口（QMI）'), gobinet: _('高通 Gobi 网络协议（GobiNet）'), ppp: _('点对点协议（PPP）')
};

function modeLabel(key) {
	return MODE_LABEL[String(key).toLowerCase()] || String(key).toUpperCase();
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'network', 'signal', 'device' ],
	POLL_INTERVAL: 8000,

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
			self.section = ctx.section;
			return self.collect(ctx);
		});
	},

	collect: function(ctx) {
		var errors = [];
		var section = ctx.section;

		if (!section)
			return { section: null, errors: errors };

		return Promise.all([
			guard(controls.getMode(section), '网络/拨号模式', errors),
			guard(controls.getNetworkPrefer(section), '网络优选', errors),
			guard(controls.getLockBand(section), '锁频段', errors),
			guard(controls.getNeighborCell(section), '邻区信息', errors),
			guard(controls.getCurrentBand(section), '当前频段', errors),
			guard(controls.getCurrentBandCapabilities(section), '当前频段能力', errors),
			guard(controls.getCellInfo(section), '小区信息', errors),
			guard(controls.getDisabledFeatures(section), '特性支持列表', errors),
			guard(controls.getAtCfg(section), 'AT 端口配置', errors)
		]).then(function(r) {
			return {
				section: section,
				mode: r[0],
				prefer: r[1],
				lockband: r[2],
				neighbor: r[3],
				currentBand: r[4],
				currentBandCapabilities: r[5],
				cell: r[6],
				disabled: r[7],
				atCfg: r[8],
				errors: errors
			};
		});
	},

	styleNode: function() {
		return E('style', {}, [
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mt-net{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境光晕 */
			'.mt-net-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-net-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(14,165,233,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片核心样式 */
			'.mt-net-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:22px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-net-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(31,64,120,0.08),0 2px 6px rgba(0,0,0,0.04)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-net-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.mt-net-kicker{font-size:12px;color:#0072f5;font-weight:750;letter-spacing:.03em;margin-bottom:4px}',
			'.mt-net-title{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:10px}',
			'.mt-net-sub{font-size:13px;color:#64748b;line-height:1.5}',
			'.mt-op-logo{width:28px;height:28px;border-radius:6px;flex-shrink:0;object-fit:contain}',

			/* 状态徽章 */
			'.mt-net-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;font-size:12px;font-weight:750;white-space:nowrap;background:rgba(236,253,245,0.85);color:#065f46;border:1px solid rgba(167,243,208,0.8)}',
			'.mt-net-badge:before{content:"";width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,0.2)}',
			'.mt-net-badge.off{background:rgba(254,242,242,0.85);color:#991b1b;border-color:rgba(254,202,202,0.8)}',
			'.mt-net-badge.off:before{background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,0.2)}',

			/* 4 列指标卡片 (带 SVG 动态微仪表) */
			'.mt-net-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px}',
			'.mt-net-metric-card{display:flex;flex-direction:column;align-items:center;text-align:center;padding:18px 14px}',
			'.mt-net-metric-head{display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:8px}',
			'.mt-net-metric-label{font-size:11px;color:#64748b;font-weight:700}',
			'.mt-net-qual{font-size:10px;font-weight:750;padding:2px 8px;border-radius:999px}',
			'.mt-net-qual.excellent{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}',
			'.mt-net-qual.good{background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe}',
			'.mt-net-qual.fair{background:#fffbeb;color:#d97706;border:1px solid #fde68a}',
			'.mt-net-qual.weak{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}',
			'.mt-net-qual.unknown{background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0}',
			'.mt-gauge-svg-box{position:relative;width:105px;height:62px;margin:2px 0 6px}',
			'.mt-gauge-svg{width:100%;height:100%}',
			'.mt-gauge-val{position:absolute;bottom:4px;left:0;right:0;font-size:17px;font-weight:800;color:#0f172a;letter-spacing:-.02em}',

			/* 2 列网络状态与服务小区卡片 */
			'.mt-net-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}',
			'.mt-card-title{font-size:15px;font-weight:750;color:#0f172a;display:flex;align-items:center;gap:8px;margin-bottom:14px}',
			'.mt-net-row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12px}',
			'.mt-net-row:last-child{border-bottom:0}',
			'.mt-net-row span:first-child{color:#64748b;font-weight:500}',
			'.mt-net-row strong{color:#0f172a;font-weight:600;text-align:right;word-break:break-word;font-variant-numeric:tabular-nums}',
			'.mt-net-row-block{display:block}.mt-net-row-block>span:first-child{display:block;margin-bottom:8px}.mt-net-row-block strong{display:block;text-align:left}',

			/* 频段锁定摘要芯片 */
			'.mt-locksum{display:flex;flex-direction:column;gap:7px}',
			'.mt-locksum-group{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
			'.mt-locksum-label{font-size:10.5px;font-weight:700;color:#0072f5;background:rgba(239,246,255,0.9);border-radius:6px;padding:2px 8px}',
			'.mt-locksum-chips{display:flex;flex-wrap:wrap;gap:4px}',
			'.mt-locksum-chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:6px;background:rgba(241,245,249,0.8);border:1px solid rgba(226,232,240,0.8);color:#0072f5;font-size:11px;font-weight:700}',
			'.mt-locksum-chip.off{background:#f8fafc;color:#94a3b8;border-color:#e2e8f0}',

			/* 载波聚合动态流向面板 */
			'.mt-ssb-serving{padding:14px 18px;border-radius:14px;background:rgba(248,250,252,0.85);border:1px solid rgba(226,232,240,0.8);margin-bottom:14px}',
			'.mt-ssb-serving-head{display:flex;justify-content:space-between;align-items:center}',
			'.mt-ssb-serving-title{font-size:14px;font-weight:750;color:#0f172a}',
			'.mt-ssb-serving-meta{font-size:11px;color:#64748b}',
			'.mt-lock-cell-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px;margin-top:12px}',
			'.mt-lock-cell-card{padding:16px;border-radius:14px;border:1px solid rgba(226,232,240,0.8);background:rgba(248,250,252,0.75);transition:all .2s ease}',
			'.mt-lock-cell-card:hover{border-color:rgba(0,114,245,0.4);background:#fff;transform:translateY(-2px)}',
			'.mt-lock-cell-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
			'.mt-lock-cell-band{font-size:13px;font-weight:750;color:#0f172a}',
			'.mt-cell-role{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:750;text-transform:uppercase}',
			'.mt-cell-role.pcc{background:#0072f5;color:#fff}',

			/* 信号条组件 */
			'.mt-sbar{display:flex;align-items:center;gap:8px;margin:6px 0}',
			'.mt-sbar-label{flex:0 0 44px;font-size:11px;font-weight:600;color:#64748b}',
			'.mt-sbar-track{flex:1;height:6px;border-radius:999px;background:#e2e8f0;overflow:hidden;min-width:60px}',
			'.mt-sbar-fill{height:100%;border-radius:inherit;transition:width .4s ease}',
			'.mt-sbar-value{flex:0 0 auto;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;min-width:72px;text-align:right}',
			'.mt-sbar.excellent .mt-sbar-fill{background:#10b981}.mt-sbar.excellent .mt-sbar-value{color:#059669}',
			'.mt-sbar.good .mt-sbar-fill{background:#0072f5}.mt-sbar.good .mt-sbar-value{color:#2563eb}',
			'.mt-sbar.fair .mt-sbar-fill{background:#f59e0b}.mt-sbar.fair .mt-sbar-value{color:#d97706}',
			'.mt-sbar.weak .mt-sbar-fill{background:#ef4444}.mt-sbar.weak .mt-sbar-value{color:#dc2626}',

			/* 无线策略网格 */
			'.mt-control-section{margin-top:16px}',
			'.mt-control-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
			'.mt-band-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;margin:10px 0}',
			'.mt-band-option{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:46px;padding:6px 4px;border:1px solid rgba(226,232,240,0.8);border-radius:10px;background:rgba(248,250,252,0.8);cursor:pointer;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;transition:all .15s ease;-webkit-user-select:none;user-select:none}',
			'.mt-band-option:hover{border-color:rgba(0,114,245,0.4);background:#fff}',
			'.mt-band-option.checked{border-color:#0072f5;background:#eff6ff;color:#0072f5;box-shadow:inset 0 0 0 1px #0072f5}',
			'.mt-band-option input{position:absolute;width:0;height:0;opacity:0;pointer-events:none}',

			/* 频率扫描终端卡片 */
			'.mt-scan-panel{margin-top:12px;padding:16px;border-radius:14px;background:#0f172a;color:#38bdf8;box-shadow:inset 0 2px 6px rgba(0,0,0,0.5)}',
			'.mt-scan-raw{margin:0;font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:300px;overflow:auto}',

			/* 响应式 */
			'@media(max-width:980px){.mt-net-metrics{grid-template-columns:repeat(2,1fr)}.mt-net-grid,.mt-control-grid{grid-template-columns:1fr}}',
			'@media(max-width:680px){.mt-net-hero{flex-direction:column;align-items:flex-start}.mt-net-metrics{grid-template-columns:1fr}}'
		].join(''));
	},

	row: function(label, value) {
		var valueNode = isNode(value) ? value : E('strong', {}, shown(value));
		return E('div', { 'class': 'mt-net-row' }, [ E('span', {}, label), valueNode ]);
	},

	/* 动态 SVG 射频仪表 (RSRP / RSRQ / SINR) */
	metricGauge: function(label, kind, rawValue, unit) {
		var n = num(rawValue), has = !isNaN(n), pct = 0, cls = 'unknown', ql = '';
		var tags = { excellent: _('优秀'), good: _('良好'), fair: _('一般'), weak: _('较弱') };
		var strokeColor = '#94a3b8';
		if (has) {
			if (kind === 'rsrp') { pct = (n + 120) * 2.5; cls = n >= -80 ? 'excellent' : n >= -90 ? 'good' : n >= -100 ? 'fair' : 'weak'; }
			else if (kind === 'rsrq') { pct = (n + 25) * 4; cls = n >= -10 ? 'excellent' : n >= -15 ? 'good' : n >= -20 ? 'fair' : 'weak'; }
			else if (kind === 'sinr') { pct = (n + 10) * 2.5; cls = n >= 20 ? 'excellent' : n >= 13 ? 'good' : n >= 0 ? 'fair' : 'weak'; }
			else { pct = (n - 20) / 60 * 100; cls = n < 45 ? 'excellent' : n < 55 ? 'good' : n < 65 ? 'fair' : 'weak'; }
			pct = Math.max(5, Math.min(100, pct));
			ql = tags[cls] || '';
			strokeColor = cls === 'excellent' ? '#10b981' : cls === 'good' ? '#0072f5' : cls === 'fair' ? '#f59e0b' : '#ef4444';
		}

		var radius = 38;
		var totalLen = Math.PI * radius; // 约 119.4
		var activeLen = (pct / 100) * totalLen;

		var svgStr = [
			'<svg class="mt-gauge-svg" viewBox="0 0 100 58">',
			'  <path d="M 12 50 A 38 38 0 0 1 88 50" fill="none" stroke="rgba(226,232,240,0.8)" stroke-width="8" stroke-linecap="round"/>',
			'  <path d="M 12 50 A 38 38 0 0 1 88 50" fill="none" stroke="' + strokeColor + '" stroke-width="8" stroke-linecap="round"',
			'        stroke-dasharray="' + activeLen.toFixed(1) + ' 120" style="transition: stroke-dasharray .5s cubic-bezier(.2,.8,.4,1);"/>',
			'</svg>'
		].join('');

		return E('div', { 'class': 'mt-net-card mt-net-metric-card' }, [
			E('div', { 'class': 'mt-net-metric-head' }, [
				E('span', { 'class': 'mt-net-metric-label' }, label),
				E('span', { 'class': 'mt-net-qual ' + cls }, ql || _('无数据'))
			]),
			E('div', { 'class': 'mt-gauge-svg-box' }, [
				svgNode(svgStr),
				E('div', { 'class': 'mt-gauge-val' }, has ? String(rawValue) : '--')
			]),
			E('span', { 'style': 'font-size:10px;color:#64748b' }, unit || '')
		]);
	},

	metricBand: function(label, band) {
		return E('div', { 'class': 'mt-net-card mt-net-metric-card' }, [
			E('div', { 'class': 'mt-net-metric-head' }, [
				E('span', { 'class': 'mt-net-metric-label' }, label),
				E('span', { 'class': 'mt-net-qual good' }, _('当前活跃'))
			]),
			E('div', { 'style': 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:62px;margin:2px 0 6px' }, [
				E('div', { 'style': 'font-size:22px;font-weight:800;color:#0072f5;letter-spacing:-.02em' }, shown(band)),
				E('span', { 'style': 'font-size:10px;color:#64748b' }, _('驻网频段'))
			]),
			E('span', { 'style': 'font-size:10px;color:#64748b' }, _('RF 射频通道'))
		]);
	},

	modeCard: function(section, modeRaw) {
		var mode = plainObject(modeRaw, 'mode');
		var keys = Object.keys(mode);
		var active = '';
		keys.forEach(function(k) {
			if (String(mode[k]) === '1') active = k;
		});
		[ 'ecm', 'ncm' ].forEach(function(k) {
			if (keys.indexOf(k) === -1) keys.push(k);
		});

		var buttons = keys.map(function(k) {
			var isActive = (String(k).toLowerCase() === String(active).toLowerCase());
			return E('button', {
				'type': 'button',
				'class': 'btn ' + (isActive ? 'cbi-button-apply' : 'cbi-button-action'),
				'disabled': isActive ? 'disabled' : null,
				'click': function() {
					controls.confirmModal(_('切换网络模式'),
						_('将模组拨号模式切换为 %s？切换过程中移动数据会短暂中断。').format(modeLabel(k)),
						function() { return controls.setMode(section, k); }, true);
				}
			}, isActive ? _('当前：%s').format(modeLabel(k)) : _('切换为 %s').format(modeLabel(k)));
		});

		return controls.card(_('网络模式'),
			_('模组对外呈现的拨号模式（由 QModem get_mode / set_mode 提供）。'), [
				controls.state(_('当前模式'), active ? modeLabel(active) : '--'),
				keys.length ? E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' }, buttons)
					: E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 未上报可用的网络模式。'))
			]);
	},

	preferCard: function(section, preferRaw) {
		var prefer = plainObject(preferRaw, 'network_prefer');
		var order = [ '3G', '4G', '5G' ];
		var keys = Object.keys(prefer);
		order.forEach(function(k) { if (keys.indexOf(k) === -1) keys.push(k); });
		keys = keys.filter(function(k) { return order.indexOf(k) !== -1; })
			.sort(function(a, b) { return order.indexOf(a) - order.indexOf(b); });

		var boxes = {};
		var options = keys.map(function(k) {
			var box = E('input', {
				'type': 'checkbox',
				'value': k,
				'checked': String(prefer[k]) === '1' ? 'checked' : null
			});
			boxes[k] = box;
			var lbl = E('label', { 'class': 'mt-band-option' + (String(prefer[k]) === '1' ? ' checked' : '') }, [ box, E('span', {}, k) ]);
			box.addEventListener('change', function() {
				lbl.classList[box.checked ? 'add' : 'remove']('checked');
			});
			return lbl;
		});

		return controls.card(_('网络优选'),
			_('选择模组允许驻网的制式。至少保留一项。'), [
				E('div', { 'class': 'mt-control-state mt-control-state-current' },
					[ E('span', {}, _('当前优选')), E('strong', {},
						keys.filter(function(k) { return String(prefer[k]) === '1'; }).join(' / ') || '--') ]),
				E('div', { 'class': 'mt-band-options' }, options),
				E('div', { 'style': 'display:flex;justify-content:flex-end;margin-top:12px' }, E('button', {
					'type': 'button', 'class': 'btn cbi-button-apply',
					'click': function() {
						var checked = keys.filter(function(k) { return boxes[k] && boxes[k].checked; });
						if (!checked.length)
							return ui.addNotification(null, E('p', {}, _('请至少选择一种网络制式。')), 'warning');
						controls.confirmModal(_('修改网络优选'),
							_('将允许驻网的制式设置为 %s？移动数据会短暂中断。').format(checked.join(' / ')),
							function() { return controls.setNetworkPrefer(section, JSON.stringify(checked)); }, true);
					}
				}, _('应用网络优选')))
			]);
	},

	lockBandPanel: function(section, bandClass, data) {
		var available = sortBands(bandItems(ci(data, [ 'available_band', 'availableband', 'bands' ])));
		var locked = bandItems(ci(data, [ 'lock_band', 'lockband', 'locked_band' ]));
		var lockedIds = {};
		locked.forEach(function(item) { lockedIds[item.id] = true; });

		if (!available.length) {
			available = sortBands(locked.slice());
			if (!available.length)
				return E('section', { 'class': 'mt-net-card', 'style': 'margin-bottom:12px' }, [
					E('h3', { 'style': 'font-size:14px;font-weight:750;margin:0 0 6px' }, bandClassLabel(bandClass)),
					E('p', { 'style': 'font-size:11px;color:#94a3b8;margin:0' }, _('本模组经 QModem 未上报该类别的可用频段。'))
				]);
		}

		var boxes = [];
		var options = available.map(function(item) {
			var box = E('input', {
				'type': 'checkbox',
				'value': item.id,
				'checked': lockedIds[item.id] ? 'checked' : null
			});
			box.addEventListener('change', function() {
				options.forEach(function(labelEl, i) {
					labelEl.classList[boxes[i].checked ? 'add' : 'remove']('checked');
				});
				refresh();
			});
			boxes.push(box);
			return E('label', { 'class': 'mt-band-option' + (lockedIds[item.id] ? ' checked' : '') },
				[ box, E('span', {}, item.id) ]);
		});

		var summaryNode = E('span', { 'style': 'font-size:11px;color:#64748b' }, '');
		function refresh() {
			var n = boxes.filter(function(b) { return b.checked; }).length;
			summaryNode.textContent = _('已选 %d / %d').format(n, available.length);
			options.forEach(function(labelEl, i) {
				labelEl.classList[boxes[i].checked ? 'add' : 'remove']('checked');
			});
		}
		refresh();
		function currentCsv() {
			return boxes.filter(function(b) { return b.checked; })
				.map(function(b) { return b.value; }).join(',');
		}
		var applyBtn = E('button', {
			'type': 'button', 'class': 'btn cbi-button-apply',
			'click': function() {
				var csv = currentCsv();
				controls.confirmModal(_('应用频段锁定'),
					csv ? _('将 %s 锁定到频段 %s？移动数据会短暂中断。').format(bandClassLabel(bandClass), csv)
						: _('解除 %s 的频段锁定？').format(bandClassLabel(bandClass),
					function() {
						return controls.setLockBand(section, { band_class: bandClass, lock_band: csv });
					}, true));
			}
		}, _('应用锁定'));

		return E('section', { 'class': 'mt-net-card', 'style': 'margin-bottom:14px' }, [
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px' }, [
				E('div', {}, [
					E('h3', { 'style': 'font-size:15px;font-weight:750;margin:0 0 4px;color:#0f172a' }, [
						bandClassLabel(bandClass),
						E('span', { 'style': 'margin-left:8px;font-size:11px;color:#0072f5;font-weight:600' },
							_('共 %d 个频段').format(available.length))
					]),
					E('p', { 'style': 'margin:0;color:#64748b;font-size:11px' }, locked.length
						? _('当前锁定 %d 个：').format(locked.length) + locked.map(function(b) { return b.name; }).join('、')
						: _('未锁定，模组可自由驻网到该类别全部可用频段。'))
				]),
				E('div', { 'style': 'display:flex;align-items:center;gap:8px' }, [
					summaryNode,
					E('button', {
						'type': 'button', 'class': 'btn',
						'click': function() { boxes.forEach(function(b) { b.checked = true; }); refresh(); }
					}, _('全选')),
					E('button', {
						'type': 'button', 'class': 'btn',
						'click': function() { boxes.forEach(function(b) { b.checked = false; }); refresh(); }
					}, _('清空'))
				])
			]),
			E('div', { 'class': 'mt-band-options' }, options),
			E('div', { 'style': 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px' }, [
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() { boxes.forEach(function(b) { b.checked = false; }); refresh(); }
				}, _('清空')),
				applyBtn
			])
		]);
	},

	lockBandSection: function(section, lockRaw, disabled) {
		var head = E('div', { 'style': 'margin-bottom:14px' }, [
			E('h3', { 'style': 'font-size:16px;font-weight:750;color:#0f172a;margin:0 0 4px' }, _('频段锁定')),
			E('p', { 'style': 'font-size:12px;color:#64748b;margin:0' }, _('限制模组可使用的频段。日常使用建议保持不锁定。'))
		]);

		var note = isDisabled(disabled, 'lockband')
			? E('div', { 'class': 'mt-control-note' }, _('固件报告频段锁定已禁用，但底层 set_lockband 方法仍可调用。'))
			: null;

		var lockband = plainObject(lockRaw, 'lockband');
		var classes = Object.keys(lockband).filter(function(k) {
			return lockband[k] && typeof lockband[k] === 'object';
		});
		classes.sort(function(a, b) {
			var ia = BAND_CLASS_ORDER.indexOf(a), ib = BAND_CLASS_ORDER.indexOf(b);
			if (ia !== -1 && ib !== -1) return ia - ib;
			if (ia !== -1) return -1;
			if (ib !== -1) return 1;
			return String(a).localeCompare(String(b));
		});

		var children = [ head ];
		if (note) children.push(note);
		if (!classes.length) {
			children.push(E('div', { 'style': 'padding:20px;text-align:center;color:#94a3b8;font-size:12px' }, _('本模组经 QModem 暂无可用的锁频段数据。')));
		} else {
			var self = this;
			children = children.concat(classes.map(function(k) {
				return self.lockBandPanel(section, k, lockband[k]);
			}));
		}

		return E('section', { 'class': 'mt-control-section' }, children);
	},

	currentBandSection: function(currentRaw) {
		var current = plainObject(currentRaw, 'current_band');
		var cells = ci(current, [ 'cells' ]);
		if (!Array.isArray(cells)) cells = [];

		var cards = cells.map(function(c) {
			var role = String(pick(c, [ 'role' ]) || '').toLowerCase();
			var rat = pick(c, [ 'rat' ]);
			var band = pick(c, [ 'band_name', 'band' ]);
			var channel = pick(c, [ 'channel', 'earfcn', 'arfcn' ]);
			var channelType = pick(c, [ 'channel_type' ]);
			var pci = pick(c, [ 'pci' ]);
			var dl = pick(c, [ 'dl_bandwidth' ]);
			var ul = pick(c, [ 'ul_bandwidth' ]);
			var scs = pick(c, [ 'scs' ]);
			var rows = [
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('制式')), E('strong', {}, shown(rat)) ]),
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('频段')), E('strong', {}, shown(band)) ]),
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, channelType || _('频点')), E('strong', {}, shown(channel)) ]),
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('物理小区标识（PCI）')), E('strong', {}, shown(pci)) ]),
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('下行带宽')), E('strong', {}, shown(dl)) ]),
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('上行带宽')), E('strong', {}, shown(ul)) ])
			];
			if (scs)
				rows.push(E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('子载波间隔')), E('strong', {}, scsText(scs)) ]));
			return E('div', { 'class': 'mt-lock-cell-card' }, [
				E('div', { 'class': 'mt-lock-cell-head' }, [
					E('span', { 'class': 'mt-lock-cell-band' }, (band || rat || _('载波')) + (channel ? ' · ' + channel : '')),
					E('span', { 'class': 'mt-cell-role' + (role === 'pcc' ? ' pcc' : '') }, role ? role.toUpperCase() : _('载波'))
				])
			].concat(rows));
		});

		return E('section', { 'class': 'mt-net-card', 'style': 'margin-bottom:16px' }, [
			E('div', { 'class': 'mt-card-title' }, [
				svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>'),
				_('当前频段与载波聚合（%d 个载波）').format(cells.length)
			]),
			E('div', { 'class': 'mt-ssb-serving' }, [
				E('div', { 'class': 'mt-ssb-serving-head' }, [
					E('span', { 'class': 'mt-ssb-serving-title' }, shown(pick(current, [ 'network_mode' ]))),
					E('span', { 'class': 'mt-ssb-serving-meta' }, (function(st) {
						var s = String(st || '').toLowerCase();
						if (s === 'unsupported') return _('不支持');
						if (s === 'supported') return _('支持');
						return shown(st);
					})(pick(current, [ 'status' ])))
				])
			]),
			cells.length ? E('div', { 'class': 'mt-lock-cell-grid' }, cards)
				: E('div', { 'style': 'padding:14px 0;color:#94a3b8;font-size:12px' }, _('本模组经 QModem 暂无载波聚合数据。'))
		]);
	},

	neighborSection: function(neighborRaw, disabled) {
		var list = neighborList(neighborRaw);
		var cards = list.map(function(item, index) {
			var d = item.data;
			var rat = pick(d, [ 'rat', 'network_mode', 'type' ]) || item.group || '';
			var band = pick(d, [ 'band_name', 'band' ]);
			var arfcn = pick(d, [ 'channel', 'arfcn', 'earfcn', 'freq', 'frequency' ]);
			var pci = pick(d, [ 'pci', 'physical_cell_id', 'physicalcellid' ]);
			var rsrp = pick(d, [ 'rsrp' ]);
			var rsrq = pick(d, [ 'rsrq' ]);
			var sinr = pick(d, [ 'sinr', 'rssnr' ]);
			var used = [ 'rat', 'network_mode', 'type', 'band_name', 'band', 'channel', 'arfcn', 'earfcn',
				'freq', 'frequency', 'pci', 'physical_cell_id', 'physicalcellid', 'rsrp', 'rsrq', 'sinr', 'rssnr' ];
			var extra = Object.keys(d).filter(function(k) {
				return used.indexOf(k.toLowerCase().replace(/[\s\-]/g, '_')) === -1
					&& d[k] !== null && typeof d[k] !== 'object';
			}).map(function(k) {
				return E('div', { 'class': 'mt-net-row' }, [ E('span', {}, k), E('strong', {}, shown(d[k])) ]);
			});
			var children = [
				E('div', { 'class': 'mt-lock-cell-head' }, [
					E('span', { 'class': 'mt-lock-cell-band' },
						(band || rat || _('邻区 %d').format(index + 1)) + (arfcn ? ' · ' + arfcn : '')),
					rat ? E('span', { 'class': 'mt-cell-role' }, rat) : null
				])
			];
			if (rsrp !== '') children.push(signalBar(rsrp, 'rsrp', _('参考信号接收功率（RSRP）')));
			if (rsrq !== '') children.push(signalBar(rsrq, 'rsrq', _('参考信号接收质量（RSRQ）')));
			if (sinr !== '') children.push(signalBar(sinr, 'sinr', _('信号与干扰加噪声比（SINR）')));
			if (pci) children.push(E('div', { 'style': 'margin-top:6px;font-size:11px;color:#64748b' }, _('物理小区标识（PCI）: ') + pci));
			return E('div', { 'class': 'mt-lock-cell-card' }, children.concat(extra));
		});

		return E('section', { 'class': 'mt-net-card', 'style': 'margin-bottom:16px' }, [
			E('div', { 'class': 'mt-card-title' }, [
				svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'),
				_('邻区信息（%d）').format(list.length)
			]),
			cards.length ? E('div', { 'class': 'mt-lock-cell-grid' }, cards)
				: E('div', { 'style': 'padding:14px 0;color:#94a3b8;font-size:12px' }, _('本模组经 QModem 暂无邻区数据。'))
		]);
	},

	scanSection: function(section, atPort) {
		var host = E('div', { 'style': 'margin-top:12px' });
		var self = this;
		var button = E('button', { 'type': 'button', 'class': 'btn cbi-button-action' }, _('开始扫描'));

		button.addEventListener('click', function() {
			ui.showModal(_('确认执行频率扫描'), [
				E('p', {}, _('扫描会占用模组资源并可能持续较长时间，期间移动数据可能受影响。')),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', {
						'type': 'button', 'class': 'btn cbi-button-apply',
						'click': function() {
							ui.hideModal();
							dom.content(host, E('div', { 'class': 'alert-message notice' }, _('正在扫描，请稍候…')));
							controls.sendAt(section, atPort, 'AT^CELLSCAN').then(function(res) {
								dom.content(host, self.scanResult(atText(res)));
							}).catch(function(err) {
								dom.content(host, E('div', { 'class': 'alert-message warning' },
									_('扫描失败：%s').format((err && err.message) || String(err))));
							});
						}
					}, _('继续'))
				])
			]);
		});

		return controls.card(_('频率扫描'),
			_('经 QModem 下发 AT^CELLSCAN 扫描无线频段。'), [
				E('div', { 'style': 'display:flex;justify-content:flex-end;margin-top:10px' }, button),
				host
			], true);
	},

	scanResult: function(text) {
		var lines = atLines(text);
		if (!lines.length)
			return E('div', { 'style': 'color:#94a3b8;font-size:12px;padding:8px 0' }, _('模组未返回扫描数据。'));
		return E('div', { 'class': 'mt-scan-panel' }, [
			E('h4', { 'style': 'font-size:13px;margin:0 0 8px;color:#fff' }, _('扫描结果（%d 行）').format(lines.length)),
			E('pre', { 'class': 'mt-scan-raw' }, lines.join('\n'))
		]);
	},

	render: function(res) {
		return controls.liveView(this, res, {
			domains: this.DOMAINS,
			interval: this.POLL_INTERVAL,
			paint: this.paintContent,
			collect: this.collect
		});
	},

	paintContent: function(res) {
		res = res || {};
		var errors = res.errors || [];
		var warnings = errors.map(function(msg) {
			return E('div', { 'class': 'mt-net-card', 'style': 'color:#b91c1c;margin-bottom:12px' }, msg);
		});

		if (!res.section)
			return E('div', { 'class': 'mt-net' }, [
				this.styleNode(),
				controls.styleNode(),
				E('div', { 'class': 'mt-net-card', 'style': 'color:#b91c1c' }, _('未检测到模组（请确认 QModem 已识别该设备）。'))
			].concat(warnings));

		var section = res.section;
		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});
		var disabled = disabledSet(res.disabled);
		var atPort = pick(plainObject(res.atCfg, 'at_cfg'), [ 'at_port' ]);

		var cell = controls.entryMap(entriesOf(res.cell));
		var networkMode = pick(cell, [ 'network_mode' ]);
		var rsrp = pick(cell, [ 'RSRP' ]);
		var rsrq = pick(cell, [ 'RSRQ' ]);
		var sinr = pick(cell, [ 'SINR' ]);
		var pci = pick(cell, [ 'Physical Cell ID', 'PCI' ]);
		var tac = pick(cell, [ 'TAC', 'LAC' ]);
		var band = pick(cell, [ 'Band' ]);
		var earfcn = pick(cell, [ 'EARFCN', 'ARFCN', 'NR ARFCN' ]);
		var cellId = pick(cell, [ 'Cell ID', 'CID' ]);
		var mcc = pick(cell, [ 'MCC' ]);
		var mnc = pick(cell, [ 'MNC' ]);
		var dlBw = pick(cell, [ 'DL Bandwidth' ]);
		var ulBw = pick(cell, [ 'UL Bandwidth' ]);
		var scs = pick(cell, [ 'SCS' ]);

		var opInfo = controls.operatorInfo(null, mcc, mnc);
		var operatorName = (mcc && mnc) ? opInfo.name : '--';
		var registered = !!(networkMode || pci || earfcn);

		var mode = plainObject(res.mode, 'mode');
		var activeMode = Object.keys(mode).filter(function(k) { return String(mode[k]) === '1'; })[0] || '';
		var prefer = plainObject(res.prefer, 'network_prefer');
		var preferOn = Object.keys(prefer).filter(function(k) { return String(prefer[k]) === '1'; });
		var lockband = plainObject(res.lockband, 'lockband');

		var lockClasses = Object.keys(lockband).filter(function(k) {
			return lockband[k] && typeof lockband[k] === 'object' &&
				(bandItems(ci(lockband[k], [ 'lock_band', 'lockband' ])).length ||
				 bandItems(ci(lockband[k], [ 'available_band', 'availableband', 'bands' ])).length);
		});
		lockClasses.sort(function(a, b) {
			var ia = BAND_CLASS_ORDER.indexOf(a), ib = BAND_CLASS_ORDER.indexOf(b);
			if (ia !== -1 && ib !== -1) return ia - ib;
			if (ia !== -1) return -1;
			if (ib !== -1) return 1;
			return String(a).localeCompare(String(b));
		});
		var lockedSummaryNode = lockClasses.length ? E('div', { 'class': 'mt-locksum' },
			lockClasses.map(function(k) {
				var locked = sortBands(bandItems(ci(lockband[k], [ 'lock_band', 'lockband' ])));
				var availCount = bandItems(ci(lockband[k], [ 'available_band', 'availableband', 'bands' ])).length;
				return E('div', { 'class': 'mt-locksum-group' }, [
					E('span', { 'class': 'mt-locksum-label' }, bandClassLabel(k)),
					E('span', { 'class': 'mt-locksum-chips' }, locked.length
						? locked.map(function(b) { return E('span', { 'class': 'mt-locksum-chip' }, b.id); })
						: [ E('span', { 'class': 'mt-locksum-chip off' }, _('未锁定')) ]),
					availCount ? E('span', { 'style': 'font-size:10px;color:#94a3b8' },
						_('可用 %d').format(availCount)) : null
				]);
			})) : null;

		var rawDump;
		try {
			rawDump = JSON.stringify({
				section: section, cell_info: res.cell, mode: res.mode, network_prefer: res.prefer,
				lockband: res.lockband, current_band: res.currentBand, neighbor_cell: res.neighbor,
				disabled_features: res.disabled, at_cfg: res.atCfg
			}, null, 2);
		} catch (e) {
			rawDump = _('无法序列化 QModem 返回数据。');
		}

		return E('div', { 'class': 'mt-net' }, [
			this.styleNode(),
			controls.styleNode(),
			/* 背景环境光晕 */
			E('div', { 'class': 'mt-net-bg-glow1' }),
			E('div', { 'class': 'mt-net-bg-glow2' }),

			modemBar,

			/* 顶部 Hero 玻璃卡片 */
			E('section', { 'class': 'mt-net-card mt-net-hero' }, [
				E('div', {}, [
					E('div', { 'class': 'mt-net-kicker' }, _('无线射频与蜂窝小区')),
					E('h2', { 'class': 'mt-net-title' }, [
						opInfo.logo ? E('img', { 'class': 'mt-op-logo', 'src': opInfo.logo, 'alt': operatorName }) : null,
						operatorName
					]),
					E('div', { 'class': 'mt-net-sub' }, _('实时监控服务小区物理参数、载波聚合配置及多频段策略。'))
				]),
				E('span', { 'class': 'mt-net-badge' + (registered ? '' : ' off') },
					registered ? (networkMode || _('已驻网')) : _('未驻网'))
			]),

			/* 4 列指标卡片 (动态 SVG 微仪表) */
			E('div', { 'class': 'mt-net-metrics' }, [
				this.metricGauge(_('参考信号接收功率（RSRP）'), 'rsrp', rsrp, _('dBm（毫瓦分贝）')),
				this.metricGauge(_('参考信号接收质量（RSRQ）'), 'rsrq', rsrq, _('dB（分贝）')),
				this.metricGauge(_('信号与干扰加噪声比（SINR）'), 'sinr', sinr, _('dB（分贝）')),
				this.metricBand(_('当前频段'), band)
			]),

			/* 2 列网络状态与服务小区卡片 */
			E('div', { 'class': 'mt-net-grid' }, [
				E('section', { 'class': 'mt-net-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>'),
						_('服务小区')
					]),
					this.row(_('网络模式'), networkMode),
					this.row(_('移动国家码 / 移动网络码（MCC / MNC）'), (mcc && mnc) ? (mcc + ' / ' + mnc) : ''),
					this.row(_('频段'), band),
					this.row(_('绝对射频信道号（EARFCN / ARFCN）'), earfcn),
					this.row(_('物理小区标识（PCI）'), pci),
					this.row(_('小区 ID'), cellId),
					this.row(_('跟踪区码 / 位置区码（TAC / LAC）'), tac),
					scs ? this.row(_('子载波间隔'), scsText(scs)) : null,
					this.row(_('下行带宽'), dlBw),
					this.row(_('上行带宽'), ulBw)
				]),
				E('section', { 'class': 'mt-net-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>'),
						_('无线状态')
					]),
					E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('运营商')), E('strong', {}, operatorName) ]),
					E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('网络模式')), E('strong', {}, activeMode ? modeLabel(activeMode) : '--') ]),
					E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('网络优选')), E('strong', {}, preferOn.length ? preferOn.join(' / ') : '--') ]),
					E('div', { 'class': 'mt-net-row mt-net-row-block' }, [ E('span', {}, _('频段锁定')), lockedSummaryNode || E('strong', {}, _('未锁定')) ]),
					E('div', { 'class': 'mt-net-row' }, [ E('span', {}, _('AT 端口')), E('strong', {}, shown(atPort)) ])
				])
			]),

			/* 当前频段与载波聚合 */
			this.currentBandSection(res.currentBand),

			/* 邻区信息 */
			this.neighborSection(res.neighbor, disabled),

			/* 刷新按钮 */
			E('div', { 'style': 'display:flex;gap:10px;margin:16px 0' }, [
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-action',
					'click': function() { window.location.reload(); }
				}, _('刷新状态'))
			]),

			/* 无线策略 (模式 / 优选 / 扫描) */
			E('section', { 'class': 'mt-net-card', 'style': 'margin-bottom:16px' }, [
				E('div', { 'style': 'margin-bottom:14px' }, [
					E('h3', { 'style': 'font-size:16px;font-weight:750;color:#0f172a;margin:0 0 4px' }, _('无线策略')),
					E('p', { 'style': 'font-size:12px;color:#64748b;margin:0' }, _('配置驻网模式、网络制式优选及射频扫描。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.modeCard(section, res.mode),
					this.preferCard(section, res.prefer),
					this.scanSection(section, atPort)
				])
			]),

			/* 频段锁定 */
			this.lockBandSection(section, res.lockband, disabled),

			/* 技术细节调试折叠栏 */
			E('details', { 'class': 'mt-net-card', 'style': 'margin-top:16px' }, [
				E('summary', { 'style': 'cursor:pointer;font-size:13px;font-weight:700;color:#0f172a;list-style:none' }, [
					_('技术细节（QModem 原始数据）')
				]),
				E('pre', { 'class': 'mt-scan-raw', 'style': 'background:#0f172a;padding:14px;border-radius:12px;margin-top:12px' }, rawDump)
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
