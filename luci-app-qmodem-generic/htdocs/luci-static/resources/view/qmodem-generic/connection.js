'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require qmodem-generic.controls as controls';

var E = controls.element;

/*
 * 移动数据（Mobile Data）— 现代白色毛玻璃 (Glassmorphism) + 动态数据通路 SVG 重构
 * 数据源全部来自 QModem 的 ubus 对象及 UCI 配置：
 *    get_connect_status / get_dns / get_mode / dial_status / network.interface status
 */

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

function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]))
		return raw[key];
	return raw;
}

function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

function joinAddresses(list) {
	if (!Array.isArray(list) || !list.length)
		return '';
	return list.map(function(item) {
		if (!item)
			return '';
		if (typeof item === 'string')
			return item;
		var addr = item.address || item['local-address'] || '';
		if (!addr)
			return '';
		return item.mask != null ? addr + '/' + item.mask : addr;
	}).filter(Boolean).join(', ');
}

function cleanDns(v) {
	return controls.valueText(v).trim().split(/\s+/)[0] || '';
}

// 安全渲染 SVG 节点 helper
function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
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
		var self = this;
		var errors = [];
		var section = ctx.section;

		if (!section)
			return { section: null, errors: errors };

		return Promise.all([
			guard(controls.getConnectStatus(section), '连接状态', errors),
			guard(controls.getBaseInfo(section), '模组信息', errors),
			guard(controls.getDns(section), 'DNS', errors),
			guard(controls.getMode(section), '拨号模式', errors),
			guard(controls.getDialStatus(section), '拨号状态', errors),
			guard(controls.getInterfaceStatus(section), '接口状态', errors),
			guard(controls.rcList('qmodem_network'), '拨号服务', errors),
			guard(controls.getMonitorStatus(section), '网络监测', errors),
			guard(controls.getUplinkStatus(), '上联管理', errors),
			guard(controls.get5gLan(section), '5G LAN', errors)
		]).then(function(results) {
			var ifstat = results[5] || {};
			var devName = ifstat.l3_device || ifstat.device || '';

			return guard(
				devName ? controls.getDeviceStatus(devName) : Promise.resolve({}),
				'设备状态', errors
			).then(function(devstat) {
				var netdev = '';
				try { netdev = uci.get('qmodem', section, 'network') || ''; } catch (e) { netdev = ''; }
				self.iface = ifstat.interface || netdev || '--';

				return {
					section: section,
					sections: ctx.sections || [],
					iface: self.iface,
					conn: results[0],
					base: results[1],
					dns: results[2],
					mode: results[3],
					dial: results[4],
					ifstat: ifstat,
					devstat: devstat || {},
					networkService: results[6] || {},
					monitor: results[7] || {},
					uplink: results[8] || {},
					fiveGLan: results[9] || {},
					errors: errors
				};
			});
		});
	},

	styleNode: function() {
		return controls.injectStyleOnce('qm-connection-style', [
			'.qm-app{--qm-glass-bg:var(--qm-glass);--qm-glass-border:var(--qm-glass-border);--qm-glass-shadow:var(--qm-shadow);--qm-primary:var(--qm-accent);--qm-success:var(--qm-ok);--qm-warning:var(--qm-warn)}',
			'.mtconn-page{position:relative;max-width:1220px;margin:0 auto;color:var(--qm-text);padding-bottom:36px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
			'.mtconn-bg-glow1{position:absolute;top:-60px;left:6%;width:450px;height:450px;background:var(--qm-glow-a);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',
			'.mtconn-bg-glow2{position:absolute;top:340px;right:5%;width:420px;height:420px;background:var(--qm-glow-b);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',
			'.mtconn-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);border:1px solid var(--qm-glass-border);border-radius:var(--qm-radius);box-shadow:var(--qm-glass-shadow);padding:24px;transition:transform .24s cubic-bezier(.16,1,.3,1),box-shadow .24s ease}',
			'.mtconn-card:hover{transform:translateY(-2px);box-shadow:0 16px 38px -4px rgba(22,34,64,0.08), inset 0 1px 1.5px rgba(255,255,255,0.95)}',
			'.mtconn-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 32px;margin-bottom:18px;background:linear-gradient(135deg,rgba(0,114,245,0.9) 0%,rgba(9,88,217,0.85) 50%,rgba(16,185,129,0.8) 100%);border-radius:var(--qm-radius);border:1px solid var(--qm-glass-border);color:#fff;box-shadow:0 14px 34px -8px rgba(0,114,245,0.32), inset 0 1px 2px rgba(255,255,255,0.45);position:relative;overflow:hidden}',
			'.mtconn-hero::before{content:"";position:absolute;top:-50%;right:-10%;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.22) 0%,transparent 70%);pointer-events:none}',
			'.mtconn-title{margin:0 0 6px;font-size:25px;font-weight:800;letter-spacing:-.02em;color:#fff}',
			'.mtconn-sub{font-size:12.5px;color:rgba(255,255,255,0.88);line-height:1.5}',
			'.mtconn-state{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:999px;background:rgba(255,255,255,0.2);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.35);box-shadow:0 4px 14px rgba(0,0,0,0.08);font-size:13px;font-weight:800;color:#fff;white-space:nowrap}',
			'.mtconn-dot{width:10px;height:10px;border-radius:50%;background:#94a3b8;position:relative}',
			'.mtconn-state.online{color:#fff;background:rgba(16,185,129,0.3);border-color:rgba(16,185,129,0.5)}',
			'.mtconn-state.online .mtconn-dot{background:#10b981;box-shadow:0 0 10px #10b981;animation:qmConnPulse 2s infinite}',
			'@keyframes qmConnPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.7)}70%{box-shadow:0 0 0 10px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}',
			'.mtconn-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px;margin-bottom:18px}',
			'.mtconn-fact-card{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:18px;background:var(--qm-glass);border:1px solid var(--qm-glass-border);box-shadow:var(--qm-shadow)}',
			'.mtconn-fact-icon{width:42px;height:42px;border-radius:14px;background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);display:flex;align-items:center;justify-content:center;color:var(--qm-accent);flex-shrink:0;box-shadow:0 2px 8px rgba(0,114,245,0.08)}',
			'.mtconn-fact-label{font-size:11px;color:var(--qm-text-muted);font-weight:700;letter-spacing:0.02em;text-transform:uppercase;margin-bottom:3px}',
			'.mtconn-fact-val{font-size:16px;font-weight:800;color:var(--qm-text);word-break:break-all;letter-spacing:-.01em;font-variant-numeric:tabular-nums}',
			'.mtconn-topo-card{padding:22px 26px;margin-bottom:18px}',
			'.mtconn-topo-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}',
			'.mtconn-topo-title{font-size:15px;font-weight:800;color:var(--qm-text);display:flex;align-items:center;gap:8px}',
			'.mtconn-topo-sub{font-size:11.5px;color:var(--qm-text-muted)}',
			'.mtconn-topo-svg{width:100%;height:100px;display:block}',
			'@keyframes qmStreamFlow{to{stroke-dashoffset:-36}}',
			'.qm-stream-line{stroke-dasharray:8,6;animation:qmStreamFlow 1.5s linear infinite}',
			'.mtconn-actions-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:18px}',
			'.mtconn-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:14px;font-size:13px;font-weight:750;cursor:pointer;transition:all .2s cubic-bezier(.16,1,.3,1);border:1px solid var(--qm-glass-inner-border);background:var(--qm-glass-inner);color:var(--qm-text)}',
			'.mtconn-btn:hover{background:#fff;transform:translateY(-1px);box-shadow:0 4px 14px rgba(22,34,64,0.06)}',
			'.mtconn-btn-primary{background:linear-gradient(135deg,#0072f5 0%,#0050b3 100%)!important;color:#fff!important;border-color:transparent!important;box-shadow:0 4px 14px rgba(0,114,245,0.25)!important}',
			'.mtconn-btn-primary:hover{box-shadow:0 6px 20px rgba(0,114,245,0.38)!important;transform:translateY(-1.5px)!important}',
			'.mtconn-btn-danger{background:var(--qm-danger-soft)!important;color:var(--qm-danger)!important;border-color:var(--qm-danger-border)!important}',
			'.mtconn-btn-danger:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(239,68,68,0.2)}',
			'.mtconn-session-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px;margin-bottom:18px}',
			'.mtconn-runtime-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:16px;margin-bottom:18px}',
			'.mtconn-sec-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}',
			'.mtconn-sec-title{font-size:15px;font-weight:800;color:var(--qm-text);display:flex;align-items:center;gap:8px}',
			'.mtconn-sec-sub{font-size:11.5px;color:var(--qm-text-muted);margin-top:2px}',
			'.mtconn-badge{padding:4px 12px;border-radius:999px;font-size:10.5px;font-weight:750;letter-spacing:.02em}',
			'.mtconn-badge.online{background:var(--qm-ok-soft);color:var(--qm-ok);border:1px solid var(--qm-ok-border)}',
			'.mtconn-badge.offline{background:var(--qm-surface-2);color:var(--qm-text-muted);border:1px solid var(--qm-border-soft)}',
			'.mtconn-address-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:0 24px}',
			'.mtconn-kv-row{display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
			'.mtconn-kv-row:last-child{border-bottom:0}',
			'.mtconn-kv-label{color:var(--qm-text-muted);font-weight:600}',
			'.mtconn-kv-val{color:var(--qm-text);font-weight:700;text-align:right;word-break:break-all;font-variant-numeric:tabular-nums}',
			'.mtconn-config-card{margin-bottom:18px}',
			'.mtconn-config-card .cbi-map>h2,.mtconn-config-card .cbi-map-descr,.mtconn-config-card .cbi-section>h3{display:none}',
			'.mtconn-config-card .cbi-section{margin:0;padding:0;border:0;box-shadow:none}',
			'.mtconn-config-card .cbi-section-node{padding:0}',
			'.mtconn-config-card .cbi-value{padding:12px 0;border-bottom:1px solid var(--qm-border-soft);display:grid;grid-template-columns:180px 1fr;align-items:center}',
			'.mtconn-config-card .cbi-value:last-child{border-bottom:0}',
			'.mtconn-config-card .cbi-value-title{font-size:13px;font-weight:700;color:var(--qm-text-soft)}',
			'.mtconn-config-card .cbi-value-field{padding:0}',
			'.mtconn-config-card .cbi-input-text,.mtconn-config-card select{background:var(--qm-glass-inner);border:1px solid var(--qm-glass-inner-border);border-radius:12px;padding:8px 14px;font-size:13px;color:var(--qm-text);transition:all .2s ease;width:100%;max-width:420px}',
			'.mtconn-config-card .cbi-input-text:focus,.mtconn-config-card select:focus{background:#fff;border-color:var(--qm-accent);box-shadow:0 0 0 3px var(--qm-accent-soft);outline:none}',
			'.mtconn-config-footer{margin-top:16px;padding-top:14px;border-top:1px solid var(--qm-border-soft);display:flex;justify-content:flex-end}',
			'.mtconn-details{margin-bottom:18px;overflow:hidden}',
			'.mtconn-details summary{list-style:none;cursor:pointer;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;font-size:14.5px;font-weight:750;color:var(--qm-text)}',
			'.mtconn-details summary::-webkit-details-marker{display:none}',
			'.mtconn-chevron{display:inline-block;transition:transform .2s ease;font-size:18px;color:var(--qm-text-muted);font-weight:700}',
			'.mtconn-details[open] .mtconn-chevron{transform:rotate(90deg)}',
			'.mtconn-details-body{padding:0 22px 22px;border-top:1px solid var(--qm-border-soft)}',
			'.mtconn-term-box{background:rgba(15,23,42,0.96);border-radius:16px;padding:16px 20px;margin-top:14px;box-shadow:0 12px 30px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.1)}',
			'.mtconn-term-header{display:flex;align-items:center;gap:7px;margin-bottom:12px}',
			'.mtconn-term-dot{width:11px;height:11px;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,0.3)}',
			'.mtconn-term-dot.r{background:#ff5f56;border:1px solid #e0443e}',
			'.mtconn-term-dot.y{background:#ffbd2e;border:1px solid #dea123}',
			'.mtconn-term-dot.g{background:#27c93f;border:1px solid #1aab29}',
			'.mtconn-term-log{margin:0;max-height:280px;overflow:auto;color:#38bdf8;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}',
			'@media(max-width:980px){.mtconn-facts{grid-template-columns:repeat(2,1fr)}.mtconn-session-grid{grid-template-columns:1fr}}',
			'@media(max-width:680px){.mtconn-hero{flex-direction:column;align-items:flex-start}.mtconn-facts{grid-template-columns:1fr}.mtconn-config-card .cbi-value{grid-template-columns:1fr;gap:6px}}'
		].join(''));
	},

	/* 顶部 4 栏关键信息卡片 */
	renderFactCard: function(iconSvg, label, value) {
		if (!controls.hasValue(value)) return null;
		return E('div', { 'class': 'mtconn-card mtconn-fact-card' }, [
			E('div', { 'class': 'mtconn-fact-icon' }, [ svgNode(iconSvg) ]),
			E('div', {}, [
				E('div', { 'class': 'mtconn-fact-label' }, label),
				E('div', { 'class': 'mtconn-fact-val' }, value || '--')
			])
		]);
	},

	sessionRow: function(label, value) {
		return controls.dataRow(label, value, 'mtconn-kv-row', 'mtconn-kv-label', 'mtconn-kv-val');
	},

	/* 动态 SVG 网络数据通路与拨号隧道图 */
	renderSvgDataTunnel: function(res, connected) {
		var iface = res.iface || 'wwan0';
		var strokeColor = connected ? '#0072f5' : '#94a3b8';
		var streamLineClass = connected ? 'qm-stream-line' : '';
		var statusText = connected ? _('Active · Cellular Data Link') : _('Disconnected · Standby');
		var dotColor = connected ? '#10b981' : '#94a3b8';

		var svgStr = [
			'<svg class="mtconn-topo-svg" viewBox="0 0 540 86">',
			'  <defs>',
			'    <linearGradient id="qmTunnelGrad" x1="0%" y1="0%" x2="100%" y2="0%">',
			'      <stop offset="0%" stop-color="#0072f5"/>',
			'      <stop offset="50%" stop-color="#10b981"/>',
			'      <stop offset="100%" stop-color="#0ea5e9"/>',
			'    </linearGradient>',
			'    <filter id="qmNodeGlow" x="-20%" y="-20%" width="140%" height="140%">',
			'      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(22,34,64,0.06)"/>',
			'    </filter>',
			'  </defs>',
			'  <!-- Node 1: WWAN Host Interface -->',
			'  <g transform="translate(15, 14)" filter="url(#qmNodeGlow)">',
			'    <rect x="0" y="0" width="125" height="58" rx="14" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.95)" stroke-width="1.8"/>',
			'    <rect x="0" y="0" width="125" height="58" rx="14" fill="none" stroke="rgba(0,114,245,0.15)" stroke-width="1"/>',
			'    <circle cx="24" cy="29" r="7" fill="#0072f5"/>',
			'    <text x="40" y="26" font-size="12.5" font-weight="800" fill="#0f172a">' + controls.xmlText(iface) + '</text>',
			'    <text x="40" y="42" font-size="10" font-weight="600" fill="#64748b">' + _('Host WWAN') + '</text>',
			'  </g>',
			'  <!-- Pipeline Link 1 -->',
			'  <line x1="145" y1="43" x2="195" y2="43" stroke="' + strokeColor + '" stroke-width="3" stroke-linecap="round" class="' + streamLineClass + '"/>',
			'  <!-- Node 2: QModem Baseband Core Engine -->',
			'  <g transform="translate(195, 14)" filter="url(#qmNodeGlow)">',
			'    <rect x="0" y="0" width="150" height="58" rx="14" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.95)" stroke-width="1.8"/>',
			'    <rect x="0" y="0" width="150" height="58" rx="14" fill="none" stroke="rgba(16,185,129,0.2)" stroke-width="1"/>',
			'    <circle cx="24" cy="29" r="7" fill="' + dotColor + '"/>',
			'    <text x="40" y="26" font-size="12.5" font-weight="800" fill="#0f172a">QModem Core</text>',
			'    <text x="40" y="42" font-size="10" font-weight="600" fill="#64748b">' + statusText + '</text>',
			'  </g>',
			'  <!-- Pipeline Link 2 -->',
			'  <line x1="350" y1="43" x2="400" y2="43" stroke="' + strokeColor + '" stroke-width="3" stroke-linecap="round" class="' + streamLineClass + '" style="animation-duration:1.2s;"/>',
			'  <!-- Node 3: 5G RAN Carrier Gateway -->',
			'  <g transform="translate(400, 14)" filter="url(#qmNodeGlow)">',
			'    <rect x="0" y="0" width="125" height="58" rx="14" fill="rgba(255,255,255,0.85)" stroke="rgba(255,255,255,0.95)" stroke-width="1.8"/>',
			'    <rect x="0" y="0" width="125" height="58" rx="14" fill="none" stroke="rgba(14,165,233,0.2)" stroke-width="1"/>',
			'    <circle cx="24" cy="29" r="7" fill="#0ea5e9"/>',
			'    <text x="40" y="26" font-size="12.5" font-weight="800" fill="#0f172a">5G RAN</text>',
			'    <text x="40" y="42" font-size="10" font-weight="600" fill="#64748b">' + (connected ? 'IPv4 / IPv6' : _('Standby')) + '</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	addressPanel: function(res) {
		var self = this;
		var ifstat = res.ifstat || {};
		var devstat = res.devstat || {};
		var dns = plainObject(res.dns, 'dns');
		var connected = res.connected;

		var ipv4 = joinAddresses(ifstat['ipv4-address']);
		var ipv6 = joinAddresses(ifstat['ipv6-address']) ||
		           joinAddresses(ifstat['ipv6-prefix-assignment']) ||
		           joinAddresses(ifstat['ipv6-prefix']);
		var mtu = ifstat.mtu != null ? String(ifstat.mtu) :
		          (devstat.mtu != null ? String(devstat.mtu) : '');
		var dns4 = [ cleanDns(dns.ipv4_dns1), cleanDns(dns.ipv4_dns2) ].filter(Boolean).join(', ');
		var dns6 = [ cleanDns(dns.ipv6_dns1), cleanDns(dns.ipv6_dns2) ].filter(Boolean).join(', ');
		if (!dns4 && !dns6 && Array.isArray(ifstat['dns-server']))
			dns4 = ifstat['dns-server'].map(cleanDns).filter(Boolean).join(', ');

		var dialStatus = plainObject(res.dial, 'dial_status');
		var running = dialStatus.running;
		var serviceOn = running === true || running === 1 ||
			/^(?:true|1|running)$/i.test(String(running));
		var serviceKnown = running !== null && running !== undefined && String(running) !== '';
		var dialRows = Object.keys(dialStatus || {}).filter(function(k) {
			return k !== 'running' && controls.hasValue(dialStatus[k]) && typeof dialStatus[k] !== 'object';
		}).slice(0, 12).map(function(k) {
			return E('div', { 'class': 'mtconn-dial-item' }, [
				E('span', { 'class': 'mtconn-dial-key' }, k),
				E('strong', { 'class': 'mtconn-dial-val' }, String(dialStatus[k]))
			]);
		});
		function runtimeItem(label, value, kind) {
			return E('div', { 'class': 'mtconn-runtime-item' }, [
				E('div', { 'class': 'mtconn-runtime-label' }, label),
				E('div', { 'class': 'mtconn-runtime-value' + (kind ? ' ' + kind : '') }, value)
			]);
		}

		return E('div', { 'class': 'mtconn-session-stack' }, [
			/* 地址与网络会话 */
			E('section', { 'class': 'mtconn-card' }, [
				E('div', { 'class': 'mtconn-sec-head' }, [
					E('div', {}, [
						E('div', { 'class': 'mtconn-sec-title' }, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'),
							_('地址与 DNS')
						]),
						E('div', { 'class': 'mtconn-sec-sub' }, _('由 QModem 上报的逻辑接口地址与协商参数'))
					]),
					E('span', { 'class': 'mtconn-badge' + (connected ? ' online' : ' offline') }, connected ? _('已连接') : _('未连接'))
				]),
				E('div', { 'class': 'mtconn-address-grid' }, [
					self.sessionRow(_('IPv4 地址'), ipv4),
					self.sessionRow(_('IPv6 地址'), ipv6),
					self.sessionRow('MTU', mtu),
					self.sessionRow(_('IPv4 DNS'), dns4),
					self.sessionRow(_('IPv6 DNS'), dns6),
					self.sessionRow(_('接口协议'), ifstat.proto),
					self.sessionRow(_('接口状态'), ifstat.up === true ? _('已启动 (UP)') : (ifstat.up === false ? _('未启动 (DOWN)') : '--')),
					self.sessionRow(_('已连接时长'), ifstat.uptime != null ? controls.formatDuration(ifstat.uptime) : '--')
				])
			]),
			/* 紧凑的连接状态带：服务运行不等于移动数据已经连接。 */
			E('section', { 'class': 'mtconn-card mtconn-dial-summary' }, [
				E('div', { 'class': 'mtconn-sec-head' }, [
					E('div', {}, [
						E('div', { 'class': 'mtconn-sec-title' }, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'),
							_('连接与拨号状态')
						]),
						E('div', { 'class': 'mtconn-sec-sub' }, _('拨号服务状态与实际联网状态分别展示'))
					]),
					E('span', { 'class': 'mtconn-badge' + (connected ? ' online' : ' offline') },
						connected ? _('网络已连接') : _('网络未连接'))
				]),
				E('div', { 'class': 'mtconn-runtime-grid' }, [
					runtimeItem(_('拨号服务'), serviceKnown ?
						(serviceOn ? _('正在运行') : _('已停止')) : _('等待 QModem 上报'),
						serviceKnown ? (serviceOn ? 'online' : 'offline') : ''),
					runtimeItem(_('移动网络'), connected ? _('已连接') : _('未连接'),
						connected ? 'online' : 'offline'),
					runtimeItem(_('网络接口'), res.iface || '--')
				]),
				dialRows.length ? E('details', { 'class': 'mtconn-dial-extra' }, [
					E('summary', {}, _('查看 %d 项拨号诊断信息').format(dialRows.length)),
					E('div', { 'class': 'mtconn-dial-list' }, dialRows)
				]) : null
			])
		]);
	},

	runAction: function(fn, label) {
		var self = this;
		if (this.connectionBusy)
			return Promise.resolve(null);
		this.connectionBusy = true;
		ui.showModal(_('正在执行%s…').format(label), [
			E('p', { 'class': 'spinning' }, _('操作已经交给 QModem，请等待模组返回结果。'))
		]);
		return Promise.resolve().then(fn).then(function() {
			ui.hideModal();
			controls.notify(null, E('p', {},
				_('%s命令已被 QModem 接受，实际连接状态将在刷新后更新。').format(label)), 'info');
			/* 不直接把“命令成功”当作“网络已经连通”。 */
			window.setTimeout(function() { window.location.reload(); }, 1300);
		}, function(err) {
			ui.hideModal();
			controls.notify(null, E('p', {}, _('%s失败：%s').format(label,
				(err && err.message) || String(err))), 'danger');
		}).then(function() { self.connectionBusy = false; }, function(err) {
			self.connectionBusy = false;
			controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
		});
	},

	confirmConnectionAction: function(title, message, fn) {
		var self = this;
		if (this.connectionBusy) return;
		ui.showModal(title, [
			E('p', {}, message),
			E('div', { 'class': 'right' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('取消')),
				' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-negative',
					'click': function() {
						ui.hideModal();
						return self.runAction(fn, title);
					}
				}, _('确定执行'))
			])
		]);
	},

	loadLog: function(details, output, section) {
		if (!details.open || details.getAttribute('data-loaded') === '1')
			return;

		details.setAttribute('data-loaded', '1');
		output.textContent = _('正在读取拨号日志…');
		Promise.resolve(controls.getDialLog(section)).then(function(result) {
			var log = result && (result.dial_log || result.log || result.logs);
			if (Array.isArray(log))
				log = log.join('\n');
			output.textContent = log || _('本模组经 QModem 暂无拨号日志。');
		}).catch(function(err) {
			details.setAttribute('data-loaded', '0');
			output.textContent = (err && err.message) || String(err);
		});
	},

	clearLog: function(details, output, section) {
		var self = this;
		controls.confirmModal(_('清除拨号日志'),
			_('将调用 QModem 清除该模组的拨号日志文件。是否继续？'),
			function() {
				return controls.clearDialLog(section).then(function() {
					details.setAttribute('data-loaded', '0');
					output.textContent = _('日志已清除，展开可重新读取。');
					if (!details.open) details.open = true;
					return self.loadLog(details, output, section);
				});
			});
	},

	/* qmodem_network 拨号服务管理（官方 rc list + luci setInitAction 接口） */
	serviceCard: function(res) {
		var self = this;
		var svc = res.networkService || {};
		var known = svc && (svc.running !== undefined || svc.enabled !== undefined) &&
			Object.keys(svc).length > 0;
		var running = svc.running === true;
		var enabled = svc.enabled === true;

		function serviceAction(label, action) {
			controls.confirmModal(label,
				_('将对 qmodem_network 拨号服务执行「%s」操作，确定继续？').format(label),
				function() {
					return controls.setInitAction('qmodem_network', action).then(function() {
						controls.notify(null, E('p', {}, _('拨号服务已执行「%s」。').format(label)), 'info');
						return controls.kickPoller();
					});
				});
		}

		function toggleGlobalDial(ev) {
			var val = ev.currentTarget.checked ? '1' : '0';
			try {
				/* 段落是否存在只能按 .name 判定：uci.get(cfg, 'main') 省略 option 时
				 * 并不保证返回段落对象，一旦返回空值就会对已存在的 main 段重复
				 * uci.add()，LuCI 直接抛错，开关永远保存不了。官方 /etc/config/qmodem
				 * 里这一段是 `config main 'main'`，所以类型与名称都用 main。 */
				var mains = uci.sections('qmodem', 'main') || [];
				if (!mains.some(function(s) { return s && s['.name'] === 'main'; }))
					uci.add('qmodem', 'main', 'main');
				uci.set('qmodem', 'main', 'enable_dial', val);
			} catch (e) {
				controls.notify(null, E('p', {}, _('保存失败：') + ((e && e.message) || String(e))), 'danger');
				return;
			}
			uci.save().then(function() {
				return controls.commitConfig('qmodem');
			}).then(function() {
				controls.notify(null, E('p', {}, _('全局拨号开关已保存。')), 'info');
			}).catch(function(err) {
				controls.notify(null, E('p', {}, _('保存失败：') + ((err && err.message) || String(err))), 'danger');
			});
		}

		var globalDial = '0';
		try { globalDial = uci.get('qmodem', 'main', 'enable_dial') || '1'; } catch (e) { globalDial = '1'; }
		var globalDialBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		globalDialBox.checked = controls.isEnabled(globalDial);
		globalDialBox.addEventListener('change', toggleGlobalDial);

		var body = [
			controls.state(_('服务状态'), !known ? _('未检测到（请确认 QModem 已安装）') :
				running ? _('运行中') : _('已停止')),
			controls.state(_('开机自启'), !known ? '--' : enabled ? _('已启用') : _('未启用')),
			controls.row(_('全局拨号开关（enable_dial）'), globalDialBox)
		];

		if (known) {
			body.push(controls.action(_('重启服务'), function() { serviceAction(_('重启服务'), 'restart'); }));
			if (running)
				body.push(controls.action(_('停止服务'), function() { serviceAction(_('停止服务'), 'stop'); }));
			else
				body.push(controls.action(_('启动服务'), function() { serviceAction(_('启动服务'), 'start'); }));
			body.push(controls.action(enabled ? _('禁用开机自启') : _('启用开机自启'), function() {
				serviceAction(enabled ? _('禁用开机自启') : _('启用开机自启'), enabled ? 'disable' : 'enable');
			}));
		}

		return controls.card(_('拨号服务'), _('qmodem_network 服务与全局拨号开关（写入 /etc/config/qmodem）。'), body);
	},

	/* qmodem_monitor 网络监测状态（官方 get_monitor_status；未安装时优雅降级） */
	monitorCard: function(res) {
		var m = res.monitor || {};
		var known = m.enabled != null || m.running != null || controls.hasValue(m.phase);
		var body;
		if (!known) {
			body = [ E('div', { 'class': 'mt-control-note' },
				_('未检测到 qmodem_monitor 网络监测服务。安装 QModem 的 qmodem-monitor 组件后，此处显示断线监测与自动恢复状态。')) ];
		} else {
			body = [
				controls.state(_('监测开关'), m.enabled ? _('已启用') : _('未启用')),
				controls.state(_('监测进程'), m.running ? _('运行中') : _('未运行')),
				controls.state(_('阶段'), m.phase),
				controls.state(_('连通性'), m.connectivity),
				controls.state(_('失败次数'), m.failures != null ? String(m.failures) : ''),
				controls.state(_('原因'), m.reason),
				controls.state(_('恢复策略'), m.profile)
			];
		}
		return controls.card(_('网络监测'), _('断线监测与自动恢复状态（QModem qmodem_monitor）。'), body);
	},

	/* qmodem-uplink-manager 上联管理状态（官方 qmodem.uplink status） */
	uplinkCard: function(res) {
		var up = res.uplink || {};
		var known = up.enabled != null || (Array.isArray(up.members) && up.members.length > 0);
		var body;
		if (!known) {
			body = [ E('div', { 'class': 'mt-control-note' },
				_('未检测到 qmodem-uplink-manager 服务。安装后此处显示多上行（WAN + 模组）的负载均衡 / 故障切换状态。')) ];
		} else {
			var memberRows = (up.members || []).map(function(m) {
				return E('div', { 'class': 'mt-info-row' }, [
					E('span', { 'class': 'mt-info-key' }, joinAddresses([ m.interface || m.id || '' ]) || m.id),
					E('strong', { 'class': 'mt-info-val' }, [
						m.selected ? E('span', { 'style': 'color:var(--qm-ok)' }, _('使用中') + ' · ') : null,
						(m.healthy === true ? _('健康') : m.healthy === false ? _('异常') : m.reason || _('未知'))
					])
				]);
			});
			body = [
				controls.state(_('上联管理'), up.enabled ? _('已启用') : _('未启用')),
				controls.state(_('模式'), up.mode),
				controls.state(_('当前出口'), joinAddresses([ up.active || '' ]) || up.active || '--'),
				controls.state(_('策略状态'), up.reason || _('正常')),
				up.config_generation && up.config_generation !== up.applied_generation ?
					E('div', { 'class': 'mt-control-note' }, _('配置已更新，等待服务应用。')) : null,
				memberRows.length ? E('div', { 'class': 'mt-info-body' }, memberRows) : null
			];
		}
		return controls.card(_('上联管理状态'), _('多上行策略路由与健康探测（qmodem.uplink）。'), body, true);
	},

	/* 5G LAN 开关（官方 get_5g_lan / set_5g_lan；不支持的模组优雅降级） */
	fiveGLanCard: function(res) {
		var self = this;
		var lan = res.fiveGLan || {};
		var body;
		if (lan.supported !== true) {
			body = [ E('div', { 'class': 'mt-control-note' },
				_('当前模组或 QModem 版本未提供 5G LAN 能力。')) ];
		} else {
			var box = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
			box.checked = lan.enabled === true;
			body = [
				controls.row(_('启用 5G LAN'), box),
				controls.action(_('应用'), function() {
					return controls.set5gLan(res.section, box.checked).then(function() {
						controls.notify(null, E('p', {}, _('5G LAN 设置已下发。')), 'info');
						return controls.kickPoller();
					}, function(err) {
						controls.notify(null, E('p', {}, _('设置失败：') + ((err && err.message) || String(err))), 'danger');
					});
				})
			];
		}
		return controls.card(_('5G LAN'), _('模组内置 5G LAN / 以太网直通能力（QModem 5g_lan 接口）。'), body);
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
		var enter = !self.painted;
		self.painted = true;

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section) {
			return E('div', { 'class': 'mtconn-page' + (enter ? ' qm-enter' : '') }, [
				self.styleNode(),
				controls.styleNode(),
				modemBar,
				E('div', { 'class': 'mtconn-card', 'style': 'color:var(--qm-danger);background:var(--qm-danger-soft);margin-top:16px' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class': 'mtconn-card', 'style': 'margin-top:10px;color:var(--qm-danger)' }, msg);
				})
			]);
		}

		var section = res.section;
		var connected = controls.evalConnectionStatus({
			conn: res.conn, base: res.base, iface: res.ifstat || {}
		}).connected;
		var mode = plainObject(res.mode, 'mode');
		var modeName = Object.keys(mode || {}).filter(function(k) {
			return controls.isEnabled(mode[k]);
		}).join(' / ').toUpperCase();
		var configuredApn = uci.get('qmodem', section, 'apn') || _('自动');
		var configuredPdp = { IPV4V6: 'IPv4 / IPv6', IPV4: 'IPv4', IP: 'IPv4', IPV6: 'IPv6', ETHERNET: 'Ethernet' }[String(uci.get('qmodem', section, 'pdp_type') || '').toUpperCase()] || 'IPv4 / IPv6';

		res.connected = connected;

		/* 拨号日志 (懒加载终端风) */
		var logOutput = E('pre', { 'class': 'mtconn-term-log' }, _('展开以读取拨号日志。'));
		var logDetails = E('details', {
			'class': 'mtconn-card mtconn-details',
			'toggle': function(ev) { self.loadLog(ev.currentTarget, logOutput, section); }
		}, [
			E('summary', {}, [
				E('span', { 'style': 'display:flex;align-items:center;gap:8px' }, [
					svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>'),
					_('最近拨号日志')
				]),
				E('span', { 'class': 'mtconn-chevron' }, '›')
			]),
			E('div', { 'class': 'mtconn-details-body' }, [
					E('div', { 'class': 'mtconn-term-box' }, [
						E('div', { 'class': 'mtconn-term-header' }, [
							E('span', { 'class': 'mtconn-term-dot r' }),
							E('span', { 'class': 'mtconn-term-dot y' }),
							E('span', { 'class': 'mtconn-term-dot g' })
						]),
						logOutput
					]),
					E('div', { 'class': 'mtconn-config-footer' }, [
						E('button', {
							'type': 'button',
							'class': 'mtconn-btn mtconn-btn-danger',
							'click': function() { self.clearLog(logDetails, logOutput, section); }
						}, _('清除日志'))
					])
				])
			]);

		/* 入站路由与数据通路面板 */
		var inboundPanel = E('div', { 'class': 'mtconn-inbound-grid' }, [
			controls.card(_('数据通路'), _('由 QModem 上报的模组数据通路信息。'), [
				controls.state(_('网络接口'), res.iface),
				controls.state(_('拨号模式'), modeName || '--'),
				controls.state(_('接口协议'), (res.ifstat || {}).proto || '--'),
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 暂以 QModem 网络配置为准。'))
			]),
			controls.card(_('IP 透传 / 后置路由 / DMZ'), _('模组侧入站转发。'), [
				controls.state(_('IP 透传'), '--'),
				controls.state(_('后置路由'), '--'),
				controls.state('DMZ', '--'),
				E('div', { 'class': 'mt-control-note' }, _('QModem 未导出这些模组私有设置，此处作只读展示。'))
			])
		]);

		return self.buildApnForm(section).then(function(formNode) {
			return E('div', { 'class': 'mtconn-page' + (enter ? ' qm-enter' : '') }, [
				self.styleNode(),
				controls.styleNode(),
				/* 背景氛围光 */
				E('div', { 'class': 'mtconn-bg-glow1' }),
				E('div', { 'class': 'mtconn-bg-glow2' }),

				(res.errors || []).length ? E('div', { 'class': 'mtconn-card', 'style': 'color:var(--qm-danger);margin-bottom:14px' }, _('部分数据读取失败：') + res.errors.join('；')) : null,
				modemBar,

				/* 顶部 Hero 玻璃卡片 */
				E('section', { 'class': 'mtconn-card mtconn-hero' }, [
					E('div', {}, [
						controls.pageTitle('connection', _('移动数据'), 'mtconn-title'),
						E('div', { 'class': 'mtconn-sub' }, _('管理移动网络连接会话、配置 APN 及拨号策略。'))
					]),
					E('div', { 'class': 'mtconn-state' + (connected ? ' online' : '') }, [
						E('span', { 'class': 'mtconn-dot' }),
						connected ? _('已连接') : _('未连接')
					])
				]),

				/* 4 列关键指标速览 */
				E('div', { 'class': 'mtconn-facts' }, [
					self.renderFactCard(
						'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>',
						_('配置节'), section
					),
					self.renderFactCard(
						'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>',
						_('网络接口'), res.iface
					),
					self.renderFactCard(
						'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
						'APN', configuredApn
					),
					self.renderFactCard(
						'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg>',
						_('IP 协议'), configuredPdp
					)
				]),

				/* 动态 SVG 拓扑通路 */
				E('section', { 'class': 'mtconn-card mtconn-topo-card' }, [
					E('div', { 'class': 'mtconn-topo-head' }, [
						E('div', {}, [
							E('div', { 'class': 'mtconn-topo-title' }, [
								svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'),
								_('动态数据通路拓扑')
							]),
							E('div', { 'class': 'mtconn-topo-sub' }, _('主机网卡接口、QModem 驱动核心与移动蜂窝 WAN 实时链路'))
						])
					]),
					self.renderSvgDataTunnel(res, connected)
				]),

				/* 地址面板与拨号状态 */
				self.addressPanel(res),

				/* 手动拨号控制：显式 button 类型，避免 LuCI CBI 表单误提交。 */
				E('div', { 'class': 'mtconn-actions-bar' }, [
					E('button', {
						'type': 'button', 'class': 'mtconn-btn mtconn-btn-primary',
						'click': function() {
							return self.runAction(function() { return controls.modemDial(section); }, _('开始拨号'));
						}
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'),
						_('开始拨号')
					]),
					E('button', {
						'type': 'button', 'class': 'mtconn-btn mtconn-btn-danger',
						'click': function() {
							return self.confirmConnectionAction(_('挂断连接'),
								_('确定断开当前移动数据连接？'),
								function() { return controls.modemHang(section); });
						}
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'),
						_('挂断连接')
					]),
					E('button', {
						'type': 'button', 'class': 'mtconn-btn mtconn-btn-secondary',
						'click': function() {
							return self.confirmConnectionAction(_('重新拨号'),
								_('将短暂断开并重新建立移动网络连接，确定继续？'),
								function() { return controls.modemRedial(section); });
						}
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'),
						_('重新拨号')
					])
				]),

				/* 服务与扩展能力：拨号服务管理 / 网络监测 / 上联管理 / 5G LAN */
				E('div', { 'class': 'mt-control-grid', 'style': 'margin-bottom:16px' }, [
					self.serviceCard(res),
					self.monitorCard(res),
					self.uplinkCard(res),
					self.fiveGLanCard(res)
				]),

				/* 拨号设置 (APN) 白色毛玻璃卡片 */
				E('section', { 'class': 'mtconn-card mtconn-config-card' }, [
					E('div', { 'class': 'mtconn-sec-head' }, [
						E('div', {}, [
							E('div', { 'class': 'mtconn-sec-title' }, [
								svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'),
								_('拨号设置 (APN)')
							]),
							E('div', { 'class': 'mtconn-sec-sub' }, _('参数保存后写入 /etc/config/qmodem，点击「重新拨号」即可应用生效。'))
						])
					]),
					formNode,
					E('div', { 'class': 'mtconn-config-footer' }, [
						E('button', {
							'type': 'button',
							'class': 'mtconn-btn mtconn-btn-primary',
							'click': function(ev) { return self.saveApn(ev && ev.currentTarget); }
						}, [
							svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'),
							_('保存 APN 设置')
						])
					])
				]),

				/* 高级连接信息折叠卡片 */
				E('details', { 'class': 'mtconn-card mtconn-details' }, [
					E('summary', {}, [
						E('span', { 'style': 'display:flex;align-items:center;gap:8px' }, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
							_('高级连接信息与数据通路')
						]),
						E('span', { 'class': 'mtconn-chevron' }, '›')
					]),
					E('div', { 'class': 'mtconn-details-body' }, [ inboundPanel ])
				]),

				/* 拨号日志 */
				logDetails
			]);
		}).catch(function(err) {
			return E('div', { 'class': 'mtconn-page' + (enter ? ' qm-enter' : '') }, [
				self.styleNode(),
				controls.styleNode(),
				E('div', { 'class': 'qm-error-banner' }, _('页面渲染失败：') + ((err && err.message) || String(err)))
			]);
		});
	},

	buildApnForm: function(section) {
		var self = this;
		if (self._apnFormNode)
			return Promise.resolve(self._apnFormNode);

		var m = new form.Map('qmodem', section);
		var s, o;

		s = m.section(form.NamedSection, section, 'modem-device');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'apn', 'APN');
		o.placeholder = _('留空使用运营商默认值');
		o.rmempty = true;

		o = s.option(form.ListValue, 'pdp_type', _('IP 协议'));
		/* 兼容旧版 UI 写入的大写值；保存时规范为 QModem 官方小写枚举。 */
		o.value('ipv4v6', 'IPv4 / IPv6');
		o.value('ip', 'IPv4');
		o.value('ipv6', 'IPv6');
		o.value('ethernet', 'Ethernet');
		o.default = 'ipv4v6';
		o.rmempty = false;
		o.cfgvalue = function(sectionId) {
			var raw = String(uci.get('qmodem', sectionId, 'pdp_type') || 'ipv4v6');
			return { IPV4: 'ip', IPV6: 'ipv6', IPV4V6: 'ipv4v6' }[raw.toUpperCase()] || raw.toLowerCase();
		};

		o = s.option(form.ListValue, 'auth', _('认证方式'));
		o.value('none', _('无'));
		o.value('pap', 'PAP');
		o.value('chap', 'CHAP');
		o.value('MsChapV2', 'MSCHAPv2');
		o.default = 'none';
		o.rmempty = false;

		o = s.option(form.Value, 'username', _('用户名'));
		o.depends('auth', 'pap');
		o.depends('auth', 'chap');
		o.depends('auth', 'MsChapV2');
		o.rmempty = true;

		o = s.option(form.Value, 'password', _('密码'));
		o.password = true;
		o.depends('auth', 'pap');
		o.depends('auth', 'chap');
		o.depends('auth', 'MsChapV2');
		o.rmempty = true;

		o = s.option(form.DynamicList, 'dns_list', _('自定义 DNS'));
		o.datatype = 'ipaddr';
		o.description = _('留空则使用移动网络下发的 DNS。');

		self._apnMap = m;
		return m.render().then(function(formNode) {
			self._apnFormNode = formNode;
			return formNode;
		}).catch(function(err) {
			self._apnMap = null;
			self._apnFormNode = E('div', { 'class': 'mtconn-card', 'style': 'color:var(--qm-danger)' },
				_('拨号设置渲染失败：') + ((err && err.message) || String(err)));
			return self._apnFormNode;
		});
	},

	saveApn: function(button) {
		var self = this;
		if (this._apnSaving) return Promise.resolve();
		if (!this._apnMap) {
			controls.notify(null, E('p', {}, _('APN 配置表单尚未正常加载，无法保存。')), 'danger');
			return Promise.resolve();
		}
		this._apnSaving = true;
		if (button) button.disabled = true;
		return Promise.resolve().then(function() {
			/* CBI Map 解析用户当前输入，提交到 UCI，然后持久化。 */
			return self._apnMap.save(null, true);
		}).then(function() {
			return controls.commitConfig('qmodem');
		}).then(function() {
			controls.notify(null, E('p', {},
				_('APN 配置已写入 /etc/config/qmodem。重新拨号后生效。')), 'info');
			window.setTimeout(function() { window.location.reload(); }, 1100);
		}).catch(function(err) {
			controls.notify(null, E('p', {},
				_('APN 保存失败：%s').format((err && err.message) || String(err))), 'danger');
		}).then(function() {
			self._apnSaving = false;
			if (button) button.disabled = false;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
