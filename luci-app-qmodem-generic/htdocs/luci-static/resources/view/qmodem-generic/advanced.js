'use strict';
'require view';
'require ui';
'require dom';
'require qmodem-generic.controls as controls';
'require qmodem-generic.theme as theme';

var E = controls.element;

/*
 * 高级设置 — 外观配色、硬件连接、能力诊断与专有设置。
 * 数据与动作全部经由 QModem 的 `qmodem` ubus 对象（由 qmodem-generic.controls 封装）：
 *    get_disabled_features / get_reboot_caps / get_at_cfg / get_copyright /
 *    base_info / get_copyright
 * 外观仅保存于浏览器；专有硬件设置仍经 send_at 下发。
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
			if (keys[j].toLowerCase().replace(/[\s_\-]/g, '') === want && controls.hasValue(obj[keys[j]]))
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

/* 只展示确实上报的频段：旧 QModem / 未填写型号可返回 null、"0"、
 * nullnullnullnull 等无效内容。不能把 DOM 空节点当作文字输出。 */
function supportedBandText(value) {
	if (value === null || value === undefined || value === false) return '';
	var raw = String(value).trim();
	if (!raw || /^(?:0|n\/a|none|unknown|undefined|null)+$/i.test(raw)) return '';
	/* 官方定义以数字或 / 分隔，也允许厂商标记 N78/B3；不展示错误对象。 */
	if (!/^[0-9a-zA-Z/,+\s-]+$/.test(raw) || /null|undefined|nan/i.test(raw)) return '';
	return raw;
}


