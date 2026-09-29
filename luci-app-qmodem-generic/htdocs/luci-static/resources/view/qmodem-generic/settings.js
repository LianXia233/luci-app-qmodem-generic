'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require qmodem-generic.controls as controls';

/*
 * 设备参数（Settings）— 现代白色毛玻璃 (Glassmorphism) + 动态配置流 SVG 重构
 * 本页编辑 QModem 的 UCI 配置 /etc/config/qmodem 中当前模组的 modem-device 配置节。
 */

function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [],

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
			self.section = ctx.section;
			return { section: ctx.section, errors: ctx.errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mt-diag-page{position:relative;max-width:960px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境漫反射光晕 */
			'.mt-set-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-set-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(14,165,233,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片核心样式 */
			'.mt-diag-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:24px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-diag-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(31,64,120,0.08),0 2px 6px rgba(0,0,0,0.04)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-diag-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.mt-diag-title{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.mt-diag-sub{font-size:13px;color:#64748b;line-height:1.5;margin:0}',
			'.mt-diag-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:rgba(239,246,255,0.85);color:#0072f5;border:1px solid rgba(191,219,254,0.8);font-size:12px;font-weight:750;white-space:nowrap}',
			'.mt-diag-dot{width:8px;height:8px;border-radius:50%;background:#0072f5;box-shadow:0 0 0 4px rgba(0,114,245,0.2)}',

			/* 动态 SVG 配置流拓扑卡片 */
			'.mt-diag-topo-card{padding:20px 24px;margin-bottom:16px}',
			'.mt-diag-topo-svg{width:100%;height:95px;display:block}',
			'@keyframes qmConfigPulse{0%{opacity:.6}50%{opacity:1}100%{opacity:.6}}',
			'.qm-cfg-stream{stroke-dasharray:7,5;animation:qmConfigDash 1.5s linear infinite}',
			'@keyframes qmConfigDash{to{stroke-dashoffset:-36}}',

			/* 表单区域精美定制 (白色毛玻璃) */
			'.mt-diag-card-head{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(226,232,240,0.7)}',
			'.mt-diag-card-head h3{font-size:16px;font-weight:750;color:#0f172a;margin:0 0 4px;display:flex;align-items:center;gap:8px}',
			'.mt-diag-card-head p{font-size:12px;color:#64748b;margin:0;line-height:1.5}',
			'.mt-diag-card .cbi-map>h2,.mt-diag-card .cbi-map-descr,.mt-diag-card .cbi-section>h3{display:none}',
			'.mt-diag-card .cbi-section{margin:0;padding:0;border:0;box-shadow:none}',
			'.mt-diag-card .cbi-section-node{padding:0}',
			'.mt-diag-card .cbi-value{padding:14px 0;border-bottom:1px solid rgba(226,232,240,0.6);display:grid;grid-template-columns:200px 1fr;align-items:center}',
			'.mt-diag-card .cbi-value:last-child{border-bottom:0}',
			'.mt-diag-card .cbi-value-title{font-size:13px;font-weight:650;color:#334155}',
			'.mt-diag-card .cbi-value-description{font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4}',
			'.mt-diag-card .cbi-input-text,.mt-diag-card select{background:rgba(255,255,255,0.85);border:1px solid rgba(203,213,225,0.8);border-radius:10px;padding:8px 14px;font-size:13px;color:#0f172a;transition:all .2s ease;width:100%;max-width:380px}',
			'.mt-diag-card .cbi-input-text:focus,.mt-diag-card select:focus{background:#fff;border-color:#0072f5;box-shadow:0 0 0 3px rgba(0,114,245,0.15);outline:none}',

			/* 保存按钮与底部导航 */
			'.mt-diag-footer{margin-top:20px;padding-top:16px;border-top:1px solid rgba(226,232,240,0.7);display:flex;justify-content:flex-end}',
			'.mt-diag-save-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:12px;font-size:13px;font-weight:750;cursor:pointer;background:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);color:#fff;border:0;box-shadow:0 4px 14px rgba(0,114,245,0.25);transition:all .2s ease}',
			'.mt-diag-save-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,114,245,0.35)}',
			'.mt-diag-back{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}',
			'.mt-diag-back-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:12px;font-size:12.5px;font-weight:650;color:#334155;background:rgba(255,255,255,0.85);border:1px solid rgba(226,232,240,0.85);text-decoration:none;transition:all .2s ease}',
			'.mt-diag-back-btn:hover{background:#fff;color:#0072f5;border-color:rgba(0,114,245,0.3);transform:translateY(-1px)}',

			/* 响应式适配 */
			'@media(max-width:720px){.mt-diag-hero{flex-direction:column;align-items:flex-start}.mt-diag-card .cbi-value{grid-template-columns:1fr;gap:6px}.mt-diag-card{padding:18px}}'
		].join(''));
	},

	/* 动态 SVG UCI 与设备实例同步链路拓扑 */
	renderSvgConfigTopo: function(section) {
		var svgStr = [
			'<svg class="mt-diag-topo-svg" viewBox="0 0 540 85">',
			'  <!-- 节点 1: UCI 配置文件 /etc/config/qmodem -->',
			'  <g transform="translate(15, 14)">',
			'    <rect x="0" y="0" width="135" height="54" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <rect x="14" y="15" width="24" height="24" rx="5" fill="#0072f5"/>',
			'    <text x="46" y="26" font-size="12" font-weight="750" fill="#0f172a">UCI Config</text>',
			'    <text x="46" y="41" font-size="10" fill="#64748b">/etc/config/qmodem</text>',
			'  </g>',
			'  <!-- 动态同步通信总线 -->',
			'  <line x1="150" y1="41" x2="225" y2="41" stroke="#0072f5" stroke-width="2.6" class="qm-cfg-stream"/>',
			'  <!-- 节点 2: QModem 守护解析器 -->',
			'  <g transform="translate(225, 14)">',
			'    <rect x="0" y="0" width="135" height="54" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="22" cy="27" r="6" fill="#10b981"/>',
			'    <text x="36" y="26" font-size="12" font-weight="750" fill="#0f172a">QModem Parser</text>',
			'    <text x="36" y="41" font-size="10" fill="#64748b">' + shown(section) + '</text>',
			'  </g>',
			'  <!-- 动态总线通道 2 -->',
			'  <line x1="360" y1="41" x2="425" y2="41" stroke="#10b981" stroke-width="2.6" class="qm-cfg-stream" style="animation-duration:1.2s;"/>',
			'  <!-- 节点 3: 模组设备实例与 AT 驱动 -->',
			'  <g transform="translate(425, 14)">',
			'    <rect x="0" y="0" width="105" height="54" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="20" cy="27" r="6" fill="#0ea5e9"/>',
			'    <text x="34" y="26" font-size="12" font-weight="750" fill="#0f172a">Modem Node</text>',
			'    <text x="34" y="41" font-size="10" fill="#64748b">Active Port</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	render: function(res) {
		var self = this;
		res = res || {};

		var warnings = (res.errors || []).map(function(msg) {
			return E('div', { 'class': 'alert-message warning' }, msg);
		});

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section)
			return E('div', { 'class': 'mt-diag-page' }, [
				this.styleNode(),
				controls.styleNode(),
				modemBar,
				E('section', { 'class': 'mt-diag-card mt-diag-hero' }, [
					E('div', {}, [
						E('h2', { 'class': 'mt-diag-title' }, _('设备参数')),
						E('p', { 'class': 'mt-diag-sub' }, _('编辑 QModem 配置（/etc/config/qmodem）中当前模组的设备参数。'))
					]),
					E('span', { 'class': 'mt-diag-badge' }, [
						E('span', { 'class': 'mt-diag-dot' }),
						'QModem'
					])
				]),
				E('div', { 'class': 'alert-message warning' },
					_('未检测到模组（请确认 QModem 已识别该设备）。'))
			].concat(warnings));

		var section = res.section;

		/* ---- QModem modem-device 配置节 ---- */
		var m = new form.Map('qmodem', section);
		var s, o;

		s = m.section(form.NamedSection, section, 'modem-device');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('启用该模组'));
		o.description = _('关闭后 QModem 将不再管理此模组。');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('模组名称 / 网络接口'));
		o.placeholder = 'wwan0';
		o.description = _('QModem 用于该模组数据接口与配置节的名称。');
		o.rmempty = true;

		o = s.option(form.Value, 'at_port', _('AT 端口'));
		o.placeholder = '/dev/ttyUSB0';
		o.description = _('QModem 下发 AT 命令使用的端口设备节点。留空则由 QModem 自动选择。');
		o.rmempty = true;

		o = s.option(form.Value, 'pdp_index', _('PDP 上下文索引'));
		o.datatype = 'uinteger';
		o.placeholder = '1';
		o.description = _('拨号使用的 PDP 上下文序号（AT+CGDCONT 的 cid）。');
		o.rmempty = true;

		o = s.option(form.DynamicList, 'modes', _('可用拨号模式'));
		o.value('ecm', 'ECM');
		o.value('ncm', 'NCM');
		o.value('rndis', 'RNDIS');
		o.value('mbim', 'MBIM');
		o.value('qmi', 'QMI');
		o.value('ppp', 'PPP');
		o.description = _('QModem 允许该模组使用的拨号模式列表，按模组实际能力显示。');
		o.rmempty = true;

		o = s.option(form.Value, 'apn', 'APN');
		o.placeholder = _('留空使用运营商默认值');
		o.description = _('与「移动数据」页共用同一份 QModem 配置。');
		o.rmempty = true;

		o = s.option(form.ListValue, 'pdp_type', _('IP 协议'));
		o.value('IPV4V6', 'IPv4 / IPv6');
		o.value('IPV4', 'IPv4');
		o.value('IPV6', 'IPv6');
		o.default = 'IPV4V6';
		o.rmempty = false;

		var saveConfig = function() {
			return m.save(null, true).then(function() {
				return uci.commit('qmodem');
			}).then(function() {
				ui.addNotification(null, E('p', {},
					_('设备参数已保存到 QModem 配置（/etc/config/qmodem），请重拨或重启模组使其生效。')));
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
			});
		};

		return m.render().then(function(formNode) {
			return E('div', { 'class': 'mt-diag-page' }, [
				self.styleNode(),
				controls.styleNode(),
				/* 背景环境漫反射光晕 */
				E('div', { 'class': 'mt-set-bg-glow1' }),
				E('div', { 'class': 'mt-set-bg-glow2' }),

				modemBar,

				/* 顶部 Hero 玻璃卡片 */
				E('section', { 'class': 'mt-diag-card mt-diag-hero' }, [
					E('div', {}, [
						E('h2', { 'class': 'mt-diag-title' }, _('设备参数')),
						E('p', { 'class': 'mt-diag-sub' }, _('编辑 QModem 配置中当前模组的设备参数（配置节：%s）。').format(shown(section)))
					]),
					E('span', { 'class': 'mt-diag-badge' }, [
						E('span', { 'class': 'mt-diag-dot' }),
						_('由 QModem 管理')
					])
				]),

				/* 动态 SVG 配置链路拓扑 */
				E('section', { 'class': 'mt-diag-card mt-diag-topo-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'),
							_('UCI 配置与设备节点映射拓扑')
						]),
						E('p', {}, _('展示 UCI 配置节、QModem 守护进程与硬件设备节点之间的同步流向。'))
					]),
					self.renderSvgConfigTopo(section)
				]),

				/* 表单卡片 (白色毛玻璃) */
				E('section', { 'class': 'mt-diag-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
							_('模组设备配置')
						]),
						E('p', {}, _('这些选项写入 /etc/config/qmodem 的 modem-device 配置节。除非自动识别有误，否则无需修改 AT 端口与拨号模式。'))
					]),
					formNode,
					E('div', { 'class': 'mt-diag-footer' }, E('button', {
						'type': 'button',
						'class': 'mt-diag-save-btn',
						'click': ui.createHandlerFn(self, saveConfig)
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'),
						_('保存设备参数')
					]))
				]),

				/* 底部返回导航 */
				E('div', { 'class': 'mt-diag-back' }, [
					E('a', { 'class': 'mt-diag-back-btn', 'href': L.url('admin/modem/qmodem-generic/system') }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>'),
						_('返回模组与 SIM')
					]),
					E('a', { 'class': 'mt-diag-back-btn', 'href': L.url('admin/modem/qmodem-generic/advanced') }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>'),
						_('返回高级设置')
					])
				])
			]);
		}).catch(function(err) {
			return E('div', { 'class': 'mt-diag-page' }, [
				self.styleNode(),
				controls.styleNode(),
				modemBar,
				E('div', { 'class': 'alert-message danger' },
					_('页面渲染失败：') + ((err && err.message) || String(err)))
			]);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
