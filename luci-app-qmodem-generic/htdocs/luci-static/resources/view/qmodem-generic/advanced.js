'use strict';
'require view';
'require ui';
'require dom';
'require qmodem-generic.controls as controls';

/*
 * 高级设置（Advanced Settings）— 现代白色毛玻璃 (Glassmorphism) + 动态硬件总线 SVG 重构
 * 数据与动作全部经由 QModem 的 `qmodem` ubus 对象（由 qmodem-generic.controls 封装）：
 *    get_disabled_features / get_reboot_caps / get_at_cfg / get_copyright /
 *    base_info / get_mode / get_network_prefer / get_lockband
 * 控制动作：do_reboot / set_mode / set_network_prefer / set_lockband / send_at。
 */

function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
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

function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	var inner = ci(raw, [ key ]);
	if (inner && typeof inner === 'object' && !Array.isArray(inner))
		return inner;
	return {};
}

function pick(map, names) {
	var v = ci(map, names);
	if (v === undefined || v === null || typeof v === 'object')
		return '';
	return String(v).trim();
}

function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

function disabledSet(raw) {
	var list = (raw && (ci(raw, [ 'disabled_features' ]) || raw)) || [];
	if (!Array.isArray(list))
		list = [];
	return list.map(function(x) { return String(x).toLowerCase().replace(/[\s_\-]/g, ''); });
}