function disabledSet(raw) {
	var list = (raw && (ci(raw, [ 'disabled_features' ]) || raw)) || [];
	if (!Array.isArray(list))
		list = [];
	return list.map(function(x) { return String(x).toLowerCase().replace(/[\s_\-]/g, ''); });
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
	return FEATURE_LABEL[key] || String(name);
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'network', 'device', 'status', 'support' ],
	/* 支持库/硬件拓扑不需要每十秒重建一次；普通模组状态仍来自已有缓存。 */
	POLL_INTERVAL: 90000,
	AUX_CACHE_MS: 120000,

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
			self.section = ctx.section;
			/* 大型 JSON 支持库和串口映射通过单独 Promise 后台加载，不阻塞首屏。 */
			self.initialAuxPromise = self.loadAuxiliary();
			return self.collect(ctx, true);
		});
	},

	loadAuxiliary: function() {
		var self = this, now = Date.now();
		if (this.auxPromise && now - (this.auxUpdated || 0) < this.AUX_CACHE_MS)
			return this.auxPromise;
		this.auxUpdated = now;
		var errors = [];
		this.auxPromise = Promise.all([
			guard(controls.getSupportStatus(), '模组支持库', errors),
			guard(controls.getSupportPorts(), '串口映射', errors),
			guard(controls.getCustomModels(), '自定义型号', errors)
		]).then(function(values) {
			self.auxData = {
				support: values[0] || {},
				ports: values[1] || { ports: [] },
				custom: values[2] || { entries: [], presets: {} },
				errors: errors
			};
			return self.auxData;
		});
		return this.auxPromise;
	},

	collect: function(ctx, quick) {
		var section = ctx.section, self = this;
		var aux = quick
			? Promise.resolve(this.auxData || {
				support: {}, ports: { ports: [] },
				custom: { entries: [], presets: {}, loading: true }, errors: []
			})
			: this.loadAuxiliary();
		return aux.then(function(meta) {
			if (!section) return {
				section: null, support: meta.support, ports: meta.ports, custom: meta.custom,
				errors: (meta.errors || []).slice()
			};
			var errors = (meta.errors || []).slice();
			return Promise.all([
				guard(controls.getDisabledFeatures(section), '特性支持列表', errors),
				guard(controls.getRebootCaps(section), '重启能力', errors),
				guard(controls.getAtCfg(section), 'AT 端口配置', errors),
				guard(controls.getBaseInfo(section), '基本信息', errors),
				guard(controls.getCopyright(section), '版权信息', errors)
			]).then(function(result) {
				return {
					section: section, support: meta.support,
					ports: meta.ports, custom: meta.custom,
					disabled: result[0], rebootCaps: result[1], atCfg: result[2],
					base: result[3], copyright: result[4], errors: errors
				};
			});
		}).catch(function(err) {
			return {
				section: section, support: {}, ports: { ports: [] },
				custom: { entries: [], presets: {}, loading: true },
				errors: [ '读取高级设置失败：' + ((err && err.message) || String(err)) ]
			};
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.qm-app{--qm-glass-bg:var(--qm-glass);--qm-glass-border:var(--qm-border);--qm-glass-shadow:var(--qm-shadow-md);--qm-primary:var(--qm-accent);--qm-success:var(--qm-ok);--qm-warning:var(--qm-warn)}',
			'.mt-hardware{position:relative;max-width:1160px;margin:0 auto;color:var(--qm-text);padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境光晕 */
			'.mt-adv-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:var(--qm-glow-a);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-adv-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:var(--qm-glow-b);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片通用规则 */
			'.mt-adv-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:22px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-adv-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px var(--qm-shadow-color),0 2px 6px var(--qm-shadow-color)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-hardware-head{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:var(--qm-surface-gradient)}',
			'.mt-hardware-head h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:var(--qm-hero-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.mt-hardware-head p{font-size:13px;color:var(--qm-text-muted);line-height:1.5;margin:0}',

			/* 动态 SVG 硬件总线拓扑 */
			'.mt-adv-topo-card{padding:20px 24px;margin-bottom:16px}',

			/* 警告与提示卡片 */
			'.mt-hardware-warning{margin-bottom:14px;color:var(--qm-warn);background:var(--qm-warn-soft);border:1px solid var(--qm-warn-border);border-radius:14px;padding:12px 18px;font-size:12.5px;display:flex;align-items:center;gap:10px}',

			/* 控制区域与标题 */
			'.mt-control-section{margin-top:16px}',
			'.mt-control-section-head{margin-bottom:14px}',
			'.mt-control-section-head h3{font-size:16px;font-weight:750;color:var(--qm-text);margin:0 0 4px;display:flex;align-items:center;gap:8px}',
			'.mt-control-section-head p{font-size:12px;color:var(--qm-text-muted);margin:0}',
			'.mt-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}',

			/* 特性标签胶囊 */
			'.mt-hardware-caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}',
			'.mt-hardware-cap{padding:3px 10px;border-radius:999px;background:var(--qm-danger-soft);color:var(--qm-danger);font-size:10.5px;font-weight:700;border:1px solid var(--qm-danger-border)}',
			'.mt-hardware-cap.ok{background:var(--qm-ok-soft);color:var(--qm-ok);border-color:var(--qm-ok-border)}',

			/* 底部开发者工具条 */
			'.mt-hardware-tools{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:18px}',
			'.mt-hardware-tool-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}',

			/* 终端输出视窗 (AT 控制台与详情) */
			'.mt-hardware-raw{background:var(--qm-surface-3);padding:16px;border-radius:14px;color:var(--qm-accent-2);font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:360px;overflow:auto}',
			'.qm-port-list{display:grid;gap:8px}.qm-port-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--qm-border-soft);border-radius:10px;background:var(--qm-surface-2)}',
			'.qm-port-main{min-width:0;display:grid;gap:4px}.qm-port-main strong{font-size:13px;overflow-wrap:anywhere}.qm-port-main small{color:var(--qm-text-muted);font-size:11px;overflow-wrap:anywhere}',
			'.qm-port-actions{display:flex;flex-wrap:wrap;gap:8px}.qm-port-actions button{white-space:nowrap}.qm-custom-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}',
			'.qm-protocols{display:flex;flex-wrap:wrap;gap:8px}.qm-protocol-check{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--qm-border-soft);border-radius:9px;background:var(--qm-surface-2);font-size:12px;cursor:pointer}.qm-protocol-check input{margin:0}.qm-protocol-check.disabled{opacity:.45;cursor:not-allowed}.qm-custom-form .qm-template-note{font-size:11px;line-height:1.5;color:var(--qm-text-muted);margin-top:6px}.qm-custom-band-note{grid-column:1/-1;color:var(--qm-text-muted);font-size:11px;padding:4px 0 12px}',
			'.qm-custom-entry{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--qm-border-soft);padding:9px 0;font-size:12px}',

			/* 响应式 */
			'.mt-support-detail{border:1px solid var(--qm-border-soft);border-radius:10px;background:var(--qm-surface-2);padding:10px 13px;color:var(--qm-text-muted);font-size:12px}.mt-support-detail .mt-control-state:last-child{border-bottom:0}',
			'@media(max-width:980px){.mt-control-grid,.qm-custom-form{grid-template-columns:1fr}}',
			'@media(max-width:700px){.qm-port-row{align-items:flex-start;flex-direction:column}.qm-port-actions{width:100%}}',
			'@media(max-width:680px){.mt-hardware-head{flex-direction:column;align-items:flex-start}.mt-hardware-tools{flex-direction:column;align-items:flex-start}.mt-hardware-tool-actions{width:100%;justify-content:flex-start}}'
		].join(''));
	},

	/* 自适应节点使用文本排版，长名称和手机竖屏均不会截字。 */
	renderBusTopo: function() {
		return theme.topology([
			{ title: _('主机系统'), sub: _('USB / PCIe 硬件连接') },
			{ title: _('QModem 管理服务'), sub: _('指令交互与通道管理') },
			{ title: _('蜂窝通信模组'), sub: _('移动网络接入') }
		]);
	},

	appearanceCard: function() {
		var appearance = theme.getAppearance();
		var tone = controls.select([
			[ 'auto', _('跟随系统主题') ], [ 'light', _('浅色') ], [ 'dark', _('深色') ]
		], appearance.tone);
		tone.setAttribute('aria-label', _('明暗模式'));
		var status = E('p', { 'class': 'qm-appearance-status', 'role': 'status' },
			_('选择后立即生效，并记住当前浏览器的选择。'));
		var buttons = [];
		var start = E('input', { 'type': 'color', 'value': appearance.customStart, 'aria-label': _('渐变起始颜色') });
		var end = E('input', { 'type': 'color', 'value': appearance.customEnd, 'aria-label': _('渐变结束颜色') });
		function save() {
			appearance.tone = tone.value;
			appearance.customStart = start.value;
			appearance.customEnd = end.value;
			var persisted = theme.setAppearance(appearance);
			buttons.forEach(function(button) {
				var selected = button.getAttribute('data-palette') === appearance.palette;
				button.classList.toggle('is-selected', selected);
				button.setAttribute('aria-pressed', String(selected));
			});
			status.textContent = persisted ? _('外观设置已保存到当前浏览器。') : _('外观已应用，当前浏览器未允许保存设置。');
		}
		function saveColors() { appearance.palette = 'custom'; save(); }
		buttons = theme.palettes().map(function(palette) {
			return E('button', {
				'type': 'button', 'class': 'qm-palette-option' + (appearance.palette === palette.id ? ' is-selected' : ''),
				'data-palette': palette.id, 'aria-pressed': String(appearance.palette === palette.id),
				'style': '--qm-preview-gradient:' + palette.gradient,
				'click': function() { appearance.palette = palette.id; save(); }
			}, [
				E('span', { 'class': 'qm-palette-swatch', 'aria-hidden': 'true' }),
				E('strong', {}, _(palette.name)), E('small', {}, _(palette.sub))
			]);
		});
		tone.addEventListener('change', save);
		start.addEventListener('change', saveColors);
		end.addEventListener('change', saveColors);
		var card = controls.card(_('外观主题'), _('设置移动网络页面的配色与明暗模式。'), [
			E('div', { 'class': 'qm-appearance-options', 'role': 'group', 'aria-label': _('页面配色') }, buttons),
			E('div', { 'class': 'qm-custom-colors' }, [
				E('label', {}, [ _('渐变起点'), start ]), E('label', {}, [ _('渐变终点'), end ])
			]),
			controls.row(_('明暗模式'), tone), status
		], true);
		card.classList.add('qm-appearance-card');
		return card;
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

	supportCard: function(support, custom) {
		/* 官方 QModem 当前支持库：只读查询 */
		support = support || {};
		var raw = (custom || {}).presets || {}, lib = raw.modem_support || raw, entries = [];
		[ 'usb', 'pcie' ].forEach(function(bus) {
			Object.keys(lib[bus] || {}).sort().forEach(function(model) {
				entries.push({ bus: bus, model: model, data: lib[bus][model] });
			});
		});
		var selector = E('select', { 'class': 'cbi-input-select', 'style': 'width:100%;margin-top:8px' }, [
			E('option', { 'value': '' }, entries.length ? _('选择型号查看配置（只读）') : (custom && custom.loading ? _('支持库正在后台读取…') : _('未获取到 QModem 支持库内容')))
		].concat(entries.map(function(item, i) {
			return E('option', { 'value': String(i) },
				(item.bus === 'pcie' ? 'PCIe · ' : 'USB · ') + item.model.toUpperCase());
		})));
		selector.disabled = !entries.length;
		var details = E('div', { 'class': 'mt-support-detail', 'style': 'margin-top:10px' },
			_('此处仅用于查看 QModem 型号定义。'));
		selector.addEventListener('change', function() {
			var index = parseInt(selector.value, 10), item = entries[index];
			if (!item) { dom.content(details, _('选择型号查看 QModem 当前配置。')); return; }
			var d = item.data || {}, rows = [
				controls.state(_('厂商'), d.manufacturer),
				controls.state(_('芯片平台'), d.platform),
				controls.state(_('拨号协议'), Array.isArray(d.modes) && d.modes.length ? d.modes.join(', ') : null),
				/* 数字 0 是部分模组有效的 PDP 序号，必须保留 */
				controls.state(_('PDP 序号'), d.pdp_index)
			];
			[
				[ _('3G WCDMA 频段'), d.wcdma_band ],
				[ _('4G LTE 频段'), d.lte_band ],
				[ _('5G NSA 频段'), d.nsa_band ],
				[ _('5G SA 频段'), d.sa_band ]
			].forEach(function(field) {
				var band = supportedBandText(field[1]);
				if (band) rows.push(controls.state(field[0], band));
			});
			/* 不给 dom.content() 传 null；避免某些 LuCI 版本渲染为字面文本。 */
			dom.content(details, rows.filter(function(node) { return node != null; }));
		});
		return controls.card(_('QModem 官方支持库（只读）'),
			_('查看当前 QModem 支持库的 USB / PCIe 型号；已同步的自定义型号也会显示在此，不能直接改动官方原生条目。'), [
				controls.state(_('支持库路径'), support.path || '/usr/share/qmodem/modem_support.json'),
				controls.state(_('收录型号数量'), String(entries.length)),
				selector, details
			], true);
	},

	customLibraryCard: function(support, custom) {
		var self = this;
		support = support || {};
		var entries = Array.isArray(custom && custom.entries) ? custom.entries : [];
		var loading = !!(custom && custom.loading);
		var saved = entries.filter(function(x) { return x.state === 'synced'; });
		var missing = entries.filter(function(x) { return x.state === 'missing'; });
		var conflicts = entries.filter(function(x) { return x.state === 'conflict'; });
		function names(items) {
			return items.map(function(x) {
				return (x.bus === 'pcie' ? 'PCIe ' : 'USB ') + String(x.model || '').toUpperCase();
			}).join('、') || _('无');
		}
		return controls.card(_('自定义模组库'),
			_('插件内置预设 JSON + 用户持久化 JSON；修改自定义型号时自动备份，并同步更新 QModem 支持库。'), [
				controls.state(_('内置预设路径'), '/usr/share/qmodem-generic/extra_modem_support.json'),
				controls.state(_('用户配置路径'), '/etc/qmodem-generic/modems/{usb,pcie}/*.json'),
				controls.state(_('自定义库型号'), loading ? _('正在后台读取…') : names(entries)),
				controls.state(_('已同步的自定义型号'), loading ? _('正在后台读取…') : names(saved)),
				missing.length ? E('div', { 'class': 'mt-control-note' },
					_('未同步：%s。点击同步可以补录到 QModem。').format(names(missing))) : null,
				conflicts.length ? E('div', { 'class': 'mt-control-note' },
					_('冲突（不允许覆盖）：%s。QModem 已有同名但定义不同的型号。').format(names(conflicts))) : null,
				!loading && !missing.length && !conflicts.length ? E('div', { 'class': 'mt-control-note' },
					_('全部自定义定义已写入 QModem 支持库。')) : null,
				E('div', { 'class': 'mt-control-actions' }, [
					E('button', { 'type':'button', 'class':'btn cbi-button-apply',
						'click': function() { self.supportSync(); } }, _('同步自定义库')),
					E('button', { 'type':'button', 'class':'btn',
						'click': function() { window.location.reload(); } }, _('刷新状态'))
				])
			], true);
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

	usePortForCustom: function(port) {
		var model = String(port.model || '').trim();
		this.customDraft = Object.assign(this.customDraft || {}, {
			edit: '0',
			bus: port.bus,
			manufacturer_id: port.bus === 'usb' ? String(port.id || '').split(':')[0] : '',
			model: /^[a-z0-9-]+$/i.test(model) ? model.toLowerCase() : ''
		});
		if (typeof this.fillCustomForm === 'function') this.fillCustomForm(this.customDraft);
		ui.addNotification(null, E('p', {}, _('已把设备信息填入自定义配置，请核对型号与拨号协议。')));
	},

	portCard: function(data) {
		var self = this;
		var ports = Array.isArray(data && data.ports) ? data.ports : [];
		var rows = ports.map(function(port) {
			var title = E('strong', {}, port.model || _('型号待读取'));
			return E('div', { 'class': 'qm-port-row' }, [
				E('div', { 'class': 'qm-port-main' }, [
					title,
					E('small', {}, (port.port || '') + ' · ' + (port.bus === 'pcie' ? 'PCIe' : 'USB') +
						' · ' + (port.id || _('ID 未知')) + ' · ' + (port.location || '') +
						' · ' + (port.confirmed ? _('QModem 已确认 AT 口') : _('候选串口，需验证 AT 功能')))
				]),
				E('div', { 'class': 'qm-port-actions' }, [
					!port.confirmed ? E('button', { 'type': 'button', 'class': 'btn', 'click': function(ev) {
						var button = ev.currentTarget;
						button.disabled = true;
						controls.probeSupportPort(port.port).then(function(result) {
							if (!result || !result.success) throw new Error((result && result.error) || _('读取失败'));
							title.textContent = port.model = result.model;
							self.usePortForCustom(port);
						}).catch(function(err) {
							ui.addNotification(null, E('p', {}, _('读取型号失败：%s').format(err.message || String(err))), 'warning');
						}).then(function() { button.disabled = false; });
					} }, _('读取型号')) : null,
					E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.usePortForCustom(port); } }, _('用于新配置'))
				])
			]);
		});
		return controls.card(_('串口与模组对应关系'), _('只读取系统设备树与 QModem 配置。未确认的串口可能是诊断口或 GNSS 口，可按需读取型号。'), [
			data && data.error ? E('div', { 'class': 'mt-control-note' }, data.error) :
			rows.length ? E('div', { 'class': 'qm-port-list' }, rows) :
				E('div', { 'class': 'mt-control-note' }, _('未发现 USB/PCIe 模组串口；请检查驱动与设备连接。'))
		], true);
	},

	customCard: function(data) {
		var self = this;
		var draft = this.customDraft || { bus: 'usb', model: '', manufacturer: 'quectel',
			manufacturer_id: '2c7c', platform: 'qualcomm', modes: 'qmi,mbim', pdp_index: '1',
			wcdma_band: '0', lte_band: '0', nsa_band: '0', sa_band: '0' };
		this.customDraft = draft;
		if (!draft.edit) draft.edit = '0';
		[ 'wcdma_band', 'lte_band', 'nsa_band', 'sa_band' ].forEach(function(key) {
			if (draft[key] === undefined || draft[key] === null) draft[key] = '0';
		});
		var allPresets = data && data.presets || {};
		var presets = allPresets.modem_support || allPresets;
		var protocols = [
			{ id: 'qmi', title: 'QMI', buses: [ 'usb', 'pcie' ] },
			{ id: 'gobinet', title: 'GobiNet', buses: [ 'usb', 'pcie' ] },
			{ id: 'mbim', title: 'MBIM', buses: [ 'usb', 'pcie' ] },
			{ id: 'rmnet', title: 'RMNET', buses: [ 'usb', 'pcie' ] },
			{ id: 'ecm', title: 'ECM', buses: [ 'usb' ] },
			{ id: 'ncm', title: 'NCM', buses: [ 'usb' ] },
			{ id: 'rndis', title: 'RNDIS', buses: [ 'usb' ] },
			{ id: 'auto', title: _('自动（AUTO）'), buses: [ 'usb' ] }
		];
		var fields = {};
		function field(key, node) {
			node.setAttribute('data-custom-field', key);
			function saveValue() { draft[key] = node.value; }
			node.addEventListener('input', saveValue);
			node.addEventListener('change', saveValue);
			fields[key] = node;
			return node;
		}
		var bus = field('bus', controls.select([ [ 'usb', 'USB' ], [ 'pcie', 'PCIe' ] ], draft.bus));
		var template = E('select', { 'class': 'cbi-input-select' });
		var templateNote = E('div', { 'class': 'qm-template-note' },
			_('从设备已安装的 QModem 支持库读取；只复制配置，不修改原型号。选择后请填写新模组的实际型号。'));
		function templateOptions() {
			var group = presets[bus.value] || {};
			var keys = Object.keys(group).filter(function(key) {
				return group[key] && typeof group[key] === 'object' && Array.isArray(group[key].modes);
			}).sort();
			dom.content(template, [
				E('option', { 'value': '' }, keys.length
					? _('请选择 QModem 已支持的型号（复制配置）')
					: _('当前支持库没有可用模板'))
			].concat(keys.map(function(key) {
				var name = group[key].manufacturer || '';
				return E('option', { 'value': key }, key.toUpperCase() + (name ? ' · ' + name : ''));
			})));
			template.disabled = !keys.length;
			template.value = '';
		}
		var checkboxes = [];
		var protocolWrap = E('div', { 'class': 'qm-protocols' }, protocols.map(function(item) {
			var box = E('input', { 'type': 'checkbox', 'value': item.id });
			var label = E('label', { 'class': 'qm-protocol-check' }, [ box, item.title ]);
			var ref = { id: item.id, buses: item.buses, box: box, label: label };
			checkboxes.push(ref);
			box.addEventListener('change', function() {
				draft.modes = checkboxes.filter(function(x) { return x.box.checked && !x.box.disabled; })
					.map(function(x) { return x.id; }).join(',');
			});
			return label;
		}));
		function bandField(key, title, example) {
			return controls.row(title, field(key, E('input', { 'type': 'text', 'value': draft[key],
				'placeholder': example, 'maxlength': '255' })));
		}
		var form = E('div', { 'class': 'qm-custom-form' }, [
			controls.row(_('连接方式'), bus),
			controls.row(_('模组型号'), field('model', E('input', { 'type': 'text', 'value': draft.model, 'placeholder': 'rg502q-ea' }))),
			controls.row(_('复制 QModem 已有型号配置'), E('div', {}, [ template, templateNote ])),
			controls.row(_('厂商标识'), field('manufacturer', E('input', { 'type': 'text', 'value': draft.manufacturer, 'placeholder': 'quectel' }))),
			controls.row(_('USB 厂商 ID'), field('manufacturer_id', E('input', { 'type': 'text', 'value': draft.manufacturer_id, 'placeholder': '2c7c' }))),
			controls.row(_('芯片平台'), field('platform', controls.select([
				[ 'qualcomm', 'Qualcomm' ], [ 'mediatek', 'MediaTek' ], [ 'unisoc', 'Unisoc' ],
				[ 'lte', 'LTE' ], [ 'lte12', 'LTE12' ], [ 'hisilicon', 'HiSilicon' ], [ 'asrmicro', 'ASR Micro' ]
			], draft.platform))),
			controls.row(_('PDP 序号'), field('pdp_index', E('input', { 'type': 'number', 'value': draft.pdp_index, 'min': '1', 'max': '16' }))),
			controls.row(_('拨号协议（可多选）'), protocolWrap),
			bandField('wcdma_band', _('3G WCDMA 频段'), '1/5/8'),
			bandField('lte_band', _('4G LTE 频段'), '1/3/5/8/41'),
			bandField('nsa_band', _('5G NSA 频段'), '41/78/79'),
			bandField('sa_band', _('5G SA 频段'), '41/78/79'),
			E('div', { 'class': 'qm-custom-band-note' },
				_('频段使用数字，以 /、逗号或空格分隔，例如 1/3/5/8；0 表示未知或不支持。以上为模组支持能力，不是锁频指令。'))
		]);
		function updateProtocols() {
			var enabled = String(draft.modes || '').split(',').filter(Boolean);
			checkboxes.forEach(function(ref) {
				var allowed = ref.buses.indexOf(bus.value) !== -1;
				ref.box.disabled = !allowed;
				ref.box.checked = allowed && enabled.indexOf(ref.id) !== -1;
				ref.label.classList[allowed ? 'remove' : 'add']('disabled');
			});
			draft.modes = checkboxes.filter(function(ref) { return ref.box.checked && !ref.box.disabled; })
				.map(function(ref) { return ref.id; }).join(',');
		}
		var editHint = E('div', { 'class': 'mt-control-note', 'style': 'margin-top:10px' });
		function fillForm() {
			Object.keys(fields).forEach(function(key) {
				if (draft[key] !== undefined && draft[key] !== null) fields[key].value = String(draft[key]);
			});
			fields.manufacturer_id.disabled = bus.value === 'pcie';
			fields.bus.disabled = draft.edit === '1';
			fields.model.disabled = draft.edit === '1';
			template.disabled = draft.edit === '1' || !Object.keys(presets[bus.value] || {}).length;
			updateProtocols();
			dom.content(editHint, draft.edit === '1' ?
				_('正在编辑：%s（%s），型号和连接方式不可修改。').format(draft.model, draft.bus) :
				_('当前为新增模式。官方原生型号只读，不允许覆盖。'));
		}
		/* 从串口卡片切换到另一个总线时，同步切换可用的 QModem 模板列表。 */
		this.fillCustomForm = function() { templateOptions(); fillForm(); };
		templateOptions();
		fillForm();
		bus.addEventListener('change', function() {
			templateOptions();
			fields.manufacturer_id.disabled = bus.value === 'pcie';
			updateProtocols();
		});
		template.addEventListener('change', function() {
			var key = template.value, cfg = (presets[bus.value] || {})[key];
			if (!key || !cfg) return;
			var originalModel = String(draft.model || '').trim();
			Object.assign(draft, {
				/* 模板只能用于添加其他型号；QModem 已有定义不允许在这里覆写。 */
				model: originalModel === key ? '' : originalModel,
				manufacturer: String(cfg.manufacturer || draft.manufacturer || ''),
				manufacturer_id: String(cfg.manufacturer_id || ''),
				platform: String(cfg.platform || draft.platform || 'qualcomm'),
				pdp_index: String(cfg.pdp_index || '1'),
				modes: Array.isArray(cfg.modes) ? cfg.modes.join(',') : '',
				wcdma_band: String(cfg.wcdma_band === undefined ? '0' : cfg.wcdma_band),
				lte_band: String(cfg.lte_band === undefined ? '0' : cfg.lte_band),
				nsa_band: String(cfg.nsa_band === undefined ? '0' : cfg.nsa_band),
				sa_band: String(cfg.sa_band === undefined ? '0' : cfg.sa_band)
			});
			fillForm();
			ui.addNotification(null, E('p', {}, _('已复制 %s 的厂商、协议和频段。请确认新模组型号后保存。').format(key)), 'info');
		});
		var entries = Array.isArray(data && data.entries) ? data.entries : [];
		return controls.card(_('自定义模组配置'),
			_('可以新增或编辑自定义型号。保存时同时更新两处 JSON 并自动备份；支持库在后台加载。'), [
			data && data.error ? E('div', { 'class': 'mt-control-note' }, data.error) : null,
			form,
			editHint,
			E('div', { 'class': 'mt-control-actions' }, [
			E('button', { 'type':'button', 'class':'btn', 'click': function() {
				Object.assign(draft, {edit:'0', model:'', bus:'usb'});
				self.fillCustomForm();
			} }, _('取消编辑 / 新增')),
			E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function(ev) {
				var button = ev.currentTarget;
				if (!draft.modes) {
					ui.addNotification(null, E('p', {}, _('请至少勾选一种与连接方式匹配的拨号协议。')), 'warning');
					return;
				}
				button.disabled = true;
				controls.saveCustomModel(Object.assign({}, draft)).then(function(result) {
					if (!result || !result.success || !result.synced) throw new Error((result && result.error) || _('自定义 JSON 与 QModem 支持库未能同时保存'));
					return result;
				}).then(function(result) {
					ui.addNotification(null, E('p', {}, _('配置已保存并同步。请重启 QModem 或设备后识别新型号。')));
					window.location.reload();
				}).catch(function(err) {
					ui.addNotification(null, E('p', {}, _('配置操作未完成：%s').format(err.message || String(err))), 'warning');
				}).then(function() { button.disabled = false; });
			} }, _('保存并同步支持库')) ]),
			E('div', { 'class': 'mt-control-note' }, _('官方 QModem 原生型号不可修改。自定义型号发生冲突时也不允许直接覆盖。')),
			entries.map(function(entry) {
				var conflict = entry.state === 'conflict';
				var status = conflict ? _('存在同名冲突') : entry.state === 'missing' ? _('未同步') : _('已同步');
				var source = entry.source === 'builtin' ? _('插件内置 JSON') : _('用户 JSON');
				return E('div', { 'class': 'qm-custom-entry' }, [
					E('span', {}, entry.model.toUpperCase() + ' · ' +
						(entry.bus === 'pcie' ? 'PCIe' : 'USB') + ' · ' +
						(entry.modes || '--') + ' · ' + source + ' · ' + status),
					E('div', { 'class': 'qm-port-actions' }, [
						E('button', {
							'type': 'button', 'class': 'btn cbi-button-action',
							'disabled': conflict ? 'disabled' : null,
							'click': function() {
								Object.assign(draft, entry, { edit:'1' });
								self.fillCustomForm();
								if (fields.model.scrollIntoView)
									fields.model.scrollIntoView({ behavior:'smooth', block:'center' });
								ui.addNotification(null, E('p', {}, _('已载入 %s，修改后保存即可同步两处 JSON。').format(entry.model)), 'info');
							}
						}, _('编辑')),
						entry.source === 'user' ? E('button', {
							'type': 'button', 'class': 'btn',
							'click': function() {
								controls.confirmModal(_('移除用户自定义 JSON'),
									_('仅移除 %s 的用户源文件，已写入 QModem 的条目会保留。').format(entry.model),
									function() {
										return controls.deleteCustomModel(entry.model, entry.bus).then(function(result) {
											if (!result || !result.success)
												throw new Error((result && result.error) || _('删除失败'));
											window.location.reload();
										});
									}, false);
							}
						}, _('移除用户配置')) : null
					])
				]);
			})
		], true);
	},
	capabilityCard: function(section, res, disabled) {
		var caps = plainObject(res.rebootCaps, 'reboot_caps');
		var softValue = ci(caps, [ 'soft_reboot_caps', 'soft' ]);
		var hardValue = ci(caps, [ 'hard_reboot_caps', 'hard' ]);
		var soft = controls.isEnabled(softValue), hard = controls.isEnabled(hardValue);

		var chips = disabled.length
			? (res.disabled && ci(res.disabled, [ 'disabled_features' ]) || []).map(function(name) {
				return E('span', { 'class': 'mt-hardware-cap' }, featureLabel(name));
			})
			: [];

		return controls.card(_('模组能力'),
			_('根据 QModem 上报显示功能限制与可用的重启方式。'), [
				controls.state(_('配置节'), section),
				controls.state(_('软重启（AT 复位）'), controls.hasValue(softValue) ? (soft ? _('支持') : _('不支持')) : ''),
				controls.state(_('硬重启（断电复位）'), controls.hasValue(hardValue) ? (hard ? _('支持') : _('不支持')) : ''),
				E('div', { 'class': 'mt-hardware-caps' }, chips)
			]);
	},

	render: function(res) {
		var self = this;
		var holder = controls.liveView(this, res, {
			domains: this.DOMAINS,
			interval: this.POLL_INTERVAL,
			paint: this.paintContent,
			collect: this.collect
		});
		/* 首屏绘制后再填充支持库；页面已切换或输入框正在编辑时不打断操作。 */
		this.auxHolder = holder;
		if (this.initialAuxPromise) {
			this.initialAuxPromise.then(function(meta) {
				if (self.auxHolder !== holder) return;
				function paintWhenIdle() {
					if (self.auxHolder !== holder) return;
					var active = document.activeElement;
					if (active && holder.contains && holder.contains(active) &&
						/^(input|textarea|select)$/i.test(active.tagName || '')) {
						/* 正在输入时不打断，离开输入框后补上刚获取的支持库数据。 */
						if (!self.auxFocusWait) {
							self.auxFocusWait = holder;
							holder.addEventListener('focusout', function() {
								if (self.auxFocusWait === holder) self.auxFocusWait = null;
								Promise.resolve().then(paintWhenIdle);
							}, { once: true });
						}
						return;
					}
					self.auxFocusWait = null;
					dom.content(holder, self.paintContent(Object.assign({}, res, meta)));
				}
				paintWhenIdle();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {},
					_('后台加载支持库失败：%s').format((err && err.message) || String(err))), 'warning');
			});
		}
		return holder;
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
						E('p', {}, _('外观配色、硬件连接与模组支持库。'))
					])
				]),
				this.appearanceCard(),
				E('div', { 'class': 'alert-message warning mt-hardware-warning' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')),
				E('section', { 'class': 'mt-control-section' }, [
					E('div', { 'class': 'mt-control-section-head' }, [
						E('h3', {}, _('模组支持库')),
						E('p', {}, _('官方 QModem 库只读展示；在自定义库中新增和编辑模组后同步到 QModem。'))
					]),
					E('div', { 'class': 'mt-control-grid' }, [
						this.supportCard(res.support, res.custom),
						this.customLibraryCard(res.support, res.custom),
						this.portCard(res.ports),
						this.customCard(res.custom)
					])
				]) ]
			));

		var section = res.section;
		var disabled = disabledSet(res.disabled);
		var atCfg = plainObject(res.atCfg, 'at_cfg');
		var atPort = pick(atCfg, [ 'at_port' ]) || controls.findEntry(controls.entryList(res.base), 'at_port') || '';
		var baseMap = controls.entryMap(controls.entryList(res.base));

		var rawDump;
		try {
			rawDump = JSON.stringify({
				config_section: section,
				disabled_features: res.disabled,
				reboot_caps: res.rebootCaps,
				at_cfg: res.atCfg,
				base_info: res.base,
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
					E('h2', {}, _('高级设置与外观')),
					E('p', {}, _('调整页面配色，查看硬件连接与模组支持情况。'))
				])
			])
		].concat(warnings).concat([
			this.appearanceCard(),

			/* 硬件连接示意 */
			E('section', { 'class': 'mt-adv-card mt-adv-topo-card' }, [
				E('div', { 'class': 'mt-control-section-head', 'style': 'margin-bottom:10px' }, [
					E('h3', {}, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>'),
						_('硬件连接与数据通路')
					]),
					E('p', {}, _('主机、管理服务与蜂窝模组之间的逻辑连接示意。'))
				]),
				this.renderBusTopo()
			]),

			/* 模组支持库 */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('模组支持库')),
					E('p', {}, _('QModem 官方型号只读查看；插件自定义型号可以新增、编辑及同步。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.supportCard(res.support, res.custom),
						this.customLibraryCard(res.support, res.custom),
					this.portCard(res.ports),
					this.customCard(res.custom)
				])
			]),

			/* 模组能力与重启 */
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('能力与诊断')),
					E('p', {}, _('QModem 上报的特性支持情况与重启能力。'))
				]),
				E('div', { 'class': 'mt-control-grid' }, [
					this.capabilityCard(section, res, disabled)
				])
			]),

			/* 专有 AT 指令按已验证的型号展示，不能跨品牌下发。 */
			controls.supportsTdTechAt(section, res.base) ? E('section', { 'class': 'mt-control-section' }, [
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
					})
				])
			]) : null,

			/* 诊断与开发者工具 */
			E('section', { 'class': 'mt-adv-card mt-hardware-tools' }, [
				E('div', {}, [
					E('h3', { 'style': 'margin:0 0 4px;font-size:15px;font-weight:750;color:var(--qm-text)' }, _('常用功能入口')),
					E('p', { 'style': 'margin:0;color:var(--qm-text-muted);font-size:12px' }, _('无线设置、SIM 管理与 AT 调试请在对应页面操作。'))
				]),
				E('div', { 'class': 'mt-hardware-tool-actions' }, [
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/qmodem-generic/network') }, _('无线与小区')),
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/qmodem-generic/system') }, _('模组与 SIM 卡')),
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
				E('summary', { 'style': 'cursor:pointer;font-size:13.5px;font-weight:750;color:var(--qm-text);list-style:none;display:flex;justify-content:space-between;align-items:center' }, [
					E('span', { 'style': 'display:flex;align-items:center;gap:8px' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'),
						_('技术细节（QModem 原始数据）')
					]),
					E('span', { 'style': 'font-size:18px;color:var(--qm-text-muted);font-weight:700' }, '›')
				]),
				E('pre', { 'class': 'mt-hardware-raw', 'style': 'margin-top:12px' }, rawDump || _('无响应。'))
			])
		]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
