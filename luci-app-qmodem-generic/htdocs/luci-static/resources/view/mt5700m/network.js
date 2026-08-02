'use strict';
'require view';
'require ui';
'require dom';
'require form';
'require uci';
'require mt5700m.controls as controls';

/*
 * 网络与小区（Radio & Cells）
 *
 * 数据源全部来自 QModem 的 `qmodem` ubus 对象（经 mt5700m.controls 封装）：
 *   get_mode / get_network_prefer / get_lockband / get_neighborcell /
 *   get_current_band / cell_info / get_disabled_features / get_at_cfg
 * 控制动作：set_mode / set_network_prefer / set_lockband / send_at。
 * 旧的 AT 文本后端与所有 AT 输出正则解析已全部移除。
 */

/* ------------------------------------------------------------------ */
/* 防御式取值辅助                                                       */
/* ------------------------------------------------------------------ */

/* 出错时不抛异常，记入 errors 数组，返回 null，避免白屏 */
function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

/* 把 QModem 的返回值统一成 [{key,value}] 形式 */
function entriesOf(raw) {
	if (Array.isArray(raw))
		return raw;
	if (raw && Array.isArray(raw.modem_info))
		return raw.modem_info;
	if (raw && typeof raw === 'object')
		return Object.keys(raw).map(function(k) { return { key: k, value: raw[k] }; });
	return [];
}

/* 忽略大小写/空格/下划线的键查找，支持多个候选键名 */
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

/* 从 cell_info 字典里按多个候选键名取第一个有值的字段 */
function pick(map, names) {
	var v = ci(map, names);
	if (v === undefined || v === null)
		return '';
	if (typeof v === 'object')
		return '';
	return String(v).trim();
}

/* 取出 { <key>: {...} } 里的子对象，取不到时返回空对象 */
function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	var inner = ci(raw, [ key ]);
	if (inner && typeof inner === 'object' && !Array.isArray(inner))
		return inner;
	return {};
}

/* 数值化，非数值返回 NaN */
function num(value) {
	if (value === undefined || value === null || value === '')
		return NaN;
	return parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
}

/* 显示值：空/未知一律显示 -- */
function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

/* 判断是否为 DOM 节点（部分 LuCI 运行时 instanceof HTMLElement 为 false） */
function isNode(v) {
	return v && typeof v === 'object' && (v instanceof HTMLElement || v.nodeType === 1);
}

/* getDisabledFeatures → 小写特性名数组 */
function disabledSet(raw) {
	var list = (raw && (ci(raw, [ 'disabled_features' ]) || raw)) || [];
	if (!Array.isArray(list))
		list = [];
	return list.map(function(x) { return String(x).toLowerCase(); });
}

function isDisabled(list, name) {
	return list.indexOf(String(name).toLowerCase()) !== -1;
}

/* send_at 返回值形态不固定，尽力取出文本 */
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

/* 把 AT 返回文本切成可显示的行（去空行/单独的 OK） */
function atLines(text) {
	return String(text || '').split(/\r?\n/).map(function(l) { return l.trim(); })
		.filter(function(l) { return l && l !== 'OK'; });
}

/* lockband 的 lock_band / available_band 元素统一成 {band_id, band_name} */
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

/* 邻区数据结构不固定：数组 / {key:数组} / 单对象，统一展开成 [{group,data}] */
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

/* ------------------------------------------------------------------ */
/* 图形化信号辅助（保留原有观感）                                       */
/* ------------------------------------------------------------------ */

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

/* SCS 原始值 → kHz 文案（QModem 也可能直接给 30kHz 这样的字符串） */
function scsText(value) {
	var raw = String(value || '').trim();
	if (!raw) return '';
	if (/[a-zA-Z]/.test(raw)) return raw;
	var table = { '0': '15', '1': '30', '2': '60', '3': '120', '4': '240' };
	if (table[raw]) return raw + ' · ' + table[raw] + ' kHz';
	return raw;
}

