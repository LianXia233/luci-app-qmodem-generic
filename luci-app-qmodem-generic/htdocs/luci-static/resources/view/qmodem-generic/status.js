/*
 * QM UI v2 —— 5G 全息全景网络座舱仪表盘 (Cyber-Cellular Cockpit)
 * 白色毛玻璃 (Glassmorphism) + 全矢量动态高阶 SVG + 现代化座舱布局
 */
'use strict';
'require view';
'require uci';
'require qmodem-generic.controls as controls';

var E = controls.element;

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

// 安全渲染 SVG 节点
function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

// 复制文字并显示轻量 Toast 反馈
function copyToClipboard(text, btn) {
	if (!text) return;
	if (navigator.clipboard && navigator.clipboard.writeText) {
		navigator.clipboard.writeText(text).then(function() {
			if (!btn) return;
			var old = btn.innerHTML;
			btn.innerHTML = '<span style="color:var(--qm-ok);font-size:11px;font-weight:750;">' + _('已复制') + '</span>';
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
			'<svg class="qm-op-icon" viewBox="0 0 28 28" width="26" height="26" fill="none">',
			'  <circle cx="14" cy="14" r="13" fill="#0085d0" fill-opacity="0.12"/>',
			'  <path d="M7 16C8.5 19 11.5 20 15 19.5C19 19 21.5 16 21 12.5C20.5 10 18.5 8.5 16 8.2C13.8 8 11.5 8.8 10 10.2" stroke="#0085d0" stroke-width="2.4" stroke-linecap="round"/>',
			'  <path d="M21 12C19.5 9 16.5 8 13 8.5C9 9 6.5 12 7 15.5C7.5 18 9.5 19.5 12 19.8" stroke="#10b981" stroke-width="2.4" stroke-linecap="round"/>',
			'  <circle cx="14" cy="14" r="2.5" fill="#0085d0"/>',
			'</svg>'
		].join(''));
	}
	// 中国电信
	if (n.indexOf('CHINA TELECOM') !== -1 || n.indexOf('TELECOM') !== -1 || n.indexOf('电信') !== -1 || /^460(03|05|11)/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 28 28" width="26" height="26" fill="none">',
			'  <circle cx="14" cy="14" r="13" fill="#005bac" fill-opacity="0.12"/>',
			'  <path d="M6 10C8 6.5 12.5 6 16 7.5C19 9 20 12 19.5 15.5C19 19 16 21 12 21C9 21 7 19 6.5 16" stroke="#005bac" stroke-width="2.4" stroke-linecap="round"/>',
			'  <path d="M15.5 13C17 11.5 20.5 11.5 22 13C23 14 23 16 22.5 17.5" stroke="#005bac" stroke-width="2.2" stroke-linecap="round"/>',
			'</svg>'
		].join(''));
	}
	// 中国联通
	if (n.indexOf('CHINA UNICOM') !== -1 || n.indexOf('UNICOM') !== -1 || n.indexOf('联通') !== -1 || /^4600[169]/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 28 28" width="26" height="26" fill="none">',
			'  <circle cx="14" cy="14" r="13" fill="#e60012" fill-opacity="0.12"/>',
			'  <path d="M8.5 8.5L19.5 19.5M19.5 8.5L8.5 19.5" stroke="#e60012" stroke-width="2.6" stroke-linecap="round"/>',
			'  <circle cx="14" cy="14" r="3.8" stroke="#e60012" stroke-width="2.2"/>',
			'</svg>'
		].join(''));
	}
	// 中国广电
	if (n.indexOf('BROADNET') !== -1 || n.indexOf('CBN') !== -1 || n.indexOf('广电') !== -1 || /^46015/.test(code)) {
		return svgNode([
			'<svg class="qm-op-icon" viewBox="0 0 28 28" width="26" height="26" fill="none">',
			'  <circle cx="14" cy="14" r="13" fill="#6366f1" fill-opacity="0.12"/>',
			'  <circle cx="14" cy="14" r="3.2" fill="#6366f1"/>',
			'  <path d="M9 10A7 7 0 0 1 19 10M6.5 7.5A11 11 0 0 1 21.5 7.5" stroke="#6366f1" stroke-width="2.4" stroke-linecap="round"/>',
			'</svg>'
		].join(''));
	}
	// 全球蜂窝通用基站
	return svgNode([
		'<svg class="qm-op-icon" viewBox="0 0 28 28" width="26" height="26" fill="none">',
		'  <circle cx="14" cy="14" r="13" fill="var(--qm-accent)" fill-opacity="0.12"/>',
		'  <path d="M14 5L18.5 23L9.5 23Z" stroke="var(--qm-accent)" stroke-width="2.2" stroke-linejoin="round"/>',
		'  <circle cx="14" cy="5" r="2.8" fill="var(--qm-accent)"/>',
		'  <path d="M9.5 8.5A6 6 0 0 1 18.5 8.5M7 6A10 10 0 0 1 21 6" stroke="var(--qm-accent)" stroke-width="2" stroke-linecap="round"/>',
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
		return controls.injectStyleOnce('qm-status-style-cockpit', [
			/* 全局变量与毛玻璃画卷容器 */
			'.qm-app{--qm-glass:rgba(255,255,255,0.72);--qm-glass-blur:blur(28px) saturate(200%) contrast(96%);--qm-glass-border:rgba(255,255,255,0.86);--qm-glass-inner:rgba(255,255,255,0.58);--qm-glass-inner-border:rgba(255,255,255,0.78);--qm-shadow:0 10px 30px -5px rgba(22,34,64,0.06),0 2px 6px -1px rgba(22,34,64,0.03),inset 0 1px 1.5px 0 rgba(255,255,255,0.95);--qm-shadow-md:0 18px 44px -6px rgba(22,34,64,0.11),0 4px 12px -2px rgba(22,34,64,0.04),inset 0 1px 1.5px 0 #ffffff}',
			'.qm-app.qm-dark{--qm-glass:rgba(18,24,38,0.74);--qm-glass-border:rgba(255,255,255,0.12);--qm-glass-inner:rgba(255,255,255,0.05);--qm-glass-inner-border:rgba(255,255,255,0.08);--qm-shadow:0 10px 30px -5px rgba(0,0,0,0.5),inset 0 1px 0 0 rgba(255,255,255,0.1);--qm-shadow-md:0 18px 44px -6px rgba(0,0,0,0.65),inset 0 1px 0 0 rgba(255,255,255,0.14)}',
			
			'.qm-cockpit-dashboard{position:relative;max-width:1240px;margin:0 auto;color:var(--qm-text);padding:6px 0 42px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}',
			
			/* 背景高斯极光光球 (流动发光) */
			'.qm-ambient-orb{position:absolute;border-radius:50%;pointer-events:none;z-index:0;animation:qmAuroraFloat 24s ease-in-out infinite alternate}',
			'.qm-ambient-orb.orb-1{top:-60px;left:6%;width:520px;height:520px;background:var(--qm-glow-a);filter:blur(85px)}',
			'.qm-ambient-orb.orb-2{top:280px;right:4%;width:480px;height:480px;background:var(--qm-glow-b);filter:blur(90px);animation-delay:-8s}',
			'.qm-ambient-orb.orb-3{bottom:120px;left:20%;width:560px;height:560px;background:var(--qm-glow-c);filter:blur(95px);animation-delay:-16s}',
			'@keyframes qmAuroraFloat{0%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(38px,30px,0) scale(1.08)}100%{transform:translate3d(-28px,44px,0) scale(0.95)}}',

			/* 通用现代毛玻璃卡片 */
			'.qm-glass-panel{position:relative;z-index:1;background:var(--qm-glass);backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);border:1px solid var(--qm-glass-border);border-radius:24px;box-shadow:var(--qm-shadow);transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease,border-color .24s ease}',
			'.qm-glass-panel:hover{box-shadow:var(--qm-shadow-md);border-color:var(--qm-glass-border-strong)}',

			/* 1. MASTER COCKPIT HEADER BAR (全息极简座舱天幕顶栏) */
			'.qm-cockpit-header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 24px;margin-bottom:20px;background:var(--qm-surface-gradient)!important;border:1px solid var(--qm-glass-border-strong)!important;border-radius:22px}',
			'.qm-head-brand{display:flex;align-items:center;gap:14px;min-width:0}',
			'.qm-brand-emblem{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:15px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);box-shadow:0 3px 10px rgba(0,0,0,0.04);flex-shrink:0}',
			'.qm-brand-title-wrap{display:flex;flex-direction:column;gap:3px;min-width:0}',
			'.qm-brand-title{font-size:20px;font-weight:850;letter-spacing:-.025em;background:var(--qm-hero-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:8px;line-height:1.2}',
			'.qm-brand-sub{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--qm-text-muted);font-weight:600}',
			
			'.qm-head-center{display:flex;align-items:center;gap:12px}',
			'.qm-radar-capsule{display:inline-flex;align-items:center;gap:9px;padding:7px 16px;border-radius:999px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);font-size:12.5px;font-weight:750;box-shadow:0 2px 8px var(--qm-shadow-color)}',
			'.qm-radar-capsule.is-online{color:var(--qm-ok);background:var(--qm-ok-soft);border-color:var(--qm-ok-border)}',
			'.qm-radar-beacon{position:relative;width:10px;height:10px;border-radius:50%;background:#94a3b8;flex:0 0 10px}',
			'.qm-radar-capsule.is-online .qm-radar-beacon{background:var(--qm-ok);box-shadow:0 0 8px var(--qm-ok)}',
			'.qm-radar-capsule.is-online .qm-radar-beacon::before,.qm-radar-capsule.is-online .qm-radar-beacon::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--qm-ok);opacity:0;animation:qmRadarWave 2.2s cubic-bezier(.2,.8,.4,1) infinite}',
			'.qm-radar-capsule.is-online .qm-radar-beacon::after{animation-delay:1.1s}',
			'@keyframes qmRadarWave{0%{transform:scale(0.8);opacity:0.9}100%{transform:scale(2.6);opacity:0}}',

			'.qm-head-actions{display:flex;align-items:center;gap:10px;flex-shrink:0}',
			'.qm-glass-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 16px;min-height:38px;border-radius:999px;border:1px solid var(--qm-glass-border);background:var(--qm-glass);color:var(--qm-text);font-weight:750;font-size:12px;cursor:pointer;box-shadow:var(--qm-shadow);transition:all .2s ease;text-decoration:none}',
			'.qm-glass-btn:hover{background:var(--qm-surface);border-color:var(--qm-accent-border);color:var(--qm-accent);transform:translateY(-1px);box-shadow:var(--qm-shadow-md);text-decoration:none}',
			'.qm-glass-btn svg{width:15px;height:15px;transition:transform .4s ease}',
			'.qm-glass-btn:active svg{transform:rotate(180deg)}',

			/* 2. DUAL-WING CORE STAGE (黄金分割双翼展台: 左翼 5G 射频与基站拓扑全景，右翼 双通道实时吞吐与 IP 矩阵) */
			'.qm-cockpit-stage{display:grid;grid-template-columns:1.14fr 0.86fr;gap:20px;margin-bottom:20px}',
			
			/* 左翼：5G 射频与载波中枢 */
			'.qm-wing-spectrum{padding:22px 24px}',
			'.qm-panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}',
			'.qm-panel-title{font-size:16px;font-weight:850;color:var(--qm-text);display:flex;align-items:center;gap:9px;letter-spacing:-.015em}',
			'.qm-panel-title svg{width:20px;height:20px;color:var(--qm-accent)}',
			'.qm-panel-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}',
			'.qm-panel-badge.excellent{background:var(--qm-ok-soft);color:var(--qm-ok);border:1px solid var(--qm-ok-border)}',
			'.qm-panel-badge.good{background:var(--qm-accent-soft);color:var(--qm-accent);border:1px solid var(--qm-accent-border)}',
			'.qm-panel-badge.fair{background:var(--qm-warn-soft);color:var(--qm-warn);border:1px solid var(--qm-warn-border)}',
			'.qm-panel-badge.weak{background:var(--qm-danger-soft);color:var(--qm-danger);border:1px solid var(--qm-danger-border)}',
			
			/* 信号上半部分：左侧仪表盘 + 右侧 4 通道指标 */
			'.qm-spectrum-upper{display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--qm-border-soft)}',
			'.qm-dial-wrapper{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center}',
			'.qm-signal-dial-svg{width:210px;height:140px;overflow:visible}',
			'.qm-dial-center-box{position:absolute;top:66px;text-align:center;display:flex;flex-direction:column;align-items:center}',
			'.qm-dial-val-text{font-size:34px;font-weight:850;color:var(--qm-text);letter-spacing:-.035em;line-height:1;font-variant-numeric:tabular-nums}',
			'.qm-dial-unit-text{font-size:10.5px;font-weight:700;color:var(--qm-text-muted);margin-top:2px}',
			'.qm-dial-wave-box{margin-top:4px;display:flex;align-items:center;gap:4px;color:var(--qm-accent)}',
			'@keyframes qmWavePulse{0%,100%{opacity:.3}50%{opacity:1}}',
			'.qm-wave-1{animation:qmWavePulse 1.8s ease-in-out infinite}',
			'.qm-wave-2{animation:qmWavePulse 1.8s ease-in-out infinite .3s}',
			'.qm-wave-3{animation:qmWavePulse 1.8s ease-in-out infinite .6s}',

			/* 4 通道射频条目网格 */
			'.qm-telemetry-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
			'.qm-telemetry-tile{padding:11px 14px;border-radius:14px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);box-shadow:0 1px 4px rgba(0,0,0,0.02)}',
			'.qm-telemetry-label{font-size:11px;font-weight:700;color:var(--qm-text-muted);letter-spacing:.01em;display:flex;justify-content:space-between}',
			'.qm-telemetry-val{font-size:15px;font-weight:850;color:var(--qm-text);margin:4px 0 6px;font-variant-numeric:tabular-nums}',
			'.qm-telemetry-bar{height:5px;border-radius:999px;background:var(--qm-border-soft);overflow:hidden}',
			'.qm-telemetry-bar i{display:block;height:100%;border-radius:inherit;transition:width .5s cubic-bezier(.2,.8,.4,1)}',

			/* 信号下半部分：5G 宏站拓扑全景图 */
			'.qm-spectrum-lower{padding-top:16px}',
			'.qm-ca-topo-svg{width:100%;height:115px;display:block}',
			'@keyframes qmFlowDash{to{stroke-dashoffset:-36}}',
			'.qm-flow-line{stroke-dasharray:7,4;animation:qmFlowDash 1.5s linear infinite}',
			'@keyframes qmTowerPulse{0%,100%{r:2.5;opacity:1}50%{r:5;opacity:.35}}',
			'.qm-tower-beacon{animation:qmTowerPulse 1.8s ease-in-out infinite}',
			
			/* 载波卡片行 */
			'.qm-carrier-pill-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
			'.qm-carrier-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:12px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);font-size:11.5px}',
			'.qm-carrier-tag{padding:2px 6px;border-radius:6px;font-size:9.5px;font-weight:850;color:#fff}',
			'.qm-carrier-tag.pcc{background:var(--qm-accent)}',
			'.qm-carrier-tag.scc{background:var(--qm-ok)}',
			'.qm-carrier-details{color:var(--qm-text-muted);font-variant-numeric:tabular-nums;display:flex;gap:6px}',

			/* 右翼：双通道实时吞吐与移动 WAN 会话 */
			'.qm-wing-session{padding:22px 24px;display:flex;flex-direction:column;gap:16px}',
			
			/* 实时流量双卡 */
			'.qm-flow-metrics{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
			'.qm-flow-card{position:relative;overflow:hidden;padding:16px;border-radius:18px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);display:flex;flex-direction:column}',
			'.qm-flow-label{font-size:11.5px;font-weight:750;color:var(--qm-text-muted);display:flex;align-items:center;gap:6px}',
			'.qm-flow-val{font-size:24px;font-weight:850;margin:6px 0 2px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}',
			'.qm-flow-sub{font-size:11px;color:var(--qm-text-muted);font-weight:600}',
			'.qm-flow-card.dl .qm-flow-val{color:#0072f5}',
			'.qm-flow-card.ul .qm-flow-val{color:#10b981}',
			
			/* 移动 WAN 双栈 IP 会话 */
			'.qm-session-matrix{display:flex;flex-direction:column;gap:9px;margin-top:auto}',
			'.qm-ip-row{padding:11px 14px;border-radius:14px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);transition:border-color .18s ease}',
			'.qm-ip-row:hover{border-color:var(--qm-accent-border)}',
			'.qm-ip-header{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:750;color:var(--qm-text-muted);margin-bottom:5px}',
			'.qm-ip-content{display:flex;justify-content:space-between;align-items:center;gap:8px}',
			'.qm-ip-val{font:700 12.5px/1.45 var(--qm-font-mono);color:var(--qm-text);word-break:break-all}',
			'.qm-copy-btn{display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--qm-text-muted);cursor:pointer;transition:all .18s ease;flex:0 0 auto}',
			'.qm-copy-btn:hover{background:var(--qm-accent-soft);color:var(--qm-accent);border-color:var(--qm-accent-border)}',
			'.qm-copy-btn svg{width:14px;height:14px}',

			/* 3. WIDE PANORAMIC TRAFFIC TRAJECTORY CHART (全景 8 天流量走势图) */
			'.qm-traffic-stage{padding:22px 24px;margin-bottom:20px}',
			'.qm-chart-svg{width:100%;height:130px;display:block}',

			/* 4. MODULAR CELLULAR INTELLIGENCE MATRIX (三联精工玻璃卡片) */
			'.qm-triad-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:20px}',
			'.qm-triad-card{padding:20px 22px}',
			'.qm-kv-item{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
			'.qm-kv-item:last-child{border-bottom:0}',
			'.qm-kv-item span{color:var(--qm-text-muted);font-weight:600}',
			'.qm-kv-item strong{color:var(--qm-text);font-weight:750;text-align:right}',
			'.qm-val-with-copy{display:inline-flex;align-items:center;gap:6px}',

			/* 6. DOCK / QUICK ACTION TILES (快捷悬浮应用坞) */
			'.qm-command-dock{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}',
			'.qm-dock-tile{position:relative;display:flex;align-items:center;gap:14px;padding:16px 18px;overflow:hidden;color:var(--qm-text);text-decoration:none;transition:all .22s cubic-bezier(.2,.8,.4,1)}',
			'.qm-dock-tile::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--qm-accent-gradient)}',
			'.qm-dock-tile:hover{transform:translateY(-2px);border-color:var(--qm-accent-border);box-shadow:var(--qm-shadow-md);text-decoration:none}',
			'.qm-dock-icon{display:flex;align-items:center;justify-content:center;flex:0 0 42px;height:42px;border-radius:13px;background:var(--qm-accent-soft);color:var(--qm-accent);box-shadow:0 2px 8px rgba(0,0,0,0.03)}',
			'.qm-dock-icon svg{width:20px;height:20px;stroke:currentColor}',
			'.qm-dock-info{flex:1;min-width:0}',
			'.qm-dock-info strong{display:block;font-size:13.5px;font-weight:750;color:var(--qm-text);line-height:1.4}',
			'.qm-dock-info span{display:block;font-size:11.5px;color:var(--qm-text-muted);margin-top:2px;line-height:1.45}',
			'.qm-dock-arrow{color:var(--qm-accent);transition:transform .2s ease}',
			'.qm-dock-tile:hover .qm-dock-arrow{transform:translateX(3px)}',

			/* 7. FULL TELEMETRY COLLAPSIBLE DRAWER (底层全量上报抽屉) */
			'.qm-info-drawer{padding:18px 24px}',
			'.qm-info-drawer>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:36px;cursor:pointer;list-style:none;font-size:15px;font-weight:800;color:var(--qm-text)}',
			'.qm-info-drawer>summary::-webkit-details-marker{display:none}',
			'.qm-info-drawer>summary::before{content:"\\25B8";color:var(--qm-text-muted);transition:transform .18s ease;display:inline-block;margin-right:8px;font-size:14px}',
			'.qm-info-drawer[open]>summary::before{transform:rotate(90deg)}',
			'.qm-info-drawer[open]>summary{border-bottom:1px solid var(--qm-border-soft);padding-bottom:12px;margin-bottom:16px}',
			'.qm-drawer-count{font-size:11px;font-weight:750;color:var(--qm-text-muted);background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);padding:3px 10px;border-radius:999px}',

			/* 响应式断点自适应 */
			'@media(max-width:1080px){.qm-cockpit-stage{grid-template-columns:1fr}.qm-triad-grid{grid-template-columns:1fr 1fr}.qm-command-dock{grid-template-columns:repeat(2,1fr)}}',
			'@media(max-width:720px){.qm-cockpit-header{flex-direction:column;align-items:flex-start}.qm-head-actions{width:100%;justify-content:space-between}.qm-spectrum-upper{grid-template-columns:1fr;justify-items:center}.qm-triad-grid,.qm-command-dock{grid-template-columns:1fr}}'
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
			label:[ _('极佳'), _('良好'), _('一般'), _('较差') ][index],
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
		var totalArcLen = (240 / 180) * Math.PI * radius;
		var pct = Math.max(0, Math.min(100, quality.percentage));
		var activeLen = (pct / 100) * totalArcLen;
		var color = quality.strokeColor || 'var(--qm-accent)';

		var curAngleDeg = 150 + (pct / 100) * 240;
		var rad = curAngleDeg * Math.PI / 180;
		var beadX = 105 + radius * Math.cos(rad);
		var beadY = 96 + radius * Math.sin(rad);

		var tickMarks = [];
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
			tickMarks.join(''),
			'  <path d="M 42.6 132 A 72 72 0 1 1 167.4 132" fill="none" stroke="var(--qm-border-soft)" stroke-width="10" stroke-linecap="round"/>',
			'  <path d="M 42.6 132 A 72 72 0 1 1 167.4 132" fill="none" stroke="url(#qmSignalGrad)" stroke-width="10" stroke-linecap="round"',
			'        stroke-dasharray="' + activeLen.toFixed(1) + ' ' + totalArcLen.toFixed(1) + '"',
			'        filter="url(#qmDialGlow)" style="transition: stroke-dasharray .6s cubic-bezier(.2,.8,.4,1);"/>',
			pct > 3 ? '  <circle cx="' + beadX.toFixed(1) + '" cy="' + beadY.toFixed(1) + '" r="5.5" fill="#ffffff" stroke="' + color + '" stroke-width="2.5" filter="url(#qmDialGlow)"/>' : '',
			'</svg>'
		].join('');

		return E('div', { 'class': 'qm-dial-wrapper' }, [
			svgNode(svgStr),
			E('div', { 'class': 'qm-dial-center-box' }, [
				E('div', { 'class': 'qm-dial-val-text' }, isNaN(parseFloat(rsrp)) ? '--' : String(rsrp)),
				E('div', { 'class': 'qm-dial-unit-text' }, 'dBm · RSRP'),
				E('div', { 'class': 'qm-dial-wave-box' }, [
					svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 20v-8"/><circle cx="12" cy="7" r="2.5"/><path d="M8 4a7 7 0 0 0 0 6" class="qm-wave-1"/><path d="M16 4a7 7 0 0 1 0 6" class="qm-wave-1"/><path d="M5 2a11 11 0 0 0 0 10" class="qm-wave-2"/><path d="M19 2a11 11 0 0 1 0 10" class="qm-wave-2"/></svg>'),
					E('span', { 'class': 'qm-panel-badge ' + quality.cls, 'style': 'padding:2px 7px;font-size:9.5px' }, quality.label)
				])
			])
		]);
	},

	metricTelemetryTile: function(label, kind, rawValue, unit) {
		var num = parseFloat(rawValue), has = !isNaN(num), pct = 0, color = 'var(--qm-text-muted)';
		if (has) {
			if (kind === 'rsrq') { pct = (num + 25) * 4; color = num >= -10 ? 'var(--qm-ok)' : num >= -15 ? 'var(--qm-accent)' : num >= -20 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			else if (kind === 'sinr') { pct = (num + 10) * 2.5; color = num >= 20 ? 'var(--qm-ok)' : num >= 13 ? 'var(--qm-accent)' : num >= 0 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			else if (kind === 'rssi') { pct = (num + 110) * 1.6; color = num >= -65 ? 'var(--qm-ok)' : num >= -75 ? 'var(--qm-accent)' : num >= -85 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			else { pct = (num - 20) / 60 * 100; color = num < 45 ? 'var(--qm-ok)' : num < 55 ? 'var(--qm-accent)' : num < 65 ? 'var(--qm-warn)' : 'var(--qm-danger)'; }
			pct = Math.max(5, Math.min(100, pct));
		}
		return E('div', { 'class': 'qm-telemetry-tile' }, [
			E('div', { 'class': 'qm-telemetry-label' }, [
				E('span', {}, label),
				has ? E('span', { 'style': 'color:' + color }, '●') : null
			]),
			E('div', { 'class': 'qm-telemetry-val' }, has ? (String(rawValue) + (unit || '')) : '--'),
			E('div', { 'class': 'qm-telemetry-bar' }, [
				E('i', { 'style': 'width:' + (has ? pct : 0) + '%;background:' + color })
			])
		]);
	},

	renderSvgCarrierTopo: function(info) {
		var hasCa = info.carriers && info.carriers.length > 1;
		var lineStroke1 = 'var(--qm-accent)';
		var lineStroke2 = 'var(--qm-ok)';

		var svgStr = [
			'<svg class="qm-ca-topo-svg" viewBox="0 0 540 100">',
			'  <defs>',
			'    <linearGradient id="qmTowerGlow" x1="0%" y1="0%" x2="100%" y2="100%">',
			'      <stop offset="0%" stop-color="var(--qm-accent)"/>',
			'      <stop offset="100%" stop-color="#38bdf8"/>',
			'    </linearGradient>',
			'  </defs>',
			'  <!-- 5G 宏站塔矢量 -->',
			'  <g transform="translate(24, 10)">',
			'    <path d="M20 4 L30 64 L10 64 Z" fill="none" stroke="url(#qmTowerGlow)" stroke-width="2.4" stroke-linejoin="round"/>',
			'    <line x1="8" y1="26" x2="32" y2="26" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <line x1="12" y1="44" x2="28" y2="44" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <circle cx="20" cy="4" r="3.5" fill="#ef4444" class="qm-tower-beacon"/>',
			'    <path d="M12 -2 A 10 10 0 0 1 28 -2" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round"/>',
			'    <path d="M7 -7 A 16 16 0 0 1 33 -7" fill="none" stroke="#38bdf8" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3,3"/>',
			'    <text x="20" y="78" font-size="10.5" fill="var(--qm-text-muted)" text-anchor="middle" font-weight="750">5G gNB 基站</text>',
			'  </g>',
			'  <!-- PCC 动态数据微波束 -->',
			'  <path d="M 68 34 C 180 12, 280 20, 420 34" fill="none" stroke="' + lineStroke1 + '" stroke-width="2.6" class="qm-flow-line"/>',
			'  <!-- SCC 动态副载波微波束 -->',
			hasCa ? '  <path d="M 68 46 C 180 70, 280 62, 420 48" fill="none" stroke="' + lineStroke2 + '" stroke-width="2.6" class="qm-flow-line" style="animation-duration:1.1s;"/>' : '',
			'  <!-- 模组基带芯片汇聚端点 -->',
			'  <g transform="translate(424, 12)">',
			'    <rect x="0" y="6" width="84" height="52" rx="12" fill="var(--qm-glass)" stroke="var(--qm-glass-border-strong)" stroke-width="2"/>',
			'    <!-- 芯片引脚 -->',
			'    <line x1="14" y1="2" x2="14" y2="6" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <line x1="28" y1="2" x2="28" y2="6" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <line x1="42" y1="2" x2="42" y2="6" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <line x1="56" y1="2" x2="56" y2="6" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <line x1="70" y1="2" x2="70" y2="6" stroke="var(--qm-accent)" stroke-width="2"/>',
			'    <text x="42" y="28" font-size="13" font-weight="850" fill="var(--qm-text)" text-anchor="middle">' + controls.xmlText(hasCa ? info.count + 'CA 聚合' : '单载波 1CC') + '</text>',
			'    <text x="42" y="44" font-size="9.5" font-weight="700" fill="var(--qm-accent)" text-anchor="middle">' + controls.xmlText(info.carriers[0] ? (info.carriers[0].band || '5G 模组') : '5G 模组') + '</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	renderSvgTrafficChart: function(days, swapped) {
		var list = Array.isArray(days) ? days.slice(-8) : [];
		if (!list.length) {
			return E('div', { 'style': 'text-align:center;padding:44px 0;color:var(--qm-text-muted);font-size:12.5px' }, _('暂无分天流量数据'));
		}
		var max = 1;
		list.forEach(function(d) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			max = Math.max(max, rx, tx);
		});

		var svgW = 600, svgH = 120, baseY = 96;
		var len = list.length;
		var gap = svgW / Math.max(1, len - 1);

		var dlPoints = [], ulPoints = [];
		list.forEach(function(d, i) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			var x = (len === 1) ? svgW / 2 : i * gap;
			var yDl = baseY - Math.max(4, (rx / max) * 75);
			var yUl = baseY - Math.max(4, (tx / max) * 75);
			dlPoints.push({ x: x, y: yDl });
			ulPoints.push({ x: x, y: yUl });
		});

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

		var dateTexts = list.map(function(d, i) {
			var x = (len === 1) ? svgW / 2 : i * gap;
			var label = String(d.date || '').slice(5);
			return '<text x="' + x.toFixed(1) + '" y="' + (baseY + 16) + '" font-size="9" fill="var(--qm-text-muted)" text-anchor="middle" font-weight="700">' + controls.xmlText(label) + '</text>';
		}).join('');

		var fullChart = [
			'<svg class="qm-chart-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '">',
			'  <defs>',
			'    <linearGradient id="qmDlAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
			'      <stop offset="0%" stop-color="#0072f5" stop-opacity="0.32"/>',
			'      <stop offset="100%" stop-color="#0072f5" stop-opacity="0.0"/>',
			'    </linearGradient>',
			'    <linearGradient id="qmUlAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">',
			'      <stop offset="0%" stop-color="#10b981" stop-opacity="0.26"/>',
			'      <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>',
			'    </linearGradient>',
			'  </defs>',
			'  <line x1="0" y1="' + baseY + '" x2="' + svgW + '" y2="' + baseY + '" stroke="var(--qm-border-soft)" stroke-width="1.2"/>',
			'  <line x1="0" y1="' + (baseY - 40) + '" x2="' + svgW + '" y2="' + (baseY - 40) + '" stroke="var(--qm-border-soft)" stroke-width="0.8" stroke-dasharray="3,3"/>',
			'  <path d="' + dlAreaStr + '" fill="url(#qmDlAreaGrad)"/>',
			'  <path d="' + dlPathStr + '" fill="none" stroke="#0072f5" stroke-width="2.6" stroke-linecap="round"/>',
			'  <path d="' + ulAreaStr + '" fill="url(#qmUlAreaGrad)"/>',
			'  <path d="' + ulPathStr + '" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round"/>',
			dateTexts,
			'</svg>'
		].join('');

		return svgNode(fullChart);
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
			1: { desc: _('GBR · 实时语音') },
			2: { desc: _('GBR · 实时视频') },
			3: { desc: _('GBR · 低延迟交互') },
			4: { desc: _('GBR · 缓冲流视频') },
			5: { desc: _('Non-GBR · IMS 信令') },
			6: { desc: _('Non-GBR · TCP 优先') },
			7: { desc: _('Non-GBR · 交互业务') },
			8: { desc: _('Non-GBR · 通用数据') },
			9: { desc: _('Non-GBR · 后台数据') }
		};
		var qi5Map = {
			1: { desc: _('GBR · 会话语音') },
			2: { desc: _('GBR · 会话视频') },
			3: { desc: _('GBR · 实时游戏') },
			4: { desc: _('GBR · 缓冲流媒体') },
			5: { desc: _('Non-GBR · IMS 信令') },
			6: { desc: _('Non-GBR · 交互业务') },
			7: { desc: _('Non-GBR · 低延迟交互') },
			8: { desc: _('Non-GBR · 默认数据') },
			9: { desc: _('Non-GBR · 后台数据') }
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
		return controls.dataRow(label, value, 'qm-kv-item');
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

	render: function(res) {
		return controls.liveView(this, res, {
			interval: this.POLL_INTERVAL,
			paint: this.paintContent,
			collect: this.collect
		});
	},

	paintContent: function(res) {
		var self = this;
		res = res || {};

		if (!res.section) {
			return E('div', { 'class': 'qm-cockpit-dashboard' }, [
				self.styleNode(), controls.styleNode(),
				E('div', { 'class': 'qm-error-banner' }, _('No modem detected (make sure QModem has recognised the device).')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class': 'qm-error-banner' }, msg);
				})
			]);
		}

		var data = self.parseStatus(res);
		var connected = data.connected === '1', reachable = data.reachable === '1';
		var session = self.parseSession(res, connected);
		var carrierInfo = self.carrierInfo(res);
		var enter = !self.painted;
		self.painted = true;

		if (/^(n\/a|none|null|--)$/i.test(data.operator_name || ''))
			data.operator_name = '';
		var opInfo = controls.operatorInfo(data.operator_name || null, data.mcc, data.mnc);
		var operator = opInfo.name;
		data.operator = (operator && operator !== _('Mobile Network')) ? operator : '';

		var rsrp = parseFloat(data.rsrp);
		var quality = self.signalQuality('rsrp', rsrp);

		function copyBtn(val) {
			return E('button', {
				'type': 'button',
				'class': 'qm-copy-btn',
				'title': _('复制'),
				'click': function(ev) {
					ev.stopPropagation();
					copyToClipboard(val, ev.currentTarget);
				}
			}, [ svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>') ]);
		}

		function copyItem(text) {
			if (!text) return text;
			return E('div', { 'class': 'qm-val-with-copy' }, [
				E('strong', {}, text),
				copyBtn(text)
			]);
		}

		var subRate = self.subscriptionRate(data.qosInfo);
		var qosLvl = self.qosExplain(data.qosInfo);

		// 流量统计汇总
		var usage = res.usage || {}, daily = res.daily || {};
		var swapped = Number(daily.swapped) === 1;
		var dl = swapped ? (Number(daily.total_tx) || 0) : (Number(daily.total_rx) || 0);
		var ul = swapped ? (Number(daily.total_rx) || 0) : (Number(daily.total_tx) || 0);
		var todayDl = swapped ? (Number(daily.today_tx) || 0) : (Number(daily.today_rx) || 0);
		var todayUl = swapped ? (Number(daily.today_rx) || 0) : (Number(daily.today_tx) || 0);

		return E('div', { 'class': 'qm-cockpit-dashboard' + (enter ? ' qm-enter' : '') }, [
			self.styleNode(), controls.styleNode(),
			/* 背景氛围光球 */
			E('div', { 'class': 'qm-ambient-orb orb-1' }),
			E('div', { 'class': 'qm-ambient-orb orb-2' }),
			E('div', { 'class': 'qm-ambient-orb orb-3' }),

			/* 异常提示 */
			(res.errors || []).map(function(msg) {
				return E('div', { 'class': 'qm-error-banner' }, msg);
			}),

			/* 多模组切换条 */
			self.modems && self.modems.length > 1 ? controls.renderModemBar(self.modems, res.section, function(id) {
				controls.setStoredSection(id);
				window.location.reload();
			}) : null,

			/* 1. MASTER COCKPIT HEADER BAR (全息极简座舱天幕顶栏) */
			E('header', { 'class': 'qm-cockpit-header' }, [
				E('div', { 'class': 'qm-head-brand' }, [
					E('div', { 'class': 'qm-brand-emblem' }, [
						renderOperatorSvg(operator || data.operator_name, data.mcc, data.mnc)
					]),
					E('div', { 'class': 'qm-brand-title-wrap' }, [
						E('div', { 'class': 'qm-brand-title' }, [
							operator || data.operator_name || _('蜂窝网络'),
							data.sysmode_detail ? E('span', { 'class': 'qm-panel-badge good', 'style': 'font-size:10px;padding:2px 8px' }, data.sysmode_detail) : null
						]),
						E('div', { 'class': 'qm-brand-sub' }, [
							data.model ? E('span', {}, data.model) : null,
							carrierInfo.band ? E('span', {}, '· Band ' + carrierInfo.band) : null,
							data.active_apn ? E('span', {}, '· APN: ' + data.active_apn) : null
						].filter(Boolean))
					])
				]),
				E('div', { 'class': 'qm-head-center' }, [
					E('div', { 'class': 'qm-radar-capsule' + (connected ? ' is-online' : '') }, [
						E('span', { 'class': 'qm-radar-beacon' }),
						connected ? _('5G 全速在线') : reachable ? _('模组就绪 · 未拨号') : _('离线')
					])
				]),
				E('div', { 'class': 'qm-head-actions' }, [
					E('button', {
						'type': 'button',
						'class': 'qm-glass-btn',
						'title': _('刷新数据'),
						'click': function(ev) { return controls.refreshPage(res.section, null, ev.currentTarget); }
					}, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>'),
						_('刷新')
					]),
					E('a', {
						'class': 'qm-glass-btn',
						'href': L.url('admin/modem/qmodem-generic/connection'),
						'title': _('连接配置')
					}, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
						_('配置')
					])
				])
			]),

			/* 2. DUAL-WING CORE STAGE (黄金分割双翼展台: 左翼 5G 射频与基站拓扑全景，右翼 双通道实时吞吐与 IP 矩阵) */
			E('div', { 'class': 'qm-cockpit-stage' }, [
				/* 左翼：5G 射频与基站载波中枢 */
				E('section', { 'class': 'qm-glass-panel qm-wing-spectrum' }, [
					E('div', { 'class': 'qm-panel-header' }, [
						E('div', { 'class': 'qm-panel-title' }, [
							svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/></svg>'),
							_('无线射频与 5G 载波拓扑')
						]),
						E('span', { 'class': 'qm-panel-badge ' + quality.cls }, quality.label)
					]),
					/* 上部：左侧弧形表盘 + 右侧 4 通道矩阵 */
					E('div', { 'class': 'qm-spectrum-upper' }, [
						self.renderSvgSignalDial(quality, data.rsrp),
						E('div', { 'class': 'qm-telemetry-grid' }, [
							self.metricTelemetryTile('SINR (信噪比)', 'sinr', data.sinr, ' dB'),
							self.metricTelemetryTile('RSRQ (信号质量)', 'rsrq', data.rsrq, ' dB'),
							self.metricTelemetryTile('PCI (物理小区)', 'pci', data.pci, ''),
							self.metricTelemetryTile('工作温度', 'temp', data.temperature, '°C')
						])
					]),
					/* 下部：5G 宏站拓扑全景图与载波 */
					E('div', { 'class': 'qm-spectrum-lower' }, [
						self.renderSvgCarrierTopo(carrierInfo),
						E('div', { 'class': 'qm-carrier-pill-row' }, carrierInfo.carriers.map(function(item, idx) {
							var isPcc = idx === 0 || /^(pcc|pcell|primary)$/i.test(item.role);
							return E('div', { 'class': 'qm-carrier-chip' }, [
								E('span', { 'class': 'qm-carrier-tag ' + (isPcc ? 'pcc' : 'scc') }, isPcc ? 'PCC' : 'SCC' + idx),
								E('strong', {}, joinValues(item.radio, item.band) || '--'),
								E('span', { 'class': 'qm-carrier-details' }, [
									mhz(item.dlBandwidth) ? 'DL ' + mhz(item.dlBandwidth) : null,
									item.pci ? 'PCI ' + item.pci : null
								].filter(Boolean).join(' · '))
							]);
						}))
					])
				]),

				/* 右翼：双通道实时吞吐与移动 WAN 会话 */
				E('section', { 'class': 'qm-glass-panel qm-wing-session' }, [
					E('div', { 'class': 'qm-panel-header' }, [
						E('div', { 'class': 'qm-panel-title' }, [
							svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'),
							_('实时流量与 WAN 会话')
						]),
						E('span', { 'class': 'qm-panel-badge ' + (connected ? 'excellent' : 'weak') }, connected ? _('已建立会话') : _('未连接'))
					]),
					/* 实时双流速卡 */
					E('div', { 'class': 'qm-flow-metrics' }, [
						E('div', { 'class': 'qm-flow-card dl' }, [
							E('div', { 'class': 'qm-flow-label' }, [
								svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.5"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>'),
								_('今日下行 (DL)')
							]),
							E('div', { 'class': 'qm-flow-val' }, controls.formatBytes(todayDl)),
							E('div', { 'class': 'qm-flow-sub' }, _('累计已下行: ') + controls.formatBytes(dl))
						]),
						E('div', { 'class': 'qm-flow-card ul' }, [
							E('div', { 'class': 'qm-flow-label' }, [
								svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>'),
								_('今日上行 (UL)')
							]),
							E('div', { 'class': 'qm-flow-val' }, controls.formatBytes(todayUl)),
							E('div', { 'class': 'qm-flow-sub' }, _('累计已上行: ') + controls.formatBytes(ul))
						])
					]),
					/* 移动 IP 会话详细 */
					E('div', { 'class': 'qm-session-matrix' }, [
						session.ipv4Address ? E('div', { 'class': 'qm-ip-row' }, [
							E('div', { 'class': 'qm-ip-header' }, [
								E('span', {}, 'IPv4 公私网地址'),
								E('span', { 'style': 'color:' + (session.ipv4Connected ? 'var(--qm-ok)' : 'var(--qm-text-muted)') }, session.ipv4Connected ? '● ' + _('已分配') : '○')
							]),
							E('div', { 'class': 'qm-ip-content' }, [
								E('span', { 'class': 'qm-ip-val' }, session.ipv4Address),
								copyBtn(session.ipv4Address)
							])
						]) : null,
						session.ipv6Address ? E('div', { 'class': 'qm-ip-row' }, [
							E('div', { 'class': 'qm-ip-header' }, [
								E('span', {}, 'IPv6 原生前缀'),
								E('span', { 'style': 'color:' + (session.ipv6Connected ? 'var(--qm-ok)' : 'var(--qm-text-muted)') }, session.ipv6Connected ? '● ' + _('已分配') : '○')
							]),
							E('div', { 'class': 'qm-ip-content' }, [
								E('span', { 'class': 'qm-ip-val' }, session.ipv6Address),
								copyBtn(session.ipv6Address)
							])
						]) : null,
						joinValues(session.dns4, session.dns6) ? E('div', { 'class': 'qm-ip-row' }, [
							E('div', { 'class': 'qm-ip-header' }, [ E('span', {}, 'DNS 域名解析') ]),
							E('div', { 'class': 'qm-ip-content' }, [
								E('span', { 'class': 'qm-ip-val' }, joinValues(session.dns4, session.dns6)),
								copyBtn(joinValues(session.dns4, session.dns6))
							])
						]) : null,
						E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:4px 2px;font-size:11.5px;color:var(--qm-text-muted)' }, [
							E('span', {}, _('网络接口: ') + (data.network_interface || session.device || '--')),
							session.mtu ? E('span', {}, 'MTU: ' + session.mtu) : null
						])
					])
				])
			]),

			/* 3. WIDE PANORAMIC TRAFFIC TRAJECTORY CHART (全景 8 天流量走势图) */
			E('section', { 'class': 'qm-glass-panel qm-traffic-stage' }, [
				E('div', { 'class': 'qm-panel-header' }, [
					E('div', { 'class': 'qm-panel-title' }, [
						svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'),
						_('全景流量走势图 (最近 8 天连续记录)')
					]),
					E('div', { 'style': 'display:flex;gap:14px;font-size:11.5px;font-weight:750' }, [
						E('span', { 'style': 'color:#0072f5' }, '● ' + _('下行 (DL)')),
						E('span', { 'style': 'color:#10b981' }, '● ' + _('上行 (UL)'))
					])
				]),
				self.renderSvgTrafficChart(daily.days, swapped)
			]),

			/* 4. MODULAR CELLULAR INTELLIGENCE MATRIX (三联精工玻璃卡片) */
			E('div', { 'class': 'qm-triad-grid' }, [
				/* 卡片 1: 5G 硬件与芯片工况 */
				E('section', { 'class': 'qm-glass-panel qm-triad-card' }, [
					E('div', { 'class': 'qm-panel-header' }, [
						E('div', { 'class': 'qm-panel-title' }, [
							svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>'),
							_('模组硬件工况')
						]),
						E('span', { 'class': 'qm-panel-badge good' }, data.manufacturer || _('就绪'))
					]),
					E('div', {}, [
						self.infoRow(_('设备型号'), data.model),
						self.infoRow(_('硬件厂商'), data.manufacturer),
						self.infoRow(_('固件版本'), data.revision),
						data.imei ? self.infoRow('IMEI', copyItem(data.imei)) : null,
						self.infoRow(_('AT 端口'), data.at_port)
					])
				]),

				/* 卡片 2: SIM 卡与安全认证 */
				E('section', { 'class': 'qm-glass-panel qm-triad-card' }, [
					E('div', { 'class': 'qm-panel-header' }, [
						E('div', { 'class': 'qm-panel-title' }, [
							svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="8" y="10" width="8" height="8" rx="1.5"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="12" y1="10" x2="12" y2="18"/></svg>'),
							_('SIM 与认证安全')
						]),
						E('span', { 'class': 'qm-panel-badge ' + (/READY|正常|OK/i.test(data.sim) ? 'excellent' : 'weak') }, data.sim || _('就绪'))
					]),
					E('div', {}, [
						self.infoRow(_('运营商识别'), data.operator),
						self.infoRow(_('SIM 状态'), data.sim),
						data.iccid ? self.infoRow('ICCID', copyItem(data.iccid)) : null,
						data.imsi ? self.infoRow('IMSI', copyItem(data.imsi)) : null,
						self.infoRow(_('本机号码'), data.phone_number)
					])
				]),

				/* 卡片 3: 蜂窝承载与服务质量 */
				E('section', { 'class': 'qm-glass-panel qm-triad-card' }, [
					E('div', { 'class': 'qm-panel-header' }, [
						E('div', { 'class': 'qm-panel-title' }, [
							svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'),
							_('5G 承载与 QoS')
						]),
						E('span', { 'class': 'qm-panel-badge good' }, data.sysmode_detail || '5G')
					]),
					E('div', {}, [
						self.infoRow(_('签约速率'), subRate),
						qosLvl.label ? E('div', { 'class': 'qm-kv-item' }, [
							E('span', {}, _('QoS 承载等级')),
							E('strong', { 'style': 'color:var(--qm-accent)' }, qosLvl.label + ' (' + qosLvl.desc + ')')
						]) : null,
						self.infoRow(_('主频段'), carrierInfo.band),
						self.infoRow(_('接入点 (APN)'), data.active_apn),
						self.infoRow('MCC / MNC', joinValues(data.mcc, data.mnc))
					])
				])
			]),

			/* 5. 流量清零计划 (若支持) */
			isTrafficAvailable(res.usage) ? self.trafficScheduleCard(res.trafficResetSchedule, res.section) : null,

			/* 6. DOCK / QUICK ACTION TILES (悬浮应用坞) */
			E('nav', { 'class': 'qm-command-dock', 'aria-label': _('快捷管理导航') }, [
				E('a', { 'class': 'qm-glass-panel qm-dock-tile', 'href': L.url('admin/modem/qmodem-generic/connection') }, [
					E('span', { 'class': 'qm-dock-icon' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 3v14m-4-4 4 4 4-4M17 21V7m-4 4 4-4 4 4"/></svg>')),
					E('div', { 'class': 'qm-dock-info' }, [
						E('strong', {}, _('APN 拨号')),
						E('span', {}, _('接入点与数据协议'))
					]),
					E('span', { 'class': 'qm-dock-arrow' }, '→')
				]),
				E('a', { 'class': 'qm-glass-panel qm-dock-tile', 'href': L.url('admin/modem/qmodem-generic/network') }, [
					E('span', { 'class': 'qm-dock-icon' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 17h2v4H3zm5-5h2v9H8zm5-5h2v14h-2zm5-4h2v18h-2z"/></svg>')),
					E('div', { 'class': 'qm-dock-info' }, [
						E('strong', {}, _('锁频与小区')),
						E('span', {}, _('频段锁定与驻留优化'))
					]),
					E('span', { 'class': 'qm-dock-arrow' }, '→')
				]),
				E('a', { 'class': 'qm-glass-panel qm-dock-tile', 'href': L.url('admin/modem/qmodem-generic/system') }, [
					E('span', { 'class': 'qm-dock-icon' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="9" y="11" width="6" height="7" rx="1"/></svg>')),
					E('div', { 'class': 'qm-dock-info' }, [
						E('strong', {}, _('模组与 SIM')),
						E('span', {}, _('卡槽切换与系统维护'))
					]),
					E('span', { 'class': 'qm-dock-arrow' }, '→')
				]),
				E('a', { 'class': 'qm-glass-panel qm-dock-tile', 'href': L.url('admin/modem/qmodem-generic/terminal') }, [
					E('span', { 'class': 'qm-dock-icon' }, svgNode('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>')),
					E('div', { 'class': 'qm-dock-info' }, [
						E('strong', {}, _('AT 终端交互')),
						E('span', {}, _('底层串口指令调试'))
					]),
					E('span', { 'class': 'qm-dock-arrow' }, '→')
				])
			]),

			/* 7. FULL TELEMETRY COLLAPSIBLE DRAWER (底层全量上报抽屉) */
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
				return E('details', { 'class': 'qm-glass-panel qm-info-drawer' }, [
					E('summary', {}, [
						E('span', {}, _('全量模组遥测上报参数')),
						fieldCount ? E('span', { 'class': 'qm-drawer-count' }, _('%d 类 · %d 项参数').format(keys.length, fieldCount)) : null
					]),
					E('div', { 'style': 'margin-top:14px' }, [ body ])
				]);
			})()
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
