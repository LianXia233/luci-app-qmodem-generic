'use strict';
'require view';
'require uci';
'require qmodem-generic.controls as controls';

/*
 * 通用模组概览页 — 显示的数据全部来自 QModem 的 `qmodem` ubus 对象，
 * 经 resources/qmodem-generic/controls.js 数据层读取；旧的文本后端已完全移除。
 * 本页对 QModem 管理的任意模组生效：顶部模组选择器可切换，下方按实际返回渲染。
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

// 带宽值归一化：QModem 可能返回 "100" 或 "100 MHz"
function mhz(value) {
	if (value == null || String(value).trim() === '')
		return '';
	var text = String(value).trim();
	return /[a-zA-Z]/.test(text) ? text : text + ' MHz';
}

// 流量统计可用性判定：rpcd 文档返回布尔 true，重构契约与本地兜底返回 0/1，
// 个别环境还会回传字符串 '1'/'true'。四种情况统一视为"已提供流量统计"。
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
		return _('Waiting for data');
	var num = Number(value);
	if (!isNaN(num) && num > 1000000000) {
		var date = new Date(num * 1000);
		return '%04d-%02d-%02d %02d:%02d'.format(date.getFullYear(), date.getMonth() + 1,
			date.getDate(), date.getHours(), date.getMinutes());
	}
	return String(value);
}

return view.extend({
	load: function() {
		var self = this, errors = [];

		function guard(promise, label, fallback) {
			return Promise.resolve(promise).catch(function(err) {
				errors.push(label + ': ' + ((err && err.message) || String(err)));
				return fallback;
			});
		}

		return controls.getModemSections().then(function(sections) {
			self.modems = sections;
			return controls.resolveSection();
		}).catch(function(err) {
			errors.push(_('QModem configuration') + ': ' + ((err && err.message) || String(err)));
			return null;
		}).then(function(section) {
			self.section = section;
			if (!section)
				return { section: null, errors: errors };

			// resolveSection 内部已 uci.load('qmodem')
			// 接口状态由 controls.getInterfaceStatus(section) 自动解析：按
			// /etc/config/network 的 modem_config 关联找到 QModem 为本模组
			// 生成的 IPv4/IPv6 逻辑接口（与模组型号无关，适配所有模组）
			var apn = uci.get('qmodem', section, 'apn') || '';

			return Promise.all([
				guard(controls.getBaseInfo(section), _('Module'), []),
				guard(controls.getCellInfo(section), _('Radio and Cells'), []),
				guard(controls.getSimInfo(section), _('SIM & Subscription'), []),
				guard(controls.getConnectStatus(section), _('Connection'), []),
				guard(controls.getDns(section), 'DNS', {}),
				guard(controls.getUsageStats(section), _('Traffic Statistics'), { available: 0 }),
				guard(controls.getCurrentBand(section), _('Carrier status'), {}),
				guard(controls.getInterfaceStatus(section), _('Mobile IP'), {}),
				guard(controls.getNetworkInfo(section), _('Network'), []),
				guard(controls.getQosInfo(section), 'QOS', {}),
				guard(controls.getTrafficResetSchedule(section), _('Traffic reset schedule'), {}),
				guard(controls.getRadioInfo(section), _('Modulation'), {}),
				guard(controls.getDailyStats(section), _('Daily traffic'), null)
			]).then(function(r) {
				// 从合并后的接口视图中取物理设备名，查询设备速率
				var iface = r[7] || {};
				var ifname = iface.interface || '';
				var devName = iface.l3_device || iface.device || '';
				var devPromise = devName
					? guard(controls.getDeviceStatus(devName), _('Device rate'), {})
					: Promise.resolve({});
				return devPromise.then(function(devStatus) {
					// 合并 QModem 返回的全部 modem_info，用于"完整信息"面板（返回什么就显示什么）
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
		});
	},

	// 把 QModem 的 modem_info 数组摊平成视图使用的扁平对象
	parseStatus: function(res) {
		var self = this;
		var find = controls.findEntry;
		var base = res.base || [], cell = res.cell || [], sim = res.sim || [],
		    conn = res.conn || [], net = res.net || [];

		/* QoS Level 与签约速率：优先使用 QModem 各信息源上报的数据
		 * （network_info 等 vendor 脚本导出的 'AMBR UL'/'AMBR DL'，单位 Mbps；
		 * 'QCI'/'5QI' 键在全部 modem_info 数组中查找），缺失时回退 AT 探测
		 * 插件（rpcd qos qos_info：CGEQOSRDP / C5GQOSRDP / CGCONTRDP）的结果 */
		var atQos = res.qosInfo || {};
		function mbpsToKbps(v) {
			var n = parseFloat(v);
			return isNaN(n) || n <= 0 ? 0 : Math.round(n * 1000);
		}
		var qmUl = mbpsToKbps(find(net, 'AMBR UL'));
		var qmDl = mbpsToKbps(find(net, 'AMBR DL'));
		var qmQciRaw = find(net, 'QCI') || find(net, '5QI') ||
			find(base, 'QCI') || find(base, '5QI') ||
			find(cell, 'QCI') || find(cell, '5QI') ||
			find(sim, 'QCI') || find(sim, '5QI');
		var qmQci = parseInt(qmQciRaw, 10) || 0;
		var qosInfo = {
			qci: qmQci || Number(atQos.qci) || 0,
			uplink_rate_kbps: qmUl || Number(atQos.uplink_rate_kbps) || 0,
			downlink_rate_kbps: qmDl || Number(atQos.downlink_rate_kbps) || 0,
			apn: atQos.apn || '',
			status: (qmUl || qmDl || qmQci || atQos.status === 'ok') ? 'ok' : String(atQos.status || 'no_data')
		};

		var data = {};

		data.model = find(base, 'name') || find(base, 'model') || _('Modem');
		data.manufacturer = find(base, 'manufacturer') || '';
		data.revision = find(base, 'revision') || '';
		data.at_port = find(base, 'at_port') || '';
		data.temperature = String(find(base, 'temperature') || '').replace(/[^0-9.\-]/g, '');

		data.rsrp = find(cell, 'RSRP') || '';
		data.rsrq = find(cell, 'RSRQ') || '';
		data.sinr = find(cell, 'SINR') || '';
		/* 接入技术：不同模组上报字段名不一（network_mode / Network Type /
		 * Radio Access Technology），逐个尝试，全模组通用 */
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
		/* 电话号码：多数 SIM 不存储 MSISDN，仅当模组/网络上报时显示，否则 -- */
		data.phone_number = this.cleanText(
			find(sim, 'SIM Number') || find(sim, 'MSISDN') || find(sim, 'Phone Number') ||
			find(net, 'SIM Number') || find(net, 'MSISDN') || '');

		/* 运营商原始名称（清洗换行/控制字符后交由 operatorInfo 映射中文运营商） */
		data.operator_name = this.cleanText(
			find(sim, 'ISP') ||
			find(sim, 'operator') || find(sim, 'Operator') ||
			find(net, 'ISP') || find(net, 'operator') ||
			find(cell, 'ISP') || '');

		/* APN：配置值 → QoS 上报（AT+CGCONTRDP）→ 网络信息上报 */
		data.active_apn = this.cleanText(
			res.apn || qosInfo.apn ||
			find(net, 'APN') || find(sim, 'APN') || '');
		data.network_interface = res.ifname || '';
		data.qosInfo = qosInfo;
		data.reachable = base.length || cell.length ? '1' : '0';
		/* 连接判定：多来源综合（接口有全局 IP > 模组自报 connect_status >
		 * QModem 拨号状态）。ECM 等内置拨号模组 get_connect_status 恒为 No，
		 * 但接口已获取地址、实际有网，必须判为已连接 */
		data.connected = controls.evalConnectionStatus({
			conn: conn, base: base, iface: (res.iface || {})
		}).connected ? '1' : '0';
		return data;
	},

	// 清洗模组上报文本中的换行/控制字符与首尾空白（如 ISP 常见 "\nCHINA MOBILE"）
	cleanText: function(raw) {
		if (raw == null) return '';
		return String(raw).replace(/[\x00-\x1f\x7f]+/g, '').trim();
	},

	// 清洗 QModem get_dns 返回值：部分模组驱动会在 DNS IP 后追加换行+二进制垃圾，
	// 仅取第一个控制字符前的有效 IP 段（split 按控制字符切分，取首个非空 token）。
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

	// 由 network.interface status + get_dns + connect_status 组装地址卡片数据
	parseSession: function(res, connected) {
		var self = this;
		var iface = res.iface || {}, dns = (res.dns && res.dns.dns) || {};
		var v4 = firstAddress(iface['ipv4-address']);
		var v6 = firstAddress(iface['ipv6-address']);
		if (!v6 && Array.isArray(iface['ipv6-prefix']) && iface['ipv6-prefix'][0])
			v6 = iface['ipv6-prefix'][0].address ? iface['ipv6-prefix'][0].address + '/' + iface['ipv6-prefix'][0].mask : '';
		// 若 network.interface status 没取到 IP（如设备刚上线、DHCP 未完成），
		// 尝试从 network.device status 读取链路层状态作为辅助信息
		var devIPs = {};
		if (!v4 && !v6 && res.devStatus) {
			var ds = res.devStatus;
			// 部分 dongle 设备会在 devStatus 中携带 IP 信息
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
			'.qmodem-generic-page{max-width:1120px;margin:0 auto;color:var(--text-color-high,#20242a)}',
			'.qmodem-generic-hero{position:relative;overflow:hidden;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;margin-bottom:14px;border-radius:16px;background:linear-gradient(135deg,#1264d8 0%,#087eae 58%,#07988e 100%);color:#fff;box-shadow:0 10px 28px rgba(14,92,155,.16)}',
			'.qmodem-generic-hero:after{content:"";position:absolute;width:210px;height:210px;right:-78px;top:-118px;border:42px solid rgba(255,255,255,.08);border-radius:50%}.qmodem-generic-hero-copy,.qmodem-generic-hero-side{position:relative;z-index:1}',
			'.qmodem-generic-title{margin:0 0 6px;color:#fff;font-size:27px;line-height:1.2}.qmodem-generic-summary{font-size:13px;line-height:1.5;color:rgba(255,255,255,.84)}',
			'.qmodem-generic-hero-meta{display:flex;flex-wrap:wrap;gap:7px 18px;margin-top:13px;font-size:11px;color:rgba(255,255,255,.72)}.qmodem-generic-hero-meta strong{margin-left:5px;color:#fff;font-weight:700}.qmodem-generic-hero-op{display:inline-flex;align-items:center;gap:6px;margin-left:0}.qmodem-generic-hero-op img{width:26px;height:26px;border-radius:4px;object-fit:contain;flex:none;background:transparent}.qmodem-generic-hero-op strong{margin-left:0;font-size:14px;font-weight:750;letter-spacing:.02em}',
			'.qmodem-generic-hero-side{display:flex;flex-direction:row;align-items:center;gap:10px;flex-wrap:nowrap}.qmodem-generic-status{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,.16);font-size:12px;font-weight:700;white-space:nowrap}.qmodem-generic-dot{width:8px;height:8px;border-radius:50%;background:#ffcd57;box-shadow:0 0 0 4px rgba(255,205,87,.18)}.qmodem-generic-status.online .qmodem-generic-dot{background:#78f2b0;box-shadow:0 0 0 4px rgba(120,242,176,.18)}',
			'.qmodem-generic-focus-grid{display:grid;grid-template-columns:1.12fr .88fr 1.18fr;gap:12px;margin-bottom:12px}.qmodem-generic-focus{display:flex;flex-direction:column;padding:17px 18px}.qmodem-generic-focus-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:13px}.qmodem-generic-focus-title{font-size:14px;font-weight:750}.qmodem-generic-focus-desc{margin-top:3px;color:var(--mt-ui-muted);font-size:10px;line-height:1.4}',
			'.qmodem-generic-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;background:#eef2f6;color:#6b7480;font-size:10px;font-weight:750;white-space:nowrap}.qmodem-generic-badge:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.qmodem-generic-badge.good,.qmodem-generic-badge.active{background:#e8f8f1;color:#087c60}.qmodem-generic-badge.fair{background:#fff5df;color:#9b6500}.qmodem-generic-badge.weak{background:#fff0ee;color:#b84035}',
			'.qmodem-generic-signal-value{display:flex;align-items:baseline;gap:6px}.qmodem-generic-signal-value strong{font-size:31px;letter-spacing:-.04em}.qmodem-generic-signal-value span{font-size:11px;color:var(--mt-ui-muted)}.qmodem-generic-signal-bars{display:flex;align-items:flex-end;gap:3px;height:52px;margin:5px 0 13px}.qmodem-generic-signal-bar{flex:1;min-width:2px;border-radius:2px 2px 1px 1px;background:var(--mt-ui-border);opacity:.55}.qmodem-generic-signal-bar.on{background:#4b94df;opacity:1}.qmodem-generic-signal-bars.excellent .on{background:#13a979}.qmodem-generic-signal-bars.fair .on{background:#e4a23a}.qmodem-generic-signal-bars.weak .on{background:#db5b52}',
			'.qmodem-generic-signal-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:auto}.qmodem-generic-mini{padding:8px 9px;border-radius:9px;background:var(--background-color-low,#f5f7f9)}.qmodem-generic-mini-top{display:flex;align-items:baseline;justify-content:space-between;gap:4px;margin-bottom:6px}.qmodem-generic-mini span{color:var(--mt-ui-muted);font-size:9px}.qmodem-generic-mini strong{font-size:12px;font-variant-numeric:tabular-nums}',
			'.qmodem-generic-gauge-track{position:relative;height:6px;border-radius:999px;background:var(--mt-ui-border,#e3e8ee);overflow:hidden}.qmodem-generic-gauge-track i{display:block;height:100%;min-width:3px;border-radius:inherit;background:#4b94df;transition:width .35s ease}.qmodem-generic-gauge-track i.excellent{background:linear-gradient(90deg,#0fb783,#13a979)}.qmodem-generic-gauge-track i.good{background:linear-gradient(90deg,#4bb985,#3fa66f)}.qmodem-generic-gauge-track i.fair{background:linear-gradient(90deg,#f0b44f,#e4a23a)}.qmodem-generic-gauge-track i.weak{background:linear-gradient(90deg,#e8756c,#db5b52)}.qmodem-generic-gauge-track i.unknown{background:var(--mt-ui-border,#cfd6de)}.qmodem-generic-mini-scale{display:flex;justify-content:space-between;margin-top:3px;color:var(--mt-ui-muted);font-size:8px;opacity:.75}',
			'.qmodem-generic-carrier-main{margin:2px 0 12px}.qmodem-generic-carrier-main strong{display:block;font-size:29px;line-height:1.15;letter-spacing:-.03em}.qmodem-generic-carrier-main span{display:block;margin-top:4px;color:var(--mt-ui-muted);font-size:11px}.qmodem-generic-band-list{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}.qmodem-generic-band{padding:5px 8px;border-radius:8px;background:#edf5ff;color:#176bc1;font-size:10px;font-weight:700}.qmodem-generic-carrier-stats{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:auto}.qmodem-generic-cc-list{display:flex;flex-direction:column;gap:7px;margin-bottom:12px}.qmodem-generic-cc-row{display:flex;flex-direction:column;gap:5px;padding:9px 11px;border-radius:10px;background:var(--background-color-low,#f5f7f9);border:1px solid var(--mt-ui-border,#e8ecf0)}.qmodem-generic-cc-role{display:flex;align-items:center;gap:8px}.qmodem-generic-cc-badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;font-size:9px;font-weight:750;white-space:nowrap}.qmodem-generic-cc-badge.primary{background:#e8f1ff;color:#176bc1}.qmodem-generic-cc-badge.secondary{background:#eef2f6;color:#6b7480}.qmodem-generic-cc-band{font-size:12px;font-weight:700;color:var(--text-color-high,#20242a)}.qmodem-generic-cc-detail{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:10px;color:var(--mt-ui-muted)}.qmodem-generic-cc-detail span{font-variant-numeric:tabular-nums}',
			'.qmodem-generic-ip-list{display:grid;gap:9px}.qmodem-generic-ip-row{padding:10px 11px;border-radius:10px;background:var(--background-color-low,#f5f7f9)}.qmodem-generic-ip-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px;font-size:10px;color:var(--mt-ui-muted)}.qmodem-generic-ip-state{font-weight:700;color:#9a6200}.qmodem-generic-ip-state.on{color:#087c60}.qmodem-generic-ip-value{font:600 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}.qmodem-generic-ip-meta{display:flex;justify-content:space-between;gap:10px;margin-top:9px;color:var(--mt-ui-muted);font-size:10px}',
			'.qmodem-generic-card-link{display:inline-flex;align-items:center;gap:5px;margin-top:auto;padding-top:12px;color:#176bc1;font-size:10px;font-weight:700;text-decoration:none}.qmodem-generic-card-link:after{content:"›";font-size:16px;line-height:10px}',
			'.qmodem-generic-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.qmodem-generic-info{display:flex;flex-direction:column;padding:17px 18px}.qmodem-generic-info-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:13px}.qmodem-generic-info-title{font-size:14px;font-weight:750}.qmodem-generic-info-desc{margin-top:3px;color:var(--mt-ui-muted);font-size:10px;line-height:1.4}.qmodem-generic-info-list{display:flex;flex-direction:column;flex:1;justify-content:center}.qmodem-generic-info-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid var(--mt-ui-border-soft,#edf0f4);font-size:12px}.qmodem-generic-info-row:last-child{border-bottom:0}.qmodem-generic-info-row span{color:var(--mt-ui-muted)}.qmodem-generic-info-row strong{text-align:right;word-break:break-all;font-weight:600;font-variant-numeric:tabular-nums}',
			'.qmodem-generic-traffic{padding:18px;margin-bottom:12px}.qmodem-generic-traffic-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px}.qmodem-generic-traffic-head h3{margin:0 0 4px;font-size:16px}.qmodem-generic-traffic-head p{margin:0;color:var(--mt-ui-muted);font-size:10px}.qmodem-generic-traffic-side{text-align:right}.qmodem-generic-updated{color:var(--mt-ui-muted);font-size:10px;white-space:nowrap}.qmodem-generic-legend{display:flex;justify-content:flex-end;gap:10px;margin-top:5px;color:var(--mt-ui-muted);font-size:9px}.qmodem-generic-legend span:before{content:"";display:inline-block;width:7px;height:3px;margin-right:4px;border-radius:9px;background:#337de8;vertical-align:middle}.qmodem-generic-legend span:last-child:before{background:#16a085}',
			'.qmodem-generic-traffic-layout{display:grid;grid-template-columns:repeat(3,minmax(0,.62fr)) minmax(300px,1.8fr);gap:10px}.qmodem-generic-traffic-stat{padding:13px;border-radius:11px;background:var(--background-color-low,#f5f7f9)}.qmodem-generic-traffic-label{font-size:10px;color:var(--mt-ui-muted);margin-bottom:6px}.qmodem-generic-traffic-value{font-size:18px;font-weight:750;letter-spacing:-.02em}.qmodem-generic-traffic-split{margin-top:5px;color:var(--mt-ui-muted);font-size:9px;line-height:1.45}',
			'.qmodem-generic-days{display:flex;flex-direction:column;justify-content:center;gap:6px;padding:2px 0 2px 8px}.qmodem-generic-day{display:grid;grid-template-columns:42px minmax(80px,1fr) 112px;align-items:center;gap:8px;font-size:9px}.qmodem-generic-date{color:var(--mt-ui-muted);font-weight:650}.qmodem-generic-bars{display:flex;flex-direction:column;gap:2px}.qmodem-generic-bar{height:4px;border-radius:999px;background:var(--background-color-low,#eef1f5);overflow:hidden}.qmodem-generic-bar i{display:block;height:100%;min-width:2px;border-radius:inherit;background:#337de8}.qmodem-generic-bar.tx i{background:#16a085}.qmodem-generic-values{text-align:right;font-variant-numeric:tabular-nums;color:var(--mt-ui-muted)}',
			'.qmodem-generic-shortcuts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.qmodem-generic-shortcut{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;color:inherit;text-decoration:none}.qmodem-generic-shortcut strong{display:block;font-size:12px}.qmodem-generic-shortcut span{display:block;margin-top:3px;color:var(--mt-ui-muted);font-size:9px;line-height:1.4}.qmodem-generic-shortcut b{color:#176bc1;font-size:20px}.qmodem-generic-alert{margin-bottom:12px}',
			'.qmodem-generic-refresh{border-color:rgba(255,255,255,.30)!important;background:rgba(255,255,255,.10)!important;color:#fff!important}',
			'@media(max-width:900px){.qmodem-generic-focus-grid{grid-template-columns:1fr 1fr}.qmodem-generic-address-card{grid-column:1/-1;min-height:auto}.qmodem-generic-traffic-layout{grid-template-columns:repeat(3,1fr)}.qmodem-generic-days{grid-column:1/-1;padding:8px 0 0}}',
			'@media(max-width:650px){.qmodem-generic-hero{display:block}.qmodem-generic-hero-side{flex-direction:row;flex-wrap:wrap;align-items:flex-start;margin-top:14px;gap:8px}.qmodem-generic-focus-grid,.qmodem-generic-shortcuts,.qmodem-generic-info-grid{grid-template-columns:1fr}.qmodem-generic-address-card{grid-column:auto}.qmodem-generic-focus{min-height:auto}.qmodem-generic-traffic-layout{grid-template-columns:1fr}.qmodem-generic-days{grid-column:auto}.qmodem-generic-day{grid-template-columns:38px 1fr}.qmodem-generic-values{grid-column:2;text-align:left}.qmodem-generic-traffic-head{display:block}.qmodem-generic-updated{margin-top:7px}}'
		].join(''));
	},

	signalQuality: function(kind, value) {
		var percentage, levels, index;
		if (isNaN(value))
			return { label:_('No data'), cls:'unknown', percentage:0 };
		if (kind === 'rsrp') { percentage = (value + 120) * 2.5; levels = [ -80, -90, -100 ]; }
		else if (kind === 'rsrq') { percentage = (value + 25) * 4; levels = [ -10, -15, -20 ]; }
		else { percentage = (value + 10) * 2.5; levels = [ 20, 13, 0 ]; }
		index = value >= levels[0] ? 0 : value >= levels[1] ? 1 : value >= levels[2] ? 2 : 3;
		return {
			label:[ _('Excellent'), _('Good'), _('Fair'), _('Weak') ][index],
			cls:[ 'excellent', 'good', 'fair', 'weak' ][index],
			percentage:Math.max(0, Math.min(100, percentage))
		};
	},

	// 载波信息：主载波取自 cell_info，成分载波（CA）取自 get_current_band 的 cells
	carrierInfo: function(res) {
		var find = controls.findEntry;
		var cell = res.cell || [];
		var raw = (res.currentBand && res.currentBand.current_band) || {};
		var mode = raw.network_mode || find(cell, 'network_mode') || '';
		var cells = Array.isArray(raw.cells) ? raw.cells : [];

		/* 上下行调制：来自 rpcd radio_info（Fibocom AT+GTCAINFO? 的 PCC 行 /
		 * Quectel AT+QNWCFG="nr5g_csi"），RAT 缺失时按网络模式推断，
		 * 组合为 "NR · MCS 20 · 64QAM" 形式的展示文案 */
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

		// 无 current_band 数据时，用 cell_info 组一条主载波
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

	// Small colour-coded horizontal gauge for a single scalar metric.
	// kind: 'rsrq' | 'sinr' | 'temp' — decides the good/fair/weak thresholds.
	metricGauge: function(label, kind, rawValue, unit, scaleLow, scaleHigh) {
		var num = parseFloat(rawValue), has = !isNaN(num), pct = 0, cls = 'unknown';
		if (has) {
			if (kind === 'rsrq') { pct = (num + 25) * 4; cls = num >= -10 ? 'excellent' : num >= -15 ? 'good' : num >= -20 ? 'fair' : 'weak'; }
			else if (kind === 'sinr') { pct = (num + 10) * 2.5; cls = num >= 20 ? 'excellent' : num >= 13 ? 'good' : num >= 0 ? 'fair' : 'weak'; }
			else { pct = (num - 20) / 60 * 100; cls = num < 45 ? 'excellent' : num < 55 ? 'good' : num < 65 ? 'fair' : 'weak'; }
			pct = Math.max(4, Math.min(100, pct));
		}
		return E('div', { 'class':'qmodem-generic-mini' }, [
			E('div', { 'class':'qmodem-generic-mini-top' }, [ E('span', {}, label), E('strong', {}, has ? (String(rawValue) + (unit || '')) : '--') ]),
			E('div', { 'class':'qmodem-generic-gauge-track' }, [ E('i', { 'class':cls, 'style':'width:' + (has ? pct : 0) + '%' }) ]),
			E('div', { 'class':'qmodem-generic-mini-scale' }, [ E('span', {}, scaleLow || ''), E('span', {}, scaleHigh || '') ])
		]);
	},

	signalCard: function(data) {
		var rsrp = parseFloat(data.rsrp);
		var quality = this.signalQuality('rsrp', rsrp), active = isNaN(rsrp) ? 0 : Math.max(1, Math.round(quality.percentage / 100 * 14));
		var bars = [], i;
		for (i = 0; i < 14; i++)
			bars.push(E('span', { 'class':'qmodem-generic-signal-bar' + (i < active ? ' on' : ''), 'style':'height:%dpx'.format(8 + i * 3) }));
		return E('section', { 'class':'qmodem-generic-focus mt-ui-card' }, [
			E('div', { 'class':'qmodem-generic-focus-head' }, [
				E('div', {}, [ E('div', { 'class':'qmodem-generic-focus-title' }, _('Signal')), E('div', { 'class':'qmodem-generic-focus-desc' }, _('Current radio quality at a glance')) ]),
				E('span', { 'class':'qmodem-generic-badge ' + quality.cls }, quality.label)
			]),
			E('div', { 'class':'qmodem-generic-signal-value' }, [ E('strong', {}, isNaN(rsrp) ? '--' : String(data.rsrp)), E('span', {}, 'RSRP · dBm') ]),
			E('div', { 'class':'qmodem-generic-signal-bars ' + quality.cls, 'aria-hidden':'true' }, bars),
			E('div', { 'class':'qmodem-generic-signal-meta' }, [
				this.metricGauge('RSRQ', 'rsrq', data.rsrq, ' dB', '-25', '-3'),
				this.metricGauge('SINR', 'sinr', data.sinr, ' dB', '-10', '30'),
				this.metricGauge(_('Temperature'), 'temp', data.temperature, '°C', '20', '80')
			])
		]);
	},

	carrierCard: function(info, devStatus) {
		var active = info.active || info.dual;
		var badge = !info.available ? _('Unavailable') : info.active ? _('Aggregating') : info.dual ? _('Dual connectivity') : _('Single carrier');
		var headline = !info.available ? '--' : info.active ? info.count + 'CA' : info.dual ? (info.mode || 'EN-DC') : (info.carriers[0] ? info.carriers[0].band : _('Single carrier'));
		// Expand every component carrier when more than one is active so the
		// serving cell (PCell + SCells) is fully listed (not just a summary).
		var ccList = null;
		if (info.carriers.length > 1) {
			ccList = E('div', { 'class':'qmodem-generic-cc-list' }, info.carriers.map(function(item, idx) {
				var role = /^(pcc|pcell|primary)$/i.test(item.role) ? _('PCell')
					: (item.role && !/^(scc|scell|secondary)$/i.test(item.role)) ? item.role
					: (idx === 0 ? _('PCell') : _('SCell %d').format(idx));
				return E('div', { 'class':'qmodem-generic-cc-row' }, [
					E('div', { 'class':'qmodem-generic-cc-role' }, [
						E('span', { 'class':'qmodem-generic-cc-badge ' + (idx === 0 ? 'primary' : 'secondary') }, role),
						E('span', { 'class':'qmodem-generic-cc-band' }, joinValues(item.radio, item.band).replace(', ', ' · ') || '--')
					]),
					E('div', { 'class':'qmodem-generic-cc-detail' }, [
						item.arfcn ? E('span', {}, (item.channelType || 'ARFCN') + ' ' + item.arfcn) : null,
						item.pci ? E('span', {}, 'PCI ' + item.pci) : null,
						E('span', {}, _('DL') + ' ' + (mhz(item.dlBandwidth) || '--')),
						E('span', {}, _('UL') + ' ' + (mhz(item.ulBandwidth) || '--')),
						item.scs ? E('span', {}, 'SCS ' + item.scs) : null
					].filter(Boolean))
				]);
			}));
		}
		return E('section', { 'class':'qmodem-generic-focus mt-ui-card' }, [
			E('div', { 'class':'qmodem-generic-focus-head' }, [
				E('div', {}, [ E('div', { 'class':'qmodem-generic-focus-title' }, _('Carrier status')), E('div', { 'class':'qmodem-generic-focus-desc' }, _('Carrier aggregation and bandwidth')) ]),
				E('span', { 'class':'qmodem-generic-badge' + (active ? ' active' : '') }, badge)
			]),
			E('div', { 'class':'qmodem-generic-carrier-main' }, [ E('strong', {}, headline || '--'), E('span', {}, info.mode || _('Mobile network')) ]),
			E('div', { 'class':'qmodem-generic-band-list' }, info.carriers.length ? info.carriers.map(function(item) {
				return E('span', { 'class':'qmodem-generic-band' }, joinValues(item.radio, item.band).replace(', ', ' · ') || '--');
			}) : E('span', { 'class':'qmodem-generic-focus-desc' }, _('Current carrier information is unavailable.'))),
			ccList,
			E('div', { 'class':'qmodem-generic-carrier-stats' }, [
				E('div', { 'class':'qmodem-generic-mini' }, [ E('span', {}, _('Downlink bandwidth')), E('strong', {}, mhz(info.dlBandwidth) || '--') ]),
				E('div', { 'class':'qmodem-generic-mini' }, [ E('span', {}, _('Uplink bandwidth')), E('strong', {}, mhz(info.ulBandwidth) || '--') ]),
				E('div', { 'class':'qmodem-generic-mini' }, [ E('span', {}, _('Downlink modulation')), E('strong', {}, info.dlModulation || '--') ]),
				E('div', { 'class':'qmodem-generic-mini' }, [ E('span', {}, _('Uplink modulation')), E('strong', {}, info.ulModulation || '--') ])
			]),
			(function() {
				var items = [];
				// 签约速率（USB 链路速率参考）
				if (devStatus && devStatus.speed) {
					var speedStr = String(devStatus.speed);
					var m = speedStr.match(/^(\d+)/);
					var linkSpeed = m ? parseInt(m[1], 10) : 0;
					var linkLabel = linkSpeed >= 1000
						? (linkSpeed / 1000).toFixed(linkSpeed % 1000 === 0 ? 0 : 1) + ' Gbps'
						: linkSpeed + ' Mbps';
					items.push(E('div', { 'class':'qmodem-generic-mini', 'style':'grid-column:1/-1' }, [
						E('span', {}, _('USB 链路速率')),
						E('strong', {}, linkLabel)
					]));
				}
				return items.length ? E('div', { 'class':'qmodem-generic-carrier-stats', 'style':'margin-top:7px' }, items) : null;
			})(),
			E('a', { 'class':'qmodem-generic-card-link', 'href':L.url('admin/modem/qmodem-generic/network') }, _('View radio and cell details'))
		]);
	},

	subscriptionRate: function(qosInfo) {
		qosInfo = qosInfo || {};
		if (qosInfo.status !== 'ok')
			return '';

		var down = Number(qosInfo.downlink_rate_kbps != null ? qosInfo.downlink_rate_kbps : (qosInfo.downlink_rate != null ? qosInfo.downlink_rate : qosInfo.rx_data_rate_max));
		var up = Number(qosInfo.uplink_rate_kbps != null ? qosInfo.uplink_rate_kbps : (qosInfo.uplink_rate != null ? qosInfo.uplink_rate : qosInfo.tx_data_rate_max));
		if (!down && !up)
			return '';

		return _('Down %s / Up %s').format(
			down ? controls.formatRate(down * 1000) : '--',
			up ? controls.formatRate(up * 1000) : '--'
		);
	},

	// QCI (QoS Class Identifier) — 3GPP 定义的承载 QoS 等级，决定网络资源优先级
	// GBR = 保证比特率（语音 / 视频等实时业务），Non-GBR = 非保证比特率（互联网数据）
	qciExplain: function(qosInfo) {
		var qci = qosInfo ? parseInt(qosInfo.qci, 10) : 0;
		if (!qosInfo || qosInfo.status !== 'ok' || !qci)
			return { label: '', desc: '' };
		var map = {
			1:  { label: 'QCI 1', desc: _('GBR · 实时语音 (VoLTE)') },
			2:  { label: 'QCI 2', desc: _('GBR · 实时视频通话') },
			3:  { label: 'QCI 3', desc: _('GBR · 实时游戏 / 低延迟交互') },
			4:  { label: 'QCI 4', desc: _('GBR · 缓冲流视频') },
			5:  { label: 'QCI 5', desc: _('Non-GBR · IMS 信令 (语音/视频控制)') },
			6:  { label: 'QCI 6', desc: _('Non-GBR · TCP 优先 (网页/邮件/文件传输)') },
			7:  { label: 'QCI 7', desc: _('Non-GBR · 交互业务 (VoIP / 在线游戏)') },
			8:  { label: 'QCI 8', desc: _('Non-GBR · 通用数据 (默认上网)') },
			9:  { label: 'QCI 9', desc: _('Non-GBR · 后台数据 (最低优先级)') },
			65: { label: 'QCI 65', desc: _('GBR · 关键任务语音') },
			66: { label: 'QCI 66', desc: _('GBR · 关键任务 PTT') },
			69: { label: 'QCI 69', desc: _('Non-GBR · 关键任务信令') },
			70: { label: 'QCI 70', desc: _('GBR · 关键任务数据') },
			79: { label: 'QCI 79', desc: _('GBR · 车联网 V2X 消息') },
			80: { label: 'QCI 80', desc: _('Non-GBR · 车联网 V2X 数据') }
		};
		var info = map[qci];
		return info ? info : { label: 'QCI ' + qci, desc: _('自定义承载') };
	},

	addressCard: function(session) {
		var active = session.connected || session.ipv4Connected || session.ipv6Connected;
		return E('section', { 'class':'qmodem-generic-focus qmodem-generic-address-card mt-ui-card' }, [
			E('div', { 'class':'qmodem-generic-focus-head' }, [
				E('div', {}, [ E('div', { 'class':'qmodem-generic-focus-title' }, _('Mobile IP')), E('div', { 'class':'qmodem-generic-focus-desc' }, _('Addresses assigned by the mobile network')) ]),
				E('span', { 'class':'qmodem-generic-badge' + (active ? ' active' : '') }, active ? _('Active') : _('Disconnected'))
			]),
			E('div', { 'class':'qmodem-generic-ip-list' }, function() {
					var rows = [
						E('div', { 'class':'qmodem-generic-ip-row' }, [ E('div', { 'class':'qmodem-generic-ip-head' }, [ E('span', {}, 'IPv4'), E('span', { 'class':'qmodem-generic-ip-state' + (session.ipv4Connected ? ' on' : '') }, session.ipv4Connected ? _('Connected') : _('Not assigned')) ]), E('div', { 'class':'qmodem-generic-ip-value' }, session.ipv4Address || '--') ]),
						E('div', { 'class':'qmodem-generic-ip-row' }, [ E('div', { 'class':'qmodem-generic-ip-head' }, [ E('span', {}, 'IPv6'), E('span', { 'class':'qmodem-generic-ip-state' + (session.ipv6Connected ? ' on' : '') }, session.ipv6Connected ? _('Connected') : _('Not assigned')) ]), E('div', { 'class':'qmodem-generic-ip-value' }, session.ipv6Address || '--') ])
					];
					if (session.dns4) rows.push(E('div', { 'class':'qmodem-generic-ip-row' }, [ E('div', { 'class':'qmodem-generic-ip-head' }, [ E('span', {}, 'DNS (IPv4)') ]), E('div', { 'class':'qmodem-generic-ip-value' }, session.dns4) ]));
					if (session.dns6) rows.push(E('div', { 'class':'qmodem-generic-ip-row' }, [ E('div', { 'class':'qmodem-generic-ip-head' }, [ E('span', {}, 'DNS (IPv6)') ]), E('div', { 'class':'qmodem-generic-ip-value' }, session.dns6) ]));
					if (!session.dns4 && !session.dns6) rows.push(E('div', { 'class':'qmodem-generic-ip-row' }, [ E('div', { 'class':'qmodem-generic-ip-head' }, [ E('span', {}, 'DNS') ]), E('div', { 'class':'qmodem-generic-ip-value' }, '--') ]));
					return rows;
				}()),
			E('div', { 'class':'qmodem-generic-ip-meta' }, [ E('span', {}, joinValues(session.device, session.proto) || '--'), E('span', {}, 'MTU ' + (session.mtu || '--')) ]),
			E('a', { 'class':'qmodem-generic-card-link', 'href':L.url('admin/modem/qmodem-generic/connection') }, _('View connection details'))
		]);
	},

	// Robust node detector: some LuCI runtimes (older L.dom) build nodes that
	// are NOT `instanceof HTMLElement` but still have nodeType === 1.  Using
	// only `instanceof HTMLElement` mis-classifies those nodes as scalars and
	// toString()s them into "[object HTMLElement]".  nodeType===1 is the
	// reliable cross-runtime test.
	isNode: function(v) {
		return v && typeof v === 'object' && (v instanceof HTMLElement || v.nodeType === 1);
	},

	infoRow: function(label, value) {
		var valueNode = this.isNode(value) ? value : E('strong', {}, (value == null || value === '') ? '--' : String(value));
		return E('div', { 'class':'qmodem-generic-info-row' }, [ E('span', {}, label), valueNode ]);
	},

	moduleCard: function(data) {
		return E('section', { 'class':'qmodem-generic-info mt-ui-card' }, [
			E('div', { 'class':'qmodem-generic-info-head' }, [
				E('div', {}, [ E('div', { 'class':'qmodem-generic-info-title' }, _('Module')), E('div', { 'class':'qmodem-generic-info-desc' }, _('Identity and firmware')) ]),
				E('span', { 'class':'qmodem-generic-badge active' }, data.model || _('Modem'))
			]),
			E('div', { 'class':'qmodem-generic-info-list' }, [
				this.infoRow(_('Manufacturer'), data.manufacturer),
				this.infoRow(_('Model'), data.model),
				this.infoRow(_('Firmware'), data.revision),
				this.infoRow('IMEI', data.imei),
				this.infoRow(_('AT port'), data.at_port)
			])
		]);
	},

	simCard: function(data) {
		var simState = data.sim || '';
		var simOk = /READY|正常|OK/i.test(simState);
		var subRate = this.subscriptionRate(data.qosInfo);
		var qciInfo = this.qciExplain(data.qosInfo);
		return E('section', { 'class':'qmodem-generic-info mt-ui-card' }, [
			E('div', { 'class':'qmodem-generic-info-head' }, [
				E('div', {}, [ E('div', { 'class':'qmodem-generic-info-title' }, _('SIM & Subscription')), E('div', { 'class':'qmodem-generic-info-desc' }, _('Subscriber identity and service plan')) ]),
				E('span', { 'class':'qmodem-generic-badge' + (simOk ? ' active' : '') }, simOk ? _('Ready') : (simState || _('Unknown')))
			]),
			E('div', { 'class':'qmodem-generic-info-list' }, [
				this.infoRow(_('Operator'), data.operator),
				this.infoRow(_('Access technology'), data.sysmode_detail),
				this.infoRow(_('APN'), data.active_apn),
				this.infoRow(_('Subscription rate'), subRate || '--'),
				/* QoS Level 常显：模组上报 QCI/5QI 时展示映射等级，未知时显示 -- */
				E('div', { 'class':'qmodem-generic-info-row' }, [
					E('span', {}, _('QoS Level')),
					qciInfo.label ? E('div', {}, [
						E('strong', {}, qciInfo.label),
						E('span', { 'style':'font-weight:400;margin-left:6px' }, qciInfo.desc)
					]) : E('strong', {}, '--')
				]),
				this.infoRow('ICCID', data.iccid),
				this.infoRow('IMSI', data.imsi),
				this.infoRow(_('Phone number'), data.phone_number)
			])
		]);
	},

	// 流量面板：数据源为 QModem get_usage_stats（当前计数器）+ qmodem_stats
	// daily_stats（本机持久化的分天记录，重启不丢失，按中国时区 UTC+8 切日）。
	// huawei 等模组 available:0 时给出说明而不是图表。
	// 方向自动识别：个别驱动把 rx/tx 接反（tx 持续大于 rx），后端识别后以
	// swapped=1 标记，这里统一交换显示，保证「下载 > 上传」的常规直觉正确。
	trafficPanel: function(usage, interfaceName, daily) {
		usage = usage || {}; daily = daily || {};
		var swapped = Number(daily.swapped) === 1;
		var dl = swapped ? (Number(daily.total_tx) || 0) : (Number(daily.total_rx) || 0);
		var ul = swapped ? (Number(daily.total_rx) || 0) : (Number(daily.total_tx) || 0);

		var head = E('div', { 'class':'qmodem-generic-traffic-head' }, [
			E('div', {}, [
				E('h3', {}, _('Traffic Statistics')),
				E('p', {}, _('Usage counters reported by QModem for %s').format(interfaceName || '--'))
			]),
			E('div', { 'class':'qmodem-generic-traffic-side' }, [
				E('div', { 'class':'qmodem-generic-updated' }, _('Last updated') + ' · ' + usageUpdated(usage.updated_at)),
				E('div', { 'class':'qmodem-generic-legend' }, [ E('span', {}, _('Download')), E('span', {}, _('Upload')) ])
			])
		]);

		if (!isTrafficAvailable(usage)) {
			return E('section', { 'class':'qmodem-generic-traffic mt-ui-card' }, [
				head,
				E('div', { 'class':'qmodem-generic-focus-desc' }, _('This module reports no traffic statistics via QModem (some vendor drivers do not implement usage_stats).'))
			]);
		}

		function stat(label, value, split) {
			return E('div', { 'class':'qmodem-generic-traffic-stat' }, [
				E('div', { 'class':'qmodem-generic-traffic-label' }, label),
				E('div', { 'class':'qmodem-generic-traffic-value' }, controls.formatBytes(value)),
				E('div', { 'class':'qmodem-generic-traffic-split' }, split || '')
			]);
		}

		// 分天历史：最近 14 天，每天两行（下行蓝 / 上行绿），按全表最大值归一化
		var dayRows = Array.isArray(daily.days) ? daily.days.slice(-14) : [];
		var maxDay = 1;
		dayRows.forEach(function(d) {
			maxDay = Math.max(maxDay, Number(d.rx) || 0, Number(d.tx) || 0);
		});
		if (!dayRows.length)
			maxDay = Math.max(dl, ul, 1);
		function dayBar(date, rxDl, txUl, isToday) {
			return E('div', { 'class':'qmodem-generic-day' }, [
				E('span', { 'class':'qmodem-generic-date' }, date.substring(5)),
				E('div', { 'class':'qmodem-generic-bars' }, [
					E('div', { 'class':'qmodem-generic-bar' }, E('i', { 'style':'width:' + Math.max(rxDl ? 2 : 0, rxDl / maxDay * 100).toFixed(1) + '%' })),
					E('div', { 'class':'qmodem-generic-bar tx' }, E('i', { 'style':'width:' + Math.max(txUl ? 2 : 0, txUl / maxDay * 100).toFixed(1) + '%' }))
				]),
				E('span', { 'class':'qmodem-generic-values' }, controls.formatBytes(rxDl + txUl))
			]);
		}
		var todayRow = dayBar(_('Today'), Number(daily.today_rx) || 0, Number(daily.today_tx) || 0, true).cloneNode(true);
		var history = E('div', { 'class':'qmodem-generic-days' }, [ todayRow ].concat(
			dayRows.map(function(d) {
				return dayBar(String(d.date || ''), swapped ? (Number(d.tx) || 0) : (Number(d.rx) || 0),
					swapped ? (Number(d.rx) || 0) : (Number(d.tx) || 0), false);
			})
		));

		return E('section', { 'class':'qmodem-generic-traffic mt-ui-card' }, [
			head,
			E('div', { 'class':'qmodem-generic-traffic-layout' }, [
				stat(_('Today download'), swapped ? (Number(daily.today_tx) || 0) : (Number(daily.today_rx) || 0)),
				stat(_('Today upload'), swapped ? (Number(daily.today_rx) || 0) : (Number(daily.today_tx) || 0)),
				stat(_('All-time total'), dl + ul, _('Download %s · Upload %s').format(controls.formatBytes(dl), controls.formatBytes(ul))),
				history
			]),
			swapped ? E('p', { 'class':'qmodem-generic-focus-desc', 'style':'margin-top:10px' },
				_('Modem driver reports reversed counters; download/upload were swapped automatically.')) : null,
			isTrafficAvailable(usage) && !dayRows.length && !(Number(daily.today_rx) + Number(daily.today_tx)) ?
				E('p', { 'class':'qmodem-generic-focus-desc', 'style':'margin-top:10px' },
					_('Daily history is being recorded in the background; the first full-day record will appear tomorrow.')) : null
		]);
	},

	// 流量统计自动清零计划：数据源为 QModem get_traffic_reset_schedule /
	// set_traffic_reset_schedule，仅在模组支持流量统计时展示。同时提供"立即清零"动作
	// （clearStats，仅部分模组如 Quectel 可用）。
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
						// QModem clear_stats（模组侧）+ 本地持久化记录一并清零；
						// 部分模组不支持模组侧清零，本地记录仍会重置
						return Promise.resolve(controls.clearStats(section)).catch(function() { return null; })
							.then(function() { return controls.statsReset(section); });
					});
			})
		];
		return controls.card(_('流量自动清零'), _('设置定时自动清零流量统计，或手动立即清零。'), body, true);
	},

	shortcut: function(title, description, path) {
		return E('a', { 'class':'qmodem-generic-shortcut mt-ui-card', 'href':L.url(path) }, [ E('div', {}, [ E('strong', {}, title), E('span', {}, description) ]), E('b', {}, '›') ]);
	},

	render: function(res) {
		res = res || {};

		if (!res.section) {
			return E('div', { 'class':'qmodem-generic-page mt-ui-page' }, [
				this.styleNode(), controls.styleNode(),
				E('div', { 'class':'alert-message warning qmodem-generic-alert' }, _('No modem detected (make sure QModem has recognised the device).')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class':'alert-message warning qmodem-generic-alert' }, msg);
				})
			]);
		}

		var data = this.parseStatus(res);
		var connected = data.connected === '1', reachable = data.reachable === '1';
		var session = this.parseSession(res, connected);
		var carrierInfo = this.carrierInfo(res);
		/* 运营商：优先小区 MCC/MNC 映射，回退模组上报的运营商名称（ISP 等），
		 * 两者皆无时 SIM 卡片显示 --，顶部横幅显示通用占位 */
		if (/^(n\/a|none|null|--)$/i.test(data.operator_name || ''))
			data.operator_name = '';
		var opInfo = controls.operatorInfo(data.operator_name || null, data.mcc, data.mnc);
		var operator = opInfo.name;
		data.operator = (operator && operator !== _('Mobile Network')) ? operator : '';

		return E('div', { 'class':'qmodem-generic-page mt-ui-page' }, [
			this.styleNode(), controls.styleNode(),
			(res.errors || []).map(function(msg) {
				return E('div', { 'class':'alert-message warning qmodem-generic-alert' }, msg);
			}),
			this.modems && this.modems.length > 1 ? controls.renderModemBar(this.modems, res.section, function(id) {
				controls.setStoredSection(id);
				window.location.reload();
			}) : null,
			E('section', { 'class':'qmodem-generic-hero' }, [
				E('div', { 'class':'qmodem-generic-hero-copy' }, [
					E('h2', { 'class':'qmodem-generic-title' }, [ data.model || _('Mobile Module') ]),
					E('div', { 'class':'qmodem-generic-summary' }, !reachable
						? _('The modem did not respond. Check the module connection.')
						: connected ? _('Mobile network is connected and ready.')
						: _('The module is online, but mobile data is not connected.')),
					E('div', { 'class':'qmodem-generic-hero-meta' }, [
						E('span', { 'class':'qmodem-generic-hero-op' }, [
							opInfo.logo ? E('img', { 'src': opInfo.logo, 'alt': operator }) : null,
							E('strong', {}, operator || '--')
						]),
						E('span', {}, [ _('Network Mode'), E('strong', {}, data.sysmode_detail || '--') ]),
						E('span', {}, [ _('Network interface'), E('strong', {}, data.network_interface || '--') ])
					])
				]),
				E('div', { 'class':'qmodem-generic-hero-side' }, [
					E('div', { 'class':'qmodem-generic-status' + (connected ? ' online' : '') }, [
						E('span', { 'class':'qmodem-generic-dot' }),
						connected ? _('Connected') : reachable ? _('Module online') : _('Unavailable')
					]),
					E('button', { 'class':'btn qmodem-generic-refresh', 'click':function() { window.location.reload(); } }, _('Refresh'))
				])
			]),
			E('div', { 'class':'qmodem-generic-focus-grid' }, [ this.signalCard(data), this.carrierCard(carrierInfo, res.devStatus), this.addressCard(session) ]),
			E('div', { 'class':'qmodem-generic-info-grid' }, [ this.moduleCard(data), this.simCard(data) ]),
			this.trafficPanel(res.usage, data.network_interface, res.daily),
		isTrafficAvailable(res.usage) ? this.trafficScheduleCard(res.trafficResetSchedule, res.section) : null,
			E('div', { 'class':'qmodem-generic-shortcuts' }, [
				this.shortcut(_('Mobile data'), _('APN, dialing, IP details and session counters'), 'admin/modem/qmodem-generic/connection'),
				this.shortcut(_('Radio and Cells'), _('Bands, cells, radio policy and diagnostics'), 'admin/modem/qmodem-generic/network'),
				this.shortcut(_('Module and SIM'), _('Module identity, SIM information and maintenance'), 'admin/modem/qmodem-generic/system')
			]),
			E('div', { 'class':'qmodem-generic-info-all' }, [
				E('h3', {}, _('Full module information')),
				E('p', {}, _('All fields reported by QModem for this module, grouped by category.')),
				E('div', { 'class':'mt-info-grid-all' }, controls.renderInfoGrouped(res.allInfo))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