function isDisabled(list, name) {
	return list.indexOf(String(name).toLowerCase().replace(/[\s_\-]/g, '')) !== -1;
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

var BAND_CLASS_LABEL = {
	GW: _('2G / 3G（GSM / WCDMA）'),
	LTE: _('4G LTE'),
	NRNSA: _('5G NR（NSA 非独立组网）'),
	NRSA: _('5G NR（SA 独立组网）')
};

var MODE_LABEL = {
	auto: _('自动'), ecm: 'ECM', ncm: 'NCM', rndis: 'RNDIS',
	mbim: 'MBIM', qmi: 'QMI', gobinet: 'GobiNet', ppp: 'PPP'
};

function modeLabel(key) {
	return MODE_LABEL[String(key).toLowerCase()] || String(key).toUpperCase();
}

var FEATURE_LABEL = {
	lockband: _('频段锁定'),
	neighborcell: _('邻区查询'),
	neighbourcell: _('邻区查询'),
	networkprefer: _('网络优选'),
	setnetworkprefer: _('网络优选设置'),
	getmode: _('拨号模式读取'),
	setmode: _('拨号模式切换'),
	simslot: _('SIM 卡槽切换'),
	setsimslot: _('SIM 卡槽切换'),
	setimei: _('IMEI 写入'),
	getimei: _('IMEI 读取'),
	sms: _('短信'),
	getsms: _('短信读取'),
	sendsms: _('短信发送'),
	usagestats: _('流量统计'),
	getusagestats: _('流量统计'),
	currentband: _('当前频段/载波聚合'),
	getcurrentband: _('当前频段/载波聚合'),
	networkinfo: _('网络信息'),
	dialstatus: _('拨号状态'),
	getdns: _('DNS 读取'),
	temperature: _('温度读取')
};

function featureLabel(name) {
	var key = String(name).toLowerCase().replace(/[\s_\-]/g, '');
	return FEATURE_LABEL[key] ? (FEATURE_LABEL[key] + '（' + name + '）') : String(name);
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'network', 'device', 'status', 'support' ],
	POLL_INTERVAL: 10000,

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

		var supportPromise = controls.getSupportStatus();

		return Promise.all([ supportPromise ])
		.then(function(rr) {
			var support = rr[0] || {};

			if (!section)
				return { section: null, support: support, errors: errors };

			return Promise.all([
				guard(controls.getDisabledFeatures(section), '特性支持列表', errors),
				guard(controls.getRebootCaps(section), '重启能力', errors),
				guard(controls.getAtCfg(section), 'AT 端口配置', errors),
				guard(controls.getBaseInfo(section), '基本信息', errors),
				guard(controls.getMode(section), '网络模式', errors),
				guard(controls.getNetworkPrefer(section), '网络优选', errors),
				guard(controls.getLockBand(section), '锁频段', errors),
				guard(controls.getCopyright(section), '版权信息', errors)
			]).then(function(r) {
				return {
					section: section,
					support: support,
					disabled: r[0],
					rebootCaps: r[1],
					atCfg: r[2],
					base: r[3],
					mode: r[4],
					prefer: r[5],
					lockband: r[6],
					copyright: r[7],
					errors: errors
				};
			});
		}).catch(function(err) {
			errors.push('加载失败：' + ((err && err.message) || String(err)));
			return { section: null, support: {}, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mt-hardware{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境光晕 */
			'.mt-adv-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-adv-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(14,165,233,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片通用规则 */
			'.mt-adv-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:22px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-adv-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(31,64,120,0.08),0 2px 6px rgba(0,0,0,0.04)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-hardware-head{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.mt-hardware-head h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.mt-hardware-head p{font-size:13px;color:#64748b;line-height:1.5;margin:0}',

			/* 动态 SVG 硬件总线拓扑 */
			'.mt-adv-topo-card{padding:20px 24px;margin-bottom:16px}',
			'.mt-adv-topo-svg{width:100%;height:100px;display:block}',
			'@keyframes qmBusDash{to{stroke-dashoffset:-36}}',
			'.qm-bus-stream{stroke-dasharray:7,5;animation:qmBusDash 1.4s linear infinite}',

			/* 警告与提示卡片 */
			'.mt-hardware-warning{margin-bottom:14px;color:#b45309;background:rgba(254,243,199,0.85);border:1px solid rgba(253,230,138,0.8);border-radius:14px;padding:12px 18px;font-size:12.5px;display:flex;align-items:center;gap:10px}',

			/* 控制区域与标题 */
			'.mt-control-section{margin-top:16px}',
			'.mt-control-section-head{margin-bottom:14px}',
			'.mt-control-section-head h3{font-size:16px;font-weight:750;color:#0f172a;margin:0 0 4px;display:flex;align-items:center;gap:8px}',
			'.mt-control-section-head p{font-size:12px;color:#64748b;margin:0}',
			'.mt-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}',

			/* 特性标签胶囊 */
			'.mt-hardware-caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}',
			'.mt-hardware-cap{padding:3px 10px;border-radius:999px;background:rgba(254,242,242,0.85);color:#dc2626;font-size:10.5px;font-weight:700;border:1px solid rgba(254,202,202,0.8)}',
			'.mt-hardware-cap.ok{background:rgba(236,253,245,0.85);color:#059669;border-color:rgba(167,243,208,0.8)}',

			/* 频段锁定网格卡片 */
			'.mt-hardware-bands{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px}',
			'.mt-hardware-band{padding:18px}',
			'.mt-hardware-band h4{margin:0 0 4px;font-size:14.5px;font-weight:750;color:#0f172a}',
			'.mt-hardware-band p{margin:0 0 12px;color:#64748b;font-size:11px;line-height:1.45}',
			'.mt-band-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}',
			'.mt-band-option{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:46px;padding:6px 4px;border:1px solid rgba(226,232,240,0.8);border-radius:10px;background:rgba(248,250,252,0.8);cursor:pointer;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;transition:all .15s ease;-webkit-user-select:none;user-select:none}',
			'.mt-band-option:hover{border-color:rgba(0,114,245,0.4);background:#fff}',
			'.mt-band-option.checked{border-color:#0072f5;background:#eff6ff;color:#0072f5;box-shadow:inset 0 0 0 1px #0072f5}',
			'.mt-band-option input{position:absolute;width:0;height:0;opacity:0;pointer-events:none}',
			'.mt-band-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',

			/* 底部开发者工具条 */
			'.mt-hardware-tools{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:18px}',
			'.mt-hardware-tool-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}',

			/* 终端输出视窗 (AT 控制台与详情) */
			'.mt-hardware-raw{background:#0f172a;padding:16px;border-radius:14px;color:#38bdf8;font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:360px;overflow:auto}',

			/* 响应式 */
			'@media(max-width:980px){.mt-control-grid,.mt-hardware-bands{grid-template-columns:1fr}}',
			'@media(max-width:680px){.mt-hardware-head{flex-direction:column;align-items:flex-start}.mt-hardware-tools{flex-direction:column;align-items:flex-start}.mt-hardware-tool-actions{width:100%;justify-content:flex-start}}'
		].join(''));
	},

	/* 动态 SVG 总线与硬件控制器拓扑 */
	renderSvgBusTopo: function() {
		var svgStr = [
			'<svg class="mt-adv-topo-svg" viewBox="0 0 540 86">',
			'  <!-- 节点 1: 主机处理器与总线 (Host Controller) -->',
			'  <g transform="translate(15, 14)">',
			'    <rect x="0" y="0" width="125" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <rect x="12" y="16" width="24" height="24" rx="5" fill="#0072f5"/>',
			'    <text x="44" y="27" font-size="12" font-weight="750" fill="#0f172a">Host Processor</text>',
			'    <text x="44" y="42" font-size="10" fill="#64748b">PCIe / USB 3.0</text>',
			'  </g>',
			'  <!-- 动态总线通道 1 -->',
			'  <line x1="140" y1="42" x2="215" y2="42" stroke="#0072f5" stroke-width="2.6" class="qm-bus-stream"/>',
			'  <!-- 节点 2: QModem 硬件接入与控制中枢 -->',
			'  <g transform="translate(215, 14)">',
			'    <rect x="0" y="0" width="135" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="22" cy="28" r="6" fill="#10b981"/>',
			'    <text x="36" y="27" font-size="12" font-weight="750" fill="#0f172a">QModem Bus Ctrl</text>',
			'    <text x="36" y="42" font-size="10" fill="#64748b">AT &amp; Channel Mgr</text>',
			'  </g>',
			'  <!-- 动态总线通道 2 -->',
			'  <line x1="350" y1="42" x2="415" y2="42" stroke="#10b981" stroke-width="2.6" class="qm-bus-stream" style="animation-duration:1.2s;"/>',
			'  <!-- 节点 3: 模组端基带射频硬件 -->',
			'  <g transform="translate(415, 14)">',
			'    <rect x="0" y="0" width="115" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="20" cy="28" r="6" fill="#0ea5e9"/>',
			'    <text x="34" y="27" font-size="12" font-weight="750" fill="#0f172a">Cellular Core</text>',
			'    <text x="34" y="42" font-size="10" fill="#64748b">Hardware Target</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	atRun: function(section, atPort, command, okMessage) {
		return controls.sendAt(section, atPort, command).then(function(res) {
			var text = atText(res);
			if (/ERROR/i.test(text)) {
				ui.addNotification(null, E('p', {}, _('模组拒绝了 AT 透传命令 %s：%s').format(command, text.trim())), 'warning');
				return Promise.reject(new Error(text.trim()));
			}
			ui.addNotification(null, E('p', {}, (okMessage || _('模组已接受该命令。')) + ' [' + command + ']'));
			return res;
		}, function(err) {
			ui.addNotification(null, E('p', {},
				_('本模组经 QModem 不支持 AT 透传命令 %s：%s').format(command, (err && err.message) || String(err))), 'warning');
			return Promise.reject(err);
		}).catch(function(err) { return Promise.reject(err); });
	},

	queryButton: function(section, atPort, command, re, target) {
		return E('button', {
			'type': 'button',
			'class': 'btn',
			'click': function() {
				controls.sendAt(section, atPort, command).then(function(res) {
					var text = atText(res);
					var m = re ? text.match(re) : null;
					if (m && m[1] != null) {
						target.value = String(m[1]);
						ui.addNotification(null, E('p', {}, _('已读取当前值：%s').format(m[1])));
					} else {
						ui.addNotification(null, E('p', {},
							_('模组未返回可识别的当前值（%s）：%s').format(command, text.trim() || '--')), 'warning');
					}
				}).catch(function(err) {
					ui.addNotification(null, E('p', {},
						_('读取失败（%s）：%s').format(command, (err && err.message) || String(err))), 'warning');
				});
			}
		}, _('读取当前值'));
	},

	atCard: function(section, atPort, opts) {
		var self = this;
		var input = controls.select([ [ '', _('保持不变') ] ].concat(opts.options), '');

		return controls.card(opts.title, opts.desc, [
			controls.row(opts.label, input),
			opts.note ? E('div', { 'class': 'mt-control-note' }, opts.note) : null,
			E('div', { 'class': 'mt-control-actions' }, [
				opts.query ? this.queryButton(section, atPort, opts.query, opts.queryRe, input) : null,
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button-apply',
					'click': function() {
						if (!input.value)
							return ui.addNotification(null, E('p', {}, _('请先选择一个值。')), 'warning');
						var command = opts.command(input.value);
						controls.confirmModal(opts.title,
							_('经 QModem 向模组下发 AT 透传命令 %s？该能力没有通用的 QModem 方法，模组可能拒绝执行。').format(command),
							function() { return self.atRun(section, atPort, command, opts.ok); },
							opts.restart !== false);
					}
				}, opts.apply || _('应用'))
			])
		], opts.wide);
	},

	supportCard: function(support) {
		var self = this;
		support = support || {};

		var available = String(support.available) === '1';
		var skipped = support.skipped || [];
		var missing = support.missing || [];
		var builtin = [].concat(skipped).concat(missing);
		var path = support.path || '/usr/share/qmodem/modem_support.json';

		var body = [];

		if (!available) {
			body.push(E('div', { 'class': 'mt-control-note' },
				_('未检测到 QModem 的模组支持库（%s）。请确认已安装 QModem。').format(path)));
		} else if (support.error) {
			body.push(E('div', { 'class': 'mt-control-note' },
				_('读取支持库失败：%s').format(support.error)));
		} else {
			body.push(controls.state(_('支持库路径'), path));
			body.push(controls.state(_('内置型号'), builtin.length ? builtin.join('、') : '--'));
			body.push(controls.state(_('已入库'), skipped.length ? skipped.join('、') : _('无')));
			body.push(missing.length
				? E('div', { 'class': 'mt-control-note' },
					_('以下内置型号尚未写入支持库：%s。同步后需重启 QModem 或重启设备。').format(missing.join('、')))
				: E('div', { 'class': 'mt-control-note' },
					_('内置型号均已存在于支持库中，无需同步。')));
		}

		body.push(E('div', { 'class': 'mt-control-actions' }, [
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button-apply',
				'click': function() { self.supportSync(); }
			}, _('同步支持库')),
			E('button', {
				'type': 'button',
				'class': 'btn',
				'click': function() { window.location.reload(); }
			}, _('刷新状态'))
		]));

		return controls.card(_('模组支持库'),
			_('把本插件内置的模组定义写入 QModem 支持库，用于识别新收录的型号。写入前自动备份。'),
			body, true);
	},

	supportSync: function() {
		return controls.syncSupport().then(function(res) {
			res = res || {};
			var added = res.added || [];

			if (added.length)
				ui.addNotification(null, E('p', {},
					_('已写入支持库：%s。请重启 QModem 或重启设备生效。').format(added.join('、'))));
			else if (res.error)
				ui.addNotification(null, E('p', {}, _('同步未生效：%s').format(res.error)), 'warning');
			else
				ui.addNotification(null, E('p', {}, _('支持库已是最新，本次未做修改。')));

			window.location.reload();
		}).catch(function(err) {
			ui.addNotification(null, E('p', {},
				_('同步支持库失败：%s').format((err && err.message) || String(err))), 'danger');
		});
	},

	capabilityCard: function(section, res, disabled) {
		var caps = plainObject(res.rebootCaps, 'reboot_caps');
		var soft = String(ci(caps, [ 'soft_reboot_caps', 'soft' ]) || '0') === '1';
		var hard = String(ci(caps, [ 'hard_reboot_caps', 'hard' ]) || '0') === '1';

		var chips = disabled.length
			? (res.disabled && ci(res.disabled, [ 'disabled_features' ]) || []).map(function(name) {
				return E('span', { 'class': 'mt-hardware-cap' }, featureLabel(name));
			})
			: [ E('span', { 'class': 'mt-hardware-cap ok' }, _('QModem 未报告任何被禁用的特性')) ];

		return controls.card(_('模组能力'),
			_('由 QModem 的 get_disabled_features / get_reboot_caps 上报。被禁用的特性已隐藏或降级只读。'), [
				controls.state(_('配置节'), section),
				controls.state(_('软重启（AT 复位）'), soft ? _('支持') : _('不支持')),
				controls.state(_('硬重启（断电复位）'), hard ? _('支持') : _('不支持')),
				E('div', { 'class': 'mt-hardware-caps' }, chips)
			]);
	},

	rebootCard: function(section, res) {
		var caps = plainObject(res.rebootCaps, 'reboot_caps');
		var soft = String(ci(caps, [ 'soft_reboot_caps', 'soft' ]) || '0') === '1';
		var hard = String(ci(caps, [ 'hard_reboot_caps', 'hard' ]) || '0') === '1';

		function rebootButton(method, label, cls, supported, message) {
			return E('button', {
				'type': 'button',
				'class': 'btn ' + cls,
				'disabled': supported ? null : 'disabled',
				'click': function() {
					if (!supported)
						return ui.addNotification(null, E('p', {}, _('本模组经 QModem 不支持该重启方式。')), 'warning');
					controls.confirmModal(label, message, function() {
						return controls.doReboot(section, method).catch(function(err) {
							ui.addNotification(null, E('p', {},
								_('重启模组失败：%s').format((err && err.message) || String(err))), 'danger');
							throw err;
						});
					}, true);
				}
			}, label);
		}

		return controls.card(_('模组重启'),
			_('经 QModem 的 do_reboot 重启模组。重启期间移动数据会中断，请勿断电。'), [
				E('div', { 'class': 'mt-control-actions' }, [
					rebootButton('soft', _('软重启模组'), 'cbi-button-action', soft,
						_('模组将执行软复位并重新注册网络，移动数据会中断约 30 秒。')),
					rebootButton('hard', _('硬重启模组'), 'cbi-button-negative', hard,
						_('模组将断电复位。可能同时影响 PCIe/USB 链路。'))
				]),
				(!soft && !hard) ? E('div', { 'class': 'mt-control-note' },
					_('本模组经 QModem 未上报任何可用的重启方式。')) : null
			]);
	},

	modeCard: function(section, modeRaw, disabled) {
		if (isDisabled(disabled, 'setmode'))
			return controls.card(_('网络模式'), _('模组对外呈现的拨号模式。'), [
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用拨号模式切换。'))
			]);

		var mode = plainObject(modeRaw, 'mode');
		var keys = Object.keys(mode);
		var active = '';
		keys.forEach(function(k) { if (String(mode[k]) === '1') active = k; });
		[ 'ecm', 'ncm' ].forEach(function(k) { if (keys.indexOf(k) === -1) keys.push(k); });

		var buttons = keys.map(function(k) {
			var isActive = (String(k).toLowerCase() === String(active).toLowerCase());
			return E('button', {
				'type': 'button',
				'class': 'btn ' + (isActive ? 'cbi-button-apply' : 'cbi-button-action'),
				'disabled': isActive ? 'disabled' : null,
				'click': function() {
					controls.confirmModal(_('切换网络模式'),
						_('将模组拨号模式切换为 %s？切换过程中移动数据会短暂中断。').format(modeLabel(k)),
						function() {
							return controls.setMode(section, k).catch(function(err) {
								ui.addNotification(null, E('p', {},
									_('切换网络模式失败：%s').format((err && err.message) || String(err))), 'danger');
								throw err;
							});
						}, true);
				}
			}, isActive ? _('当前：%s').format(modeLabel(k)) : _('切换为 %s').format(modeLabel(k)));
		});

		return controls.card(_('网络模式'),
			_('模组对外呈现的拨号模式（由 QModem get_mode / set_mode 提供）。'), [
				controls.state(_('当前模式'), active ? modeLabel(active) : '--'),
				keys.length ? E('div', { 'class': 'mt-control-actions' }, buttons)
					: E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 未上报可用的网络模式。'))
			]);
	},

	preferCard: function(section, preferRaw, disabled) {
		if (isDisabled(disabled, 'networkprefer') || isDisabled(disabled, 'setnetworkprefer'))
			return controls.card(_('网络优选'), _('选择模组允许驻网的制式。'), [
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用网络优选。'))
			]);

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
			_('选择模组允许驻网的制式（由 QModem get_network_prefer / set_network_prefer 提供）。至少保留一项。'), [
				E('div', { 'class': 'mt-band-options' }, options),
				E('div', { 'class': 'mt-control-actions' }, E('button', {
					'type': 'button', 'class': 'btn cbi-button-apply',
					'click': function() {
						var checked = keys.filter(function(k) { return boxes[k] && boxes[k].checked; });
						if (!checked.length)
							return ui.addNotification(null, E('p', {}, _('请至少选择一种网络制式。')), 'warning');
						controls.confirmModal(_('修改网络优选'),
							_('将允许驻网的制式设置为 %s？移动数据会短暂中断。').format(checked.join(' / ')),
							function() {
								return controls.setNetworkPrefer(section, JSON.stringify(checked)).catch(function(err) {
									ui.addNotification(null, E('p', {},
										_('设置网络优选失败：%s').format((err && err.message) || String(err))), 'danger');
									throw err;
								});
							}, true);
					}
				}, _('应用网络优选')))
			]);
	},

	lockBandPanel: function(section, bandClass, data) {
		var label = BAND_CLASS_LABEL[bandClass] || bandClass;
		var available = bandItems(ci(data, [ 'available_band', 'availableband', 'bands' ]));
		var locked = bandItems(ci(data, [ 'lock_band', 'lockband', 'locked_band' ]));
		var lockedIds = {};
		locked.forEach(function(item) { lockedIds[item.id] = true; });

		if (!available.length) {
			available = locked.slice();
			if (!available.length)
				return E('section', { 'class': 'mt-adv-card mt-hardware-band' }, [
					E('h4', {}, label),
					E('p', {}, _('本模组经 QModem 未上报该类别的可用频段。'))
				]);
		}

		var boxes = [];
		var options = available.map(function(item) {
			var box = E('input', {
				'type': 'checkbox',
				'value': item.id,
				'checked': lockedIds[item.id] ? 'checked' : null
			});
			var lbl = E('label', { 'class': 'mt-band-option' + (lockedIds[item.id] ? ' checked' : '') }, [ box, E('span', {}, item.name) ]);
			box.addEventListener('change', function() {
				lbl.classList[box.checked ? 'add' : 'remove']('checked');
			});
			boxes.push(box);
			return lbl;
		});

		return E('section', { 'class': 'mt-adv-card mt-hardware-band' }, [
			E('h4', {}, label),
			E('p', {}, _('已锁定 %d 个频段，共 %d 个可用频段。不勾选任何频段表示解除锁定。')
				.format(locked.length, available.length)),
			E('div', { 'class': 'mt-band-options' }, options),
			E('div', { 'class': 'mt-band-actions' }, [
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() {
						boxes.forEach(function(b) { b.checked = false; b.parentElement.classList.remove('checked'); });
					}
				}, _('清空')),
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() {
						boxes.forEach(function(b) { b.checked = true; b.parentElement.classList.add('checked'); });
					}
				}, _('全选')),
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-apply',
					'click': function() {
						var csv = boxes.filter(function(b) { return b.checked; })
							.map(function(b) { return b.value; }).join(',');
						controls.confirmModal(_('应用频段锁定'),
							csv ? _('将 %s 锁定到频段 %s？移动数据会短暂中断。').format(label, csv)
								: _('解除 %s 的频段锁定？').format(label),
							function() {
								return controls.setLockBand(section, { band_class: bandClass, lock_band: csv })
									.catch(function(err) {
										ui.addNotification(null, E('p', {},
											_('设置频段锁定失败：%s').format((err && err.message) || String(err))), 'danger');
										throw err;
									});
							}, true);
					}
				}, _('应用锁定'))
			])
		]);
	},

	lockBandSection: function(section, lockRaw, disabled) {
		var head = E('div', { 'class': 'mt-control-section-head' }, [
			E('h3', {}, _('频段锁定')),
			E('p', {}, _('限制模组可使用的频段（由 QModem get_lockband / set_lockband 提供）。日常使用建议保持不锁定。'))
		]);

		if (isDisabled(disabled, 'lockband'))
			return E('section', { 'class': 'mt-control-section' }, [
				head,
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用频段锁定。'))
			]);

		var lockband = plainObject(lockRaw, 'lockband');
		var classes = [ 'GW', 'LTE', 'NRNSA', 'NRSA' ].filter(function(k) {
			return lockband[k] && typeof lockband[k] === 'object';
		});
		Object.keys(lockband).forEach(function(k) {
			if (classes.indexOf(k) === -1 && lockband[k] && typeof lockband[k] === 'object')
				classes.push(k);
		});

		if (!classes.length)
			return E('section', { 'class': 'mt-control-section' }, [
				head,
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 暂无可用的锁频段数据。'))
			]);

		var self = this;
		return E('section', { 'class': 'mt-control-section' }, [
			head,
			E('div', { 'class': 'mt-hardware-bands' }, classes.map(function(k) {
				return self.lockBandPanel(section, k, lockband[k]);
			}))
		]);
	},

	passthroughCard: function(section, atPort) {
		var input = E('input', { 'class': 'cbi-input-text', 'placeholder': 'AT^SETMODE?' });
		var output = E('pre', { 'class': 'mt-hardware-raw', 'style': 'margin-top:12px;max-height:220px' },
			_('尚未下发命令。'));

		return controls.card(_('AT 透传控制台'),
			_('经 QModem 的 send_at 向模组下发任意 AT 命令，用于模块私有设置与调试。'), [
				controls.row(_('AT 命令'), input),
				E('div', { 'class': 'mt-control-actions' }, E('button', {
					'type': 'button', 'class': 'btn cbi-button-action',
					'click': function() {
						var command = (input.value || '').trim();
						if (!command)
							return ui.addNotification(null, E('p', {}, _('请输入 AT 命令。')), 'warning');
						dom.content(output, _('正在下发，请稍候…'));
						controls.sendAt(section, atPort, command).then(function(r) {
							dom.content(output, atText(r) || _('模组未返回内容。'));
						}).catch(function(err) {
							dom.content(output, _('下发失败：%s').format((err && err.message) || String(err)));
						});
					}
				}, _('下发命令'))),
				output
			], true);
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
		var warnings = (res.errors || []).map(function(msg) {
			return E('div', { 'class': 'alert-message warning mt-hardware-warning' }, msg);
		});

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section)
			return E('div', { 'class': 'mt-hardware' }, [].concat(
				[ this.styleNode(), controls.styleNode() ],
				warnings,
				[ modemBar,
				E('section', { 'class': 'mt-adv-card mt-hardware-head' }, [
					E('div', {}, [
						E('h2', {}, _('高级设置')),
						E('p', {}, _('模组能力、重启与无线策略，全部经 QModem 的 qmodem ubus 下发。'))
					])
				]),
				E('div', { 'class': 'alert-message warning mt-hardware-warning' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')),
				E('section', { 'class': 'mt-control-section' }, [
					E('div', { 'class': 'mt-control-section-head' }, [
						E('h3', {}, _('模组支持库')),
						E('p', {}, _('QModem 依赖模组支持库识别模组型号。若本模组尚未被 QModem 收录，可在此写入内置定义。'))
					]),
					E('div', { 'class': 'mt-control-grid' }, [
						this.supportCard(res.support)
					])
				]) ]
			));

		var section = res.section;
		var disabled = disabledSet(res.disabled);
		var atCfg = plainObject(res.atCfg, 'at_cfg');
		var atPort = pick(atCfg, [ 'at_port' ]) || controls.findEntry(controls.entryList(res.base), 'at_port') || '';
		var baseMap = controls.entryMap(controls.entryList(res.base));
		var cr = plainObject(res.copyright, 'copyright');

		var rawDump;
		try {
			rawDump = JSON.stringify({
				config_section: section,
				disabled_features: res.disabled,
				reboot_caps: res.rebootCaps,
				at_cfg: res.atCfg,
				base_info: res.base,
				mode: res.mode,
				network_prefer: res.prefer,
				lockband: res.lockband,
				copyright: res.copyright
			}, null, 2);
		} catch (e) {
			rawDump = _('无法序列化 QModem 返回数据。');
		}

		return E('div', { 'class': 'mt-hardware' }, [
			this.styleNode(),
			controls.styleNode(),
			/* 背景环境光晕 */
			E('div', { 'class': 'mt-adv-bg-glow1' }),
			E('div', { 'class': 'mt-adv-bg-glow2' }),

			modemBar,

			/* 顶部 Hero 玻璃卡片 */
			E('section', { 'class': 'mt-adv-card mt-hardware-head' }, [
				E('div', {}, [
					E('h2', {}, _('高级设置与硬件控制')),
					E('p', {}, _('硬件总线模式、重启能力、驻网策略与底层 AT 透传调试。'))
				])
			])
		].concat(warnings).concat([
			/* 动态 SVG 硬件总线拓扑 */
			E('section', { 'class': 'mt-adv-card mt-adv-topo-card' }, [
				E('div', { 'class': 'mt-control-section-head', 'style': 'margin-bottom:10px' }, [
					E('h3', {}, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'),
						_('硬件总线与数据通路架构')
					]),
					E('p', {}, _('主机处理器、QModem 守护进程与模组蜂窝核心交互链路'))
				]),
				this.renderSvgBusTopo()
			]),

			E('div', { 'class': 'mt-hardware-warning' }, [
				svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'),
				_('修改硬件接口档位可能同时中断移动数据与模组管理通道。应用前请记录当前取值。')
			]),

			/* 模组支持库 */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('模组支持库')),
					E('p', {}, _('QModem 依赖模组支持库识别模组型号；本插件内置的型号定义可一键写入。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.supportCard(res.support)
				])
			]),

			/* 模组能力与重启 */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('模组能力与维护')),
					E('p', {}, _('QModem 上报的特性支持情况与重启能力。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.capabilityCard(section, res, disabled),
					this.rebootCard(section, res)
				])
			]),

			/* 无线策略 (模式与优选) */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('无线策略')),
					E('p', {}, _('拨号模式与驻网制式，使用 QModem 的专用方法下发。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.modeCard(section, res.mode, disabled),
					this.preferCard(section, res.prefer, disabled)
				])
			]),

			/* 频段锁定 */
			this.lockBandSection(section, res.lockband, disabled),

			/* 专有硬件设置 (AT 透传) */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('模块专有硬件设置（AT 透传）')),
					E('p', {}, _('以下能力在 QModem 中没有通用方法，只能经 send_at 以模块私有 AT 命令下发；可点击「读取当前值」向模组查询。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.atCard(section, atPort, {
						title: _('USB 数据模式'),
						desc: _('模组对主机呈现的 USB 网络驱动档位。'),
						label: _('USB 模式'),
						options: [
							[ '0', 'Linux ECM' ], [ '1', 'Windows NCM' ], [ '2', 'Linux ECM · Debug' ],
							[ '3', 'Windows NCM · Debug' ], [ '4', 'Linux NCM' ], [ '5', 'Linux NCM · Debug' ],
							[ '6', 'Windows RNDIS' ], [ '8', 'PPP' ]
						],
						query: 'AT^SETMODE?',
						queryRe: /\^SETMODE:\s*(\d+)/,
						command: function(v) { return 'AT^SETMODE=' + v; },
						apply: _('应用 USB 模式'),
						ok: _('USB 模式命令已被接受。'),
						note: _('切换后 USB 接口会重新枚举，管理通道可能短暂中断。')
					}),
					this.atCard(section, atPort, {
						title: _('PCIe 以太网控制器'),
						desc: _('模组侧 PCIe 以太网数据通路开关。'),
						label: _('PCIe 控制器'),
						options: [ [ '1', _('启用') ], [ '0', _('禁用') ] ],
						query: 'AT^TDPMCFG?',
						queryRe: /\^TDPMCFG:\s*(\d+)/,
						command: function(v) { return 'AT^TDPMCFG=' + v; },
						apply: _('应用 PCIe 控制器'),
						ok: _('PCIe 控制器命令已被接受。')
					}),
					this.atCard(section, atPort, {
						title: _('PCIe 以太网 PHY 档位'),
						desc: _('使 PHY 档位与以太网控制器匹配。'),
						label: _('PHY 档位'),
						options: [ [ '1', 'RTL8111 · 1 Gbps' ], [ '2', 'RTL8125 · 2.5 Gbps' ] ],
						query: 'AT^TDPCIELANCFG?',
						queryRe: /\^TDPCIELANCFG:\s*(\d+)/,
						command: function(v) { return 'AT^TDPCIELANCFG=' + v; },
						apply: _('应用 PHY 档位'),
						ok: _('PHY 档位命令已被接受。'),
						note: _('此处选择的是硬件 PHY 档位。')
					}),
					this.atCard(section, atPort, {
						title: _('SIM 热插拔'),
						desc: _('物理 SIM 卡插拔检测行为。'),
						label: _('SIM 热插拔'),
						options: [ [ '1', _('启用') ], [ '0', _('禁用') ] ],
						query: 'AT^TDSIMHP?',
						queryRe: /\^TDSIMHP:\s*(\d+)/,
						command: function(v) { return 'AT^TDSIMHP=' + v; },
						apply: _('应用 SIM 热插拔'),
						ok: _('SIM 热插拔命令已被接受。'),
						restart: false
					}),
					this.atCard(section, atPort, {
						title: _('热保护轮询'),
						desc: _('模组内置温度保护的轮询开关与周期。'),
						label: _('轮询周期'),
						options: [ [ '1', '1 s' ], [ '2', '2 s' ], [ '3', '3 s' ], [ '5', '5 s' ],
							[ '10', '10 s' ], [ '30', '30 s' ], [ '60', '60 s' ] ],
						query: 'AT^THERMAUTOFUN?',
						queryRe: /\^THERMAUTOFUN:\s*\d+[,\s]+\d+[,\s]+(\d+)/,
						command: function(v) { return 'AT^THERMAUTOFUN=1,1,' + v; },
						apply: _('应用热保护设置'),
						ok: _('热保护命令已被接受。'),
						note: _('日常使用请保持热保护开启。当前模组温度：%s').format(shown(controls.normalizeTemperature(baseMap['temperature']))),
						restart: false
					}),
					this.passthroughCard(section, atPort)
				])
			]),

			/* 诊断与开发者工具 */
			E('section', { 'class': 'mt-adv-card mt-hardware-tools' }, [
				E('div', {}, [
					E('h3', { 'style': 'margin:0 0 4px;font-size:15px;font-weight:750;color:#0f172a' }, _('诊断与开发者工具')),
					E('p', { 'style': 'margin:0;color:#64748b;font-size:12px' }, _('查看模组设备参数，或直接向模组发送 AT 命令。'))
				]),
				E('div', { 'class': 'mt-hardware-tool-actions' }, [
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/qmodem-generic/settings') }, _('设备参数设置')),
					E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/modem/qmodem-generic/terminal') }, _('AT 控制台')),
					E('button', {
						'type': 'button', 'class': 'btn',
						'click': function() { window.location.reload(); }
					}, _('刷新状态'))
				])
			]),

			/* 调试技术细节折叠栏 */
			E('details', { 'class': 'mt-adv-card', 'style': 'margin-top:16px' }, [
				E('summary', { 'style': 'cursor:pointer;font-size:13.5px;font-weight:750;color:#0f172a;list-style:none;display:flex;justify-content:space-between;align-items:center' }, [
					E('span', { 'style': 'display:flex;align-items:center;gap:8px' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'),
						_('技术细节（QModem 原始数据）')
					]),
					E('span', { 'style': 'font-size:18px;color:#94a3b8;font-weight:700' }, '›')
				]),
				E('pre', { 'class': 'mt-hardware-raw', 'style': 'margin-top:12px' }, rawDump || _('无响应。'))
			])
		]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
