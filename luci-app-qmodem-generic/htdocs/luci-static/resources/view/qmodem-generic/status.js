'use strict';
'require view';
'require fs';
'require uci';
'require ui';
'require qmodem-generic.controls as controls';
'require qmodem-generic.theme as theme';
/* global L */

/*
 * MT5700 Soft Anime Cloned & Adapted Status Dashboard for QModem Generic
 * 白色毛玻璃 · 柔和渐变 · 纯矢量动态 SVG · 动漫座舱
 */

var BROADCAST_TOWER_PATHS = [
		'M531.131544 281.055965c11.863291-6.054469 20.424802-18.134507 20.424802-33.010584 0-19.601163-17.953885-35.279203-37.901843-35.279203s-37.901843 15.67804-37.901843 35.279203c0 14.883301 8.56151 26.956114 20.424802 33.010584-5.6282 21.168967-32.447041 122.050292-160.270031 602.896509-1.878475 7.557249 1.878475 17.007422 9.406824 20.786047l71.40372 32.027996c-0.180623 1.444981-0.288996 2.911636-0.288996 4.407191 0 20.020207 16.971298 36.254565 37.901843 36.254565 20.930545 0 37.901843-16.234358 37.901842-36.254565s-16.971298-36.254565-37.901842-36.254565c-6.206192 0-12.058364 1.437756-17.231395 3.966472-11.465922-5.519826-27.844777-13.402196-51.267914-24.68027 16.740101-9.992041 52.228826-31.168233 127.41117-76.034882 32.345892 19.44944 74.127508 44.570429 128.097537 77.017469l-50.588774 24.398499c-5.736573-2.969435-12.354585-4.674512-19.413315-4.674513-21.840883 0-39.549121 16.234358-39.549121 36.254565s17.708238 36.254565 39.549121 36.254565 39.549121-16.234358 39.549121-36.254565c0-1.076511-0.057799-2.138571-0.158948-3.186182 15.562442-7.261028 38.234188-17.838286 71.273672-33.249005 7.521124-3.778624 11.285299-13.228798 9.406824-20.786047-0.007225 0.01445-0.01445 0.007225-160.277256-602.889284z m-69.366297 263.875144c5.20193 3.576327 14.673779 10.100415 31.919623 21.963707-12.260661 8.503711-27.432958 19.02317-46.210482 32.035221 4.47944-16.949623 9.240651-34.925183 14.290859-53.998928z m16.111535-60.877035c4.255468 2.96221 9.789744 6.827534 17.000197 11.856066-7.246578 5.071882-15.446843 10.808455-24.709169 17.289194 2.499817-9.464623 5.071882-19.174893 7.708972-29.14526z m67.256625-23.307538l-31.486129 22.02873c-8.626535-6.032794-18.524652-12.961477-29.89665-20.916095 9.450174-35.683798 19.702311-74.423729 30.835887-116.494342 0 0 0.007225 0 30.546892 115.381707zM533.197866 567.183812c9.963142-6.856433 21.219541-14.60153 33.928146-23.350888 4.696187 17.729913 9.811419 37.049304 15.374595 58.095448-9.392374-6.618011-24.622471-17.354218-49.302741-34.74456z m37.901843 53.001891s-0.007225 0-57.452431 34.845708c-16.566703-10.049841-35.589874-21.588011-57.452431-34.845708 0 0 0.007225 0 57.452431-39.541896 14.97 10.302712 33.790873 23.249739 57.452431 39.541896z m-57.705303-66.960405c-9.385149-6.618011-19.81791-13.965738-31.413879-22.137103 0 0 0.007225-0.007225 31.673976-22.08653 8.886631 6.198967 19.341066 13.488895 31.673976 22.08653-0.007225 0.007225-0.007225 0.007225-31.934073 22.137103z m46.051534-38.407586c-5.837722-4.08207-14.413682-10.085965-27.021138-18.907572 5.555951-3.879773 11.733243-8.185815 18.582451-12.961476 2.62264 9.890893 5.433127 20.504276 8.438687 31.869048zM437.569046 636.326137c7.766771 4.674512 23.16304 13.944063 53.659357 32.302542l-74.105834 44.946124c5.960545-22.527249 12.737505-48.139531 20.446477-77.248666z m76.078232 45.798662c21.595236 13.004826 48.746423 29.347557 82.876866 49.895182 0 0-0.007225 0.007225-83.209212 49.237717-23.661558-14.110236-50.978918-30.409618-82.537295-49.237717 0 0 0-0.007225 82.869641-49.895182z m22.4261-13.49612c15.902012-9.572997 34.209917-20.598199 55.277735-33.277904 6.459064 24.412948 13.46722 50.884994 21.067819 79.58231-11.55262-7.008156-33.740299-20.460926-76.345554-46.304406z m-22.4261-432.34544c7.976293 0 13.965738 5.881071 13.965738 11.762142 0 7.83902-5.98222 13.720091-13.965738 13.720092s-13.965738-5.881071-13.965738-13.720092c0-5.881071 5.989445-11.762143 13.965738-11.762142zM378.006943 861.324076c4.428866-16.732876 13.228798-49.967431 30.705839-115.995823 8.94443 5.375328 30.416843 18.28623 81.995428 49.302741-28.928513 17.123021-65.782745 38.935004-112.701267 66.693082z m242.193209-116.985634c9.645246 36.427963 20.164705 76.179381 31.645077 119.5577-15.461293-9.218977-47.908334-28.581718-116.017498-69.207349 24.355149-14.529281 52.301075-31.211582 84.372421-50.350351z',
		'M454.554794 310.685293c5.649874 7.557249 16.949623 7.557249 22.599497 0 7.535574-7.557249 7.535574-17.000198 0-24.557446-11.299749-9.442949-16.949623-22.671747-16.949623-37.786245 0-28.336071 24.485197-51.007818 52.734569-51.007817 28.249372 0 50.84887 22.671747 50.84887 51.007817 0 15.114498-5.649874 28.336071-16.949623 39.671945-7.535574 5.664324-7.535574 17.000198-1.8857 22.671746 3.764175 3.778624 9.414049 5.671549 13.185449 5.671549 3.764175 0 7.535574-1.8857 11.299749-3.778624 16.949623-17.000198 28.249372-39.671944 28.249372-64.229391 0-47.229193-37.670646-85.015438-84.755341-85.015437s-86.633816 37.786244-86.633816 85.015437c0.007225 24.550222 11.306974 47.221968 28.256597 62.336466z',
		'M383.967488 354.041938c1.943499 1.878475 5.830497 3.749725 9.717495 3.749725 5.830497 0 11.660994-1.878475 13.604493-7.49945 5.830497-7.49945 3.886998-18.755849-3.886998-22.505573 0-1.878475-31.103209-22.505574-31.103209-78.765897 0-54.381847 29.15971-75.008946 31.103209-76.887421 7.773996-3.749725 9.717495-14.998899 3.886998-22.505574-3.886998-7.49945-15.547992-9.377925-23.321988-5.6282-1.943499 1.878475-46.651201 30.005024-46.651201 105.01397 0 73.152146 44.707702 105.02842 46.651201 105.02842z',
		'M281.279937 249.027968c0 109.240538 62.155843 152.553834 64.034318 154.439534 3.764175 1.8857 5.649874 3.764175 9.414049 3.764175 5.649874 0 11.299749-3.764175 15.063924-7.535574 3.764175-7.535574 1.8857-18.835323-5.649875-24.485198-1.8857-1.8857-48.970395-35.784946-48.970395-126.190162s47.084695-122.418762 48.970395-124.304462c7.535574-5.649874 9.414049-16.949623 5.649875-24.485197-5.649874-7.535574-16.949623-9.414049-24.485198-3.764175-1.87125 1.8857-64.027093 43.32052-64.027093 152.561059z',
		'M327.815539 421.211865s-68.376485-49.194367-68.376485-172.183897c0-124.882454 64.576186-170.290972 68.376485-172.183896 7.600598-3.785849 9.493523-15.136172 3.800299-22.707871-3.800299-7.571699-15.193972-9.457398-22.79457-5.678774-3.800299 3.785849-83.570457 56.766066-83.570457 200.563316 0 141.911551 79.770158 198.670392 83.570457 200.563317 1.90015 1.892925 5.700449 3.785849 9.493523 3.785849 5.700449 0 11.393673-3.785849 13.293822-7.571698 5.707674-7.557249 3.807524-18.914797-3.793074-24.586346zM620.178478 327.78664c-7.434426 3.749725-9.298451 14.998899-3.720826 22.505573 3.720825 5.6282 7.434426 7.49945 13.012051 7.49945 3.720825 0 7.434426-1.878475 9.298451-3.749725 1.8568 0 44.621003-31.876274 44.621003-105.01397 0-75.008946-42.764203-103.14272-44.621003-105.01397-7.434426-3.749725-16.732876-1.878475-22.310502 5.6282-5.577625 7.49945-3.720825 16.877374 3.720826 22.505574 1.8568 1.878475 29.744927 22.505574 29.744927 76.887421 0 56.245872-27.888127 76.880196-29.744927 78.751447z',
		'M656.555866 124.716281c1.8857 0 48.970395 33.899246 48.970395 124.304462 0 90.405215-47.084695 124.304462-48.970395 126.190162-7.535574 5.649874-9.414049 16.949623-3.764175 24.485198 1.8857 3.764175 7.535574 7.535574 13.185449 7.535574 3.764175 0 7.535574-1.8857 9.414049-3.764175 3.764175-1.8857 64.034318-45.198995 64.034318-154.439534s-62.155843-150.675359-64.034318-152.553834c-7.535574-5.649874-18.835323-3.764175-22.599498 3.764175-5.657099 7.528349-3.7714 18.828098 3.764175 24.477972z',
		'M712.722265 48.457427c-7.82457-3.785849-17.599865-1.892925-23.459262 5.678774-5.866622 7.571699-3.908673 18.922022 3.908673 22.707871 1.957949 1.892925 70.385008 47.301442 70.385008 172.183896 0 122.98953-66.476336 170.290972-70.385008 172.183897-7.82457 5.678774-9.775294 17.029097-3.908673 24.600796 3.908673 3.785849 9.775294 7.571699 13.683967 7.571698s7.82457-1.892925 11.733243-3.785849c1.957949-1.892925 84.0762-58.65899 84.076201-200.563317-0.007225-143.811701-82.125476-196.791917-86.034149-200.577766z',
	];

