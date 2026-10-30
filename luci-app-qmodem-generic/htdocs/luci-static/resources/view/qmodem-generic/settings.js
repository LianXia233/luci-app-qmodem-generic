'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require qmodem-generic.controls as controls';
'require qmodem-generic.theme as theme';

var E = controls.element;

/*
 * 设备参数（Settings）— QModem 设备配置与节点对应关系
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
	load: function() {
		var self = this;
		return controls.bootstrap().then(function(ctx) {
			self.section = ctx.section;
			return Promise.all([
				controls.getTtyPorts(),
				controls.getAvailableDevices()
			]).then(function(extra) {
				return {
					section: ctx.section,
					errors: ctx.errors,
					ttyPorts: (extra[0] && extra[0].ports) || [],
					availableDevices: (extra[1] && extra[1].devices) || {}
				};
			});
		});
	},

	/* ---- 官方 QModem 设备扫描 / 添加 / 移除（与官方 settings 页同款接口） ---- */

	scan: function(kind, button) {
		var self = this;
		if (self._scanning) return;
		self._scanning = true;
		if (button) button.disabled = true;
		var label = kind === 'pcie' ? 'PCIe' : kind === 'usb' ? 'USB' : _('全部总线');
		ui.showModal(_('Scanning'), [
			E('p', { 'class': 'spinning' }, _('正在扫描 %s 设备，扫描由 QModem 的 modem_scan 服务执行，可能需要数十秒…').format(label))
		]);
		/* 扫描失败（含 code != 0）由 controls.scanDevices 统一 reject，这里只处理成功分支 */
		controls.scanDevices(kind).then(function() {
			ui.hideModal();
			controls.notify(null, E('p', {}, _('扫描完成，模组列表已更新。')));
			window.setTimeout(function() { window.location.reload(); }, 900);
		}).catch(function(err) {
			ui.hideModal();
			controls.notify(null, E('p', {}, _('扫描失败：') + ((err && err.message) || String(err))), 'danger');
		}).then(function() {
			self._scanning = false;
			if (button) button.disabled = false;
		});
	},

	showAddModal: function(available) {
		var self = this;
		var keys = Object.keys(available || {}).sort();
		if (!keys.length) {
			controls.notify(null, E('p', {}, _('没有可用的新设备。请先执行扫描，QModem 识别到设备后即可在此添加。')), 'info');
			return;
		}
		var select = E('select', { 'class': 'cbi-input-select', 'style': 'width:100%' }, keys.map(function(key) {
			var info = available[key] || {};
			return E('option', { 'value': key }, info.label || key);
		}));
		ui.showModal(_('Add modem'), [
			E('p', {}, _('选择 QModem 扫描到的设备并添加为模组配置节。')),
			E('div', { 'style': 'margin:12px 0' }, select),
			E('div', { 'class': 'right' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function() {
					var key = select.value;
					var info = available[key] || {};
					if (!key) return;
					ui.hideModal();
					try {
						uci.add('qmodem', 'modem-device', key);
						if (info.type) uci.set('qmodem', key, 'data_interface', info.type);
						if (info.path) uci.set('qmodem', key, 'path', info.path);
						uci.set('qmodem', key, 'use_ubus', '1');
					} catch (e) {
						return controls.notify(null, E('p', {}, _('添加失败：') + ((e && e.message) || String(e))), 'danger');
					}
					uci.save().then(function() {
						return controls.commitConfig('qmodem');
					}).then(function() {
						controls.notify(null, E('p', {}, _('模组已添加，QModem 将在下次扫描时完成识别。')));
						window.setTimeout(function() { window.location.reload(); }, 1000);
					}).catch(function(err) {
						controls.notify(null, E('p', {}, _('添加失败：') + ((err && err.message) || String(err))), 'danger');
					});
				} }, _('Add'))
			])
		]);
	},

	removeModem: function(section) {
		controls.confirmModal(_('移除该模组'),
			_('将调用 QModem 移除该模组的配置节、挂断其连接并清理生成的网络接口配置。该操作不可撤销，是否继续？'),
			function() {
				return controls.removeModem(section).then(function() {
					controls.notify(null, E('p', {}, _('模组已移除。')));
				});
			});
	},

	styleNode: function() {
		return controls.injectStyleOnce('qm-settings-style', [
			'.qm-app{--qm-glass-bg:var(--qm-glass);--qm-glass-border:var(--qm-border);--qm-glass-shadow:var(--qm-shadow-md);--qm-primary:var(--qm-accent);--qm-success:var(--qm-ok);--qm-warning:var(--qm-warn)}',
			'.mt-diag-page{position:relative;max-width:1120px;margin:0 auto;color:var(--qm-text);padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境漫反射光晕 */
			'.mt-set-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:var(--qm-glow-a);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-set-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:var(--qm-glow-b);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片核心样式 */
			'.mt-diag-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:24px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-diag-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px var(--qm-shadow-color),0 2px 6px var(--qm-shadow-color)}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-diag-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:24px 28px;margin-bottom:16px;background:var(--qm-hero-gradient)}',
			'.qm-app .mt-diag-hero .mt-diag-title{margin:0 0 6px;font-size:23px;line-height:1.35;font-weight:750;letter-spacing:0;background:none;color:var(--qm-on-hero);-webkit-text-fill-color:var(--qm-on-hero)}',
			'.mt-diag-sub{font-size:13px;color:var(--qm-text-muted);line-height:1.5;margin:0}',
			'.mt-diag-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:999px;background:var(--qm-accent-soft);color:var(--qm-accent);border:1px solid var(--qm-accent-border);font-size:12px;font-weight:750;white-space:nowrap}',
			'.mt-diag-dot{width:8px;height:8px;border-radius:50%;background:var(--qm-accent);box-shadow:0 0 0 4px var(--qm-accent-soft)}',

			/* CSS 网格随容器伸缩，名称和设备节点可换行，不会被 SVG 固定宽度裁切。 */
			'.mt-diag-topo-card{padding:20px 24px;margin-bottom:16px}',
			'.mt-diag-path{display:grid;grid-template-columns:minmax(0,1fr) 52px minmax(0,1fr) 52px minmax(0,1fr);align-items:center;gap:12px;padding:10px 0 2px}',
			'.mt-diag-path-node{display:flex;align-items:center;gap:12px;min-width:0;min-height:84px;padding:14px;border:1px solid var(--qm-border);border-radius:14px;background:var(--qm-surface-2)}',
			'.mt-diag-path-icon{display:flex;align-items:center;justify-content:center;flex:0 0 34px;height:34px;border-radius:10px;background:var(--qm-accent-soft);color:var(--qm-accent);font-size:15px;font-weight:750}',
			'.mt-diag-path-copy{display:flex;flex-direction:column;gap:5px;min-width:0}',
			'.mt-diag-path-copy strong{font-size:13px;line-height:1.4;color:var(--qm-text)}',
			'.mt-diag-path-copy small{font-size:11px;line-height:1.45;color:var(--qm-text-muted);overflow-wrap:anywhere}',
			'.mt-diag-path-line{height:2px;background:var(--qm-border);position:relative;overflow:hidden}',
			'.mt-diag-path-line:after{content:"";display:block;width:45%;height:100%;background:var(--qm-accent);animation:qmPathFlow 2s linear infinite}',
			'@keyframes qmPathFlow{from{transform:translateX(-110%)}to{transform:translateX(340%)}}',

			/* 表单区域精美定制 (白色毛玻璃) */
			'.qm-app .mt-diag-card .mt-diag-card-head{margin-bottom:14px;padding:0 0 12px;border:0;border-bottom:1px solid var(--qm-border-soft);border-radius:0;background:transparent;box-shadow:none}',
			'.mt-diag-card-head h3{font-size:16px;font-weight:750;color:var(--qm-text);margin:0 0 4px;display:flex;align-items:center;gap:8px}',
			'.mt-diag-card-head p{font-size:12px;color:var(--qm-text-muted);margin:0;line-height:1.5}',
			'.mt-diag-card .cbi-map>h2,.mt-diag-card .cbi-map-descr,.mt-diag-card .cbi-section>h3{display:none}',
			'.mt-diag-card .cbi-section{margin:0;padding:0;border:0;box-shadow:none}',
			'.mt-diag-card .cbi-section-node{padding:0}',
			'.qm-app .mt-diag-form-card .cbi-value{padding:13px 0;border-bottom:1px solid var(--qm-border-soft);display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr);gap:16px;align-items:start}',
			'.mt-diag-card .cbi-value:last-child{border-bottom:0}',
			'.qm-app .mt-diag-form-card .cbi-value-title{font-size:13px;font-weight:650;color:var(--qm-text-soft);padding-top:8px}',
			'.mt-diag-card .cbi-value-description{font-size:11px;color:var(--qm-text-muted);margin-top:4px;line-height:1.4}',
			'.qm-app .mt-diag-form-card .cbi-value-field{min-width:0;max-width:600px}',
			'.mt-diag-form-card .cbi-input-text,.mt-diag-form-card select{background:var(--qm-glass);border:1px solid var(--qm-border);border-radius:10px;padding:8px 14px;font-size:13px;color:var(--qm-text);transition:all .2s ease;width:100%;max-width:560px}',
			'.mt-diag-form-card .cbi-dynlist{max-width:560px}',
			'.mt-diag-card .cbi-input-text:focus,.mt-diag-card select:focus{background:var(--qm-surface);border-color:var(--qm-accent);box-shadow:0 0 0 3px var(--qm-accent-soft);outline:none}',

			/* 保存按钮与底部导航 */
			'.mt-diag-footer{margin-top:20px;padding-top:16px;border-top:1px solid var(--qm-border-soft);display:flex;justify-content:flex-end}',
			'.mt-diag-save-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:12px;font-size:13px;font-weight:750;cursor:pointer;background:var(--qm-accent-gradient);color:var(--qm-on-hero);border:0;box-shadow:0 4px 14px var(--qm-accent-border);transition:all .2s ease}',
			'.mt-diag-save-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px var(--qm-accent-border)}',
			'.mt-diag-back{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}',
			'.mt-diag-back-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:12px;font-size:12.5px;font-weight:650;color:var(--qm-text-soft);background:var(--qm-glass);border:1px solid var(--qm-border-soft);text-decoration:none;transition:all .2s ease}',
			'.mt-diag-back-btn:hover{background:var(--qm-surface);color:var(--qm-accent);border-color:var(--qm-accent-border);transform:translateY(-1px)}',

			/* 响应式适配 */
			'@media(max-width:820px){.mt-diag-path{grid-template-columns:1fr;gap:8px}.mt-diag-path-node{min-height:0}.mt-diag-path-line{width:2px;height:20px;margin-left:30px}.mt-diag-path-line:after{width:100%;height:45%;animation:qmPathFlowVertical 2s linear infinite}@keyframes qmPathFlowVertical{from{transform:translateY(-110%)}to{transform:translateY(340%)}}.qm-app .mt-diag-form-card .cbi-value{grid-template-columns:1fr;gap:5px}.qm-app .mt-diag-form-card .cbi-value-title{padding-top:0}}',
			'@media(max-width:560px){.mt-diag-card{padding:16px}.mt-diag-hero{flex-direction:column;align-items:flex-start}.mt-diag-badge{white-space:normal}}',
			'@media(prefers-reduced-motion:reduce){.mt-diag-path-line:after{animation:none;width:100%;height:100%}}'
		].join(''));
	},

	/* 配置节与 AT 端口的示意路径；空端口明确标为自动选择。 */
	renderConfigPath: function(section, atPort) {
		function node(icon, title, detail) {
			return E('div', { 'class': 'mt-diag-path-node' }, [
				E('span', { 'class': 'mt-diag-path-icon', 'aria-hidden': 'true' }, icon),
				E('span', { 'class': 'mt-diag-path-copy' }, [
					E('strong', {}, title), E('small', {}, detail)
				])
			]);
		}
		return E('div', { 'class': 'mt-diag-path', 'role': 'group', 'aria-label': _('配置与设备对应关系') }, [
			node('1', _('QModem 配置'), '/etc/config/qmodem'),
			E('span', { 'class': 'mt-diag-path-line', 'aria-hidden': 'true' }),
			node('2', _('当前配置节'), shown(section)),
			E('span', { 'class': 'mt-diag-path-line', 'aria-hidden': 'true' }),
			node('3', _('AT 端口'), atPort ? String(atPort) : _('由 QModem 自动选择'))
		]);
	},

	render: function(res) {
		var self = this;
		theme.apply();
		res = res || {};
		var enter = !self.painted;
		self.painted = true;

		var warnings = (res.errors || []).map(function(msg) {
			return E('div', { 'class': 'alert-message warning' }, msg);
		});

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section)
			return E('div', { 'class': 'mt-diag-page' + (enter ? ' qm-enter' : '') }, [
				this.styleNode(),
				controls.styleNode(),
				modemBar,
				E('section', { 'class': 'mt-diag-card mt-diag-hero' }, [
					E('div', {}, [
						controls.pageTitle('settings', _('设备参数'), 'mt-diag-title'),
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
		var ttyHints = (res.ttyPorts || []).map(function(p) { return (p && p.id) || ''; }).filter(Boolean);
		o.description = ttyHints.length
			? _('QModem 下发 AT 命令使用的端口设备节点。留空则由 QModem 自动选择。检测到的端口：%s').format(ttyHints.join('、'))
			: _('QModem 下发 AT 命令使用的端口设备节点。留空则由 QModem 自动选择。');
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

		/* ---- QModem 全局扫描设置（/etc/config/qmodem main 节） ---- */
		var gm = new form.Map('qmodem', 'main');
		var gs = gm.section(form.NamedSection, 'main', 'main');
		gs.anonymous = true;
		gs.addremove = false;

		var g = gs.option(form.Flag, 'enable_dial', _('全局拨号开关'));
		g.description = _('关闭后 QModem 不再为任何模组自动拨号。');
		g.default = '1';
		g.rmempty = false;

		g = gs.option(form.Flag, 'enable_pcie_scan', _('允许 PCIe 扫描'));
		g.description = _('启动与热插拔时扫描 PCIe 总线上的模组。');
		g.rmempty = false;

		g = gs.option(form.Flag, 'enable_usb_scan', _('允许 USB 扫描'));
		g.description = _('启动与热插拔时扫描 USB 总线上的模组。');
		g.rmempty = false;

		g = gs.option(form.Flag, 'block_auto_probe', _('禁止自动探测'));
		g.description = _('开启后 QModem 不再自动探测/添加新模组，仅保留手动添加。');
		g.rmempty = false;

		var savingGlobal = false;
		var saveGlobal = function(button) {
			if (savingGlobal) return Promise.resolve();
			savingGlobal = true;
			button.disabled = true;
			return Promise.resolve().then(function() { return gm.save(null, true); }).then(function() {
				return controls.commitConfig('qmodem');
			}).then(function() {
				controls.notify(null, E('p', {}, _('全局扫描设置已保存。')));
			}).catch(function(err) {
				controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
			}).then(function() {
				savingGlobal = false;
				button.disabled = false;
			});
		};

		var saving = false;
		var saveConfig = function(button) {
			if (saving) return Promise.resolve();
			saving = true;
			button.disabled = true;
			return Promise.resolve().then(function() { return m.save(null, true); }).then(function() {
				return controls.commitConfig('qmodem');
			}).then(function() {
				controls.notify(null, E('p', {},
					_('设备参数已保存到 QModem 配置（/etc/config/qmodem），请重拨或重启模组使其生效。')));
				window.setTimeout(function() { window.location.reload(); }, 1100);
			}).catch(function(err) {
				controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
			}).then(function() {
				saving = false;
				button.disabled = false;
			});
		};

		return Promise.all([ m.render(), gm.render() ]).then(function(nodes) {
			var formNode = nodes[0], globalFormNode = nodes[1];
			return E('div', { 'class': 'mt-diag-page' + (enter ? ' qm-enter' : '') }, [
				self.styleNode(),
				controls.styleNode(),
				/* 背景环境漫反射光晕 */
				E('div', { 'class': 'mt-set-bg-glow1' }),
				E('div', { 'class': 'mt-set-bg-glow2' }),

				modemBar,

				/* 顶部 Hero 玻璃卡片 */
				E('section', { 'class': 'mt-diag-card mt-diag-hero' }, [
					E('div', {}, [
						controls.pageTitle('settings', _('设备参数'), 'mt-diag-title'),
						E('p', { 'class': 'mt-diag-sub' }, _('编辑 QModem 配置中当前模组的设备参数（配置节：%s）。').format(shown(section)))
					]),
					E('span', { 'class': 'mt-diag-badge' }, [
						E('span', { 'class': 'mt-diag-dot' }),
						_('由 QModem 管理')
					])
				]),

				/* 设备扫描与模组接入（官方 QModem 扫描接口） */
				E('section', { 'class': 'mt-diag-card mt-diag-topo-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/><line x1="2" y1="20" x2="2.01" y2="20"/></svg>'),
							_('设备扫描与模组接入')
						]),
						E('p', {}, _('扫描 PCIe / USB 总线上的模组设备，或从 QModem 已识别的设备中手动添加；移除操作将同时清理生成的网络配置。'))
					]),
					E('div', { 'style': 'display:flex;gap:10px;flex-wrap:wrap' }, [
						E('button', { 'type': 'button', 'class': 'mt-diag-save-btn', 'click': function(ev) { self.scan('pcie', ev.currentTarget); } }, _('扫描 PCIe 设备')),
						E('button', { 'type': 'button', 'class': 'mt-diag-save-btn', 'click': function(ev) { self.scan('usb', ev.currentTarget); } }, _('扫描 USB 设备')),
						E('button', { 'type': 'button', 'class': 'mt-diag-save-btn', 'click': function(ev) { self.scan('all', ev.currentTarget); } }, _('扫描全部设备')),
						E('button', { 'type': 'button', 'class': 'mt-diag-back-btn', 'click': function() { self.showAddModal(res.availableDevices); } }, _('添加模组')),
						E('button', { 'type': 'button', 'class': 'mt-diag-back-btn', 'style': 'color:var(--qm-danger)', 'click': function() { self.removeModem(section); } }, _('移除该模组'))
					])
				]),

				/* 配置与设备节点对应关系 */
				E('section', { 'class': 'mt-diag-card mt-diag-topo-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'),
							_('配置与设备对应关系')
						]),
						E('p', {}, _('当前配置节与 AT 端口的对应关系；更改端口后保存并刷新页面即可更新。'))
					]),
					self.renderConfigPath(section, uci.get('qmodem', section, 'at_port'))
				]),

				/* 表单卡片 (白色毛玻璃) */
				E('section', { 'class': 'mt-diag-card mt-diag-form-card' }, [
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
						'click': function(ev) { return saveConfig(ev.currentTarget); }
					}, [
						svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'),
						_('保存设备参数')
					]))
				]),

				/* 全局扫描设置 */
				E('section', { 'class': 'mt-diag-card mt-diag-form-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, _('全局扫描设置')),
						E('p', {}, _('写入 /etc/config/qmodem 的 main 配置节，控制 QModem 的自动扫描与拨号行为。'))
					]),
					globalFormNode,
					E('div', { 'class': 'mt-diag-footer' }, E('button', {
						'type': 'button',
						'class': 'mt-diag-save-btn',
						'click': function(ev) { return saveGlobal(ev.currentTarget); }
					}, _('保存全局设置')))
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
			return E('div', { 'class': 'mt-diag-page' + (enter ? ' qm-enter' : '') }, [
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