/* 频段类别中文名 */
var BAND_CLASS_LABEL = {
	GW: _('2G / 3G（GSM / WCDMA）'),
	LTE: _('4G LTE'),
	NRNSA: _('5G NR（NSA 非独立组网）'),
	NRSA: _('5G NR（SA 独立组网）')
};

/* 拨号/网络模式中文名 */
var MODE_LABEL = {
	auto: _('自动'), ecm: 'ECM', ncm: 'NCM', rndis: 'RNDIS',
	mbim: 'MBIM', qmi: 'QMI', gobinet: 'GobiNet', ppp: 'PPP'
};

function modeLabel(key) {
	return MODE_LABEL[String(key).toLowerCase()] || String(key).toUpperCase();
}

return view.extend({
	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

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
		}).catch(function(err) {
			errors.push('加载失败：' + ((err && err.message) || String(err)));
			return { section: null, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-net{max-width:1120px;margin:0 auto;color:var(--text-color-high,#20242a)}',
			'.mt-net-hero{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:21px 23px;border:1px solid #cfe4fb;border-radius:15px;background:linear-gradient(135deg,#f4f9ff,#eefaf8);margin-bottom:16px}',
			'.mt-net-kicker{font-size:12px;color:#2470a9;font-weight:700;margin-bottom:5px}',
			'.mt-net-title{font-size:25px;font-weight:720;line-height:1.2;margin:0 0 6px;display:flex;align-items:center;gap:10px}',
			'.mt-net-sub{font-size:13px;color:var(--text-color-medium,#68717d)}',
			'.mt-op-logo{width:28px;height:28px;border-radius:6px;flex-shrink:0;object-fit:contain}',
			'.mt-net-badge{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;background:#dcf6eb;color:#08775d;font-size:12px;font-weight:700;white-space:nowrap}',
			'.mt-net-badge:before{content:"";width:7px;height:7px;border-radius:50%;background:#17b883}',
			'.mt-net-badge.off{background:#fff0e2;color:#99530a}.mt-net-badge.off:before{background:#e99737}',
			'.mt-net-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}',
			'.mt-net-metric,.mt-net-panel{border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff);box-shadow:0 3px 12px rgba(20,32,50,.04)}',
			'.mt-net-metric{padding:16px}.mt-net-label{font-size:12px;color:var(--text-color-medium,#707985);margin-bottom:6px}',
			'.mt-net-value{font-size:23px;font-weight:720}.mt-net-unit{font-size:12px;color:#747c86;margin-left:5px}',
			'.mt-net-metric-top{display:flex;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:9px}.mt-net-qual{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}.mt-net-qual.excellent{background:#dcf6eb;color:#08775d}.mt-net-qual.good{background:#e2f3e4;color:#2f7a3f}.mt-net-qual.fair{background:#fdf0d8;color:#9a6a12}.mt-net-qual.weak{background:#fce4e0;color:#b23b30}.mt-net-qual.unknown{background:var(--background-color-low,#eef1f4);color:#8a939d}',
			'.mt-net-gauge{position:relative;height:7px;border-radius:999px;background:var(--border-color-low,#e3e8ee);overflow:hidden;margin-top:2px}.mt-net-gauge i{display:block;height:100%;min-width:3px;border-radius:inherit;background:#4b94df;transition:width .35s ease}.mt-net-gauge i.excellent{background:linear-gradient(90deg,#0fb783,#13a979)}.mt-net-gauge i.good{background:linear-gradient(90deg,#4bb985,#3fa66f)}.mt-net-gauge i.fair{background:linear-gradient(90deg,#f0b44f,#e4a23a)}.mt-net-gauge i.weak{background:linear-gradient(90deg,#e8756c,#db5b52)}.mt-net-gauge i.unknown{background:var(--border-color-low,#cfd6de)}.mt-net-gauge-scale{display:flex;justify-content:space-between;margin-top:4px;color:var(--text-color-medium,#9099a3);font-size:9px;opacity:.8}',
			'.mt-net-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
			'.mt-net-panel{padding:16px}.mt-net-panel h3{font-size:14px;margin:0 0 12px}',
			'.mt-net-row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4);font-size:13px}',
			'.mt-net-row:last-child{border-bottom:0}.mt-net-row span:first-child{color:var(--text-color-medium,#707985)}.mt-net-row strong{text-align:right;word-break:break-word}',
			'.mt-net-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}.mt-net-actions .btn{border-radius:9px;padding:7px 14px}',
			'.mt-scan-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px;margin-top:12px}.mt-scan-panel{padding:16px}.mt-scan-panel h4{font-size:14px;margin:0 0 12px;color:var(--text-color-high,#20242a)}.mt-scan-table{width:100%;border-collapse:collapse;font-size:12.5px}.mt-scan-table th,.mt-scan-table td{padding:6px 10px;border-bottom:1px solid var(--border-color-low,#edf0f4);text-align:left}.mt-scan-table th{color:var(--text-color-medium,#707985);font-weight:600;background:var(--background-color-low,#f8fafb)}.mt-scan-table td{text-align:right;font-weight:600}.mt-scan-table td:first-child{text-align:left;font-weight:400}.mt-scan-note{color:var(--text-color-medium,#707985);font-size:12px;padding:8px 0}.mt-scan-raw{margin-top:8px}',
			'.mt-net-details{margin-top:14px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:12px;overflow:hidden}',
			'.mt-net-details summary{cursor:pointer;padding:13px 15px;font-size:13px;font-weight:650}.mt-net-raw{margin:0;padding:14px;background:#17202a;color:#dce6ef;white-space:pre-wrap;word-break:break-word;font:12px/1.55 monospace;max-height:420px;overflow:auto}',
			'.mt-freq-head{margin-top:20px;padding:19px 20px;border-radius:13px;background:linear-gradient(135deg,#f4f7fb,#f1f8f6);border:1px solid #dce7ee}.mt-freq-head h3{font-size:18px;margin:0 0 6px}.mt-freq-head p{margin:0;color:var(--text-color-medium,#68717d);font-size:12px}',
			'.mt-freq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.mt-freq-card{padding:17px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-freq-card h4{margin:0 0 12px;font-size:14px}.mt-freq-field{margin:11px 0}.mt-freq-field label{display:block;font-size:12px;color:var(--text-color-medium,#6d7680);margin-bottom:5px}.mt-freq-field input,.mt-freq-field select{width:100%;box-sizing:border-box}.mt-freq-help{font-size:11px;color:var(--text-color-medium,#7b838c);margin-top:5px}.mt-freq-actions{display:flex;justify-content:flex-end;margin-top:14px}',
			'.mt-band-card{padding:18px}.mt-band-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px}.mt-band-head h3{margin:0 0 4px;font-size:15px}.mt-band-head p{margin:0;color:var(--text-color-medium,#6d7680);font-size:11px;line-height:1.45}.mt-band-head .btn{flex:0 0 auto}.mt-band-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mt-band-option{display:flex;align-items:center;gap:9px;min-height:40px;padding:7px 10px;border:1px solid var(--border-color-low,#e8ecf0);border-radius:9px;background:var(--background-color-low,#f8fafb);cursor:pointer;font-size:12px;transition:border-color .15s ease,background-color .15s ease}.mt-band-option:hover{border-color:#9cc5ee;background:#f1f7fd}.mt-band-option input{flex:0 0 auto;width:16px!important;height:16px;margin:0}.mt-band-apply{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:15px 18px}.mt-band-apply p{margin:0;color:var(--text-color-medium,#6d7680);font-size:11px;line-height:1.5}.mt-band-apply .btn{flex:0 0 auto}',
			'.mt-band-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
			// 图形化信号条
			'.mt-sbar{display:flex;align-items:center;gap:8px;margin:4px 0}.mt-sbar-label{flex:0 0 44px;font-size:11px;font-weight:600;color:var(--text-color-medium,#707985)}.mt-sbar-track{flex:1;height:16px;border-radius:8px;background:#eef1f5;overflow:hidden;min-width:60px}.mt-sbar-fill{height:100%;border-radius:8px;transition:width .35s ease}.mt-sbar-value{flex:0 0 auto;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;min-width:72px;text-align:right}',
			'.mt-sbar.excellent .mt-sbar-fill{background:linear-gradient(90deg,#22c55e,#16a34a)}.mt-sbar.good .mt-sbar-fill{background:linear-gradient(90deg,#3b82f6,#2563eb)}.mt-sbar.fair .mt-sbar-fill{background:linear-gradient(90deg,#f59e0b,#d97706)}.mt-sbar.weak .mt-sbar-fill{background:linear-gradient(90deg,#ef4444,#dc2626)}',
			'.mt-sbar.excellent .mt-sbar-value{color:#15803d}.mt-sbar.good .mt-sbar-value{color:#1d4ed8}.mt-sbar.fair .mt-sbar-value{color:#b45309}.mt-sbar.weak .mt-sbar-value{color:#b91c1c}',
			// 载波 / 邻区卡片网格
			'.mt-lock-cell-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:10px}.mt-lock-cell-card{padding:14px;border-radius:12px;border:1px solid var(--border-color-medium,#d9dde4);background:var(--background-color-high,#fff);transition:border-color .2s ease,box-shadow .2s ease}.mt-lock-cell-card:hover{border-color:#9cc5ee;box-shadow:0 3px 12px rgba(20,32,50,.06)}',
			'.mt-lock-cell-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.mt-lock-cell-band{font-size:12px;font-weight:700;color:var(--text-color-high,#20242a)}.mt-lock-cell-btns{display:flex;gap:6px}.mt-lock-btn{flex:0 0 auto;padding:4px 12px;font-size:11px;border-radius:8px;background:#eef2f6;color:#176bc1;font-weight:700;border:1px solid #c9daf0;cursor:pointer;white-space:nowrap}.mt-lock-btn:hover{background:#dbeafe;border-color:#93c5fd;color:#1d4ed8}',
			'.mt-lock-cell-pci{margin-top:6px;font-size:10px;color:var(--text-color-medium,#707985);font-variant-numeric:tabular-nums}',
			'.mt-cell-role{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#eef2f6;color:#4a5561;font-size:10px;font-weight:700;text-transform:uppercase}.mt-cell-role.pcc{background:#dcf6eb;color:#08775d}',
			// 服务小区强调块
			'.mt-ssb-serving{padding:16px;border-radius:12px;background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1px solid var(--border-color-low,#e8ecf0);margin-bottom:12px}.mt-ssb-serving-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.mt-ssb-serving-title{font-size:13px;font-weight:700;color:var(--text-color-high,#20242a)}.mt-ssb-serving-meta{font-size:11px;color:var(--text-color-medium,#707985);font-variant-numeric:tabular-nums}',
			'@media(max-width:720px){.mt-net-hero{display:block}.mt-net-badge{margin-top:13px}.mt-net-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.mt-net-grid,.mt-freq-grid{grid-template-columns:1fr}.mt-band-options{grid-template-columns:repeat(2,minmax(0,1fr))}.mt-band-apply{display:block}.mt-band-apply .btn{width:100%;margin-top:12px}}',
			'@media(max-width:430px){.mt-band-head{display:block}.mt-band-head .btn{margin-top:10px}.mt-band-options{grid-template-columns:1fr}}'
		].join(''));
	},

	row: function(label, value) {
		var valueNode = isNode(value) ? value : E('strong', {}, shown(value));
		return E('div', { 'class': 'mt-net-row' }, [ E('span', {}, label), valueNode ]);
	},

	metric: function(label, value, unit) {
		return E('div', { 'class': 'mt-net-metric mt-ui-card' }, [
			E('div', { 'class': 'mt-net-label' }, label),
			E('span', { 'class': 'mt-net-value' }, shown(value)),
			value ? E('span', { 'class': 'mt-net-unit' }, unit) : null
		]);
	},

	metricGauge: function(label, kind, rawValue, unit, scaleLow, scaleHigh) {
		var n = num(rawValue), has = !isNaN(n), pct = 0, cls = 'unknown', ql = '';
		var tags = { excellent: _('优秀'), good: _('良好'), fair: _('一般'), weak: _('较弱') };
		if (has) {
			if (kind === 'rsrp') { pct = (n + 120) * 2.5; cls = n >= -80 ? 'excellent' : n >= -90 ? 'good' : n >= -100 ? 'fair' : 'weak'; }
			else if (kind === 'rsrq') { pct = (n + 25) * 4; cls = n >= -10 ? 'excellent' : n >= -15 ? 'good' : n >= -20 ? 'fair' : 'weak'; }
			else if (kind === 'sinr') { pct = (n + 10) * 2.5; cls = n >= 20 ? 'excellent' : n >= 13 ? 'good' : n >= 0 ? 'fair' : 'weak'; }
			else { pct = (n - 20) / 60 * 100; cls = n < 45 ? 'excellent' : n < 55 ? 'good' : n < 65 ? 'fair' : 'weak'; }
			pct = Math.max(4, Math.min(100, pct));
			ql = tags[cls] || '';
		}
		return E('div', { 'class': 'mt-net-metric mt-ui-card' }, [
			E('div', { 'class': 'mt-net-metric-top' }, [
				E('span', { 'class': 'mt-net-label', 'style': 'margin:0' }, label),
				E('span', { 'class': 'mt-net-qual ' + cls }, ql || _('无数据'))
			]),
			E('div', {}, [
				E('span', { 'class': 'mt-net-value' }, has ? String(rawValue) : '--'),
				has ? E('span', { 'class': 'mt-net-unit' }, unit) : null
			]),
			E('div', { 'class': 'mt-net-gauge' }, [ E('i', { 'class': cls, 'style': 'width:' + (has ? pct : 0) + '%' }) ]),
			E('div', { 'class': 'mt-net-gauge-scale' }, [ E('span', {}, scaleLow || ''), E('span', {}, scaleHigh || '') ])
		]);
	},

	/* ---------------- 网络模式（ECM / NCM） ---------------- */

	modeCard: function(section, modeRaw) {
		var mode = plainObject(modeRaw, 'mode');
		var keys = Object.keys(mode);
		var active = '';
		keys.forEach(function(k) {
			if (String(mode[k]) === '1') active = k;
		});
		/* QModem 按模组实际返回的能力提供可用的拨号模式，ECM / NCM 为常见兜底项 */
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
				keys.length ? E('div', { 'class': 'mt-net-actions' }, buttons)
					: E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 未上报可用的网络模式。'))
			]);
	},

	/* ---------------- 网络优选（3G / 4G / 5G） ---------------- */

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
			return E('label', { 'class': 'mt-band-option' }, [ box, E('span', {}, k) ]);
		});

		return controls.card(_('网络优选'),
			_('选择模组允许驻网的制式。至少保留一项，取消全部选择会导致无法注册网络。'), [
				E('div', { 'class': 'mt-band-options' }, options),
				E('div', { 'class': 'mt-band-actions' }, E('button', {
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

	/* ---------------- 锁频段 ---------------- */

	lockBandPanel: function(section, bandClass, data) {
		var available = bandItems(ci(data, [ 'available_band', 'availableband', 'bands' ]));
		var locked = bandItems(ci(data, [ 'lock_band', 'lockband', 'locked_band' ]));
		var lockedIds = {};
		locked.forEach(function(item) { lockedIds[item.id] = true; });

		if (!available.length) {
			available = locked.slice();
			if (!available.length)
				return E('section', { 'class': 'mt-band-card mt-ui-card' }, [
					E('div', { 'class': 'mt-band-head' }, E('div', {}, [
						E('h3', {}, BAND_CLASS_LABEL[bandClass] || bandClass),
						E('p', {}, _('本模组经 QModem 未上报该类别的可用频段。'))
					]))
				]);
		}

		var boxes = [];
		var options = available.map(function(item) {
			var box = E('input', {
				'type': 'checkbox',
				'value': item.id,
				'checked': lockedIds[item.id] ? 'checked' : null
			});
			boxes.push(box);
			return E('label', { 'class': 'mt-band-option' }, [ box, E('span', {}, item.name) ]);
		});

		return E('section', { 'class': 'mt-band-card mt-ui-card' }, [
			E('div', { 'class': 'mt-band-head' }, [
				E('div', {}, [
					E('h3', {}, BAND_CLASS_LABEL[bandClass] || bandClass),
					E('p', {}, _('已锁定 %d 个频段，共 %d 个可用频段。不勾选任何频段表示解除锁定。')
						.format(locked.length, available.length))
				]),
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() { boxes.forEach(function(b) { b.checked = true; }); }
				}, _('全选'))
			]),
			E('div', { 'class': 'mt-band-options' }, options),
			E('div', { 'class': 'mt-band-actions' }, [
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() { boxes.forEach(function(b) { b.checked = false; }); }
				}, _('清空')),
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-apply',
					'click': function() {
						var checked = boxes.filter(function(b) { return b.checked; })
							.map(function(b) { return b.value; });
						var csv = checked.join(',');
						controls.confirmModal(_('应用频段锁定'),
							csv ? _('将 %s 锁定到频段 %s？移动数据会短暂中断。').format(BAND_CLASS_LABEL[bandClass] || bandClass, csv)
								: _('解除 %s 的频段锁定？').format(BAND_CLASS_LABEL[bandClass] || bandClass),
							function() {
								return controls.setLockBand(section, { band_class: bandClass, lock_band: csv });
							}, true);
					}
				}, _('应用锁定'))
			])
		]);
	},

	lockBandSection: function(section, lockRaw, disabled) {
		var head = E('div', { 'class': 'mt-control-section-head' }, [
			E('h3', {}, _('频段锁定')),
			E('p', {}, _('限制模组可使用的频段。日常使用建议保持不锁定，锁定后在异地可能无法注册网络。'))
		]);

		var note = isDisabled(disabled, 'lockband')
			? E('div', { 'class': 'mt-control-note' }, _('固件报告频段锁定已禁用，但底层 set_lockband 方法仍可调用。尝试提交频段配置可能生效。'))
			: null;

		var lockband = plainObject(lockRaw, 'lockband');
		var classes = [ 'GW', 'LTE', 'NRNSA', 'NRSA' ].filter(function(k) {
			return lockband[k] && typeof lockband[k] === 'object';
		});
		Object.keys(lockband).forEach(function(k) {
			if (classes.indexOf(k) === -1 && lockband[k] && typeof lockband[k] === 'object')
				classes.push(k);
		});

		if (!classes.length) {
			var children = [head];
			if (note) children.push(note);
			children.push(E('div', { 'class': 'mt-control-note', 'style': 'background:#eef2f6;color:#58606a' }, _('本模组经 QModem 暂无可用的锁频段数据（get_lockband 返回为空）。')));
			return E('section', { 'class': 'mt-control-section' }, children);
		}

		var self = this;
		var children = [head];
		if (note) children.push(note);
		children.push(E('div', { 'class': 'mt-freq-grid', 'style': 'margin-top:0' }, classes.map(function(k) {
			return self.lockBandPanel(section, k, lockband[k]);
		})));
		return E('section', { 'class': 'mt-control-section' }, children);
	},

	/* ---------------- 当前频段 / 载波聚合 ---------------- */

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
				E('div', { 'class': 'mt-net-row' }, [ E('span', {}, 'PCI'), E('strong', {}, shown(pci)) ]),
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

		return E('section', { 'class': 'mt-net-panel mt-ui-card', 'style': 'margin-top:12px' }, [
			E('h3', {}, _('当前频段与载波聚合（%d 个载波）').format(cells.length)),
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
				: E('div', { 'class': 'mt-scan-note' }, _('本模组经 QModem 暂无载波聚合数据。'))
		]);
	},

	/* ---------------- 邻区 ---------------- */

	neighborSection: function(neighborRaw, disabled) {
		var head = E('h3', {}, _('邻区信息'));

		var note = (isDisabled(disabled, 'neighborcell') || isDisabled(disabled, 'neighbourcell'))
			? E('div', { 'class': 'mt-control-note', 'style': 'margin-bottom:12px' }, _('固件报告邻区查询已禁用，但底层 set_neighborcell/get_neighborcell 方法仍可调用。'))
			: null;

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
			if (rsrp !== '') children.push(signalBar(rsrp, 'rsrp', 'RSRP'));
			if (rsrq !== '') children.push(signalBar(rsrq, 'rsrq', 'RSRQ'));
			if (sinr !== '') children.push(signalBar(sinr, 'sinr', 'SINR'));
			if (pci) children.push(E('div', { 'class': 'mt-lock-cell-pci' }, 'PCI: ' + pci));
			return E('div', { 'class': 'mt-lock-cell-card' }, children.concat(extra));
		});

		return E('section', { 'class': 'mt-net-panel mt-ui-card', 'style': 'margin-top:12px' }, [
			head,
			note,
			E('div', {}, _('邻区信息（%d）').format(list.length)),
			cards.length ? E('div', { 'class': 'mt-lock-cell-grid' }, cards)
				: E('div', { 'class': 'mt-scan-note' }, _('本模组经 QModem 暂无邻区数据。'))
		].filter(Boolean));
	},

	/* ---------------- 频率扫描（AT^CELLSCAN） ---------------- */

	scanSection: function(section, atPort) {
		var host = E('div', { 'class': 'mt-scan-results' });
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
			_('经 QModem 下发 AT^CELLSCAN 并原样展示模组返回的文本。模组已驻网时可能返回错误。'), [
				E('div', { 'class': 'mt-net-actions' }, button),
				host
			], true);
	},

	scanResult: function(text) {
		var lines = atLines(text);
		if (!lines.length)
			return E('div', { 'class': 'mt-scan-note' }, _('模组未返回扫描数据。'));
		if (lines.some(function(l) { return l.indexOf('ERROR') !== -1; }))
			return E('section', { 'class': 'mt-scan-panel mt-ui-card' }, [
				E('h4', {}, _('频率扫描')),
				E('div', { 'class': 'mt-scan-note' }, _('模组拒绝了本次扫描（通常因为已驻留在小区上）。')),
				E('pre', { 'class': 'mt-net-raw mt-scan-raw' }, lines.join('\n'))
			]);
		return E('section', { 'class': 'mt-scan-panel mt-ui-card' }, [
			E('h4', {}, _('频率扫描结果（%d 行）').format(lines.length)),
			E('pre', { 'class': 'mt-net-raw mt-scan-raw' }, lines.join('\n'))
		]);
	},

	/* ---------------- 渲染 ---------------- */

	render: function(res) {
		res = res || {};
		var errors = res.errors || [];
		var warnings = errors.map(function(msg) {
			return E('div', { 'class': 'alert-message warning' }, msg);
		});

		if (!res.section)
			return E('div', { 'class': 'mt-net mt-ui-page' }, [
				this.styleNode(),
				controls.styleNode(),
				E('div', { 'class': 'alert-message warning' }, _('未检测到模组（请确认 QModem 已识别该设备）。'))
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
		var lockedSummary = Object.keys(lockband).filter(function(k) {
			return lockband[k] && bandItems(ci(lockband[k], [ 'lock_band', 'lockband' ])).length;
		}).map(function(k) {
			return (BAND_CLASS_LABEL[k] || k) + '：' +
				bandItems(ci(lockband[k], [ 'lock_band', 'lockband' ])).map(function(b) { return b.name; }).join(', ');
		});

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

		return E('div', { 'class': 'mt-net mt-ui-page' }, [
			this.styleNode(),
			controls.styleNode()
		].concat(warnings).concat([
			modemBar,
			E('section', { 'class': 'mt-net-hero mt-ui-hero' }, [
				E('div', {}, [
					E('div', { 'class': 'mt-net-kicker' }, _('网络与小区')),
					E('h2', { 'class': 'mt-net-title' }, [
						opInfo.logo ? E('img', { 'class': 'mt-op-logo', 'src': opInfo.logo, 'alt': operatorName }) : null,
						operatorName
					]),
					E('div', { 'class': 'mt-net-sub' }, _('由 QModem 上报的服务小区、频段与驻网信息。'))
				]),
				E('span', { 'class': 'mt-net-badge' + (registered ? '' : ' off') },
					registered ? (networkMode || _('已驻网')) : _('未驻网'))
			]),
			E('div', { 'class': 'mt-net-metrics' }, [
				this.metricGauge('RSRP', 'rsrp', rsrp, ' dBm', '-120', '-70'),
				this.metricGauge('RSRQ', 'rsrq', rsrq, ' dB', '-25', '-3'),
				this.metricGauge('SINR', 'sinr', sinr, ' dB', '-10', '30'),
				this.metric(_('当前频段'), band, '')
			]),
			E('div', { 'class': 'mt-net-grid' }, [
				E('section', { 'class': 'mt-net-panel' }, [
					E('h3', {}, _('服务小区')),
					this.row(_('网络模式'), networkMode),
					this.row('MCC / MNC', (mcc && mnc) ? (mcc + ' / ' + mnc) : ''),
					this.row(_('频段'), band),
					this.row('EARFCN / ARFCN', earfcn),
					this.row('PCI', pci),
					this.row(_('小区 ID'), cellId),
					this.row('TAC / LAC', tac),
					scs ? this.row(_('子载波间隔'), scsText(scs)) : null,
					this.row(_('下行带宽'), dlBw),
					this.row(_('上行带宽'), ulBw)
				]),
				E('section', { 'class': 'mt-net-panel' }, [
					E('h3', {}, _('无线状态')),
					this.row(_('运营商'), operatorName),
					this.row(_('网络模式'), activeMode ? modeLabel(activeMode) : ''),
					this.row(_('网络优选'), preferOn.length ? preferOn.join(' / ') : ''),
					this.row(_('频段锁定'), lockedSummary.length ? lockedSummary.join('；') : _('未锁定')),
					this.row(_('AT 端口'), atPort)
				])
			]),
			this.currentBandSection(res.currentBand),
			this.neighborSection(res.neighbor, disabled),
			E('div', { 'class': 'mt-net-actions' }, [
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-action',
					'click': function() { window.location.reload(); }
				}, _('刷新状态'))
			]),
			E('details', { 'class': 'mt-net-details mt-ui-details' }, [
				E('summary', {}, [
					E('span', { 'class': 'mt-ui-summary-copy' }, E('span', { 'class': 'mt-ui-summary-title' }, _('技术细节（QModem 原始数据）'))),
					E('span', { 'class': 'mt-ui-chevron', 'aria-hidden': 'true' }, '›')
				]),
				E('pre', { 'class': 'mt-net-raw mt-ui-details-body' }, rawDump)
			]),
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('无线策略')),
					E('p', {}, _('网络模式、驻网制式与频率扫描，全部经 QModem 的 qmodem ubus 下发。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.modeCard(section, res.mode),
					this.preferCard(section, res.prefer),
					this.scanSection(section, atPort)
				])
			]),
			this.lockBandSection(section, res.lockband, disabled)
		]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
