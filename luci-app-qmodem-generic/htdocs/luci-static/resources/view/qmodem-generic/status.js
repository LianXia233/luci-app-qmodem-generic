'use strict';
'require view';
'require uci';
'require qmodem-generic.controls as controls';

var E = controls.element;

/*
 * 通用模组概览页 — 现代白色毛玻璃 (Glassmorphism) + 动态高阶 SVG 仪表盘重构
 * 数据来自 QModem ubus 状态缓存，经 controls.js 适配层处理。
 */

function firstAddress(list) {
	var item = (Array.isArray(list) ? list : [])[0];
	if (!item || !item.address)
		return '';
	return item.address + (item.mask != null && item.mask !== '' ? '/' + item.mask : '');
}

function joinValues() {
	return Array.prototype.slice.call(arguments).filter(function(v) {
		return v != null && String(v) !== '';
	}).join(', ');
}

function mhz(value) {
	if (value == null || String(value).trim() === '')
		return '';
	var text = String(value).trim();
	if (!/[0-9]/.test(text))
		return '';
	return /[a-zA-Z]/.test(text) ? text : text + ' MHz';
}

function isTrafficAvailable(usage) {
	var a = usage && usage.available;
	return a === true || a === 1 || a === '1' || a === 'true';
}

function sumBandwidth(carriers, key) {
	var total = 0, found = false;
	(carriers || []).forEach(function(item) {
		var num = parseFloat(item[key]);
		if (!isNaN(num)) { total += num; found = true; }
	});
	return found ? String(Math.round(total * 100) / 100) : '';
}

function usageUpdated(value) {
	if (value == null || value === '')
		return _('等待数据');
	var num = Number(value);
	if (!isNaN(num) && num > 1000000000) {
		var date = new Date(num * 1000);
		return '%04d-%02d-%02d %02d:%02d'.format(date.getFullYear(), date.getMonth() + 1,
			date.getDate(), date.getHours(), date.getMinutes());
	}
	return String(value);
}

// 安全渲染 SVG 节点 helper
function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

// 复制文字并带有视觉反馈
function copyToClipboard(text, btn) {
	if (!text) return;
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(function() {
			if (!btn) return;
			var old = btn.innerHTML;
			btn.innerHTML = '<span style="color:var(--qm-ok);font-size:11px;font-weight:700;">' + _('已复制') + '</span>';
			setTimeout(function() { btn.innerHTML = old; }, 1600);
		}).catch(function() {});
	}
}

// 运营商专属矢量 SVG 图标
function renderOperatorSvg(opName, mcc, mnc) {
	var code = (mcc && mnc != null) ? (String(mcc) + (String(mnc).length === 1 ? '0' + mnc : mnc)) : '';
	var n = String(opName || '').toUpperCase();

	// 中国移动
	if (n.indexOf('CHINA MOBILE') !== -1 || n.indexOf('CMCC') !== -1 || n.indexOf('移动') !== -1 || /^4600[02478]/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 26 26" width="24" height="24" fill="none">',
			'  <circle cx="13" cy="13" r="12" fill="#0085d0" fill-opacity="0.14"/>',
			'  <path d="M7 15C8.4 17.5 10.8 18.5 13.8 18.2C17.2 17.7 19.2 15 18.8 12C18.5 10 17 8.7 15 8.4C13.2 8.1 11.2 8.7 10 9.8" stroke="#0085d0" stroke-width="2.2" stroke-linecap="round"/>',
			'  <path d="M19 11C17.6 8.5 15.2 7.5 12.2 7.8C8.8 8.3 6.8 11 7.2 14C7.5 16 9 17.3 11 17.6" stroke="#10b981" stroke-width="2.2" stroke-linecap="round"/>',
			'  <circle cx="13" cy="13" r="2.2" fill="#0085d0"/>',
			'</svg>'
		].join(''));
	}
	// 中国电信
	if (n.indexOf('CHINA TELECOM') !== -1 || n.indexOf('TELECOM') !== -1 || n.indexOf('电信') !== -1 || /^460(03|05|11)/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 26 26" width="24" height="24" fill="none">',
			'  <circle cx="13" cy="13" r="12" fill="#005bac" fill-opacity="0.14"/>',
			'  <path d="M6 9C8 6 12 5.5 15 7C17.5 8.5 18.5 11 18 14C17.5 17 15 19 11.5 19C9 19 7 17.5 6.5 15" stroke="#005bac" stroke-width="2.2" stroke-linecap="round"/>',
			'  <path d="M14.5 12C16 10.5 19 10.5 20.5 12C21.5 13 21.5 14.5 21 16" stroke="#005bac" stroke-width="2" stroke-linecap="round"/>',
			'</svg>'
		].join(''));
	}
	// 中国联通
	if (n.indexOf('CHINA UNICOM') !== -1 || n.indexOf('UNICOM') !== -1 || n.indexOf('联通') !== -1 || /^4600[169]/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 26 26" width="24" height="24" fill="none">',
			'  <circle cx="13" cy="13" r="12" fill="#e60012" fill-opacity="0.14"/>',
			'  <path d="M8 8L18 18M18 8L8 18" stroke="#e60012" stroke-width="2.4" stroke-linecap="round"/>',
			'  <circle cx="13" cy="13" r="3.5" stroke="#e60012" stroke-width="2"/>',
			'</svg>'
		].join(''));
	}
	// 中国广电
	if (n.indexOf('BROADNET') !== -1 || n.indexOf('CBN') !== -1 || n.indexOf('广电') !== -1 || /^46015/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 26 26" width="24" height="24" fill="none">',
			'  <circle cx="13" cy="13" r="12" fill="#6366f1" fill-opacity="0.14"/>',
			'  <circle cx="13" cy="13" r="3" fill="#6366f1"/>',
			'  <path d="M8.5 9A6.5 6.5 0 0 1 17.5 9M6 6.5A10 10 0 0 1 20 6.5" stroke="#6366f1" stroke-width="2.2" stroke-linecap="round"/>',
			'</svg>'
		].join(''));
	}
	// 通用全球蜂窝基站
	return svgNode([
		'<svg class="qm-op-icon" viewBox="0 0 26 26" width="24" height="24" fill="none">',
		'  <circle cx="13" cy="13" r="12" fill="var(--qm-accent)" fill-opacity="0.14"/>',
		'  <path d="M13 5L17 21L9 21Z" stroke="var(--qm-accent)" stroke-width="2" stroke-linejoin="round"/>',
		'  <circle cx="13" cy="5" r="2.5" fill="var(--qm-accent)"/>',
		'  <path d="M9 8A5.5 5.5 0 0 1 17 8M6.5 5.5A9 9 0 0 1 19.5 5.5" stroke="var(--qm-accent)" stroke-width="1.8" stroke-linecap="round"/>',
		'</svg>'
	].join(''));
}

