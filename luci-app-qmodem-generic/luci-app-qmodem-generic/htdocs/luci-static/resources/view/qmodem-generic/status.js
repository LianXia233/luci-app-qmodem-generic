'use strict';
'require view';
'require uci';
'require qmodem-generic.controls as controls';

/*
 * 通用模组概览页 — 现代白色毛玻璃 (Glassmorphism) + 动态 SVG 仪表盘重构
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

// 安全渲染 SVG 节点 helper，规避部分老旧 LuCI 运行时 createElementNS 差异
function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'status', 'network', 'signal', 'sim', 'stats', 'qos', 'radio' ],
	POLL_INTERVAL: 5000,

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
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
			guard(controls.getQosInfo(section), 'QOS', {}),
			guard(controls.getTrafficResetSchedule(section), _('流量清零计划'), {}),
			guard(controls.getRadioInfo(section), _('调制方式'), {}),
			guard(controls.getDailyStats(section), _('每日流量'), null)
		]).then(function(r) {
			var iface = r[7] || {};
			var ifname = iface.interface || '';
			var devName = iface.l3_device || iface.device || '';
			var devPromise = devName
				? guard(controls.getDeviceStatusCached(section), _('设备速率'), {})
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
					trafficResetSchedule: r[10],
					currentBand: r[6],
					iface: r[7],
					net: r[8],
					qosInfo: r[9] || {},
					radioInfo: r[11] || {},
					daily: r[12] || null,
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

		var atQos = res.qosInfo || {};
		/* 后端契约：签名速率统一为 kbps，未知用 null（绝不伪装成 0）。
		 * QCI（LTE）与 5QI（5G）是两个独立维度，前端必须分开承接，不能互相覆盖。 */
		function posNum(v) {
			var n = Number(v);
			return isFinite(n) && n > 0 ? n : null;
		}
		function mbpsToKbps(v) {
			var n = parseFloat(v);
			return isNaN(n) || n <= 0 ? null : Math.round(n * 1000);
		}
		/* QModem 原生 modem_info 字段优先（QCI 属于 LTE、5QI 属于 5G），
		 * 且必须确认字段属于当前注册网络/当前 APN（worker 已按 CID 校准）。 */
		var qmQci = parseInt(find(net, 'QCI') || find(base, 'QCI') ||
			find(cell, 'QCI') || find(sim, 'QCI') ||
			find(net, 'QCI Index') || find(base, 'QCI Index'), 10);
		var qm5qi = parseInt(find(net, '5QI') || find(base, '5QI') ||
			find(cell, '5QI') || find(sim, '5QI') ||
			find(net, '5QI Index') || find(base, '5QI Index'), 10);
		qmQci = isFinite(qmQci) && qmQci > 0 ? qmQci : null;
		qm5qi = isFinite(qm5qi) && qm5qi > 0 ? qm5qi : null;
		var qmUl = mbpsToKbps(find(net, 'AMBR UL'));
		var qmDl = mbpsToKbps(find(net, 'AMBR DL'));

		var atQci = posNum(atQos.qci);
		var at5qi = posNum(atQos.five_qi);
		var atDl = posNum(atQos.downlink_rate_kbps);
		var atUl = posNum(atQos.uplink_rate_kbps);

		var qosInfo = {
			qci: qmQci != null ? qmQci : atQci,
			qci_source: qmQci != null ? 'qmodem.network_info' : (atQci != null ? String(atQos.qci_source || 'qmodem.modem_info') : null),
			five_qi: qm5qi != null ? qm5qi : at5qi,
			five_qi_source: qm5qi != null ? 'qmodem.network_info' : (at5qi != null ? String(atQos.five_qi_source || 'qmodem.modem_info') : null),
			downlink_rate_kbps: qmDl != null ? qmDl : atDl,
			uplink_rate_kbps: qmUl != null ? qmUl : atUl,
			rate_source: (qmDl != null || qmUl != null) ? 'qmodem.network_info' : String(atQos.rate_source || ''),
			apn: atQos.apn || find(net, 'APN') || '',
			domain: String(atQos.domain || (qm5qi != null ? 'NR' : 'LTE')),
			status: String(atQos.status || 'no_data')
		};

		var data = {};
		data.model = find(base, 'name') || find(base, 'model') || _('模组');
		data.manufacturer = find(base, 'manufacturer') || '';
		data.revision = find(base, 'revision') || '';
		data.at_port = find(base, 'at_port') || '';
		data.temperature = String(controls.normalizeTemperature(find(base, 'temperature')) || '').replace(/[^0-9.\-]/g, '');

		data.rsrp = find(cell, 'RSRP') || '';
		data.rsrq = find(cell, 'RSRQ') || '';
		data.sinr = find(cell, 'SINR') || '';
		data.sysmode_detail = this.cleanText(
			find(cell, 'network_mode') ||
			find(cell, 'Network Type') ||
			find(net, 'Network Type') ||
			find(conn, 'Network Type') ||
			find(cell, 'Radio Access Technology') ||
			find(net, 'Radio Access Technology') || '');
		data.mcc = find(cell, 'MCC') || '';
		data.mnc = find(cell, 'MNC') || '';

		data.sim = find(sim, 'SIM Status') || '';
		data.imei = find(sim, 'IMEI') || find(base, 'IMEI') || '';
		data.imsi = find(sim, 'IMSI') || '';
		var rawIccid = find(sim, 'ICCID') || '';
		data.iccid = rawIccid ? String(rawIccid).replace(/[\n\r]/g, '') : '--';
		data.phone_number = this.cleanText(
			find(sim, 'SIM Number') || find(sim, 'MSISDN') || find(sim, 'Phone Number') ||
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
		if (raw == null) return '';
		return String(raw).replace(/[\x00-\x1f\x7f]+/g, '').trim();
	},

	cleanDns: function(raw) {
		if (!raw) return '';
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
		return E('style', {}, [
			/* 全局毛玻璃与流动渐变底蕴 */
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.qmodem-glass-page{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:30px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境氛围光球，烘托白色毛玻璃透光感 */
			'.qmodem-glass-bg-glow{position:absolute;top:-40px;left:5%;width:420px;height:420px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.qmodem-glass-bg-glow2{position:absolute;top:280px;right:4%;width:380px;height:380px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(236,72,153,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 卡片通用白色毛玻璃效果 */
			'.qm-glass-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:20px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.qm-glass-card:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(31,64,120,0.09),0 2px 6px rgba(0,0,0,0.04)}',

			/* 顶部 Hero 玻璃卡片 */
			'.qm-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.qm-hero-title{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.qm-hero-sub{font-size:13px;color:#64748b;line-height:1.5}',
			'.qm-hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;margin-top:14px;font-size:12px;color:#475569}',
			'.qm-hero-op{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border-radius:10px;background:rgba(255,255,255,0.7);border:1px solid rgba(226,232,240,0.8);font-weight:700;color:#0f172a}',
			'.qm-hero-op img{width:22px;height:22px;object-fit:contain}',
			'.qm-pill-tag{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;background:rgba(241,245,249,0.75);font-size:11px;font-weight:600;color:#475569}',
			'.qm-pill-tag strong{color:#0f172a}',

			/* 状态指示徽章 & SVG 脉冲光圈 */
			'.qm-hero-actions{display:flex;align-items:center;gap:12px}',
			'.qm-status-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,0.8);border:1px solid rgba(226,232,240,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.04);font-size:12px;font-weight:700}',
			'.qm-pulse-circle{width:10px;height:10px;border-radius:50%;background:#cbd5e1;position:relative}',
			'.qm-status-badge.online{color:#065f46;background:rgba(236,253,245,0.85);border-color:rgba(167,243,208,0.8)}',
			'.qm-status-badge.online .qm-pulse-circle{background:#10b981;box-shadow:0 0 0 0 rgba(16,185,129,0.6);animation:qmPulse 2s infinite}',
			'@keyframes qmPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.7)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}',
			'.qm-refresh-btn{padding:8px 18px;border-radius:999px;border:1px solid rgba(203,213,225,0.8);background:rgba(255,255,255,0.8);color:#334155;font-weight:600;font-size:12px;cursor:pointer;transition:all .2s ease}',
			'.qm-refresh-btn:hover{background:#fff;color:#0072f5;border-color:rgba(0,114,245,0.4);transform:scale(1.02)}',

			/* 核心聚焦 3 列网格 */
			'.qm-grid-3{display:grid;grid-template-columns:1.08fr 1.02fr 1fr;gap:16px;margin-bottom:16px}',
			'.qm-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}',
			'.qm-card-title{font-size:15px;font-weight:750;color:#0f172a;display:flex;align-items:center;gap:8px}',
			'.qm-card-sub{font-size:11px;color:#64748b;margin-top:2px}',
			'.qm-badge{padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.02em;text-transform:uppercase}',
			'.qm-badge.excellent{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}',
			'.qm-badge.good{background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe}',
			'.qm-badge.fair{background:#fffbeb;color:#d97706;border:1px solid #fde68a}',
			'.qm-badge.weak{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}',
			'.qm-badge.active{background:#eff6ff;color:#0072f5;border:1px solid #bfdbfe}',

			/* 信号仪表盘 SVG 容器 */
			'.qm-signal-dial-box{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 0 10px}',
			'.qm-signal-dial-svg{width:180px;height:120px;overflow:visible}',
			'.qm-dial-value-text{position:absolute;top:62px;text-align:center}',
			'.qm-dial-value-text strong{font-size:28px;font-weight:800;color:#0f172a;letter-spacing:-.03em}',
			'.qm-dial-value-text span{display:block;font-size:10px;color:#64748b;margin-top:-2px}',

			/* 信号小指标微卡片 */
			'.qm-mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}',
			'.qm-mini-item{padding:9px 10px;border-radius:12px;background:rgba(248,250,252,0.7);border:1px solid rgba(241,245,249,0.85);text-align:center}',
			'.qm-mini-label{font-size:10px;color:#64748b;font-weight:600}',
			'.qm-mini-val{font-size:13px;font-weight:750;color:#0f172a;margin:2px 0 4px;font-variant-numeric:tabular-nums}',
			'.qm-mini-bar{height:4px;border-radius:999px;background:#e2e8f0;overflow:hidden}',
			'.qm-mini-bar i{display:block;height:100%;border-radius:inherit;transition:width .4s ease}',

			/* 载波聚合动态 SVG 拓扑 */
			'.qm-carrier-topo-box{padding:6px 0 12px}',
			'.qm-carrier-topo-svg{width:100%;height:105px;display:block}',
			'@keyframes qmDashFlow{to{stroke-dashoffset:-36}}',
			'.qm-flow-line{stroke-dasharray:6,4;animation:qmDashFlow 1.6s linear infinite}',
			'.qm-cc-container{display:flex;flex-direction:column;gap:6px;max-height:175px;overflow-y:auto;padding-right:2px;margin:8px 0}',
			'.qm-cc-card{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:12px;background:rgba(248,250,252,0.75);border:1px solid rgba(226,232,240,0.7)}',
			'.qm-cc-left{display:flex;align-items:center;gap:8px}',
			'.qm-cc-badge{padding:2px 6px;border-radius:6px;font-size:9px;font-weight:750}',
			'.qm-cc-badge.pcc{background:#0072f5;color:#fff}',
			'.qm-cc-badge.scc{background:#e2e8f0;color:#475569}',
			'.qm-cc-band{font-size:12px;font-weight:700;color:#0f172a}',
			'.qm-cc-metrics{font-size:10px;color:#64748b;display:flex;gap:8px;font-variant-numeric:tabular-nums}',

			/* IP网络会话卡片 */
			'.qm-ip-box{display:flex;flex-direction:column;gap:8px}',
			'.qm-ip-row{padding:10px 12px;border-radius:12px;background:rgba(248,250,252,0.75);border:1px solid rgba(226,232,240,0.7)}',
			'.qm-ip-header{display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px}',
			'.qm-ip-val{font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;word-break:break-all}',
			'.qm-ip-link{display:inline-flex;align-items:center;gap:4px;color:#0072f5;font-size:11px;font-weight:700;text-decoration:none;margin-top:auto;padding-top:10px}',

			/* 双列信息网格 */
			'.qm-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}',
			'.qm-list-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12px}',
			'.qm-list-row:last-child{border-bottom:0}',
			'.qm-list-row span{color:#64748b}',
			'.qm-list-row strong{color:#0f172a;font-weight:600;text-align:right}',

			/* 流量统计面板 & SVG 图表 */
			'.qm-traffic-layout{display:grid;grid-template-columns:repeat(3,minmax(0,.7fr)) minmax(320px,1.9fr);gap:12px;margin-top:14px}',
			'.qm-stat-card{padding:14px;border-radius:14px;background:rgba(248,250,252,0.85);border:1px solid rgba(226,232,240,0.8);display:flex;flex-direction:column;justify-content:center}',
			'.qm-stat-label{font-size:11px;color:#64748b;font-weight:600;display:flex;align-items:center;gap:6px}',
			'.qm-stat-val{font-size:20px;font-weight:800;color:#0f172a;margin:5px 0 2px;letter-spacing:-.02em}',
			'.qm-stat-sub{font-size:10px;color:#94a3b8}',
			'.qm-traffic-chart-box{background:rgba(248,250,252,0.7);border-radius:14px;border:1px solid rgba(226,232,240,0.8);padding:12px 14px}',
			'.qm-traffic-chart-svg{width:100%;height:115px;display:block}',

			/* 快捷导航 */
			'.qm-shortcuts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}',
			'.qm-shortcut-item{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;color:inherit;text-decoration:none}',
			'.qm-shortcut-item strong{display:block;font-size:13px;color:#0f172a}',
			'.qm-shortcut-item span{display:block;font-size:11px;color:#64748b;margin-top:3px}',
			'.qm-shortcut-item i{font-style:normal;font-size:18px;color:#0072f5;font-weight:700}',

			/* 响应式适配 */
			'@media(max-width:980px){.qm-grid-3{grid-template-columns:1fr 1fr}.qm-address-card{grid-column:1/-1}.qm-traffic-layout{grid-template-columns:repeat(3,1fr)}.qm-traffic-chart-box{grid-column:1/-1}}',
			'@media(max-width:680px){.qm-hero{flex-direction:column;align-items:flex-start}.qm-hero-actions{width:100%;justify-content:space-between}.qm-grid-3,.qm-grid-2,.qm-shortcuts,.qm-traffic-layout{grid-template-columns:1fr}.qm-address-card,.qm-traffic-chart-box{grid-column:auto}}'
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
		var colors = [ '#10b981', '#0072f5', '#f59e0b', '#ef4444' ];
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

		var ri = res.radioInfo || {};
		var stripCtl = function(v) { return v == null ? '' : String(v).replace(/[\x00-\x1f\x7f]+/g, '').trim(); };
		var rat = stripCtl(ri.rat);
		if (!rat)
			rat = /NR/i.test(mode) ? 'NR' : (/LTE/i.test(mode) || /LTE/i.test(stripCtl(find(cell, 'Network Type')) || stripCtl(find(res.net || [], 'Network Type'))) ? 'LTE' : '');
		function modLine(mcs, mod) {
			if ((mcs == null || mcs === '') && (!mod || /^unknown$/i.test(mod)))
				return '';
			var parts = [ rat ];
			if (mcs != null && mcs !== '')
				parts.push('MCS ' + mcs);
			if (mod && !/^unknown$/i.test(mod))
				parts.push(mod);
			return parts.filter(Boolean).join(' · ');
		}

		var carriers = cells.map(function(item) {
			return {
				role: item.role || '',
				radio: item.rat || '',
				band: item.band_name || item.band || '',
				arfcn: item.channel || '',
				channelType: item.channel_type || '',
				pci: item.pci || '',
				scs: item.scs || '',
				dlBandwidth: item.dl_bandwidth || '',
				ulBandwidth: item.ul_bandwidth || ''
			};
		}).filter(function(item) { return item.band || item.arfcn; });

		if (!carriers.length) {
			var single = {
				role: 'PCC',
				radio: /NR/i.test(mode) ? 'NR' : /LTE/i.test(mode) ? 'LTE' : '',
				band: find(cell, 'Band') || '',
				arfcn: find(cell, 'EARFCN') || find(cell, 'ARFCN') || '',
				channelType: find(cell, 'EARFCN') ? 'EARFCN' : (find(cell, 'ARFCN') ? 'ARFCN' : ''),
				pci: find(cell, 'Physical Cell ID') || '',
				scs: find(cell, 'SCS') || '',
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
			dlModulation: modLine(ri.dl_mcs, ri.dl_modulation),
			ulModulation: modLine(ri.ul_mcs, ri.ul_modulation),
			carriers: carriers
		};
	},

	/* 动态 SVG 信号仪表圆盘组件 */
	renderSvgSignalDial: function(quality, rsrp) {
		var radius = 64;
		var totalArcLen = Math.PI * radius; // 180度半圆弧长约 201
		var activeLen = (quality.percentage / 100) * totalArcLen;
		var color = quality.strokeColor || '#0072f5';

		var svgStr = [
			'<svg class="qm-signal-dial-svg" viewBox="0 0 160 95">',
			'  <defs>',
			'    <linearGradient id="qmDialGrad" x1="0%" y1="0%" x2="100%" y2="0%">',
			'      <stop offset="0%" stop-color="#0072f5"/>',
			'      <stop offset="60%" stop-color="#10b981"/>',
			'      <stop offset="100%" stop-color="' + color + '"/>',
			'    </linearGradient>',
			'    <filter id="qmDialGlow" x="-20%" y="-20%" width="140%" height="140%">',
			'      <feGaussianBlur stdDeviation="3" result="blur"/>',
			'      <feComposite in="SourceGraphic" in2="blur" operator="over"/>',
			'    </filter>',
			'  </defs>',
			'  <!-- 底轨圆弧 -->',
			'  <path d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="rgba(226,232,240,0.8)" stroke-width="10" stroke-linecap="round"/>',
			'  <!-- 动态指示圆弧 -->',
			'  <path d="M 16 80 A 64 64 0 0 1 144 80" fill="none" stroke="url(#qmDialGrad)" stroke-width="10" stroke-linecap="round"',
			'        stroke-dasharray="' + activeLen.toFixed(1) + ' ' + totalArcLen.toFixed(1) + '"',
			'        filter="url(#qmDialGlow)" style="transition: stroke-dasharray .6s cubic-bezier(.2,.8,.4,1);"/>',
			'</svg>'
		].join('');

		return E('div', { 'class': 'qm-signal-dial-box' }, [
			svgNode(svgStr),
			E('div', { 'class': 'qm-dial-value-text' }, [
				E('strong', {}, isNaN(parseFloat(rsrp)) ? '--' : String(rsrp)),
				E('span', {}, 'RSRP · dBm')
			])
		]);
	},

	metricGauge: function(label, kind, rawValue, unit) {
		var num = parseFloat(rawValue), has = !isNaN(num), pct = 0, color = '#94a3b8';
		if (has) {
			if (kind === 'rsrq') { pct = (num + 25) * 4; color = num >= -10 ? '#10b981' : num >= -15 ? '#0072f5' : num >= -20 ? '#f59e0b' : '#ef4444'; }
			else if (kind === 'sinr') { pct = (num + 10) * 2.5; color = num >= 20 ? '#10b981' : num >= 13 ? '#0072f5' : num >= 0 ? '#f59e0b' : '#ef4444'; }
			else { pct = (num - 20) / 60 * 100; color = num < 45 ? '#10b981' : num < 55 ? '#0072f5' : num < 65 ? '#f59e0b' : '#ef4444'; }
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
		var quality = this.signalQuality('rsrp', rsrp);
		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/></svg>'),
						_('信号')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('射频与信道环境质量'))
				]),
				E('span', { 'class': 'qm-badge ' + quality.cls }, quality.label)
			]),
			this.renderSvgSignalDial(quality, data.rsrp),
			E('div', { 'class': 'qm-mini-grid' }, [
				this.metricGauge('RSRQ', 'rsrq', data.rsrq, ' dB'),
				this.metricGauge('SINR', 'sinr', data.sinr, ' dB'),
				this.metricGauge(_('温度'), 'temp', data.temperature, '°C')
			])
		]);
	},

	/* 动态 SVG 载波拓扑图 */
	renderSvgCarrierTopo: function(info) {
		var hasCa = info.carriers && info.carriers.length > 1;
		var lineStroke1 = hasCa ? '#0072f5' : '#64748b';
		var lineStroke2 = '#10b981';

		var svgStr = [
			'<svg class="qm-carrier-topo-svg" viewBox="0 0 320 85">',
			'  <defs>',
			'    <linearGradient id="qmTowerGlow" x1="0%" y1="0%" x2="100%" y2="100%">',
			'      <stop offset="0%" stop-color="#0072f5"/>',
			'      <stop offset="100%" stop-color="#60a5fa"/>',
			'    </linearGradient>',
			'  </defs>',
			'  <!-- 基站塔 -->',
			'  <g transform="translate(20, 14)">',
			'    <path d="M16 2 L22 46 L10 46 Z" fill="none" stroke="url(#qmTowerGlow)" stroke-width="2.2" stroke-linejoin="round"/>',
			'    <line x1="8" y1="20" x2="24" y2="20" stroke="#0072f5" stroke-width="1.8"/>',
			'    <line x1="11" y1="32" x2="21" y2="32" stroke="#0072f5" stroke-width="1.8"/>',
			'    <circle cx="16" cy="2" r="3.5" fill="#0072f5"/>',
			'    <path d="M10 -2 A 8 8 0 0 1 22 -2" fill="none" stroke="#60a5fa" stroke-width="1.8" stroke-linecap="round"/>',
			'    <text x="16" y="58" font-size="9" fill="#64748b" text-anchor="middle" font-weight="600">gNB/eNB</text>',
			'  </g>',
			'  <!-- 动态传输波束连线 -->',
			'  <path d="M 52 26 C 110 10, 160 18, 240 22" fill="none" stroke="' + lineStroke1 + '" stroke-width="2" class="qm-flow-line"/>',
			hasCa ? '  <path d="M 52 32 C 110 48, 160 42, 240 38" fill="none" stroke="' + lineStroke2 + '" stroke-width="2" class="qm-flow-line" style="animation-duration:1.2s;"/>' : '',
			'  <!-- 终端/模组汇聚 -->',
			'  <g transform="translate(244, 12)">',
			'    <rect x="0" y="4" width="48" height="34" rx="8" fill="rgba(241,245,249,0.9)" stroke="#94a3b8" stroke-width="1.6"/>',
			'    <text x="24" y="21" font-size="10" font-weight="700" fill="#0f172a" text-anchor="middle">' + (hasCa ? info.count + 'CA' : '1CC') + '</text>',
			'    <text x="24" y="32" font-size="8" font-weight="600" fill="#64748b" text-anchor="middle">' + (info.carriers[0] ? (info.carriers[0].band || 'Modem') : 'Modem') + '</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	carrierCard: function(info, devStatus) {
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
					item.pci ? E('span', {}, 'PCI ' + item.pci) : null,
					E('span', {}, 'DL ' + (mhz(item.dlBandwidth) || '--')),
					E('span', {}, 'UL ' + (mhz(item.ulBandwidth) || '--'))
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
				E('span', { 'class': 'qm-mini-label' }, _('USB 链路速率')),
				E('strong', { 'style': 'font-size:12px;color:#0072f5' }, linkLabel)
			]);
		}

		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/></svg>'),
						_('载波聚合状态')
					]),
					E('div', { 'class': 'qm-card-sub' }, info.mode || _('移动网络'))
				]),
				E('span', { 'class': 'qm-badge' + (active ? ' active' : '') }, badge)
			]),
			E('div', { 'class': 'qm-carrier-topo-box' }, [ this.renderSvgCarrierTopo(info) ]),
			E('div', { 'class': 'qm-cc-container' }, ccElements),
			E('div', { 'class': 'qm-mini-grid', 'style': 'grid-template-columns:1fr 1fr' }, [
				E('div', { 'class': 'qm-mini-item' }, [ E('div', { 'class': 'qm-mini-label' }, _('下行带宽')), E('div', { 'class': 'qm-mini-val' }, mhz(info.dlBandwidth) || '--') ]),
				E('div', { 'class': 'qm-mini-item' }, [ E('div', { 'class': 'qm-mini-label' }, _('上行带宽')), E('div', { 'class': 'qm-mini-val' }, mhz(info.ulBandwidth) || '--') ]),
				speedItem
			].filter(Boolean)),
			E('a', { 'class': 'qm-ip-link', 'href': L.url('admin/modem/qmodem-generic/network') }, [ _('射频与小区详情'), ' →' ])
		]);
	},

	addressCard: function(session) {
		var active = session.connected || session.ipv4Connected || session.ipv6Connected;
		return E('section', { 'class': 'qm-glass-card qm-address-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'),
						_('移动 IP')
					]),
					E('div', { 'class': 'qm-card-sub' }, joinValues(session.device, session.proto) || _('已分配地址'))
				]),
				E('span', { 'class': 'qm-badge' + (active ? ' excellent' : ' weak') }, active ? _('已激活') : _('已断开'))
			]),
			E('div', { 'class': 'qm-ip-box' }, [
				E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [ E('span', {}, 'IPv4'), E('span', { 'style': 'color:' + (session.ipv4Connected ? '#10b981' : '#94a3b8') }, session.ipv4Connected ? _('已连接') : _('未分配')) ]),
					E('div', { 'class': 'qm-ip-val' }, session.ipv4Address || '--')
				]),
				E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [ E('span', {}, 'IPv6'), E('span', { 'style': 'color:' + (session.ipv6Connected ? '#10b981' : '#94a3b8') }, session.ipv6Connected ? _('已连接') : _('未分配')) ]),
					E('div', { 'class': 'qm-ip-val' }, session.ipv6Address || '--')
				]),
				E('div', { 'class': 'qm-ip-row' }, [
					E('div', { 'class': 'qm-ip-header' }, [ E('span', {}, 'DNS 服务器') ]),
					E('div', { 'class': 'qm-ip-val' }, joinValues(session.dns4, session.dns6) || '--')
				])
			]),
			E('div', { 'style': 'display:flex;justify-content:space-between;margin-top:10px;font-size:11px;color:#64748b' }, [
				E('span', {}, 'MTU: ' + (session.mtu || '--')),
				E('span', {}, session.up ? '接口已启用' : '接口已停用')
			]),
			E('a', { 'class': 'qm-ip-link', 'href': L.url('admin/modem/qmodem-generic/connection') }, [ _('连接详情'), ' →' ])
		]);
	},

	subscriptionRate: function(qosInfo) {
		qosInfo = qosInfo || {};
		// 后端统一以 kbps 上报；未知/空用 '--'，绝不把「没有」显示成「0」
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

	/* QCI 与 5QI 分开发布：LTE 用 QCI、5G 用 5QI，二者独立，不互相覆盖。
	 * 两侧都能给出时（边界情况）分别列出。未知一律返回 label='' ，由卡片显示 '--'。 */
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
			1:  { desc: _('GBR · 实时语音 (VoLTE)') },
			2:  { desc: _('GBR · 实时视频通话') },
			3:  { desc: _('GBR · 实时游戏 / 低延迟交互') },
			4:  { desc: _('GBR · 缓冲流视频') },
			5:  { desc: _('Non-GBR · IMS 信令') },
			6:  { desc: _('Non-GBR · TCP 优先（网页/邮件/文件）') },
			7:  { desc: _('Non-GBR · 交互业务（VoIP/在线游戏）') },
			8:  { desc: _('Non-GBR · 通用数据（默认上网）') },
			9:  { desc: _('Non-GBR · 后台数据（最低优先级）') },
			65: { desc: _('GBR · 关键任务语音') },
			66: { desc: _('GBR · 关键任务 PTT') },
			69: { desc: _('Non-GBR · 关键任务信令') },
			70: { desc: _('GBR · 关键任务数据') }
		};
		var qi5Map = {
			1:  { desc: _('GBR · 会话语音') },
			2:  { desc: _('GBR · 会话视频（实时）') },
			3:  { desc: _('GBR · 实时游戏 / 交互') },
			4:  { desc: _('GBR · 缓冲流媒体') },
			5:  { desc: _('Non-GBR · IMS 信令') },
			6:  { desc: _('Non-GBR · 交互（TCP 网页/邮件）') },
			7:  { desc: _('Non-GBR · 交互（VoIP/在线游戏）') },
			8:  { desc: _('Non-GBR · 默认数据') },
			9:  { desc: _('Non-GBR · 后台数据（最低优先级）') },
			65: { desc: _('GBR · 关键任务语音') },
			66: { desc: _('GBR · 关键任务 PTT') },
			67: { desc: _('GBR · 关键任务视频') },
			69: { desc: _('Non-GBR · 关键任务信令') },
			70: { desc: _('GBR · 关键任务数据') }
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
		var valNode = (value && typeof value === 'object' && (value instanceof HTMLElement || value.nodeType === 1))
			? value : E('strong', {}, (value == null || value === '') ? '--' : String(value));
		return E('div', { 'class': 'qm-list-row' }, [ E('span', {}, label), valNode ]);
	},

	moduleCard: function(data) {
		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>'),
						_('模组')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('硬件与固件信息'))
				]),
				E('span', { 'class': 'qm-badge active' }, data.model || _('模组'))
			]),
			E('div', {}, [
				this.infoRow(_('厂商'), data.manufacturer),
				this.infoRow(_('型号'), data.model),
				this.infoRow(_('固件'), data.revision),
				this.infoRow('IMEI', data.imei),
				this.infoRow(_('AT 端口'), data.at_port)
			])
		]);
	},

	simCard: function(data) {
		var simState = data.sim || '';
		var simOk = /READY|正常|OK/i.test(simState);
		var subRate = this.subscriptionRate(data.qosInfo);
		var qosLvl = this.qosExplain(data.qosInfo);
		return E('section', { 'class': 'qm-glass-card' }, [
			E('div', { 'class': 'qm-card-head' }, [
				E('div', {}, [
					E('div', { 'class': 'qm-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="8" y="10" width="8" height="8" rx="1"/></svg>'),
						_('SIM 与订阅')
					]),
					E('div', { 'class': 'qm-card-sub' }, _('订阅身份与运营商 QoS'))
				]),
				E('span', { 'class': 'qm-badge' + (simOk ? ' excellent' : ' weak') }, simOk ? _('就绪') : (simState || _('未知')))
			]),
			E('div', {}, [
				this.infoRow(_('运营商'), data.operator),
				this.infoRow(_('接入技术'), data.sysmode_detail),
				this.infoRow(_('接入点'), data.active_apn),
				this.infoRow(_('签约速率'), subRate || '--'),
				E('div', { 'class': 'qm-list-row' }, [
					E('span', {}, _('QoS 等级')),
					qosLvl.label ? E('div', {}, [
						E('strong', { 'style': 'color:#0072f5' }, qosLvl.label),
						E('span', { 'style': 'font-weight:400;margin-left:6px;font-size:10px' }, qosLvl.desc)
					]) : E('strong', {}, '--')
				]),
				this.infoRow('ICCID', data.iccid),
				this.infoRow('IMSI', data.imsi)
			])
		]);
	},

	/* 动态 SVG 历史双轨能量条形图 */
	renderSvgTrafficChart: function(days, swapped) {
		var list = Array.isArray(days) ? days.slice(-10) : [];
		if (!list.length) {
			return E('div', { 'style': 'text-align:center;padding:35px 0;color:#94a3b8;font-size:11px' }, _('暂无历史数据。'));
		}
		var max = 1;
		list.forEach(function(d) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			max = Math.max(max, rx, tx);
		});

		var svgW = 440, svgH = 100;
		var gap = svgW / list.length;
		var barW = Math.max(6, gap * 0.32);

		var barsSvg = list.map(function(d, i) {
			var rx = swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0);
			var tx = swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0);
			var rxH = Math.max(3, (rx / max) * 65);
			var txH = Math.max(3, (tx / max) * 65);
			var x = i * gap + (gap - barW * 2 - 3) / 2;
			var dateLabel = String(d.date || '').slice(5);

			return [
				'<rect x="' + x + '" y="' + (80 - rxH) + '" width="' + barW + '" height="' + rxH + '" rx="3" fill="#0072f5"/>',
				'<rect x="' + (x + barW + 3) + '" y="' + (80 - txH) + '" width="' + barW + '" height="' + txH + '" rx="3" fill="#10b981"/>',
				'<text x="' + (x + barW) + '" y="94" font-size="8" fill="#94a3b8" text-anchor="middle">' + dateLabel + '</text>'
			].join('');
		}).join('');

		var fullChart = [
			'<svg class="qm-traffic-chart-svg" viewBox="0 0 ' + svgW + ' ' + svgH + '">',
			'  <line x1="0" y1="80" x2="' + svgW + '" y2="80" stroke="rgba(226,232,240,0.8)" stroke-width="1"/>',
			barsSvg,
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
					svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'),
					_('流量统计')
				]),
				E('div', { 'class': 'qm-card-sub' }, _('接口计数器 %s').format(interfaceName || '--'))
			]),
			E('div', { 'style': 'text-align:right' }, [
				E('div', { 'style': 'font-size:10px;color:#94a3b8' }, _('已更新') + ' · ' + usageUpdated(usage.updated_at)),
				E('div', { 'style': 'display:flex;gap:10px;font-size:10px;color:#64748b;margin-top:4px' }, [
					E('span', {}, '● 下行 (DL) #0072f5'),
					E('span', {}, '● 上行 (UL) #10b981')
				])
			])
		]);

		if (!isTrafficAvailable(usage)) {
			return E('section', { 'class': 'qm-glass-card', 'style': 'margin-bottom:16px' }, [
				head,
				E('div', { 'style': 'color:#94a3b8;font-size:12px;padding:14px 0' }, _('该模组未通过 QModem 上报流量统计。'))
			]);
		}

		var todayDl = swapped ? (Number(daily.today_tx) || 0) : (Number(daily.today_rx) || 0);
		var todayUl = swapped ? (Number(daily.today_rx) || 0) : (Number(daily.today_tx) || 0);

		return E('section', { 'class': 'qm-glass-card', 'style': 'margin-bottom:16px' }, [
			head,
			E('div', { 'class': 'qm-traffic-layout' }, [
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '今日下载 (DL)'),
					E('div', { 'class': 'qm-stat-val', 'style': 'color:#0072f5' }, controls.formatBytes(todayDl)),
					E('div', { 'class': 'qm-stat-sub' }, '今日流量')
				]),
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '今日上传 (UL)'),
					E('div', { 'class': 'qm-stat-val', 'style': 'color:#10b981' }, controls.formatBytes(todayUl)),
					E('div', { 'class': 'qm-stat-sub' }, '今日流量')
				]),
				E('div', { 'class': 'qm-stat-card' }, [
					E('div', { 'class': 'qm-stat-label' }, '累计总量'),
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
			controls.action(_('立即清零流量统计'), function() {
				controls.confirmModal(_('立即清零流量统计'),
					_('此操作会立即清零该模组的流量计数，并同步清零本机分天流量记录。是否继续？'),
					function() {
						return Promise.resolve(controls.clearStats(section)).catch(function() { return null; })
							.then(function() { return controls.statsReset(section); });
					});
			})
		];
		return controls.card(_('流量自动清零'), _('设置定时自动清零流量统计，或手动立即清零。'), body, true);
	},

	shortcut: function(title, description, path) {
		return E('a', { 'class': 'qm-glass-card qm-shortcut-item', 'href': L.url(path) }, [
			E('div', {}, [
				E('strong', {}, title),
				E('span', {}, description)
			]),
			E('i', {}, '→')
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

		if (!res.section) {
			return E('div', { 'class': 'qmodem-glass-page' }, [
				this.styleNode(), controls.styleNode(),
				E('div', { 'class': 'qm-glass-card', 'style': 'color:#b91c1c;background:rgba(254,242,242,0.85)' },
					_('No modem detected (make sure QModem has recognised the device).')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class': 'qm-glass-card', 'style': 'margin-top:10px;color:#b91c1c' }, msg);
				})
			]);
		}

		var data = this.parseStatus(res);
		var connected = data.connected === '1', reachable = data.reachable === '1';
		var session = this.parseSession(res, connected);
		var carrierInfo = this.carrierInfo(res);

		if (/^(n\/a|none|null|--)$/i.test(data.operator_name || ''))
			data.operator_name = '';
		var opInfo = controls.operatorInfo(data.operator_name || null, data.mcc, data.mnc);
		var operator = opInfo.name;
		data.operator = (operator && operator !== _('Mobile Network')) ? operator : '';

		return E('div', { 'class': 'qmodem-glass-page' }, [
			this.styleNode(), controls.styleNode(),
			/* 背景环境光晕 */
			E('div', { 'class': 'qmodem-glass-bg-glow' }),
			E('div', { 'class': 'qmodem-glass-bg-glow2' }),

			(res.errors || []).map(function(msg) {
				return E('div', { 'class': 'qm-glass-card', 'style': 'margin-bottom:12px;color:#b91c1c' }, msg);
			}),

			this.modems && this.modems.length > 1 ? controls.renderModemBar(this.modems, res.section, function(id) {
				controls.setStoredSection(id);
				window.location.reload();
			}) : null,

			/* 顶部 Hero 玻璃卡片 */
			E('section', { 'class': 'qm-glass-card qm-hero' }, [
				E('div', {}, [
					E('h2', { 'class': 'qm-hero-title' }, data.model || _('移动模组')),
					E('div', { 'class': 'qm-hero-sub' }, !reachable
						? _('模组未响应，请检查模组连接。')
						: connected ? _('移动网络已连接并正常运行。')
						: _('模组在线，但移动数据会话已断开。')),
					E('div', { 'class': 'qm-hero-meta' }, [
						E('span', { 'class': 'qm-hero-op' }, [
							opInfo.logo ? E('img', { 'src': opInfo.logo, 'alt': operator }) : null,
							operator || '--'
						]),
						E('span', { 'class': 'qm-pill-tag' }, [ _('模式:'), E('strong', {}, data.sysmode_detail || '--') ]),
						E('span', { 'class': 'qm-pill-tag' }, [ _('接口:'), E('strong', {}, data.network_interface || '--') ])
					])
				]),
				E('div', { 'class': 'qm-hero-actions' }, [
					E('div', { 'class': 'qm-status-badge' + (connected ? ' online' : '') }, [
						E('span', { 'class': 'qm-pulse-circle' }),
						connected ? _('已连接') : reachable ? _('在线') : _('不可用')
					]),
					E('button', { 'class': 'qm-refresh-btn', 'click': function() { window.location.reload(); } }, _('刷新'))
				])
			]),

			/* 核心聚焦 3 栏网格 (信号 / 载波 / 会话IP) */
			E('div', { 'class': 'qm-grid-3' }, [
				this.signalCard(data),
				this.carrierCard(carrierInfo, res.devStatus),
				this.addressCard(session)
			]),

			/* 模组与 SIM 硬件卡片 */
			E('div', { 'class': 'qm-grid-2' }, [
				this.moduleCard(data),
				this.simCard(data)
			]),

			/* 流量监控面板与 SVG 图表 */
			this.trafficPanel(res.usage, data.network_interface, res.daily),

			/* 流量清零计划 */
			isTrafficAvailable(res.usage) ? this.trafficScheduleCard(res.trafficResetSchedule, res.section) : null,

			/* 快捷跳转 */
			E('div', { 'class': 'qm-shortcuts' }, [
				this.shortcut(_('移动数据'), _('APN、拨号、IP 详情与会话计数'), 'admin/modem/qmodem-generic/connection'),
				this.shortcut(_('射频与小区'), _('频段、小区、射频策略与诊断'), 'admin/modem/qmodem-generic/network'),
				this.shortcut(_('模组与 SIM'), _('模组身份、SIM 信息与维护'), 'admin/modem/qmodem-generic/system')
			]),

			/* 原始底层完整信息 */
			E('div', { 'class': 'qm-glass-card' }, [
				E('h3', { 'style': 'margin:0 0 6px;font-size:15px;font-weight:750;color:#0f172a' }, _('完整模组信息')),
				E('p', { 'style': 'margin:0 0 16px;color:#64748b;font-size:11px' }, _('该模组由 QModem 上报的全部字段，按类别分组展示。')),
				E('div', { 'class': 'mt-info-grid-all' }, controls.renderInfoGrouped(res.allInfo))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