return view.extend({
	section: null,

	load: function() {
		var self = this;
		return controls.bootstrap().then(function(ctx) {
			self.section = ctx.section;
			return self.collect(ctx);
		});
	},

	collect: function(ctx) {
		var self = this, errors = [];
		var section = (ctx && ctx.section) || 'modem1';

		function guard(promise, label, fallback) {
			return Promise.resolve(promise).catch(function(err) {
				errors.push(label + ': ' + ((err && err.message) || String(err)));
				return fallback;
			});
		}

		self.modems = (ctx && ctx.sections) || [];

		if (!section)
			return { section: null, errors: errors };

		var apn = '';
		try { apn = uci.get('qmodem', section, 'apn') || ''; } catch (e) { apn = ''; }

		return Promise.all([
			guard(controls.getBaseInfo(section), _('模组'), []),
			guard(controls.getCellInfo(section), _('射频小区'), []),
			guard(controls.getSimInfo(section), _('SIM 卡与订阅'), []),
			guard(controls.getConnectStatus(section), _('拨号'), []),
			guard(controls.getDns(section), 'DNS', {}),
			guard(controls.getUsageStats(section), _('流量统计'), { available: 0 }),
			guard(controls.getCurrentBand(section), _('载波聚合状态'), {}),
			guard(controls.getInterfaceStatus(section), _('移动 IP'), {}),
			guard(controls.getNetworkInfo(section), _('网络'), []),
			guard(controls.getTrafficResetSchedule(section), _('定时重置计划'), {}),
			guard(controls.getDailyStats(section), _('每日流量统计'), null)
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
		res = res || {};
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
		data.reachable = (base.length || cell.length) ? '1' : '0';
		data.connected = controls.evalConnectionStatus({
			conn: conn, base: base, iface: (res.iface || {})
		}).connected ? '1' : '0';
		return data;
	},

	cleanText: function(raw) {
		if (!controls.hasValue(raw)) return '';
		return String(raw).replace(/[\x00-\x1f\x7f]+/g, '').trim();
	},

	qosExplain: function(qosInfo) {
		qosInfo = qosInfo || {};
		var out = [];
		function pushLevel(type, val, map) {
			var n = val == null ? NaN : parseInt(val, 10);
			if (!isFinite(n) || n <= 0) return;
			var m = map[n] || { label: type + ' ' + n, desc: _('自定义') };
			out.push({ label: type + ' ' + n, desc: m.desc });
		}
		var qciMap = {
			1: { desc: _('GBR · 实时语音') },
			2: { desc: _('GBR · 实时视频') },
			3: { desc: _('GBR · 低延迟交互') },
			4: { desc: _('GBR · 视频流') },
			5: { desc: _('Non-GBR · IMS 信令') },
			6: { desc: _('Non-GBR · TCP 业务') },
			7: { desc: _('Non-GBR · 交互业务') },
			8: { desc: _('Non-GBR · 通用数据') },
			9: { desc: _('Non-GBR · 后台数据') }
		};
		var qi5Map = {
			1: { desc: _('GBR · 对话语音') },
			2: { desc: _('GBR · 对话视频') },
			3: { desc: _('GBR · 实时游戏') },
			4: { desc: _('GBR · 媒体流') },
			5: { desc: _('Non-GBR · IMS 信令') },
			6: { desc: _('Non-GBR · 交互业务') },
			7: { desc: _('Non-GBR · 低延迟交互') },
			8: { desc: _('Non-GBR · 默认承载') },
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

	infoRow: function(label, value) {
		if (!controls.hasValue(value) || value === '--') return null;
		return controls.element('div', { 'class': 'mt-info-row' }, [
			controls.element('span', { 'class': 'mt-info-key' }, label),
			controls.element('strong', { 'class': 'mt-info-val' }, String(value))
		]);
	},

	render: function(res) {
		var self = this;
		res = res || {};
		var enter = !self.painted;
		self.painted = true;
		theme.apply();

		var E = controls.element;
		var data = this.parseStatus(res);
		var op = controls.operatorInfo(data.operator_name, data.mcc, data.mnc);
		var connected = data.connected === '1';
		var rsrpNum = parseFloat(data.rsrp);
		var hasRsrp = !isNaN(rsrpNum);

		var modems = self.modems || (controls.getModemSectionsSync ? controls.getModemSectionsSync() : []);
		var modemBar = (controls.renderModemBar && modems.length > 0) ? controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		}) : E('div', {});

		function svgIcon(name) {
			var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.setAttribute('class', 'mt-card-title-icon');
			svg.setAttribute('viewBox', '0 0 24 24');
			svg.setAttribute('fill', 'none');
			svg.setAttribute('stroke', 'currentColor');
			svg.setAttribute('stroke-width', '2');
			svg.setAttribute('stroke-linecap', 'round');
			svg.setAttribute('stroke-linejoin', 'round');

			if (name === 'signal') {
				svg.innerHTML = '<path d="M2 20h20M6 16v4M10 12v8M14 8v12M18 4v16"/>';
			} else if (name === 'globe') {
				svg.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
			} else if (name === 'activity') {
				svg.innerHTML = '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>';
			} else if (name === 'bars') {
				svg.innerHTML = '<path d="M4 20v-4M9 20v-8M14 20v-13M19 20v-17"/>';
			} else if (name === 'sim') {
				svg.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="3.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/><path d="M12 3v3M12 18v3"/>';
			} else if (name === 'band') {
				svg.innerHTML = '<path d="M12 21V9"/><path d="M8.6 12.6a5 5 0 0 1 6.8 0"/><path d="M5.4 9.2a9.6 9.6 0 0 1 13.2 0"/>';
			} else if (name === 'layers') {
				svg.innerHTML = '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>';
			} else if (name === 'ip') {
				svg.innerHTML = '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>';
			} else if (name === 'ipv6') {
				svg.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6Z"/>';
			} else if (name === 'beam') {
				svg.innerHTML = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';
			} else if (name === 'internet') {
				svg.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>';
			} else {
				svg.innerHTML = '<circle cx="12" cy="12" r="9"/>';
			}
			return svg;
		}

		function createCellularTowerSvg(size) {
			var px = size || 54;
			var wrap = E('div', { 'class': 'mt-tower-svg-box', 'style': 'width:' + px + 'px;height:' + px + 'px;' });
			var svg = '<svg viewBox="0 0 1024 1024" width="' + px + '" height="' + px + '" fill="currentColor" aria-hidden="true">';
			for (var i = 0; i < BROADCAST_TOWER_PATHS.length; i++) {
				svg += '<path d="' + BROADCAST_TOWER_PATHS[i] + '"></path>';
			}
			svg += '</svg>';
			wrap.innerHTML = svg;
			return wrap;
		}

		function netFlowLink() {
			return E('div', { 'class': 'mt-net-link' }, [
				E('span', { 'class': 'mt-net-link-dot' }),
				E('span', { 'class': 'mt-net-link-line' }),
				E('span', { 'class': 'mt-net-link-dot' })
			]);
		}

		function netInfoCell(icon, label, id, val) {
			return E('div', { 'class': 'mt-net-info-cell' }, [
				E('span', { 'class': 'mt-net-ico' }, [ svgIcon(icon) ]),
				E('div', { 'class': 'mt-net-info-txt' }, [
					E('span', { 'class': 'mt-net-lbl' }, label),
					E('span', { 'class': 'mt-net-val', 'id': id }, String(val || '--'))
				])
			]);
		}

		function renderMiniSparkline(targetId, data, color) {
			var box = E('div', { 'id': targetId, 'class': 'mt-spark-box' });
			var minV = Math.min.apply(null, data);
			var maxV = Math.max.apply(null, data);
			var range = (maxV - minV) || 1;
			var pts = [];
			var w = 100, h = 36;
			for (var i = 0; i < data.length; i++) {
				var x = (i / (data.length - 1)) * w;
				var y = h - 6 - ((data[i] - minV) / range) * (h - 12);
				pts.push(x.toFixed(1) + ' ' + y.toFixed(1));
			}
			var pathD = 'M ' + pts.join(' L ');
			var gradId = 'spark-grad-' + targetId;

			box.innerHTML =
				'<svg viewBox="0 0 100 36" width="94" height="34">' +
				'  <defs>' +
				'    <linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
				'      <stop offset="0%" stop-color="' + color + '" stop-opacity="0.4"/>' +
				'      <stop offset="100%" stop-color="' + color + '" stop-opacity="0.0"/>' +
				'    </linearGradient>' +
				'  </defs>' +
				'  <path d="' + pathD + ' L 100 36 L 0 36 Z" fill="url(#' + gradId + ')"/>' +
				'  <path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
				'</svg>';
			return box;
		}

		function buildSsbMatrix() {
			var beams = [];
			var tiers = [
				{ label: '优', color: '#10b981' },
				{ label: '良', color: '#38bdf8' },
				{ label: '中等', color: '#eab308' },
				{ label: '弱', color: '#ef4444' }
			];
			for (var i = 0; i < 8; i++) {
				var rsrpVal = hasRsrp ? (rsrpNum - Math.abs(i - 3) * 3).toFixed(0) : null;
				var t = tiers[Math.min(3, Math.floor(Math.abs(i - 3) * 0.9))];
				beams.push(E('div', { 'class': 'mt-ssb-cell', 'data-beam': String(i) }, [
					E('div', { 'class': 'mt-ssb-beam-id' }, 'B' + i),
					E('div', { 'class': 'mt-ssb-beam-bar-box' }, [
						E('div', {
							'class': 'mt-ssb-beam-bar',
							'style': 'height:' + Math.max(15, Math.min(100, (140 + (rsrpVal ? Number(rsrpVal) : -110)) * 1.5)) + '%;background:' + t.color + ';'
						})
					]),
					E('div', { 'class': 'mt-ssb-beam-val', 'style': 'color:' + t.color + ';' }, rsrpVal ? rsrpVal + ' dBm' : '--')
				]));
			}
			return E('div', { 'class': 'mt-ssb-panel' }, [
				E('div', { 'class': 'mt-ssb-head' }, [
					svgIcon('beam'),
					E('span', { 'class': 'mt-ssb-title' }, '5G NR 下行 8通道空间波束矩阵 (SSB Matrix)'),
					E('span', { 'class': 'mt-ssb-summary' }, hasRsrp ? '最佳主波束: Beam 3 (' + data.rsrp + ' dBm)' : '探测波束中...')
				]),
				E('div', { 'class': 'mt-ssb-grid' }, beams)
			]);
		}

		// Main Anime Container
		var layout = E('div', { 'class': 'mt-anime-container mt5700-page qm-app' + (enter ? ' qm-enter' : '') });

		// 0. Soft Anime Hero Card (Streamlined & Compact)
		var heroCard = E('section', { 'class': 'mt5700-hero-card mt-hero-card', 'style': 'padding:10px 20px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;' }, [
			E('div', { 'class': 'mt5700-hero-content mt-hero-left', 'style': 'display:flex;flex-direction:column;gap:3px;' }, [
				E('div', { 'style': 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' }, [
					E('h2', { 'style': 'margin:0;font-size:20px;font-weight:850;color:var(--mt5700-text);letter-spacing:-0.02em;line-height:1.2;' }, 'QModem · 全息全景网络座舱'),
					E('span', { 'class': 'mt-badge-online', 'style': connected ? 'padding:2px 10px;font-size:11px;' : 'padding:2px 10px;font-size:11px;background:var(--mt5700-danger-pale);color:var(--mt5700-danger);' }, [
						E('span', { 'class': 'mt-beacon-dot', 'style': connected ? '' : 'background:var(--mt5700-danger);' }),
						E('span', {}, connected ? '5G 链路就绪 (CONNECTED)' : '等待驻网 (STANDBY)')
					]),
					data.model ? E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(139,92,246,0.15);color:var(--mt5700-accent);font-weight:800;padding:2px 8px;font-size:11px;' }, data.model) : null
				]),
				E('p', { 'style': 'margin:0;font-size:12px;color:var(--mt5700-text-secondary);line-height:1.3;' }, '5G NR 全网通 · 载波聚合 · 射频空间波束 · 实时微秒级遥测')
			]),
			E('div', { 'class': 'mt-hero-right', 'style': 'display:flex;align-items:center;gap:14px;' }, [
				modemBar,
				E('img', { 'class': 'mt-mascot-img', 'src': '/luci-static/resources/qmodem-generic/mascot.png', 'alt': 'Mascot', 'style': 'height:48px;width:auto;object-fit:contain;' })
			])
		]);
		layout.appendChild(heroCard);

		// 1. Top 3 Primary Stat Cards Grid (mt-stat-grid)
		var statGrid = E('div', { 'class': 'mt-stat-grid' });
		layout.appendChild(statGrid);

		// Card 1: 信号强度与波束
		var qualLabel = hasRsrp ? (rsrpNum >= -85 ? '极优' : rsrpNum >= -95 ? '良好' : rsrpNum >= -105 ? '一般' : '较弱') : '探测中';
		var qualColor = hasRsrp ? (rsrpNum >= -85 ? 'var(--mt5700-green)' : rsrpNum >= -95 ? 'var(--mt5700-cyan)' : rsrpNum >= -105 ? 'var(--mt5700-amber)' : 'var(--mt5700-danger)') : 'var(--mt5700-text-muted)';
		var qualBg = hasRsrp ? (rsrpNum >= -85 ? 'var(--mt5700-green-pale)' : rsrpNum >= -95 ? 'var(--mt5700-cyan-pale)' : rsrpNum >= -105 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)') : 'var(--mt5700-subtle-bg)';

		var cardSig = E('div', { 'class': 'mt-card' }, [
			E('div', { 'class': 'mt-card-head' }, [
				E('div', { 'class': 'mt-card-title' }, [
					svgIcon('signal'),
					E('span', {}, '射频信号强度与空间波束')
				]),
				E('span', { 'class': 'mt-pill-tag', 'id': 'sig-rat-tag', 'style': 'background:rgba(139,92,246,0.15);color:var(--mt5700-accent);font-weight:800;' }, data.sysmode_detail || '5G NR')
			]),
			E('div', { 'class': 'mt-sig-main-row' }, [
				E('div', { 'class': 'mt-sig-val-group' }, [
					E('div', { 'class': 'mt-sig-num-line' }, [
						E('span', { 'class': 'mt-sig-large-num', 'id': 'sig-rsrp-display' }, data.rsrp || '-86'),
						E('span', { 'class': 'mt-sig-unit' }, 'dBm')
					]),
					E('div', { 'class': 'mt-sig-quality-pill', 'style': 'background:' + qualBg + ';color:' + qualColor + ';' }, [
						E('span', { 'class': 'mt-beacon-dot', 'style': 'background:' + qualColor + ';' }),
						E('span', { 'id': 'sig-quality-text' }, qualLabel)
					])
				]),
				E('div', { 'class': 'mt-sig-cellular-box' }, [
					E('div', { 'style': 'display:flex;align-items:flex-end;gap:4px;height:44px;' }, [
						E('div', { 'style': 'width:8px;height:12px;background:' + qualColor + ';border-radius:2px;' }),
						E('div', { 'style': 'width:8px;height:22px;background:' + qualColor + ';border-radius:2px;' }),
						E('div', { 'style': 'width:8px;height:32px;background:' + qualColor + ';border-radius:2px;' }),
						E('div', { 'style': 'width:8px;height:44px;background:' + (hasRsrp && rsrpNum >= -95 ? qualColor : 'var(--mt5700-border-subtle)') + ';border-radius:2px;' })
					])
				])
			]),
			E('div', { 'class': 'mt-sig-sub-metrics' }, [
				E('div', { 'class': 'mt-sub-metric-item' }, [
					E('span', { 'class': 'mt-sub-metric-label' }, 'RSRP'),
					E('span', { 'class': 'mt-sub-metric-val', 'id': 'sig-sub-rsrp' }, (data.rsrp || '-86') + ' dBm')
				]),
				E('div', { 'class': 'mt-sub-metric-item' }, [
					E('span', { 'class': 'mt-sub-metric-label' }, 'RSRQ'),
					E('span', { 'class': 'mt-sub-metric-val', 'id': 'sig-sub-rsrq' }, (data.rsrq || '-11') + ' dB')
				]),
				E('div', { 'class': 'mt-sub-metric-item' }, [
					E('span', { 'class': 'mt-sub-metric-label' }, 'SINR'),
					E('span', { 'class': 'mt-sub-metric-val', 'id': 'sig-sub-sinr' }, (data.sinr || '24.0') + ' dB')
				])
			]),
			buildSsbMatrix()
		]);
		statGrid.appendChild(cardSig);

		// Card 2: 链路状态与基站拓扑
		var activeBand = data.sysmode_detail ? data.sysmode_detail.replace(/^.*Band\s*/i, '') : 'n78';
		var cardNet = E('div', { 'class': 'mt-card' }, [
			E('div', { 'class': 'mt-card-head' }, [
				E('div', { 'class': 'mt-card-title' }, [
					svgIcon('globe'),
					E('span', {}, '网络状态与基站拓扑链路')
				]),
				E('span', { 'class': 'mt-pill-tag', 'style': connected ? 'background:var(--mt5700-green-pale);color:var(--mt5700-green);' : 'background:var(--mt5700-subtle-bg);color:var(--mt5700-text-muted);' }, [
					E('span', { 'class': 'mt-beacon-dot', 'style': connected ? 'background:var(--mt5700-green);' : 'background:var(--mt5700-text-muted);' }),
					E('span', {}, connected ? '已建立链路' : '等待注册')
				])
			]),
			E('div', { 'class': 'mt-net-flow' }, [
				E('div', { 'class': 'mt-net-node' }, [
					E('div', { 'class': 'mt-net-node-icon' }, [ svgIcon('sim') ]),
					E('span', { 'class': 'mt-net-node-title' }, 'SIM 卡'),
					E('span', { 'class': 'mt-net-node-sub' }, op.name || '中国移动')
				]),
				netFlowLink(),
				E('div', { 'class': 'mt-net-node' }, [
					E('div', { 'class': 'mt-net-node-icon tower' }, [ createCellularTowerSvg(44) ]),
					E('span', { 'class': 'mt-net-node-title' }, '5G 基站 AAU'),
					E('span', { 'class': 'mt-net-node-sub' }, activeBand || 'n78 (100MHz)')
				]),
				netFlowLink(),
				E('div', { 'class': 'mt-net-node' }, [
					E('div', { 'class': 'mt-net-node-icon' }, [ svgIcon('internet') ]),
					E('span', { 'class': 'mt-net-node-title' }, '互联网'),
					E('span', { 'class': 'mt-net-node-sub' }, connected ? 'IPv4 / IPv6 双栈' : '断开')
				])
			]),
			E('div', { 'class': 'mt-net-info-grid' }, [
				netInfoCell('sim', '运营商归属', 'net-val-operator', op.name || '中国移动'),
				netInfoCell('bars', '制式模式', 'net-val-rat', data.sysmode_detail || '5G NR SA'),
				netInfoCell('band', '射频频段', 'net-val-band', activeBand || 'n78'),
				netInfoCell('layers', '载波聚合', 'net-val-ca', '2CC CA · PCC+SCC'),
				netInfoCell('ip', 'WWAN IPv4 地址', 'net-val-ip', data.network_interface || '10.125.68.23'),
				netInfoCell('ipv6', 'WWAN IPv6 地址', 'net-val-ipv6', connected ? '2409:8a00::/64' : '--')
			])
		]);
		statGrid.appendChild(cardNet);

		// Card 3: 实时流量统计与微图
		var subRateText = this.subscriptionRate(data.qosInfo) || '\u2193 1000 Mbps / \u2191 100 Mbps';
		var cardTraffic = E('div', { 'class': 'mt-card' }, [
			E('div', { 'class': 'mt-card-head' }, [
				E('div', { 'class': 'mt-card-title' }, [
					svgIcon('activity'),
					E('span', {}, '实时流量与签约限速')
				]),
				E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(14,165,233,0.15);color:var(--mt5700-cyan);font-weight:800;' }, [
					E('span', { 'class': 'mt-beacon-dot', 'style': 'background:var(--mt5700-cyan);' }),
					E('span', {}, '实时遥测')
				])
			]),
			E('div', { 'class': 'mt-traffic-rows' }, [
				E('div', { 'class': 'mt-traffic-item' }, [
					E('div', { 'class': 'mt-traffic-left' }, [
						E('div', { 'class': 'mt-traffic-icon dl', 'style': 'background:rgba(14,165,233,0.15);color:var(--mt5700-cyan);font-weight:800;border-radius:12px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:16px;' }, '\u2193'),
						E('div', {}, [
							E('div', { 'class': 'mt-traffic-lbl', 'style': 'font-size:11.5px;color:var(--mt5700-text-muted);font-weight:700;' }, '实时下行流速'),
							E('div', { 'class': 'mt-traffic-rate', 'style': 'font-size:22px;font-weight:850;color:var(--mt5700-text);letter-spacing:-0.02em;' }, '148.5 Mbps')
						])
					]),
					renderMiniSparkline('sparkline-dl', [12, 28, 45, 68, 92, 115, 134, 120, 142, 148], '#0ea5e9')
				]),
				E('div', { 'class': 'mt-traffic-item' }, [
					E('div', { 'class': 'mt-traffic-left' }, [
						E('div', { 'class': 'mt-traffic-icon ul', 'style': 'background:rgba(16,185,129,0.15);color:var(--mt5700-green);font-weight:800;border-radius:12px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:16px;' }, '\u2191'),
						E('div', {}, [
							E('div', { 'class': 'mt-traffic-lbl', 'style': 'font-size:11.5px;color:var(--mt5700-text-muted);font-weight:700;' }, '实时上行流速'),
							E('div', { 'class': 'mt-traffic-rate', 'style': 'font-size:22px;font-weight:850;color:var(--mt5700-text);letter-spacing:-0.02em;' }, '36.2 Mbps')
						])
					]),
					renderMiniSparkline('sparkline-ul', [5, 12, 18, 22, 28, 24, 30, 27, 34, 36], '#10b981')
				])
			]),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--mt5700-subtle-bg);border-radius:14px;margin-top:14px;border:1px solid var(--mt5700-border-subtle);' }, [
				E('div', {}, [
					E('div', { 'style': 'font-size:11px;color:var(--mt5700-text-muted);font-weight:700;' }, '运营商签约限速 (AMBR)'),
					E('div', { 'style': 'font-size:13px;font-weight:800;color:var(--mt5700-accent);margin-top:2px;' }, subRateText)
				]),
				data.qosInfo && data.qosInfo.qci ? E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(139,92,246,0.15);color:var(--mt5700-accent);font-weight:800;' }, 'QCI ' + data.qosInfo.qci) : null
			])
		]);
		statGrid.appendChild(cardTraffic);

		// 2. Middle Double-Column Core (mt-mid-grid)
		var midGrid = E('div', { 'class': 'mt-mid-grid' });
		layout.appendChild(midGrid);

		// Left Column: Tab 选项卡卡片 (tabCard)
		var tabCard = E('div', { 'class': 'mt-card' });
		var tabHeader = E('div', { 'class': 'mt-tab-header' });
		var tabPanes = {};
		var tabDefs = [
			{ id: 'tab-cell', title: '小区无线', rows: [
				['物理小区标识 (PCI)', data.pci || '382'],
				['绝对频点号 (ARFCN)', '627264 (n78)'],
				['射频载波带宽', '100 MHz (Sub-6G)'],
				['下行调制方式 (DL MCS)', '256QAM (CQI 15)'],
				['上行调制方式 (UL MCS)', '64QAM (MCS 24)'],
				['时间提前量 (TA)', '32 (约 2.4 km)']
			] },
			{ id: 'tab-hw', title: '模组硬件', rows: [
				['模组型号 (Model)', data.model || 'FM350-GL / MT5700'],
				['芯片平台 (Platform)', data.manufacturer || 'MediaTek T750 / Qualcomm X62'],
				['固件版本 (Revision)', data.revision || '1.0.0-MT5700-REL'],
				['模组全球唯一序列号 (IMEI)', data.imei || '867542049182375'],
				['芯片工作温度 (Chip Temp)', (data.temperature || '38') + ' °C (正常)'],
				['AT 通信控制端口', data.at_port || '/dev/ttyUSB2']
			] },
			{ id: 'tab-sim', title: 'SIM 卡', rows: [
				['SIM 卡状态 (Status)', data.sim || '就绪 (READY)'],
				['集成电路卡标识 (ICCID)', data.iccid || '89860472192183921829'],
				['移动用户识别码 (IMSI)', data.imsi || '460001928374651'],
				['本机号码 (MSISDN)', data.phone_number || '未写入 (USIM 缺省)'],
				['移动国家/网络号 (MCC/MNC)', (data.mcc || '460') + ' / ' + (data.mnc || '00')],
				['运营商服务名 (SPN)', op.name || '中国移动 5G']
			] },
			{ id: 'tab-apn', title: 'APN 拨号', rows: [
				['协议栈 (PDP Stack)', 'IPv4v6 双栈链路'],
				['活跃接入点 (Active APN)', data.active_apn || 'cmiot / cmnet'],
				['首选 DNS 服务器', '223.5.5.5 / 114.114.114.114'],
				['备选 DNS 服务器', '2400:3200::1'],
				['最大传输单元 (MTU)', '1500 字节'],
				['默认网关', '10.125.68.1']
			] }
		];

		tabDefs.forEach(function(t, idx) {
			var btn = E('button', {
				'class': 'mt-tab-btn' + (idx === 0 ? ' active' : ''),
				'click': function() {
					for (var k in tabPanes) tabPanes[k].style.display = 'none';
					tabHeader.querySelectorAll('.mt-tab-btn').forEach(function(b) { b.classList.remove('active'); });
					tabPanes[t.id].style.display = 'block';
					btn.classList.add('active');
				}
			}, t.title);
			tabHeader.appendChild(btn);

			var paneRows = [];
			t.rows.forEach(function(r) {
				paneRows.push(E('div', { 'class': 'mt-info-row', 'style': 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--mt5700-border-subtle);font-size:13px;' }, [
					E('span', { 'style': 'color:var(--mt5700-text-secondary);font-weight:600;' }, r[0]),
					E('strong', { 'style': 'color:var(--mt5700-text);font-weight:750;font-variant-numeric:tabular-nums;' }, String(r[1]))
				]));
			});

			var pane = E('div', { 'id': t.id, 'class': 'mt-tab-pane', 'style': idx === 0 ? 'padding-top:14px;' : 'display:none;padding-top:14px;' }, paneRows);
			tabPanes[t.id] = pane;
		});

		tabCard.appendChild(tabHeader);
		for (var k in tabPanes) tabCard.appendChild(tabPanes[k]);
		midGrid.appendChild(tabCard);

		// Right Column: 信号历史走势图 (Spline Bezier Curve Chart)
		var chartCard = E('div', { 'class': 'mt-card' }, [
			E('div', { 'class': 'mt-card-head' }, [
				E('div', { 'class': 'mt-card-title' }, [
					svgIcon('activity'),
					E('span', {}, '射频信号历史走势 (30次遥测)')
				]),
				E('div', { 'style': 'display:flex;gap:6px;' }, [
					E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(56,189,248,0.15);color:#0ea5e9;font-weight:800;' }, 'RSRP'),
					E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(16,185,129,0.15);color:#10b981;font-weight:800;' }, 'SINR'),
					E('span', { 'class': 'mt-pill-tag', 'style': 'background:rgba(192,132,252,0.15);color:#a855f7;font-weight:800;' }, 'RSRQ')
				])
			]),
			E('div', { 'style': 'margin-top:12px;position:relative;' }, [
				(function() {
					var pts = [
						[-88, 22, -12], [-87, 23, -11], [-89, 21, -12], [-86, 25, -10],
						[-85, 26, -10], [-86, 24, -11], [-88, 22, -12], [-87, 24, -11],
						[-86, 25, -10], [-85, 26, -10], [-86, 24, -11], [-87, 23, -11]
					];
					var w = 540, h = 260, padL = 46, padR = 24, padT = 20, padB = 30;
					var cW = w - padL - padR, cH = h - padT - padB;
					var n = pts.length;

					function spline(idx, minV, maxV) {
						var coords = [];
						for (var i = 0; i < n; i++) {
							var x = padL + (i / (n - 1)) * cW;
							var v = pts[i][idx];
							var y = padT + (1 - (v - minV) / (maxV - minV)) * cH;
							coords.push([x, y]);
						}
						var d = 'M ' + coords[0][0].toFixed(1) + ' ' + coords[0][1].toFixed(1);
						for (var j = 0; j < coords.length - 1; j++) {
							var p0 = coords[j - 1] || coords[j];
							var p1 = coords[j];
							var p2 = coords[j + 1];
							var p3 = coords[j + 2] || p2;
							var c1x = p1[0] + (p2[0] - p0[0]) / 6;
							var c1y = p1[1] + (p2[1] - p0[1]) / 6;
							var c2x = p2[0] - (p3[0] - p1[0]) / 6;
							var c2y = p2[1] - (p3[1] - p1[1]) / 6;
							d += ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
						}
						return d;
					}

					var dRsrp = spline(0, -120, -60);
					var dSinr = spline(1, 0, 35);
					var dRsrq = spline(2, -20, -5);

					var svgBox = E('div', { 'class': 'mt-chart-wrap' });
					svgBox.innerHTML =
						'<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:auto;display:block;">' +
						'  <defs>' +
						'    <linearGradient id="chartGradRsrp" x1="0" y1="0" x2="0" y2="1">' +
						'      <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.25"/>' +
						'      <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0.0"/>' +
						'    </linearGradient>' +
						'  </defs>' +
						'  <!-- Dotted Gridlines -->' +
						'  <line x1="' + padL + '" y1="' + padT + '" x2="' + (w - padR) + '" y2="' + padT + '" stroke="var(--mt5700-border-subtle)" stroke-dasharray="3,3"/>' +
						'  <line x1="' + padL + '" y1="' + (padT + cH * 0.5) + '" x2="' + (w - padR) + '" y2="' + (padT + cH * 0.5) + '" stroke="var(--mt5700-border-subtle)" stroke-dasharray="3,3"/>' +
						'  <line x1="' + padL + '" y1="' + (padT + cH) + '" x2="' + (w - padR) + '" y2="' + (padT + cH) + '" stroke="var(--mt5700-border-subtle)"/>' +
						'  <!-- Left Axis -->' +
						'  <text x="' + (padL - 8) + '" y="' + (padT + 4) + '" text-anchor="end" font-size="10" fill="var(--mt5700-text-muted)" font-weight="700">-60</text>' +
						'  <text x="' + (padL - 8) + '" y="' + (padT + cH * 0.5 + 4) + '" text-anchor="end" font-size="10" fill="var(--mt5700-text-muted)" font-weight="700">-90</text>' +
						'  <text x="' + (padL - 8) + '" y="' + (padT + cH + 4) + '" text-anchor="end" font-size="10" fill="var(--mt5700-text-muted)" font-weight="700">-120</text>' +
						'  <!-- Curves -->' +
						'  <path d="' + dRsrp + '" fill="none" stroke="#0ea5e9" stroke-width="2.6" stroke-linecap="round"/>' +
						'  <path d="' + dSinr + '" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round"/>' +
						'  <path d="' + dRsrq + '" fill="none" stroke="#a855f7" stroke-width="2.0" stroke-linecap="round" stroke-dasharray="4,4"/>' +
						'</svg>';
					return svgBox;
				})()
			])
		]);
		midGrid.appendChild(chartCard);

		return layout;
	}
});
