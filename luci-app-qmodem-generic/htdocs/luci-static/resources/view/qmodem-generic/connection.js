'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require qmodem-generic.controls as controls';

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
	return String(v == null ? '' : v).split(/\s+/)[0] || '';
}

// 安全渲染 SVG 节点 helper
function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'status', 'network' ],
	POLL_INTERVAL: 5000,

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
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
			guard(controls.getInterfaceStatus(section), '接口状态', errors)
		]).then(function(results) {
			var ifstat = results[5] || {};
			var devName = ifstat.l3_device || ifstat.device || '';

			return guard(
				devName ? controls.getDeviceStatusCached(section) : Promise.resolve({}),
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
					errors: errors
				};
			});
		});
	},

	styleNode: function() {
		return E('style', {}, [
			/* 全局毛玻璃与流动渐变底蕴 */
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mtconn-page{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境氛围光球 */
			'.mtconn-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mtconn-bg-glow2{position:absolute;top:320px;right:5%;width:400px;height:400px;background:radial-gradient(circle,rgba(14,165,233,0.10) 0%,rgba(99,102,241,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片通用规则 */
			'.mtconn-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:22px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mtconn-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(31,64,120,0.08),0 2px 6px rgba(0,0,0,0.04)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mtconn-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.mtconn-title{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.mtconn-sub{font-size:13px;color:#64748b;line-height:1.5}',
			'.mtconn-state{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,0.8);border:1px solid rgba(226,232,240,0.9);box-shadow:0 2px 8px rgba(0,0,0,0.04);font-size:13px;font-weight:750;white-space:nowrap}',
			'.mtconn-dot{width:10px;height:10px;border-radius:50%;background:#cbd5e1;position:relative}',
			'.mtconn-state.online{color:#065f46;background:rgba(236,253,245,0.85);border-color:rgba(167,243,208,0.8)}',
			'.mtconn-state.online .mtconn-dot{background:#10b981;box-shadow:0 0 0 0 rgba(16,185,129,0.6);animation:qmConnPulse 2s infinite}',
			'@keyframes qmConnPulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,0.7)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}',

			/* 关键指标概览卡片 (4 列) */
			'.mtconn-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px}',
			'.mtconn-fact-card{display:flex;align-items:center;gap:14px;padding:16px 18px}',
			'.mtconn-fact-icon{width:40px;height:40px;border-radius:12px;background:rgba(239,246,255,0.8);border:1px solid rgba(191,219,254,0.6);display:flex;align-items:center;justify-content:center;color:#0072f5;flex-shrink:0}',
			'.mtconn-fact-label{font-size:11px;color:#64748b;font-weight:600;margin-bottom:2px}',
			'.mtconn-fact-val{font-size:15px;font-weight:750;color:#0f172a;word-break:break-all;letter-spacing:-.01em}',

			/* 动态 SVG 链路拓扑面板 */
			'.mtconn-topo-card{padding:20px 24px;margin-bottom:16px}',
			'.mtconn-topo-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}',
			'.mtconn-topo-title{font-size:15px;font-weight:750;color:#0f172a;display:flex;align-items:center;gap:8px}',
			'.mtconn-topo-sub{font-size:11px;color:#64748b}',
			'.mtconn-topo-svg{width:100%;height:100px;display:block}',
			'@keyframes qmStreamFlow{to{stroke-dashoffset:-36}}',
			'.qm-stream-line{stroke-dasharray:7,5;animation:qmStreamFlow 1.5s linear infinite}',

			/* 快捷操作动作按钮条 (拨号/挂断/重拨) */
			'.mtconn-actions-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px}',
			'.mtconn-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 22px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s ease;border:1px solid transparent;backdrop-filter:blur(8px)}',
			'.mtconn-btn-primary{background:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);color:#fff;box-shadow:0 4px 14px rgba(0,114,245,0.25)}',
			'.mtconn-btn-primary:hover{background:linear-gradient(135deg,#1a85ff 0%,#1d4ed8 100%);transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,114,245,0.35)}',
			'.mtconn-btn-danger{background:rgba(254,242,242,0.85);color:#dc2626;border-color:rgba(254,202,202,0.8)}',
			'.mtconn-btn-danger:hover{background:#fee2e2;transform:translateY(-1px);box-shadow:0 4px 12px rgba(220,38,38,0.15)}',
			'.mtconn-btn-secondary{background:rgba(255,255,255,0.85);color:#334155;border-color:rgba(226,232,240,0.8)}',
			'.mtconn-btn-secondary:hover{background:#fff;color:#0072f5;transform:translateY(-1px);border-color:rgba(0,114,245,0.3)}',

			/* 双列地址与会话面板 */
			'.mtconn-session-grid{display:grid;grid-template-columns:1.28fr 0.92fr;gap:16px;margin-bottom:16px}',
			'.mtconn-sec-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}',
			'.mtconn-sec-title{font-size:15px;font-weight:750;color:#0f172a;display:flex;align-items:center;gap:8px}',
			'.mtconn-sec-sub{font-size:11px;color:#64748b;margin-top:2px}',
			'.mtconn-badge{padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.02em}',
			'.mtconn-badge.online{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}',
			'.mtconn-badge.offline{background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0}',

			/* 地址网格与行项目 */
			'.mtconn-address-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}',
			'.mtconn-kv-row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12px}',
			'.mtconn-kv-row:last-child{border-bottom:0}',
			'.mtconn-kv-label{color:#64748b;font-weight:500}',
			'.mtconn-kv-val{color:#0f172a;font-weight:600;text-align:right;word-break:break-all;font-variant-numeric:tabular-nums}',

			/* 拨号状态原始网格 */
			'.mtconn-dial-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;padding-right:4px}',
			'.mtconn-dial-item{display:flex;justify-content:space-between;padding:7px 10px;border-radius:10px;background:rgba(248,250,252,0.7);border:1px solid rgba(241,245,249,0.85);font-size:11px}',
			'.mtconn-dial-key{color:#64748b;font-weight:600}',
			'.mtconn-dial-val{color:#0f172a;font-weight:700;font-variant-numeric:tabular-nums}',

			/* APN 拨号配置表单区域 (白色毛玻璃) */
			'.mtconn-config-card{margin-bottom:16px}',
			'.mtconn-config-card .cbi-map>h2,.mtconn-config-card .cbi-map-descr,.mtconn-config-card .cbi-section>h3{display:none}',
			'.mtconn-config-card .cbi-section{margin:0;padding:0;border:0;box-shadow:none}',
			'.mtconn-config-card .cbi-section-node{padding:0}',
			'.mtconn-config-card .cbi-value{padding:12px 0;border-bottom:1px solid rgba(226,232,240,0.6);display:grid;grid-template-columns:180px 1fr;align-items:center}',
			'.mtconn-config-card .cbi-value:last-child{border-bottom:0}',
			'.mtconn-config-card .cbi-value-title{font-size:13px;font-weight:600;color:#334155}',
			'.mtconn-config-card .cbi-value-field{padding:0}',
			'.mtconn-config-card .cbi-input-text,.mtconn-config-card select{background:rgba(255,255,255,0.85);border:1px solid rgba(203,213,225,0.8);border-radius:10px;padding:7px 12px;font-size:13px;color:#0f172a;transition:all .2s ease;width:100%;max-width:380px}',
			'.mtconn-config-card .cbi-input-text:focus,.mtconn-config-card select:focus{background:#fff;border-color:#0072f5;box-shadow:0 0 0 3px rgba(0,114,245,0.15);outline:none}',
			'.mtconn-config-footer{margin-top:16px;padding-top:14px;border-top:1px solid rgba(226,232,240,0.7);display:flex;justify-content:flex-end}',

			/* 折叠面板 (高级连接信息 & 日志) */
			'.mtconn-details{margin-bottom:16px;overflow:hidden}',
			'.mtconn-details summary{list-style:none;cursor:pointer;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700;color:#0f172a}',
			'.mtconn-details summary::-webkit-details-marker{display:none}',
			'.mtconn-chevron{display:inline-block;transition:transform .2s ease;font-size:18px;color:#94a3b8;font-weight:700}',
			'.mtconn-details[open] .mtconn-chevron{transform:rotate(90deg)}',
			'.mtconn-details-body{padding:0 20px 20px;border-top:1px solid rgba(226,232,240,0.6)}',

			/* 日志极客风格终端视窗 */
			'.mtconn-term-box{background:#0f172a;border-radius:14px;padding:14px;margin-top:12px;box-shadow:inset 0 2px 6px rgba(0,0,0,0.5)}',
			'.mtconn-term-header{display:flex;align-items:center;gap:6px;margin-bottom:10px}',
			'.mtconn-term-dot{width:10px;height:10px;border-radius:50%}',
			'.mtconn-term-dot.r{background:#ef4444}',
			'.mtconn-term-dot.y{background:#f59e0b}',
			'.mtconn-term-dot.g{background:#10b981}',
			'.mtconn-term-log{margin:0;max-height:280px;overflow:auto;color:#38bdf8;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}',

			/* 响应式适配 */
			'@media(max-width:980px){.mtconn-facts{grid-template-columns:repeat(2,1fr)}.mtconn-session-grid{grid-template-columns:1fr}.mtconn-address-grid{grid-template-columns:1fr}}',
			'@media(max-width:680px){.mtconn-hero{flex-direction:column;align-items:flex-start}.mtconn-facts{grid-template-columns:1fr}.mtconn-config-card .cbi-value{grid-template-columns:1fr;gap:6px}}'
		].join(''));
	},

	/* 顶部 4 栏关键信息卡片 */
	renderFactCard: function(iconSvg, label, value) {
		return E('div', { 'class': 'mtconn-card mtconn-fact-card' }, [
			E('div', { 'class': 'mtconn-fact-icon' }, [ svgNode(iconSvg) ]),
			E('div', {}, [
				E('div', { 'class': 'mtconn-fact-label' }, label),
				E('div', { 'class': 'mtconn-fact-val' }, value || '--')
			])
		]);
	},

	sessionRow: function(label, value) {
		return E('div', { 'class': 'mtconn-kv-row' }, [
			E('span', { 'class': 'mtconn-kv-label' }, label),
			E('strong', { 'class': 'mtconn-kv-val' }, value || '--')
		]);
	},

	/* 动态 SVG 网络数据通路与拨号隧道图 */
	renderSvgDataTunnel: function(res, connected) {
		var iface = res.iface || 'wwan0';
		var strokeColor = connected ? '#0072f5' : '#94a3b8';
		var streamLineClass = connected ? 'qm-stream-line' : '';
		var statusText = connected ? _('链路活跃 · 通路畅通') : _('拨号中断 · 离线中');
		var dotColor = connected ? '#10b981' : '#94a3b8';

		var svgStr = [
			'<svg class="mtconn-topo-svg" viewBox="0 0 540 86">',
			'  <defs>',
			'    <linearGradient id="qmTunnelGrad" x1="0%" y1="0%" x2="100%" y2="0%">',
			'      <stop offset="0%" stop-color="#0072f5"/>',
			'      <stop offset="50%" stop-color="#10b981"/>',
			'      <stop offset="100%" stop-color="#0ea5e9"/>',
			'    </linearGradient>',
			'  </defs>',
			'  <!-- 节点 1: 主机网卡 / 逻辑接口 -->',
			'  <g transform="translate(15, 14)">',
			'    <rect x="0" y="0" width="115" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="22" cy="28" r="6" fill="#0072f5"/>',
			'    <text x="36" y="25" font-size="12" font-weight="750" fill="#0f172a">' + iface + '</text>',
			'    <text x="36" y="41" font-size="10" fill="#64748b">' + _('网络接口') + '</text>',
			'  </g>',
			'  <!-- 传输链路 1 -->',
			'  <line x1="130" y1="42" x2="200" y2="42" stroke="' + strokeColor + '" stroke-width="2.6" stroke-linecap="round" class="' + streamLineClass + '"/>',
			'  <!-- 节点 2: QModem 核心守护驱动 -->',
			'  <g transform="translate(200, 14)">',
			'    <rect x="0" y="0" width="135" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="24" cy="28" r="6" fill="' + dotColor + '"/>',
			'    <text x="38" y="25" font-size="12" font-weight="750" fill="#0f172a">QModem Core</text>',
			'    <text x="38" y="41" font-size="10" fill="#64748b">' + statusText + '</text>',
			'  </g>',
			'  <!-- 传输链路 2 -->',
			'  <line x1="335" y1="42" x2="405" y2="42" stroke="' + strokeColor + '" stroke-width="2.6" stroke-linecap="round" class="' + streamLineClass + '" style="animation-duration:1.2s;"/>',
			'  <!-- 节点 3: 蜂窝基站与公网 -->',
			'  <g transform="translate(405, 14)">',
			'    <rect x="0" y="0" width="120" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="22" cy="28" r="6" fill="#0ea5e9"/>',
			'    <text x="36" y="25" font-size="12" font-weight="750" fill="#0f172a">蜂窝广域网</text>',
			'    <text x="36" y="41" font-size="10" fill="#64748b">' + (connected ? 'IPv4 / IPv6' : _('离线')) + '</text>',
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
		var dialRows = Object.keys(dialStatus || {}).filter(function(k) {
			var v = dialStatus[k];
			return v == null || typeof v !== 'object';
		}).slice(0, 14).map(function(k) {
			return E('div', { 'class': 'mtconn-dial-item' }, [
				E('span', { 'class': 'mtconn-dial-key' }, k),
				E('strong', { 'class': 'mtconn-dial-val' }, dialStatus[k] == null ? '--' : String(dialStatus[k]))
			]);
		});

		return E('div', { 'class': 'mtconn-session-grid' }, [
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
			/* 拨号状态原始上报 */
			E('section', { 'class': 'mtconn-card' }, [
				E('div', { 'class': 'mtconn-sec-head' }, [
					E('div', {}, [
						E('div', { 'class': 'mtconn-sec-title' }, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'),
							_('拨号状态')
						]),
						E('div', { 'class': 'mtconn-sec-sub' }, _('QModem dial_status 实时状态上报'))
					]),
					E('span', { 'class': 'mtconn-badge online' }, 'ubus')
				]),
				dialRows.length ? E('div', { 'class': 'mtconn-dial-list' }, dialRows) :
					E('div', { 'style': 'color:#94a3b8;font-size:12px;padding:20px 0;text-align:center' }, _('暂无拨号状态数据'))
			])
		]);
	},

	runAction: function(fn, success) {
		ui.showModal(_('请稍候…'), [ E('p', { 'class': 'spinning' }, _('正在下发连接操作…')) ]);
		return Promise.resolve(fn()).then(function() {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, success));
			window.setTimeout(function() { window.location.reload(); }, 1200);
		}).catch(function(err) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
		});
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

	render: function(res) {
		return controls.liveView(this, res, {
			domains: this.DOMAINS,
			interval: this.POLL_INTERVAL,
			paint: this.paintContent,
			collect: this.collect
		});
	},

	paintContent: function(res) {
		var self = this;
		res = res || {};

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section) {
			return E('div', { 'class': 'mtconn-page' }, [
				self.styleNode(),
				controls.styleNode(),
				modemBar,
				E('div', { 'class': 'mtconn-card', 'style': 'color:#b91c1c;background:rgba(254,242,242,0.85);margin-top:16px' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).map(function(msg) {
					return E('div', { 'class': 'mtconn-card', 'style': 'margin-top:10px;color:#b91c1c' }, msg);
				})
			]);
		}

		var section = res.section;
		var connected = controls.evalConnectionStatus({
			conn: res.conn, base: res.base, iface: res.ifstat || {}
		}).connected;
		var mode = plainObject(res.mode, 'mode');
		var modeName = Object.keys(mode || {}).filter(function(k) {
			return String(mode[k]) === '1';
		}).join(' / ').toUpperCase();
		var configuredApn = uci.get('qmodem', section, 'apn') || _('自动');
		var configuredPdp = { IPV4V6: 'IPv4 / IPv6', IPV4: 'IPv4', IPV6: 'IPv6' }[String(uci.get('qmodem', section, 'pdp_type') || '').toUpperCase()] || 'IPv4 / IPv6';

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
				])
			])
		]);

		/* 入站路由与数据通路面板 */
		var inboundPanel = E('div', { 'style': 'padding-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px' }, [
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
			return E('div', { 'class': 'mtconn-page' }, [
				self.styleNode(),
				controls.styleNode(),
				/* 背景氛围光 */
				E('div', { 'class': 'mtconn-bg-glow1' }),
				E('div', { 'class': 'mtconn-bg-glow2' }),

				(res.errors || []).length ? E('div', { 'class': 'mtconn-card', 'style': 'color:#b91c1c;margin-bottom:14px' }, _('部分数据读取失败：') + res.errors.join('；')) : null,
				modemBar,

				/* 顶部 Hero 玻璃卡片 */
				E('section', { 'class': 'mtconn-card mtconn-hero' }, [
					E('div', {}, [
						E('h2', { 'class': 'mtconn-title' }, _('移动数据')),
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

				/* 快捷操作动作按钮条 (带 SVG 矢量图标) */
				E('div', { 'class': 'mtconn-actions-bar' }, [
					E('button', {
						'class': 'mtconn-btn mtconn-btn-primary',
						'click': function() { return self.runAction(function() { return controls.modemDial(section); }, _('已开始拨号。')); }
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>'),
						_('开始拨号')
					]),
					E('button', {
						'class': 'mtconn-btn mtconn-btn-danger',
						'click': function() {
							return controls.confirmModal(_('挂断移动数据'), _('确认现在断开移动数据连接？'), function() {
								return controls.modemHang(section);
							});
						}
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'),
						_('挂断连接')
					]),
					E('button', {
						'class': 'mtconn-btn mtconn-btn-secondary',
						'click': function() {
							return controls.confirmModal(_('重新拨号'), _('重拨期间移动数据将短暂中断。是否继续？'), function() {
								return controls.modemRedial(section);
							});
						}
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'),
						_('重新拨号')
					])
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
							'click': ui.createHandlerFn(self, function() { return self.saveApn(); })
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
			return E('div', { 'class': 'mtconn-page' }, [
				self.styleNode(),
				controls.styleNode(),
				E('div', { 'class': 'mtconn-card', 'style': 'color:#b91c1c;margin-top:16px' },
					_('页面渲染失败：') + ((err && err.message) || String(err)))
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
		o.value('IPV4V6', 'IPv4 / IPv6');
		o.value('IPV4', 'IPv4');
		o.value('IPV6', 'IPv6');
		o.default = 'IPV4V6';
		o.rmempty = false;

		o = s.option(form.ListValue, 'auth', _('认证方式'));
		o.value('none', _('无'));
		o.value('pap', 'PAP');
		o.value('chap', 'CHAP');
		o.default = 'none';
		o.rmempty = false;

		o = s.option(form.Value, 'username', _('用户名'));
		o.depends('auth', 'pap');
		o.depends('auth', 'chap');
		o.rmempty = true;

		o = s.option(form.Value, 'password', _('密码'));
		o.password = true;
		o.depends('auth', 'pap');
		o.depends('auth', 'chap');
		o.rmempty = true;

		o = s.option(form.DynamicList, 'dns_list', _('自定义 DNS'));
		o.datatype = 'ipaddr';
		o.description = _('留空则使用移动网络下发的 DNS。');

		self._apnMap = m;
		return m.render().then(function(formNode) {
			self._apnFormNode = formNode;
			return formNode;
		}).catch(function(err) {
			self._apnFormNode = E('div', { 'class': 'mtconn-card', 'style': 'color:#b91c1c' },
				_('拨号设置渲染失败：') + ((err && err.message) || String(err)));
			return self._apnFormNode;
		});
	},

	saveApn: function() {
		var self = this;
		if (!self._apnMap)
			return Promise.resolve();
		return self._apnMap.save(null, true).then(function() {
			return uci.commit('qmodem');
		}).then(function() {
			ui.addNotification(null, E('p', {}, _('APN 设置已保存到 QModem 配置（qmodem），请重拨以生效。')));
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