return view.extend({
	POLL_INTERVAL: 6000,

	load: function() {
		var self = this;
		return controls.bootstrap().then(function(ctx) {
			self.section = ctx.section;
			return self.collect(ctx);
		});
	},

	collect: function(ctx) {
		var self = this, errors = [];
		var section = ctx.section;

		function guard(promise, label, fallback) {
			return Promise.resolve(promise).catch(function(err) {
				errors.push(label + ': ' + ((err && err.message) || String(err)));
				return fallback;
			});
		}

		self.modems = ctx.sections || [];

		if (!section)
			return { section: null, errors: errors };

		var apn = '';
		try { apn = uci.get('qmodem', section, 'apn') || ''; } catch (e) { apn = ''; }

		return Promise.all([
			guard(controls.getBaseInfo(section), _('模组'), []),
			guard(controls.getCellInfo(section), _('射频与小区'), []),
			guard(controls.getSimInfo(section), _('SIM 与订阅'), []),
			guard(controls.getConnectStatus(section), _('连接'), []),
			guard(controls.getDns(section), 'DNS', {}),
			guard(controls.getUsageStats(section), _('流量统计'), { available: 0 }),
			guard(controls.getCurrentBand(section), _('载波聚合状态'), {}),
			guard(controls.getInterfaceStatus(section), _('移动 IP'), {}),
			guard(controls.getNetworkInfo(section), _('网络'), []),
			guard(controls.getTrafficResetSchedule(section), _('流量清零计划'), {}),
			guard(controls.getDailyStats(section), _('每日流量'), null)
		]).then(function(r) {
			var iface = r[7] || {};
			var ifname = iface.interface || '';
			var devName = iface.l3_device || iface.device || '';
			var devPromise = devName
				? guard(controls.getDeviceStatus(devName), _('设备状态'), {})
				: Promise.resolve({});
			return devPromise.then(function(devStatus) {
				var allInfo = [].concat(r[0] || [], r[1] || [], r[2] || [], r[8] || []);
				return {
					section: section,
					ifname: ifname,
					apn: apn,
					base: r[0],
					cell: r[1],
					sim: r[2],
					conn: r[3],
					dns: r[4],
					usage: r[5],
					trafficResetSchedule: r[9],
					currentBand: r[6],
					iface: r[7],
					net: r[8],
					daily: r[10] || null,
					devStatus: devStatus,
					allInfo: allInfo,
					errors: errors
				};
			});
		});
	},

	parseStatus: function(res) {
		var find = controls.findEntry;
		var base = res.base || [], cell = res.cell || [], sim = res.sim || [],
		    conn = res.conn || [], net = res.net || [];

		function mbpsToKbps(v) {
			if (!controls.hasValue(v)) return null;
			var n = parseFloat(v);
			return isFinite(n) && n > 0 ? Math.round(n * 1024) : null;
		}

		var qosInfo = {
			qci: find(net, 'QCI'),
			five_qi: find(net, '5QI'),
			downlink_rate_kbps: mbpsToKbps(find(net, 'AMBR DL') || find(net, 'Downlink AMBR')),
			uplink_rate_kbps: mbpsToKbps(find(net, 'AMBR UL') || find(net, 'Uplink AMBR')),
			apn: this.cleanText(find(net, 'APN') || '')
		};

		var data = {};
		data.model = this.cleanText(
			find(base, 'model') || find(base, 'name') ||
			find(base, 'Model') || find(base, 'Model Name') ||
			find(base, 'product') || find(base, 'Product') || '');
		data.manufacturer = this.cleanText(
			find(base, 'manufacturer') || find(base, 'Manufacturer') ||
			find(base, 'vendor') || find(base, 'Vendor') || '');
		data.revision = this.cleanText(
			find(base, 'revision') || find(base, 'Revision') ||
			find(base, 'firmware') || find(base, 'Firmware') || '');
		data.imei = this.cleanText(
			find(base, 'imei') || find(base, 'IMEI') ||
			find(sim, 'imei') || find(sim, 'IMEI') || '');
		data.at_port = this.cleanText(
			find(base, 'at_port') || find(base, 'port') || '');

		data.temperature = this.cleanText(
			find(base, 'temperature') || find(cell, 'temperature') ||
			find(base, 'Temperature') || find(cell, 'Temperature') || '');
		if (data.temperature && /^-?999(\.0+)?$/.test(data.temperature))
			data.temperature = '';

		data.mcc = this.cleanText(find(cell, 'MCC') || find(net, 'MCC') || '');
		data.mnc = this.cleanText(find(cell, 'MNC') || find(net, 'MNC') || '');

		data.sysmode_detail = this.cleanText(
			find(cell, 'network_mode') || find(cell, 'Mode') ||
			find(cell, 'Network Mode') || find(net, 'network_mode') ||
			find(net, 'Network Mode') || find(net, 'RAT') ||
			find(base, 'Network Type') || '');

		data.pci = this.cleanText(
			find(cell, 'Physical Cell ID') || find(cell, 'PCI') ||
			find(cell, 'pci') || '');

		function pickEntry(list, keys) {
			for (var i = 0; i < keys.length; i++) {
				var v = find(list, keys[i]);
				if (controls.hasValue(v)) return v;
			}
			return '';
		}

		var rawRsrp = pickEntry(cell, ['RSRP', 'rsrp', 'Primary RSRP', 'SS-RSRP']);
		data.rsrp = controls.hasValue(rawRsrp) ? String(rawRsrp).trim() : '';

		var rawRsrq = pickEntry(cell, ['RSRQ', 'rsrq', 'Primary RSRQ', 'SS-RSRQ']);
		data.rsrq = controls.hasValue(rawRsrq) ? String(rawRsrq).trim() : '';

		var rawSinr = pickEntry(cell, ['SINR', 'sinr', 'Primary SINR', 'SS-SINR']);
		data.sinr = controls.hasValue(rawSinr) ? String(rawSinr).trim() : '';

		data.sim = this.cleanText(
			find(sim, 'SIM Status') || find(sim, 'sim_status') ||
			find(sim, 'Status') || find(sim, 'status') || '');
		data.iccid = this.cleanText(
			find(sim, 'ICCID') || find(sim, 'iccid') || '');
		data.imsi = this.cleanText(
			find(sim, 'IMSI') || find(sim, 'imsi') || '');
		data.phone_number = this.cleanText(
			find(sim, 'Phone Number') || find(sim, 'phone_number') ||
			find(sim, 'MSISDN') || find(sim, 'msisdn') ||
			find(net, 'SIM Number') || find(net, 'MSISDN') || '');

		data.operator_name = this.cleanText(
			find(sim, 'ISP') ||
			find(sim, 'operator') || find(sim, 'Operator') ||
			find(net, 'ISP') || find(net, 'operator') ||
			find(cell, 'ISP') || '');

		data.active_apn = this.cleanText(
			res.apn || qosInfo.apn ||
			find(net, 'APN') || find(sim, 'APN') || '');
		data.network_interface = res.ifname || '';
		data.qosInfo = qosInfo;
		data.reachable = base.length || cell.length ? '1' : '0';
		data.connected = controls.evalConnectionStatus({
			conn: conn, base: base, iface: (res.iface || {})
		}).connected ? '1' : '0';
		return data;
	},

	cleanText: function(raw) {
		if (!controls.hasValue(raw)) return '';
		return String(raw).replace(/[\x00-\x1f\x7f]+/g, '').trim();
	},

	cleanDns: function(raw) {
		if (!controls.hasValue(raw)) return '';
		var str = String(raw);
		var parts = str.split(/[\x00-\x1f\x7f]+/);
		for (var i = 0; i < parts.length; i++) {
			var p = parts[i].trim();
			if (p) return p;
		}
		return '';
	},

	parseSession: function(res, connected) {
		var self = this;
		var iface = res.iface || {}, dns = (res.dns && res.dns.dns) || {};
		var v4 = firstAddress(iface['ipv4-address']);
		var v6 = firstAddress(iface['ipv6-address']);
		if (!v6 && Array.isArray(iface['ipv6-prefix']) && iface['ipv6-prefix'][0])
			v6 = iface['ipv6-prefix'][0].address ? iface['ipv6-prefix'][0].address + '/' + iface['ipv6-prefix'][0].mask : '';
		var devIPs = {};
		if (!v4 && !v6 && res.devStatus) {
			var ds = res.devStatus;
			if (ds && typeof ds === 'object' && ds.ipv4) devIPs.v4 = String(ds.ipv4).trim();
			if (ds && typeof ds === 'object' && ds.ipv6) devIPs.v6 = String(ds.ipv6).trim();
		}
		return {
			ipv4Address: v4 || devIPs.v4 || '',
			ipv6Address: v6 || devIPs.v6 || '',
			ipv4Connected: !!v4 || !!devIPs.v4,
			ipv6Connected: !!v6 || !!devIPs.v6,
			dns4: joinValues(self.cleanDns(dns.ipv4_dns1), self.cleanDns(dns.ipv4_dns2)),
			dns6: joinValues(self.cleanDns(dns.ipv6_dns1), self.cleanDns(dns.ipv6_dns2)),
			mtu: iface.mtu || (res.devStatus && res.devStatus.mtu) || '',
			proto: iface.proto || '',
			device: iface.device || res.ifname || (res.devStatus && res.devStatus.device) || '',
			up: iface.up === true || (res.devStatus && res.devStatus.up === true),
			connected: connected
		};
	},

	styleNode: function() {
		return controls.injectStyleOnce('qm-status-style', [
			/* 顶级白色毛玻璃布局与环境光晕 */
			'.qm-app{--qm-glass-card-bg:var(--qm-glass);--qm-glass-border-color:var(--qm-glass-border);--qm-glass-shadow-val:var(--qm-shadow)}',
			'.qmodem-glass-page{position:relative;max-width:1220px;margin:0 auto;color:var(--qm-text);padding:4px 0 36px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
			
			/* 三重环境极光光球，穿透毛玻璃 */
			'.qm-ambient-orb{position:absolute;border-radius:50%;pointer-events:none;z-index:0;animation:qmAuroraFloat 22s ease-in-out infinite alternate}',
			'.qm-ambient-orb.orb-1{top:-40px;left:5%;width:480px;height:480px;background:var(--qm-glow-a);filter:blur(75px)}',
			'.qm-ambient-orb.orb-2{top:320px;right:4%;width:440px;height:440px;background:var(--qm-glow-b);filter:blur(80px);animation-delay:-7s}',
			'.qm-ambient-orb.orb-3{bottom:60px;left:22%;width:520px;height:520px;background:var(--qm-glow-c);filter:blur(85px);animation-delay:-14s}',
			'@keyframes qmAuroraFloat{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(36px,28px,0) scale(1.09)}100%{transform:translate3d(-24px,42px,0) scale(0.95)}}',

			/* 毛玻璃卡片基类 */
			'.qm-glass-card{position:relative;z-index:1;background:var(--qm-glass);backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-shadow);padding:22px 24px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease,border-color .24s ease}',
			'.qm-glass-card:hover{transform:translateY(-2px);box-shadow:var(--qm-shadow-md);border-color:var(--qm-glass-border-strong)}',

			/* 顶部旗舰 Hero 白毛玻璃大横幅 */
			'.qm-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:18px;background:var(--qm-surface-gradient)!important;border:1px solid var(--qm-glass-border-strong)!important;border-radius:22px!important}',
			'.qm-hero-title{margin:0 0 6px;font-size:27px;font-weight:850;letter-spacing:-.025em;background:var(--qm-hero-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:10px}',
			'.qm-hero-sub{font-size:13px;color:var(--qm-text-muted);line-height:1.55}',
			'.qm-hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:14px}',
			'.qm-hero-op{display:inline-flex;align-items:center;gap:8px;padding:5px 13px;border-radius:12px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);font-weight:750;color:var(--qm-text);font-size:12.5px;box-shadow:0 2px 6px rgba(0,0,0,0.03)}',
			'.qm-hero-op svg{width:22px;height:22px;flex:0 0 22px}',
			'.qm-pill-tag{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);font-size:11.5px;font-weight:600;color:var(--qm-text-soft)}',
			'.qm-pill-tag strong{color:var(--qm-text);font-weight:750}',
			'.qm-pill-dot{width:7px;height:7px;border-radius:50%;background:var(--qm-accent);box-shadow:0 0 8px var(--qm-accent)}',

			/* Hero 右侧动态雷达指示器与操作 */
			'.qm-hero-actions{display:flex;align-items:center;gap:12px;flex-shrink:0}',
			'.qm-beacon-wrap{display:inline-flex;align-items:center;gap:10px;padding:8px 18px;border-radius:999px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);box-shadow:0 2px 8px var(--qm-shadow-color);font-size:12.5px;font-weight:750}',
			'.qm-radar-beacon{position:relative;width:12px;height:12px;border-radius:50%;background:#94a3b8;flex:0 0 12px}',
			'.qm-beacon-wrap.is-online{color:var(--qm-ok);background:var(--qm-ok-soft);border-color:var(--qm-ok-border)}',
			'.qm-beacon-wrap.is-online .qm-radar-beacon{background:var(--qm-ok);box-shadow:0 0 10px var(--qm-ok)}',
			'.qm-beacon-wrap.is-online .qm-radar-beacon::before,.qm-beacon-wrap.is-online .qm-radar-beacon::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--qm-ok);opacity:0;animation:qmRadarWave 2.2s cubic-bezier(.2,.8,.4,1) infinite}',
			'.qm-beacon-wrap.is-online .qm-radar-beacon::after{animation-delay:1.1s}',
			'@keyframes qmRadarWave{0%{transform:scale(0.8);opacity:0.9}100%{transform:scale(2.5);opacity:0}}',

			/* 刷新按钮 */
			'.qm-refresh-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;min-height:38px;border-radius:999px;border:1px solid var(--qm-glass-border);background:var(--qm-glass);color:var(--qm-text);font-weight:700;font-size:12.5px;cursor:pointer;box-shadow:var(--qm-shadow);transition:all .2s ease}',
			'.qm-refresh-btn:hover{background:var(--qm-surface);border-color:var(--qm-accent-border);color:var(--qm-accent);transform:translateY(-1px);box-shadow:var(--qm-shadow-md)}',
			'.qm-refresh-btn svg{width:16px;height:16px;transition:transform .4s ease}',
			'.qm-refresh-btn:active svg{transform:rotate(180deg)}',

			/* 3 栏核心卡片网格 */
			'.qm-grid-3{display:grid;grid-template-columns:1.06fr 1.02fr 1fr;gap:18px;margin-bottom:18px}',
			'.qm-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px}',
			'.qm-card-title{font-size:15px;font-weight:800;color:var(--qm-text);display:flex;align-items:center;gap:8px;letter-spacing:-.01em}',
			'.qm-card-title svg{width:19px;height:19px;flex:0 0 19px}',
			'.qm-card-sub{font-size:11.5px;color:var(--qm-text-muted);margin-top:3px}',
			'.qm-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:999px;font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;border:1px solid transparent}',
			'.qm-badge.excellent{background:var(--qm-ok-soft);color:var(--qm-ok);border-color:var(--qm-ok-border)}',
			'.qm-badge.good{background:var(--qm-accent-soft);color:var(--qm-accent);border-color:var(--qm-accent-border)}',
			'.qm-badge.fair{background:var(--qm-warn-soft);color:var(--qm-warn);border-color:var(--qm-warn-border)}',
			'.qm-badge.weak{background:var(--qm-danger-soft);color:var(--qm-danger);border-color:var(--qm-danger-border)}',
			'.qm-badge.active{background:var(--qm-accent-soft);color:var(--qm-accent);border-color:var(--qm-accent-border)}',

			/* 信号仪表盘高阶 SVG 容器 */
			'.qm-signal-dial-box{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 0 8px}',
			'.qm-signal-dial-svg{width:210px;height:140px;overflow:visible}',
			'.qm-dial-center-box{position:absolute;top:66px;text-align:center;display:flex;flex-direction:column;align-items:center}',
			'.qm-dial-val-text{font-size:32px;font-weight:850;color:var(--qm-text);letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}',
			'.qm-dial-unit-text{font-size:10.5px;font-weight:700;color:var(--qm-text-muted);margin-top:2px}',
			'.qm-dial-wave-box{margin-top:4px;display:flex;align-items:center;gap:3px;color:var(--qm-accent)}',
			'@keyframes qmWavePulse{0%,100%{opacity:.3}50%{opacity:1}}',
			'.qm-wave-1{animation:qmWavePulse 1.8s ease-in-out infinite}',
			'.qm-wave-2{animation:qmWavePulse 1.8s ease-in-out infinite .3s}',
			'.qm-wave-3{animation:qmWavePulse 1.8s ease-in-out infinite .6s}',

			/* 信号三格微卡片 */
			'.qm-mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:12px}',
			'.qm-mini-item{padding:10px 12px;border-radius:14px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.02)}',
			'.qm-mini-label{font-size:10.5px;color:var(--qm-text-muted);font-weight:700;letter-spacing:.02em}',
			'.qm-mini-val{font-size:13.5px;font-weight:800;color:var(--qm-text);margin:3px 0 5px;font-variant-numeric:tabular-nums}',
			'.qm-mini-bar{height:5px;border-radius:999px;background:var(--qm-border-soft);overflow:hidden}',
			'.qm-mini-bar i{display:block;height:100%;border-radius:inherit;transition:width .5s cubic-bezier(.2,.8,.4,1)}',

			/* 载波聚合高阶拓扑 SVG */
			'.qm-carrier-topo-box{padding:4px 0 10px}',
			'.qm-carrier-topo-svg{width:100%;height:100px;display:block}',
			'@keyframes qmFlowDash{to{stroke-dashoffset:-36}}',
			'.qm-flow-line{stroke-dasharray:7,4;animation:qmFlowDash 1.5s linear infinite}',
			'@keyframes qmTowerPulse{0%,100%{r:2.5;opacity:1}50%{r:4.5;opacity:.4}}',
			'.qm-tower-beacon{animation:qmTowerPulse 1.8s ease-in-out infinite}',
			'.qm-cc-container{display:flex;flex-direction:column;gap:7px;max-height:180px;overflow-y:auto;padding-right:2px;margin:10px 0}',
			'.qm-cc-card{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;border-radius:13px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border)}',
			'.qm-cc-left{display:flex;align-items:center;gap:9px}',
			'.qm-cc-badge{padding:3px 7px;border-radius:7px;font-size:9.5px;font-weight:800}',
			'.qm-cc-badge.pcc{background:var(--qm-accent);color:#ffffff}',
			'.qm-cc-badge.scc{background:var(--qm-ok);color:#ffffff}',
			'.qm-cc-band{font-size:12.5px;font-weight:750;color:var(--qm-text)}',
			'.qm-cc-metrics{font-size:11px;color:var(--qm-text-muted);display:flex;gap:10px;font-variant-numeric:tabular-nums}',

			/* 移动 IP 会话卡片 */
			'.qm-ip-box{display:flex;flex-direction:column;gap:9px}',
			'.qm-ip-row{padding:11px 14px;border-radius:14px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);transition:border-color .18s ease}',
			'.qm-ip-row:hover{border-color:var(--qm-accent-border)}',
			'.qm-ip-header{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:750;color:var(--qm-text-muted);margin-bottom:5px}',
			'.qm-ip-content{display:flex;justify-content:space-between;align-items:center;gap:8px}',
			'.qm-ip-val{font:700 12.5px/1.45 var(--qm-font-mono);color:var(--qm-text);word-break:break-all}',
			'.qm-copy-btn{display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--qm-text-muted);cursor:pointer;transition:all .18s ease;flex:0 0 auto}',
			'.qm-copy-btn:hover{background:var(--qm-accent-soft);color:var(--qm-accent);border-color:var(--qm-accent-border)}',
			'.qm-copy-btn svg{width:14px;height:14px}',
			'.qm-ip-link{display:inline-flex;align-items:center;gap:5px;color:var(--qm-accent);font-size:11.5px;font-weight:750;text-decoration:none;margin-top:auto;padding-top:10px;transition:gap .18s ease}',
			'.qm-ip-link:hover{gap:8px;text-decoration:none}',

			/* 2 栏网格 (模组与 SIM) */
			'.qm-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}',
			'.qm-list-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
			'.qm-list-row:last-child{border-bottom:0}',
			'.qm-list-row span{color:var(--qm-text-muted);font-weight:600}',
			'.qm-list-row strong{color:var(--qm-text);font-weight:700;text-align:right}',
			'.qm-val-with-copy{display:inline-flex;align-items:center;gap:6px}',

			/* 流量统计高阶 Area 图表面板 */
			'.qm-traffic-layout{display:grid;grid-template-columns:repeat(3,minmax(0,.75fr)) minmax(320px,1.9fr);gap:14px;margin-top:16px}',
			'.qm-stat-card{padding:16px;border-radius:16px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);display:flex;flex-direction:column;justify-content:center}',
			'.qm-stat-label{font-size:11.5px;color:var(--qm-text-muted);font-weight:700;display:flex;align-items:center;gap:6px}',
			'.qm-stat-val{font-size:22px;font-weight:850;color:var(--qm-text);margin:6px 0 2px;letter-spacing:-.025em;font-variant-numeric:tabular-nums}',
			'.qm-stat-sub{font-size:10.5px;color:var(--qm-text-muted)}',
			'.qm-traffic-chart-box{background:var(--qm-glass-inner);border-radius:16px;border:1px solid var(--qm-glass-inner-border);padding:14px 16px}',
			'.qm-traffic-chart-svg{width:100%;height:120px;display:block}',

			/* 快捷导航 */
			'.qm-shortcuts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:18px 0}',
			'.qm-shortcut-item{position:relative;display:flex;align-items:center;gap:14px;min-width:0;min-height:96px;padding:18px 20px;overflow:hidden;color:var(--qm-text);text-decoration:none;background:var(--qm-glass);backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);border:1px solid var(--qm-glass-border);border-radius:18px;box-shadow:var(--qm-shadow);transition:all .22s cubic-bezier(.2,.8,.4,1)}',
			'.qm-shortcut-item::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--qm-accent-gradient)}',
			'.qm-shortcut-item:hover{transform:translateY(-2px);border-color:var(--qm-accent-border);box-shadow:var(--qm-shadow-md);text-decoration:none}',
			'.qm-shortcut-icon{display:flex;align-items:center;justify-content:center;flex:0 0 44px;height:44px;border-radius:14px;background:var(--qm-accent-soft);color:var(--qm-accent);box-shadow:0 2px 8px rgba(0,0,0,0.03)}',
			'.qm-shortcut-icon svg{width:22px;height:22px;stroke:currentColor}',
			'.qm-shortcut-copy{flex:1;min-width:0}',
			'.qm-shortcut-copy strong{display:block;font-size:14px;font-weight:750;color:var(--qm-text);line-height:1.4}',
			'.qm-shortcut-copy span{display:block;font-size:12px;color:var(--qm-text-muted);margin-top:4px;line-height:1.55;white-space:normal}',
			'.qm-shortcut-arrow{display:flex;align-items:center;justify-content:center;flex:0 0 24px;height:24px;color:var(--qm-accent);transition:transform .2s ease}',
			'.qm-shortcut-item:hover .qm-shortcut-arrow{transform:translateX(3px)}',
			'.qm-shortcut-arrow svg{width:18px;height:18px}',

			/* 完整信息折叠面板 */
			'.qm-info-details>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;cursor:pointer;list-style:none;font-size:15px;font-weight:750;color:var(--qm-text);padding:2px 0}',
			'.qm-info-details>summary::-webkit-details-marker{display:none}',
			'.qm-info-details>summary::before{content:"\\25B8";color:var(--qm-text-muted);transition:transform .18s ease;display:inline-block;margin-right:8px;font-size:14px}',
			'.qm-info-details[open]>summary::before{transform:rotate(90deg)}',
			'.qm-info-details[open]>summary{border-bottom:1px solid var(--qm-border-soft);padding-bottom:12px;margin-bottom:16px}',
			'.qm-info-count{font-size:11.5px;font-weight:700;color:var(--qm-text-muted);background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);padding:3px 9px;border-radius:999px}',

			/* 响应式断点 */
			'@media(max-width:980px){.qm-grid-3{grid-template-columns:1fr 1fr}.qm-address-card{grid-column:1/-1}.qm-traffic-layout{grid-template-columns:repeat(3,1fr)}.qm-traffic-chart-box{grid-column:1/-1}}',
			'@media(max-width:720px){.qm-hero{flex-direction:column;align-items:flex-start;padding:20px}.qm-hero-actions{width:100%;justify-content:space-between}.qm-grid-3,.qm-grid-2,.qm-shortcuts,.qm-traffic-layout{grid-template-columns:1fr}.qm-address-card,.qm-traffic-chart-box{grid-column:auto}}'
		].join(''));
	},

	signalQuality: function(kind, value) {
		var percentage, levels, index;
		if (isNaN(value))
			return { label:_('暂无数据'), cls:'unknown', percentage:0, strokeColor:'#94a3b8' };
		if (kind === 'rsrp') { percentage = (value + 120) * 2.5; levels = [ -80, -90, -100 ]; }
		else if (kind === 'rsrq') { percentage = (value + 25) * 4; levels = [ -10, -15, -20 ]; }
		else { percentage = (value + 10) * 2.5; levels = [ 20, 13, 0 ]; }
		index = value >= levels[0] ? 0 : value >= levels[1] ? 1 : value >= levels[2] ? 2 : 3;
		var colors = [ 'var(--qm-ok)', 'var(--qm-accent)', 'var(--qm-warn)', 'var(--qm-danger)' ];
		return {
			label:[ _('优'), _('良'), _('中'), _('差') ][index],
			cls:[ 'excellent', 'good', 'fair', 'weak' ][index],
			percentage: Math.max(0, Math.min(100, percentage)),
			strokeColor: colors[index]
		};
	},

	carrierInfo: function(res) {
		var find = controls.findEntry;
		var cell = res.cell || [];
		var raw = (res.currentBand && res.currentBand.current_band) || {};
		var mode = raw.network_mode || find(cell, 'network_mode') || '';
		var cells = Array.isArray(raw.cells) ? raw.cells : [];

		var carriers = cells.map(function(item) {
			return {
				role: item.role || '',
				radio: item.rat || '',
				band: item.band_name || item.band || '',
				arfcn: controls.valueText(item.channel),
				channelType: item.channel_type || '',
				pci: controls.valueText(item.pci),
				scs: controls.valueText(item.scs),
				dlBandwidth: controls.valueText(item.dl_bandwidth),
				ulBandwidth: controls.valueText(item.ul_bandwidth)
			};
		}).filter(function(item) { return item.band || item.arfcn; });

		if (!carriers.length) {
			var single = {
				role: 'PCC',
				radio: /NR/i.test(mode) ? 'NR' : /LTE/i.test(mode) ? 'LTE' : '',
				band: find(cell, 'Band') || '',
				arfcn: find(cell, 'EARFCN') || find(cell, 'ARFCN') || '',
				channelType: find(cell, 'EARFCN') ? 'EARFCN' : (find(cell, 'ARFCN') ? 'ARFCN' : ''),
				pci: controls.valueText(find(cell, 'Physical Cell ID')),
				scs: controls.valueText(find(cell, 'SCS')),
				dlBandwidth: find(cell, 'DL Bandwidth') || '',
				ulBandwidth: find(cell, 'UL Bandwidth') || ''
			};
			if (single.band || single.arfcn)
				carriers = [ single ];
		}

		return {
			available: carriers.length > 0,
			active: carriers.length > 1,
			dual: /EN-?DC|NSA/i.test(mode),
			mode: mode,
			count: carriers.length,
			band: find(cell, 'Band') || (carriers[0] ? carriers[0].band : ''),
			dlBandwidth: find(cell, 'DL Bandwidth') || sumBandwidth(carriers, 'dlBandwidth'),
			ulBandwidth: find(cell, 'UL Bandwidth') || sumBandwidth(carriers, 'ulBandwidth'),
			carriers: carriers
		};
	},

	/* 动态高阶 240度 SVG 信号仪表圆盘组件 */
	renderSvgSignalDial: function(quality, rsrp) {
		var radius = 72;
		// 240度大范围弧度: (240 / 360) * 2 * PI * 72 ≈ 301.6
		var totalArcLen = (240 / 180) * Math.PI * radius;
		var pct = Math.max(0, Math.min(100, quality.percentage));
		var activeLen = (pct / 100) * totalArcLen;
		var color = quality.strokeColor || 'var(--qm-accent)';

		// 计算当前指标探针点在圆周上的极坐标位置
		// 起始角度 150度，总跨度 240度
		var curAngleDeg = 150 + (pct / 100) * 240;
		var rad = curAngleDeg * Math.PI / 180;
		var beadX = 105 + radius * Math.cos(rad);
		var beadY = 96 + radius * Math.sin(rad);

		// 外围精密刻度线 (5 档主要刻度)
		var tickMarks = [];
		var tickLabels = [ '-120', '-105', '-90', '-75', '-60' ];
		for (var t = 0; t < 5; t++) {
			var tAngle = (150 + t * 60) * Math.PI / 180;
			var xInner = 105 + 80 * Math.cos(tAngle);
			var yInner = 96 + 80 * Math.sin(tAngle);
			var xOuter = 105 + 86 * Math.cos(tAngle);
			var yOuter = 96 + 86 * Math.sin(tAngle);
			tickMarks.push('<line x1="' + xInner.toFixed(1) + '" y1="' + yInner.toFixed(1) + '" x2="' + xOuter.toFixed(1) + '" y2="' + yOuter.toFixed(1) + '" stroke="var(--qm-border)" stroke-width="1.6" stroke-linecap="round"/>');
		}

		var svgStr = [
			'<svg class="qm-signal-dial-svg" viewBox="0 0 210 140">',
			'  <defs>',
			'    <linearGradient id="qmSignalGrad" x1="0%" y1="100%" x2="100%" y2="0%">',
			'      <stop offset="0%" stop-color="#3b82f6"/>',
			'      <stop offset="35%" stop-color="#06b6d4"/>',
			'      <stop offset="70%" stop-color="#10b981"/>',
			'      <stop offset="100%" stop-color="' + (quality.cls === 'weak' ? '#ef4444' : quality.cls === 'fair' ? '#f59e0b' : '#10b981') + '"/>',
			'    </linearGradient>',
			'    <filter id="qmDialGlow" x="-20%" y="-20%" width="140%" height="140%">',
			'      <feGaussianBlur stdDeviation="3.5" result="blur"/>',
			'      <feComposite in="SourceGraphic" in2="blur" operator="over"/>',
			'    </filter>',
			'  </defs>',
			'  <!-- 外围刻度线 -->',
			tickMarks.join(''),
			'  <!-- 底轨圆弧 (240度) -->',
			'  <path d="M 42.6 132 A 72 72 0 1 1 167.4 132" fill="none" stroke="var(--qm-border-soft)" stroke-width="10" stroke-linecap="round"/>',
			'  <!-- 动态指示圆弧 -->',
			'  <path d="M 42.6 132 A 72 72 0 1 1 167.4 132" fill="none" stroke="url(#qmSignalGrad)" stroke-width="10" stroke-linecap="round"',
			'        stroke-dasharray="' + activeLen.toFixed(1) + ' ' + totalArcLen.toFixed(1) + '"',
			'        filter="url(#qmDialGlow)" style="transition: stroke-dasharray .6s cubic-bezier(.2,.8,.4,1);"/>',
			'  <!-- 弧尖高亮指示光珠 -->',
			pct > 3 ? '  <circle cx="' + beadX.toFixed(1) + '" cy="' + beadY.toFixed(1) + '" r="5.5" fill="#ffffff" stroke="' + color + '" stroke-width="2.5" filter="url(#qmDialGlow)"/>' : '',
			'</svg>'
		].join('');

		return E('div', { 'class': 'qm-signal-dial-box' }, [
			svgNode(svgStr),
			E('div', { 'class': 'qm-dial-center-box' }, [
				E('div', { 'class': 'qm-dial-val-text' }, isNaN(parseFloat(rsrp)) ? '--' : String(rsrp)),
				E('div', { 'class': 'qm-dial-unit-text' }, 'dBm · RSRP'),
				E('div', { 'class': 'qm-dial-wave-box' }, [
					svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 20v-8"/><circle cx="12" cy="7" r="2.5"/><path d="M8 4a7 7 0 0 0 0 6" class="qm-wave-1"/><path d="M16 4a7 7 0 0 1 0 6" class="qm-wave-1"/><path d="M5 2a11 11 0 0 0 0 10" class="qm-wave-2"/><path d="M19 2a11 11 0 0 1 0 10" class="qm-wave-2"/></svg>'),
					E('span', { 'class': 'qm-badge ' + quality.cls, 'style': 'padding:2px 7px;font-size:9.5px' }, quality.label)
				])
			])
		]);
	},

	metricGauge: function(label, kind, rawValue, unit) {
		var num = parseFloat(rawValue), has = !isNaN(num), pct = 0, color = 'var(--qm-text-muted)';
		if (!has) return null;
		if (has) {
			if (kind === 'rsrq') { pct = (num + 25) * 4; color = num >= -10 ? 'var(--qm-ok)' : num >= -15 ? 'var(--qm-accent)' : num >= -20 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			else if (kind === 'sinr') { pct = (num + 10) * 2.5; color = num >= 20 ? 'var(--qm-ok)' : num >= 13 ? 'var(--qm-accent)' : num >= 0 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			else { pct = (num - 20) / 60 * 100; color = num < 45 ? 'var(--qm-ok)' : num < 55 ? 'var(--qm-accent)' : num < 65 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			pct = Math.max(5, Math.min(100, pct));
		}
		return E('div', { 'class': 'qm-mini-item' }, [
			E('div', { 'class': 'qm-mini-label' }, label),
			E('div', { 'class': 'qm-mini-val' }, has ? (String(rawValue) + (unit || '')) : '--'),
			E('div', { 'class': 'qm-mini-bar' }, [
				E('i', { 'style': 'width:' + (has ? pct : 0) + '%;background:' + color })
			])
		]);
	},

	signalCard: function(data) {
		var rsrp = parseFloat(data.rsrp);
		if ([ data.rsrp, data.rsrq, data.sinr, data.temperature ].every(function(v) { return !controls.hasValue(v); })) return null;
		var quality = this.signalQuality('rsrp', rsrp);
		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/></svg>'),
						_('无线射频')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('实时射频环境与信道质量'))
				]),
				E('span', { 'class': 'qm-badge ' + quality.cls }, quality.label)
			]),
			!isNaN(rsrp) ? this.renderSvgSignalDial(quality, data.rsrp) : null,
			E('div', { 'class': 'qm-mini-grid' }, [
				this.metricGauge('RSRQ', 'rsrq', data.rsrq, ' dB'),
				this.metricGauge('SINR', 'sinr', data.sinr, ' dB'),
				this.metricGauge(_('温度'), 'temp', data.temperature, '°C')
			])
		]);
	},

	/* 动态高阶 5G 基站与载波聚合 SVG 拓扑 */
	renderSvgCarrierTopo: function(info) {
		var hasCa = info.carriers && info.carriers.length > 1;
		var lineStroke1 = 'var(--qm-accent)';
		var lineStroke2 = 'var(--qm-ok)';

		var svgStr = [
			'<svg class="qm-carrier-topo-svg" viewBox="0 0 340 92">',
			'  <defs>',
			'    <linearGradient id="qmTowerGlow" x1="0%" y1="0%" x2="100%" y2="100%">',
			'      <stop offset="0%" stop-color="var(--qm-accent)"/>',
			'      <stop offset="100%" stop-color="#38bdf8"/>',
			'    </linearGradient>',
			'    <filter id="qmParticleGlow">',
			'      <feGaussianBlur stdDeviation="2" result="blur"/>',
			'      <feComposite in="SourceGraphic" in2="blur" operator="over"/>',
			'    </filter>',
			'  </defs>',
			'  <!-- 5G 宏站塔矢量 -->',
			'  <g transform="translate(18, 12)">',
			'    <path d="M16 2 L23 48 L9 48 Z" fill="none" stroke="url(#qmTowerGlow)" stroke-width="2.2" stroke-linejoin="round"/>',
			'    <line x1="7" y1="20" x2="25" y2="20" stroke="var(--qm-accent)" stroke-width="1.8"/>',
			'    <line x1="10" y1="33" x2="22" y2="33" stroke="var(--qm-accent)" stroke-width="1.8"/>',
			'    <!-- 顶端闪烁航空警示灯 -->',
			'    <circle cx="16" cy="2" r="3" fill="#ef4444" class="qm-tower-beacon"/>',
			'    <!-- 辐射射频电磁波 -->',
			'    <path d="M10 -2 A 8 8 0 0 1 22 -2" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round"/>',
			'    <path d="M6 -6 A 13 13 0 0 1 26 -6" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3,3"/>',
			'    <text x="16" y="60" font-size="9" fill="var(--qm-text-muted)" text-anchor="middle" font-weight="700">5G gNB</text>',
			'  </g>',
			'  <!-- PCC 动态数据束波 -->',
			'  <path d="M 52 28 C 115 12, 175 18, 250 26" fill="none" stroke="' + lineStroke1 + '" stroke-width="2.5" class="qm-flow-line"/>',
			'  <!-- SCC 动态副载波束波 -->',
			hasCa ? '  <path d="M 52 36 C 115 52, 175 46, 250 38" fill="none" stroke="' + lineStroke2 + '" stroke-width="2.5" class="qm-flow-line" style="animation-duration:1.1s;"/>' : '',
			'  <!-- 模组终端汇聚芯片节点 -->',
			'  <g transform="translate(254, 12)">',
			'    <rect x="0" y="4" width="58" height="38" rx="10" fill="var(--qm-glass)" stroke="var(--qm-glass-border-strong)" stroke-width="1.8"/>',
			'    <!-- 芯片金手指引脚 -->',
			'    <line x1="10" y1="1" x2="10" y2="4" stroke="var(--qm-accent)" stroke-width="1.6"/>',
			'    <line x1="20" y1="1" x2="20" y2="4" stroke="var(--qm-accent)" stroke-width="1.6"/>',
			'    <line x1="30" y1="1" x2="30" y2="4" stroke="var(--qm-accent)" stroke-width="1.6"/>',
			'    <line x1="40" y1="1" x2="40" y2="4" stroke="var(--qm-accent)" stroke-width="1.6"/>',
			'    <text x="29" y="22" font-size="11" font-weight="850" fill="var(--qm-text)" text-anchor="middle">' + controls.xmlText(hasCa ? info.count + 'CA' : '1CC') + '</text>',
			'    <text x="29" y="34" font-size="8.5" font-weight="700" fill="var(--qm-text-muted)" text-anchor="middle">' + controls.xmlText(info.carriers[0] ? (info.carriers[0].band || 'Modem') : 'Modem') + '</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	carrierCard: function(info, devStatus) {
		if (!info.available) return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-title' }, _('载波聚合状态')),
			E('p', { 'class': 'qm-card-sub' }, _('QModem 暂未提供载波数据。'))
		]);
		var active = info.active || info.dual;
		var badge = !info.available ? _('不可用') : info.active ? _('载波聚合中') : info.dual ? _('双连接') : _('单载波');

		var ccElements = info.carriers.map(function(item, idx) {
			var isPcc = idx === 0 || /^(pcc|pcell|primary)$/i.test(item.role);
			return E('div', { 'class': 'qm-cc-card' }, [
				E('div', { 'class': 'qm-cc-left' }, [
					E('span', { 'class': 'qm-cc-badge ' + (isPcc ? 'pcc' : 'scc') }, isPcc ? 'PCC' : 'SCC' + idx),
					E('span', { 'class': 'qm-cc-band' }, joinValues(item.radio, item.band).replace(', ', ' · ') || '--')
				]),
				E('div', { 'class': 'qm-cc-metrics' }, [
					controls.hasValue(item.pci) ? E('span', {}, 'PCI ' + item.pci) : null,
					mhz(item.dlBandwidth) ? E('span', {}, 'DL ' + mhz(item.dlBandwidth)) : null,
					mhz(item.ulBandwidth) ? E('span', {}, 'UL ' + mhz(item.ulBandwidth)) : null
				].filter(Boolean))
			]);
		});

		var speedItem = null;
		if (devStatus && devStatus.speed) {
			var m = String(devStatus.speed).match(/^(\d+)/);
			var linkSpeed = m ? parseInt(m[1], 10) : 0;
			var linkLabel = linkSpeed >= 1000
				? (linkSpeed / 1000).toFixed(linkSpeed % 1000 === 0 ? 0 : 1) + ' Gbps'
				: linkSpeed + ' Mbps';
			speedItem = E('div', { 'class': 'qm-mini-item', 'style': 'grid-column:1/-1;text-align:left;display:flex;justify-content:space-between;align-items:center' }, [
				E('span', { 'class': 'qm-mini-label' }, _('物理链路速率')),
				E('strong', { 'style': 'font-size:12.5px;color:var(--qm-accent);font-weight:750' }, linkLabel)
			]);
		}

		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>'),
						_('载波聚合')
					]),
					E('div', { 'class': 'qm-card-sub' }, info.mode || _('移动网络拓扑'))
				]),
				E('span', { 'class': 'qm-badge' + (active ? ' active' : '') }, badge)
			]),
			E('div', { 'class': 'qm-carrier-topo-box' }, [ this.renderSvgCarrierTopo(info) ]),
			E('div', { 'class': 'qm-cc-container' }, ccElements),
			E('div', { 'class': 'qm-mini-grid', 'style': 'grid-template-columns:1fr 1fr' }, [
				mhz(info.dlBandwidth) ? E('div', { 'class': 'qm-mini-item' }, [ E('div', { 'class': 'qm-mini-label' }, _('下行总带宽')), E('div', { 'class': 'qm-mini-val' }, mhz(info.dlBandwidth)) ]) : null,
				mhz(info.ulBandwidth) ? E('div', { 'class': 'qm-mini-item' }, [ E('div', { 'class': 'qm-mini-label' }, _('上行总带宽')), E('div', { 'class': 'qm-mini-val' }, mhz(info.ulBandwidth)) ]) : null,
				speedItem
			].filter(Boolean)),
			E('a', { 'class': 'qm-ip-link', 'href': L.url('admin/modem/qmodem-generic/network') }, [ _('查看无线与小区详情'), ' →' ])
		]);
	},

	addressCard: function(session) {
		var active = session.connected || session.ipv4Connected || session.ipv6Connected;

		function copyBtn(val) {
			var btn = E('button', {
				'type': 'button',
				'class': 'qm-copy-btn',
				'title': _('复制地址'),
				'click': function(ev) {
					ev.stopPropagation();
					copyToClipboard(val, ev.currentTarget);
				}
			}, [ svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>') ]);
			return btn;
		}

		return E('section', { 'class': 'qm-glass-card qm-address-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'),
						_('移动 IP 会话')
					]),
					E('div', { 'class': 'qm-card-sub' }, joinValues(session.device, session.proto) || _('已建立数据通道'))
				]),
				E('span', { 'class': 'qm-badge' + (active ? ' excellent' : ' weak') }, active ? _('已激活') : _('已断开'))
			]),
			E('div', { 'class': 'qm-ip-box' }, [
				session.ipv4Address ? E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [
						E('span', {}, 'IPv4'),
						E('span', { 'style': 'color:' + (session.ipv4Connected ? 'var(--qm-ok)' : 'var(--qm-text-muted)') }, session.ipv4Connected ? '● ' + _('已连接') : '○ ' + _('未分配'))
					]),
					E('div', { 'class': 'qm-ip-content' }, [
						E('span', { 'class': 'qm-ip-val' }, session.ipv4Address || '--'),
						copyBtn(session.ipv4Address)
					])
				]) : null,
				session.ipv6Address ? E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [
						E('span', {}, 'IPv6'),
						E('span', { 'style': 'color:' + (session.ipv6Connected ? 'var(--qm-ok)' : 'var(--qm-text-muted)') }, session.ipv6Connected ? '● ' + _('已连接') : '○ ' + _('未分配'))
					]),
					E('div', { 'class': 'qm-ip-content' }, [
						E('span', { 'class': 'qm-ip-val' }, session.ipv6Address || '--'),
						copyBtn(session.ipv6Address)
					])
				]) : null,
				joinValues(session.dns4, session.dns6) ? E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [ E('span', {}, 'DNS 服务器') ]),
					E('div', { 'class': 'qm-ip-content' }, [
						E('span', { 'class': 'qm-ip-val' }, joinValues(session.dns4, session.dns6) || '--'),
						copyBtn(joinValues(session.dns4, session.dns6))
					])
				]) : null
			]),
			E('div', { 'style': 'display:flex;justify-content:space-between;margin-top:12px;font-size:11.5px;color:var(--qm-text-muted)' }, [
				session.mtu ? E('span', {}, 'MTU: ' + session.mtu) : null,
				E('span', {}, session.up ? '接口运行中' : '接口已挂起')
			]),
			E('a', { 'class': 'qm-ip-link', 'href': L.url('admin/modem/qmodem-generic/connection') }, [ _('查看移动数据详情'), ' →' ])
		]);
	},

	subscriptionRate: function(qosInfo) {
		qosInfo = qosInfo || {};
		var down = Number(qosInfo.downlink_rate_kbps != null ? qosInfo.downlink_rate_kbps : qosInfo.downlink_rate);
		var up = Number(qosInfo.uplink_rate_kbps != null ? qosInfo.uplink_rate_kbps : qosInfo.uplink_rate);
		down = isFinite(down) && down > 0 ? down : null;
		up = isFinite(up) && up > 0 ? up : null;
		if (down == null && up == null)
			return null;
		return _('下行 %s / 上行 %s').format(
			down != null ? controls.formatRate(down) : '--',
			up != null ? controls.formatRate(up) : '--'
		);
	},

	qosExplain: function(qosInfo) {
		qosInfo = qosInfo || {};
		var out = [];
		function pushLevel(type, val, map) {
			var n = val == null ? NaN : parseInt(val, 10);
			if (!isFinite(n) || n <= 0) return;
			var m = map[n] || { label: type + ' ' + n, desc: _('自定义承载') };
			out.push({ label: type + ' ' + n, desc: m.desc });
		}
		var qciMap = {
			1:  { desc: _('GBR · 实时语音') },
			2:  { desc: _('GBR · 实时视频') },
			3:  { desc: _('GBR · 低延迟交互') },
			4:  { desc: _('GBR · 缓冲流视频') },
			5:  { desc: _('Non-GBR · IMS 信令') },
			6:  { desc: _('Non-GBR · TCP 优先') },
			7:  { desc: _('Non-GBR · 交互业务') },
			8:  { desc: _('Non-GBR · 通用数据') },
			9:  { desc: _('Non-GBR · 后台数据') }
		};
		var qi5Map = {
			1:  { desc: _('GBR · 会话语音') },
			2:  { desc: _('GBR · 会话视频') },
			3:  { desc: _('GBR · 实时游戏') },
			4:  { desc: _('GBR · 缓冲流媒体') },
			5:  { desc: _('Non-GBR · IMS 信令') },
			6:  { desc: _('Non-GBR · 交互业务') },
			7:  { desc: _('Non-GBR · 低延迟交互') },
			8:  { desc: _('Non-GBR · 默认数据') },
			9:  { desc: _('Non-GBR · 后台数据') }
		};
		pushLevel('QCI', qosInfo.qci, qciMap);
		pushLevel('5QI', qosInfo.five_qi, qi5Map);
		if (!out.length)
			return { label: '', desc: '' };
		return {
			label: out.map(function(o) { return o.label; }).join(' · '),
			desc: out.map(function(o) { return o.desc; }).join(' / ')
		};
	},

	infoRow: function(label, value) {
		return controls.dataRow(label, value, 'qm-list-row');
	},

	moduleCard: function(data) {
		function copyItem(text) {
			if (!text) return text;
			return E('div', { 'class': 'qm-val-with-copy' }, [
				E('strong', {}, text),
				E('button', {
					'type': 'button',
					'class': 'qm-copy-btn',
					'title': _('复制'),
					'click': function(ev) { copyToClipboard(text, ev.currentTarget); }
				}, [ svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>') ])
			]);
		}

		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>'),
						_('模组硬件')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('芯片架构与底层固件'))
				]),
				E('span', { 'class': 'qm-badge active' }, data.model || _('模组'))
			]),
			E('div', {}, [
				this.infoRow(_('硬件厂商'), data.manufacturer),
				this.infoRow(_('设备型号'), data.model),
				this.infoRow(_('固件版本'), data.revision),
				data.imei ? this.infoRow('IMEI', copyItem(data.imei)) : null,
				this.infoRow(_('控制端口'), data.at_port)
			])
		]);
	},

	simCard: function(data) {
		var simState = data.sim || '';
		var simOk = /^(?:SIM )?(?:READY|正常|OK)$/i.test(String(simState).trim());
		var subRate = this.subscriptionRate(data.qosInfo);
		var qosLvl = this.qosExplain(data.qosInfo);

		function copyItem(text) {
			if (!text) return text;
			return E('div', { 'class': 'qm-val-with-copy' }, [
				E('strong', {}, text),
				E('button', {
					'type': 'button',
					'class': 'qm-copy-btn',
					'title': _('复制'),
					'click': function(ev) { copyToClipboard(text, ev.currentTarget); }
				}, [ svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>') ])
			]);
		}

		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="8" y="10" width="8" height="8" rx="1.5"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="12" y1="10" x2="12" y2="18"/></svg>'),
						_('SIM 与订阅')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('卡片状态与签约服务质量'))
				]),
				E('span', { 'class': 'qm-badge' + (simOk ? ' excellent' : ' weak') }, simOk ? _('就绪') : (simState || _('未知')))
			]),
			E('div', {}, [
				this.infoRow(_('运营商'), data.operator),
				this.infoRow(_('接入制式'), data.sysmode_detail),
				this.infoRow(_('接入点 (APN)'), data.active_apn),
				this.infoRow(_('签约速率'), subRate),
				qosLvl.label ? E('div', { 'class': 'qm-list-row' }, [
					E('span', {}, _('QoS 等级')),
					E('div', { 'style': 'text-align:right' }, [
						E('strong', { 'style': 'color:var(--qm-accent)' }, qosLvl.label),
						E('span', { 'style': 'font-weight:500;margin-left:6px;font-size:11px;color:var(--qm-text-muted)' }, qosLvl.desc)
					])
				]) : null,
				data.iccid ? this.infoRow('ICCID', copyItem(data.iccid)) : null,
				data.imsi ? this.infoRow('IMSI', copyItem(data.imsi)) : null
			])
		]);
	},

	/* 动态高阶平滑 SVG 双轨面积流量折线图 */
	renderSvgTrafficChart: function(days, swapped) {
		var list = Array.isArray(days) ? days.slice(-8) : [];
		if (!list.length) {
			return E('div', { 'style': 'text-align:center;padding:40px 0;color:var(--qm-text-muted);font-size:12px' }, _('暂无分天流量数据'));
		}
		var max = 1;
		list.forEach(function(d) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			max = Math.max(max, rx, tx);
		});

		var svgW = 440, svgH = 100, baseY = 82;
		var len = list.length;
		var gap = svgW / Math.max(1, len - 1);

		var dlPoints = [], ulPoints = [];
		list.forEach(function(d, i) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			var x = (len === 1) ? svgW / 2 : i * gap;
			var yDl = baseY - Math.max(3, (rx / max) * 64);
			var yUl = baseY - Math.max(3, (tx / max) * 64);
			dlPoints.push({ x: x, y: yDl });
			ulPoints.push({ x: x, y: yUl });
		});

		// 构造三次贝塞尔平滑路径
		function makeBezierPath(pts) {
			if (!pts.length) return '';
			if (pts.length === 1) return 'M ' + (pts[0].x - 10) + ' ' + pts[0].y + ' L ' + (pts[0].x + 10) + ' ' + pts[0].y;
			var path = 'M ' + pts[0].x + ' ' + pts[0].y;
			for (var i = 0; i < pts.length - 1; i++) {
				var p0 = pts[i], p1 = pts[i + 1];
				var cp1x = p0.x + (p1.x - p0.x) * 0.45;
				var cp1y = p0.y;
				var cp2x = p0.x + (p1.x - p0.x) * 0.55;
				var cp2y = p1.y;
				path += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1);
			}
			return path;
		}

		var dlPathStr = makeBezierPath(dlPoints);
		var ulPathStr = makeBezierPath(ulPoints);
		var dlAreaStr = dlPathStr + ' L ' + (dlPoints[dlPoints.length - 1].x) + ' ' + baseY + ' L ' + dlPoints[0].x + ' ' + baseY + ' Z';
		var ulAreaStr = ulPathStr + ' L ' + (ulPoints[ulPoints.length - 1].x) + ' ' + baseY + ' L ' + ulPoints[0].x + ' ' + baseY + ' Z';

		// 日期刻度文字
		var dateTexts = list.map(function(d, i) {
			var x = (len === 1) ? svgW / 2 : i * gap;
			var label = String(d.date || '').slice(5);
			return '<text x="' + x.toFixed(1) + '" y="' + (baseY + 14) + '" font-size="8.5" fill="var(--qm-text-muted)" text-anchor="middle" font-weight="600">' + controls.xmlText(label) + '</text>';
		}).join('');

		var fullChart = [
			'<svg class="qm-traffic-chart-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '">',
			'  <defs>',
			'    <linearGradient id="qmDlAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
			'      <stop offset="0%" stop-color="#0072f5" stop-opacity="0.32"/>',
			'      <stop offset="100%" stop-color="#0072f5" stop-opacity="0.0"/>',
			'    </linearGradient>',
			'    <linearGradient id="qmUlAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
			'      <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>',
			'      <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>',
			'    </linearGradient>',
			'  </defs>',
			'  <!-- 参考基线 -->',
			'  <line x1="0" y1="' + baseY + '" x2="' + svgW + '" y2="' + baseY + '" stroke="var(--qm-border-soft)" stroke-width="1.2"/>',
			'  <line x1="0" y1="' + (baseY - 32) + '" x2="' + svgW + '" y2="' + (baseY - 32) + '" stroke="var(--qm-border-soft)" stroke-width="0.8" stroke-dasharray="3,3"/>',
			'  <!-- 下行渐变面积与曲线 -->',
			'  <path d="' + dlAreaStr + '" fill="url(#qmDlAreaGrad)"/>',
			'  <path d="' + dlPathStr + '" fill="none" stroke="#0072f5" stroke-width="2.5" stroke-linecap="round"/>',
			'  <!-- 上行渐变面积与曲线 -->',
			'  <path d="' + ulAreaStr + '" fill="url(#qmUlAreaGrad)"/>',
			'  <path d="' + ulPathStr + '" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round"/>',
			dateTexts,
			'</svg>'
		].join('');

		return svgNode(fullChart);
	},

	trafficPanel: function(usage, interfaceName, daily) {
		usage = usage || {}; daily = daily || {};
		var swapped = Number(daily.swapped) === 1;
		var dl = swapped ? (Number(daily.total_tx) || 0) : (Number(daily.total_rx) || 0);
		var ul = swapped ? (Number(daily.total_rx) || 0) : (Number(daily.total_tx) || 0);

		var head = E('div', { 'class': 'qm-card-head' }, [
			E('div', {}, [
				E('div', { 'class': 'qm-card-title' }, [
					svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'),
					_('流量分析')
				]),
				E('div', { 'class': 'qm-card-sub' }, _('移动接口统计 · %s').format(interfaceName || '--'))
			]),
			E('div', { 'style': 'text-align:right' }, [
				E('div', { 'style': 'font-size:10.5px;color:var(--qm-text-muted);font-weight:600' }, _('更新于') + ' ' + usageUpdated(usage.updated_at)),
				E('div', { 'style': 'display:flex;gap:12px;font-size:11px;font-weight:700;margin-top:4px' }, [
					E('span', { 'style': 'color:#0072f5' }, '● ' + _('下行 (DL)')),
					E('span', { 'style': 'color:#10b981' }, '● ' + _('上行 (UL)'))
				])
			])
		]);

		if (!isTrafficAvailable(usage)) {
			return E('section', { 'class': 'qm-glass-card', 'style': 'margin-bottom:18px' }, [
				head,
				E('div', { 'style': 'color:var(--qm-text-muted);font-size:12.5px;padding:16px 0' }, _('当前模组未开启硬件流量计数或暂未上报。'))
			]);
		}

		var todayDl = swapped ? (Number(daily.today_tx) || 0) : (Number(daily.today_rx) || 0);
		var todayUl = swapped ? (Number(daily.today_rx) || 0) : (Number(daily.today_tx) || 0);

		return E('section', { 'class': 'qm-glass-card', 'style': 'margin-bottom:18px' }, [
			head,
			E('div', { 'class': 'qm-traffic-layout' }, [
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '今日下载 (DL)'),
					E('div', { 'class': 'qm-stat-val', 'style': 'color:#0072f5' }, controls.formatBytes(todayDl)),
					E('div', { 'class': 'qm-stat-sub' }, '今日已用流量')
				]),
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '今日上传 (UL)'),
					E('div', { 'class': 'qm-stat-val', 'style': 'color:#10b981' }, controls.formatBytes(todayUl)),
					E('div', { 'class': 'qm-stat-sub' }, '今日已用流量')
				]),
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '累计流量总量'),
					E('div', { 'class': 'qm-stat-val' }, controls.formatBytes(dl + ul)),
					E('div', { 'class': 'qm-stat-sub' }, 'DL ' + controls.formatBytes(dl) + ' / UL ' + controls.formatBytes(ul))
				]),
				E('div', { 'class': 'qm-traffic-chart-box' }, [
					this.renderSvgTrafficChart(daily.days, swapped)
				])
			])
		]);
	},

	trafficScheduleCard: function(schedule, section) {
		schedule = schedule || {};
		function pad2(n) { return (n < 10 ? '0' : '') + n; }
		function enabledFlag(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

		var enabledBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		enabledBox.checked = enabledFlag(schedule.enabled);

		var typeSelect = controls.select([
			[ 'monthly', _('每月（按日期）') ],
			[ 'daily', _('每日') ]
		], schedule.reset_type || 'monthly');

		var dayInput = E('input', { 'type': 'number', 'min': '1', 'max': '31', 'class': 'cbi-input-text', 'style': 'width:90px' });
		dayInput.value = Number(schedule.day) || 1;

		var hourOptions = [];
		for (var h = 0; h < 24; h++) hourOptions.push([ String(h), pad2(h) + ':00' ]);
		var minuteOptions = [];
		for (var m = 0; m < 60; m++) minuteOptions.push([ String(m), pad2(m) ]);
		var hourSelect = controls.select(hourOptions, schedule.hour != null ? schedule.hour : 0);
		var minuteSelect = controls.select(minuteOptions, schedule.minute != null ? schedule.minute : 0);

		var dayRow = controls.row(_('清零日（每月）'), dayInput);
		function syncType() {
			dayRow.style.display = typeSelect.value === 'monthly' ? '' : 'none';
		}
		typeSelect.addEventListener('change', syncType);
		syncType();

		var body = [
			controls.row(_('启用自动清零'), enabledBox),
			controls.row(_('清零频率'), typeSelect),
			dayRow,
			controls.row(_('小时'), hourSelect),
			controls.row(_('分钟'), minuteSelect),
			controls.action(_('保存计划'), function() {
				syncType();
				var params = {
					enabled: enabledBox.checked,
					reset_type: typeSelect.value,
					hour: Number(hourSelect.value) || 0,
					minute: Number(minuteSelect.value) || 0
				};
				if (typeSelect.value === 'monthly')
					params.day = Number(dayInput.value) || 1;
				controls.confirmModal(_('保存流量清零计划'),
					_('QModem 将更新定时任务，使流量统计按设定时间自动清零。是否继续？'),
					function() { return controls.setTrafficResetSchedule(section, params); });
			}),
			controls.action(_('开启模组自动统计'), function() {
				controls.confirmModal(_('开启模组自动统计'),
					_('开启后模组将周期保存流量计数（部分厂商固件支持），路由器重启后计数不丢失。是否继续？'),
					function() { return controls.saveStats(section); });
			}),
			controls.action(_('立即清零流量统计'), function() {
				controls.confirmModal(_('立即清零流量统计'),
					_('此操作会清零该模组的流量计数，并同步清零本机分天流量记录。是否继续？'),
					function() {
						return Promise.resolve(controls.clearStats(section)).catch(function() { return null; })
							.then(function() { return controls.statsReset(section); });
					});
			})
		];
		return controls.card(_('流量自动清零计划'), _('设置周期清零定时任务，或手动重置流量计数器。'), body, true);
	},

	shortcut: function(title, description, path) {
		var kind = path.split('/').pop();
		var paths = {
			connection: '<path d="M7 3v14m-4-4 4 4 4-4M17 21V7m-4 4 4-4 4 4"/>',
			network: '<path d="M3 17h2v4H3zm5-5h2v9H8zm5-5h2v14h-2zm5-4h2v18h-2z"/>',
			system: '<path d="M7 2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="9" y="11" width="6" height="7" rx="1"/>'
		};
		return E('a', { 'class': 'qm-shortcut-item', 'href': L.url(path) }, [
			E('span', { 'class': 'qm-shortcut-icon', 'aria-hidden': 'true' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + (paths[kind] || paths.connection) + '</svg>')),
			E('div', { 'class': 'qm-shortcut-copy' }, [
				E('strong', {}, title),
				E('span', {}, description)
			]),
			E('span', { 'class': 'qm-shortcut-arrow', 'aria-hidden': 'true' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'))
		]);
	},

	render: function(res) {
		return controls.liveView(this, res, {
			interval: this.POLL_INTERVAL,
			paint: this.paintContent,
			collect: this.collect
		});
	},

	paintContent: function(res) {
		res = res || {};

		if (!res.section) {
			return E('div', { 'class': 'qmodem-glass-page' }, [
				this.styleNode(), controls.styleNode(),
				E('div', { 'class': 'qm-error-banner' }, _('No modem detected (make sure QModem has recognised the device).')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class': 'qm-error-banner' }, msg);
				})
			]);
		}

		var data = this.parseStatus(res);
		var connected = data.connected === '1', reachable = data.reachable === '1';
		var session = this.parseSession(res, connected);
		var carrierInfo = this.carrierInfo(res);
		var enter = !this.painted;
		this.painted = true;

		if (/^(n\/a|none|null|--)$/i.test(data.operator_name || ''))
			data.operator_name = '';
		var opInfo = controls.operatorInfo(data.operator_name || null, data.mcc, data.mnc);
		var operator = opInfo.name;
		data.operator = (operator && operator !== _('Mobile Network')) ? operator : '';

		return E('div', { 'class': 'qmodem-glass-page' + (enter ? ' qm-enter' : '') }, [
			this.styleNode(), controls.styleNode(),
			/* 三重背景极光氛围光球 */
			E('div', { 'class': 'qm-ambient-orb orb-1' }),
			E('div', { 'class': 'qm-ambient-orb orb-2' }),
			E('div', { 'class': 'qm-ambient-orb orb-3' }),

			(res.errors || []).map(function(msg) {
				return E('div', { 'class': 'qm-error-banner' }, msg);
			}),

			this.modems && this.modems.length > 1 ? controls.renderModemBar(this.modems, res.section, function(id) {
				controls.setStoredSection(id);
				window.location.reload();
			}) : null,

			/* 顶部旗舰白色毛玻璃 Hero 大卡片 */
			E('section', { 'class': 'qm-hero' }, [
				E('div', {}, [
					controls.pageTitle('status', data.model || _('移动模组'), 'qm-hero-title'),
					E('div', { 'class': 'qm-hero-sub' }, !reachable
						? _('模组未响应，请检查模组连接或硬件供电。')
						: connected ? _('移动数据链路已连通，高速网络正常运行中。')
						: _('模组已就绪，移动数据会话未连接。')),
					E('div', { 'class': 'qm-hero-meta' }, [
						E('span', { 'class': 'qm-hero-op' }, [
							renderOperatorSvg(operator || data.operator_name, data.mcc, data.mnc),
							operator || data.operator_name || _('蜂窝网络')
						]),
						data.sysmode_detail ? E('span', { 'class': 'qm-pill-tag' }, [
							E('span', { 'class': 'qm-pill-dot' }),
							E('strong', {}, data.sysmode_detail)
						]) : null,
						carrierInfo.band ? E('span', { 'class': 'qm-pill-tag' }, [
							_('主频段:'), E('strong', {}, carrierInfo.band)
						]) : null,
						data.network_interface ? E('span', { 'class': 'qm-pill-tag' }, [
							_('网络接口:'), E('strong', {}, data.network_interface)
						]) : null,
						data.active_apn ? E('span', { 'class': 'qm-pill-tag' }, [
							'APN:', E('strong', {}, data.active_apn)
						]) : null
					].filter(Boolean))
				]),
				E('div', { 'class': 'qm-hero-actions' }, [
					E('div', { 'class': 'qm-beacon-wrap' + (connected ? ' is-online' : '') }, [
						E('span', { 'class': 'qm-radar-beacon' }),
						connected ? _('已连接') : reachable ? _('在线') : _('未连接')
					]),
					E('button', {
						'type': 'button',
						'class': 'qm-refresh-btn',
						'title': _('刷新模组数据'),
						'click': function(ev) { return controls.refreshPage(res.section, null, ev.currentTarget); }
					}, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>'),
						_('刷新')
					])
				])
			]),

			/* 核心聚焦 3 栏网格 (射频信号 / 载波拓扑 / 移动IP会话) */
			E('div', { 'class': 'qm-grid-3' }, [
				this.signalCard(data),
				this.carrierCard(carrierInfo, res.devStatus),
				this.addressCard(session)
			]),

			/* 模组与 SIM 硬件卡片 (2 栏自适应网格) */
			E('div', { 'class': 'qm-grid-2' }, [
				this.moduleCard(data),
				this.simCard(data)
			]),

			/* 流量统计面板与 SVG 双轨平滑折线图 */
			this.trafficPanel(res.usage, data.network_interface, res.daily),

			/* 流量清零计划 */
			isTrafficAvailable(res.usage) ? this.trafficScheduleCard(res.trafficResetSchedule, res.section) : null,

			/* 快捷导航 */
			E('nav', { 'class': 'qm-shortcuts', 'aria-label': _('常用功能') }, [
				this.shortcut(_('移动数据'), _('APN 接入点与拨号参数配置'), 'admin/modem/qmodem-generic/connection'),
				this.shortcut(_('无线与小区'), _('锁频段、小区驻留与频点锁定'), 'admin/modem/qmodem-generic/network'),
				this.shortcut(_('模组与 SIM 卡'), _('硬件状态检测、SIM 卡槽切换与维护'), 'admin/modem/qmodem-generic/system')
			]),

			/* QModem 上报的完整信息（优雅白色毛玻璃折叠面板） */
			(function() {
				var filtered = (res.allInfo || []).filter(function(item) {
					return item && controls.hasValue(item.value);
				});
				var groups = controls.groupByClass(filtered);
				var keys = Object.keys(groups);
				var fieldCount = keys.reduce(function(n, k) {
					return n + (groups[k] || []).length;
				}, 0);
				var body = keys.length
					? E('div', { 'class': 'mt-info-grid-all' }, controls.renderInfoGrouped(res.allInfo))
					: E('div', { 'style': 'color:var(--qm-text-muted);font-size:12.5px;padding:8px 0' }, _('QModem 未上报其它信息字段。'));
				return E('details', { 'class': 'qm-glass-card qm-info-details' }, [
					E('summary', {}, [
						_('完整模组上报信息'),
						fieldCount ? E('span', { 'class': 'qm-info-count' }, _('%d 类 · %d 项').format(keys.length, fieldCount)) : null
					]),
					E('div', {}, [ body ])
				]);
			})()
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
