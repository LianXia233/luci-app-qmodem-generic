'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require mt5700m.controls as controls';

/*
 * 移动数据（Mobile Data）
 *
 * 数据源全部来自 QModem 的 `qmodem` ubus 对象（经 mt5700m.controls 封装）：
 *   get_connect_status / get_dns / get_mode / dial_status / network.interface status
 * APN 等拨号参数读写 /etc/config/qmodem 的 modem-device 配置节。
 * 旧的 AT 文本后端与旧 ubus 对象已全部移除。
 */

/* 把 QModem 的返回值统一成 [{key,value}] 形式 */
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

/* 取出 { <key>: {...} } 里的子对象，取不到时返回原对象/空对象 */
function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]))
		return raw[key];
	return raw;
}

/* 出错时不抛异常，记入 errors 数组，返回 null，避免白屏 */
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

/* QModem 部分版本的 DNS 字段会带回车换行的杂散数据，仅保留首个有效地址 */
function cleanDns(v) {
	return String(v == null ? '' : v).split(/\s+/)[0] || '';
}

return view.extend({
	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

			if (!section)
				return { section: null, errors: errors };

			return uci.load('qmodem').catch(function(err) {
				errors.push('读取 qmodem 配置失败：' + ((err && err.message) || String(err)));
				return null;
			}).then(function() {
				/* 接口状态：由 controls 按 modem_config / 命名规则自动解析出
				 * QModem 为本模组生成的 IPv4/IPv6 逻辑接口并合并地址视图 */
				return Promise.all([
					guard(controls.getConnectStatus(section), '连接状态', errors),
					guard(controls.getDns(section), 'DNS', errors),
					guard(controls.getMode(section), '拨号模式', errors),
					guard(controls.getDialStatus(section), '拨号状态', errors),
					guard(controls.getInterfaceStatus(section), '接口状态', errors)
				]).then(function(results) {
					var ifstat = results[4] || {};
					var devName = ifstat.l3_device || ifstat.device || '';

					/* MTU 不在接口 dump 里，从物理设备状态补齐 */
					return guard(
						devName ? controls.getDeviceStatus(devName) : Promise.resolve({}),
						'设备状态', errors
					).then(function(devstat) {
						self.iface = ifstat.interface || uci.get('qmodem', section, 'network') || '--';

						return {
							section: section,
							iface: self.iface,
							conn: results[0],
							dns: results[1],
							mode: results[2],
							dial: results[3],
							ifstat: ifstat,
							devstat: devstat || {},
							errors: errors
						};
					});
				});
			});
		}).catch(function(err) {
			errors.push('加载失败：' + ((err && err.message) || String(err)));
			return { section: null, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mtconn-page{max-width:1040px;margin:0 auto}',
			'.mtconn-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 22px;margin-bottom:16px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:15px;background:linear-gradient(135deg,rgba(20,111,217,.10),rgba(0,155,133,.08))}',
			'.mtconn-title{font-size:22px;font-weight:720;margin:0 0 5px}',
			'.mtconn-sub{font-size:13px;color:var(--text-color-medium,#69717d)}',
			'.mtconn-state{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700;white-space:nowrap}',
			'.mtconn-dot{width:10px;height:10px;border-radius:50%;background:#d79a22;box-shadow:0 0 0 5px rgba(215,154,34,.14)}',
			'.mtconn-state.online .mtconn-dot{background:#0aa378;box-shadow:0 0 0 5px rgba(10,163,120,.14)}',
			'.mtconn-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}',
			'.mtconn-fact{padding:13px 14px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:11px;background:var(--background-color-high,#fff)}',
			'.mtconn-label{font-size:11px;color:var(--text-color-medium,#69717d);margin-bottom:5px}',
			'.mtconn-value{font-size:14px;font-weight:650;word-break:break-word}',
			'.mtconn-actions{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 18px}',
			'.mtconn-actions .btn{border-radius:9px}',
			'.mtconn-session{display:grid;grid-template-columns:1.25fr .9fr;align-items:start;gap:12px;margin-bottom:16px}.mtconn-session-card{padding:16px 18px}.mtconn-session-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:9px}.mtconn-session-head h3{margin:0 0 4px;font-size:14px}.mtconn-session-head p{margin:0;color:var(--mt-ui-muted);font-size:10px;line-height:1.45}.mtconn-session-badge{padding:4px 8px;border-radius:999px;background:#eef2f6;color:#6b7480;font-size:10px;font-weight:700;white-space:nowrap}.mtconn-session-badge.on{background:#e8f8f1;color:#087c60}',
			'.mtconn-session-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}.mtconn-session-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:1px solid var(--mt-ui-border-soft);font-size:10px}.mtconn-session-row span{color:var(--mt-ui-muted)}.mtconn-session-row strong{text-align:right;word-break:break-all}.mtconn-session-actions{display:flex;justify-content:flex-end;margin-top:11px}',
			'.mtconn-pdp{margin:16px 0;padding:16px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mtconn-pdp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px}.mtconn-pdp-head h3{font-size:15px;margin:0 0 4px}.mtconn-pdp-head p{font-size:11px;color:var(--text-color-medium,#69717d);margin:0;line-height:1.45}.mtconn-pdp-row{display:grid;grid-template-columns:58px 100px 1fr 90px auto;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border-color-low,#edf0f4);font-size:12px}.mtconn-pdp-state{font-weight:650;color:#7b8794}.mtconn-pdp-state.on{color:#08775d}.mtconn-pdp-actions{display:flex;gap:6px;justify-content:flex-end}',
			'.mtconn-config{margin:16px 0;padding:18px 20px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mtconn-config-head{margin-bottom:10px}.mtconn-config-head h3{margin:0 0 5px;font-size:16px}.mtconn-config-head p{margin:0;color:var(--text-color-medium,#69717d);font-size:12px;line-height:1.5}.mtconn-config .cbi-map>h2,.mtconn-config .cbi-map-descr,.mtconn-config .cbi-section>h3{display:none}.mtconn-config .cbi-section{margin:0;padding:0;border:0;box-shadow:none}.mtconn-config .cbi-section-node{padding:0}.mtconn-config .cbi-value{padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4)}.mtconn-config .cbi-value:last-child{border-bottom:0}',
			'.mtconn-advanced-body{padding:0 18px 18px}.mtconn-advanced-body .mtconn-pdp{border:0;padding:0;margin:18px 0 0;box-shadow:none}.mtconn-advanced-body .mt-control-section{margin-top:18px}',
			'.mtconn-log{margin-top:16px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:11px;background:var(--background-color-high,#fff)}',
			'.mtconn-log summary{cursor:pointer;padding:13px 15px;font-weight:650}',
			'.mtconn-log pre{max-height:260px;overflow:auto;margin:0;padding:14px 15px;border-top:1px solid var(--border-color-low,#edf0f4);font-size:11px;white-space:pre-wrap}',
			'@media(max-width:720px){.mtconn-hero{display:block}.mtconn-state{margin-top:14px}.mtconn-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.mtconn-session{grid-template-columns:1fr}.mtconn-pdp-row{grid-template-columns:48px 80px 1fr}.mtconn-pdp-row .mtconn-pdp-state,.mtconn-pdp-actions{grid-column:3}.mtconn-config{padding:16px}}',
			'@media(max-width:420px){.mtconn-facts,.mtconn-session-columns{grid-template-columns:1fr}}'
		].join(''));
	},

	fact: function(label, value) {
		return E('div', { 'class': 'mtconn-fact mt-ui-card' }, [
			E('div', { 'class': 'mtconn-label' }, label),
			E('div', { 'class': 'mtconn-value' }, value || '--')
		]);
	},

	sessionRow: function(label, value) {
		return E('div', { 'class': 'mtconn-session-row' }, [ E('span', {}, label), E('strong', {}, value || '--') ]);
	},

	/* 地址卡片：IPv4/IPv6/MTU 取自 netifd 接口合并视图（QModem 生成的 v4/v6 接口），
	 * DNS 优先取 QModem get_dns，缺失时回退接口上报的 dns-server */
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
		}).slice(0, 12).map(function(k) {
			return self.sessionRow(k, dialStatus[k] == null ? '' : String(dialStatus[k]));
		});

		return E('div', { 'class': 'mtconn-session' }, [
			E('section', { 'class': 'mtconn-session-card mt-ui-card' }, [
				E('div', { 'class': 'mtconn-session-head' }, [
					E('div', {}, [
						E('h3', {}, _('地址与 DNS')),
						E('p', {}, _('由 QModem 上报的接口地址、MTU 与模组下发的 DNS。'))
					]),
					E('span', { 'class': 'mtconn-session-badge' + (connected ? ' on' : '') }, connected ? _('已连接') : _('未连接'))
				]),
				E('div', { 'class': 'mtconn-session-columns' }, [
					self.sessionRow(_('IPv4 地址'), ipv4),
					self.sessionRow(_('IPv6 地址'), ipv6),
					self.sessionRow('MTU', mtu),
					self.sessionRow(_('IPv4 DNS'), dns4),
					self.sessionRow(_('IPv6 DNS'), dns6),
					self.sessionRow(_('接口协议'), ifstat.proto),
					self.sessionRow(_('接口状态'), ifstat.up === true ? _('已启动') : (ifstat.up === false ? _('未启动') : '')),
					self.sessionRow(_('已连接时长'), ifstat.uptime != null ? controls.formatDuration(ifstat.uptime) : '')
				])
			]),
			E('section', { 'class': 'mtconn-session-card mt-ui-card' }, [
				E('div', { 'class': 'mtconn-session-head' }, [
					E('div', {}, [
						E('h3', {}, _('拨号状态')),
						E('p', {}, _('QModem dial_status 原始上报。'))
					]),
					E('span', { 'class': 'mtconn-session-badge' }, 'QModem')
				])
			].concat(dialRows.length ? dialRows : [
				E('div', { 'class': 'alert-message notice' }, _('本模组经 QModem 暂无拨号状态数据。'))
			]))
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
		var self = this;
		res = res || {};

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section) {
			return E('div', { 'class': 'mtconn-page mt-ui-page' }, [
				self.styleNode(),
				controls.styleNode(),
				modemBar,
				E('section', { 'class': 'mtconn-hero mt-ui-hero' }, [
					E('div', {}, [
						E('h2', { 'class': 'mtconn-title' }, _('移动数据')),
						E('div', { 'class': 'mtconn-sub' }, _('本页数据全部来自 QModem。'))
					])
				]),
				E('div', { 'class': 'alert-message warning' }, _('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null
			]);
		}

		var section = res.section;
		var conn = entriesOf(res.conn);
		var connected = controls.findEntry(conn, 'connect_status') === 'Yes';
		var mode = plainObject(res.mode, 'mode');
		var modeName = Object.keys(mode || {}).filter(function(k) {
			return String(mode[k]) === '1';
		}).join(' / ').toUpperCase();
		var configuredApn = uci.get('qmodem', section, 'apn') || _('自动');
		var configuredPdp = { IPV4V6: 'IPv4 / IPv6', IPV4: 'IPv4', IPV6: 'IPv6' }[String(uci.get('qmodem', section, 'pdp_type') || '').toUpperCase()] || 'IPv4 / IPv6';

		res.connected = connected;

		/* ---- APN / 拨号参数（写入 /etc/config/qmodem 的当前配置节） ---- */
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

		var saveApn = function() {
			return m.save(null, true).then(function() {
				return uci.commit('qmodem');
			}).then(function() {
				ui.addNotification(null, E('p', {}, _('APN 设置已保存到 QModem 配置（qmodem），请重拨以生效。')));
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
			});
		};

		/* ---- 拨号日志（QModem get_dial_log，展开时懒加载） ---- */
		var logOutput = E('pre', { 'class': 'mt-ui-details-body' }, _('展开以读取拨号日志。'));
		var logDetails = E('details', {
			'class': 'mtconn-log mt-ui-details',
			'toggle': function(ev) { self.loadLog(ev.currentTarget, logOutput, section); }
		}, [
			E('summary', {}, [
				E('span', { 'class': 'mt-ui-summary-copy' }, E('span', { 'class': 'mt-ui-summary-title' }, _('最近的拨号日志'))),
				E('span', { 'class': 'mt-ui-chevron', 'aria-hidden': 'true' }, '›')
			]),
			logOutput
		]);

		/* ---- 入站路由：原先由 AT 输出解析，现改为只读说明 ---- */
		var inboundPanel = E('section', { 'class': 'mt-control-section' }, [
			E('div', { 'class': 'mt-control-section-head' }, [
				E('h3', {}, _('入站路由与数据通路')),
				E('p', {}, _('IP 透传、Post-Route、DMZ 等模组侧转发设置。'))
			]),
			E('div', { 'class': 'mt-control-grid' }, [
				controls.card(_('数据通路'), _('由 QModem 上报的模组数据通路信息。'), [
					controls.state(_('网络接口'), res.iface),
					controls.state(_('拨号模式'), modeName || '--'),
					controls.state(_('接口协议'), (res.ifstat || {}).proto || '--'),
					E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 暂以 QModem 网络配置为准。'))
				]),
				controls.card(_('IP 透传 / Post-Route / DMZ'), _('模组侧入站转发。'), [
					controls.state(_('IP 透传'), '--'),
					controls.state('Post-Route', '--'),
					controls.state('DMZ', '--'),
					E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 暂以 QModem 网络配置为准：QModem 未导出这些模组私有设置，此处仅作只读展示，请在「网络」中配置转发与 DMZ。'))
				])
			])
		]);

		return m.render().then(function(formNode) {
			return E('div', { 'class': 'mtconn-page mt-ui-page' }, [
				self.styleNode(),
				controls.styleNode(),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, _('部分数据读取失败：') + res.errors.join('；')) : null,
				modemBar,
				E('section', { 'class': 'mtconn-hero mt-ui-hero' }, [
					E('div', {}, [
						E('h2', { 'class': 'mtconn-title' }, _('移动数据')),
						E('div', { 'class': 'mtconn-sub' }, _('配置模组如何经 QModem 接入移动网络。'))
					]),
					E('div', { 'class': 'mtconn-state' + (connected ? ' online' : '') }, [
						E('span', { 'class': 'mtconn-dot' }),
						connected ? _('已连接') : _('未连接')
					])
				]),
				E('div', { 'class': 'mtconn-facts' }, [
					self.fact(_('配置节'), section),
					self.fact(_('网络接口'), res.iface),
					self.fact('APN', configuredApn),
					self.fact(_('IP 协议'), configuredPdp)
				]),
				self.addressPanel(res),
				E('div', { 'class': 'mtconn-actions' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': function() { return self.runAction(function() { return controls.modemDial(section); }, _('已开始拨号。')); }
					}, _('拨号')),
					E('button', {
						'class': 'btn cbi-button-negative',
						'click': function() {
							return controls.confirmModal(_('挂断移动数据'), _('现在断开移动数据连接？'), function() {
								return controls.modemHang(section);
							});
						}
					}, _('挂断')),
					E('button', {
						'class': 'btn',
						'click': function() {
							return controls.confirmModal(_('重新拨号'), _('重拨期间移动数据会短暂中断。'), function() {
								return controls.modemRedial(section);
							});
						}
					}, _('重拨'))
				]),
				E('section', { 'class': 'mtconn-config mt-ui-card' }, [
					E('div', { 'class': 'mtconn-config-head' }, [
						E('h3', {}, _('拨号设置（APN）')),
						E('p', {}, _('保存后写入 /etc/config/qmodem 的当前模组配置节，再点击「重拨」使其生效。'))
					]),
					formNode,
					E('div', { 'class': 'mt-control-actions' }, E('button', {
						'type': 'button',
						'class': 'btn cbi-button-apply',
						'click': ui.createHandlerFn(self, saveApn)
					}, _('保存 APN 设置')))
				]),
				E('details', { 'class': 'mtconn-advanced mt-ui-details' }, [
					E('summary', {}, [
						E('span', { 'class': 'mt-ui-summary-copy' }, [
							E('span', { 'class': 'mt-ui-summary-title' }, _('高级连接信息')),
							E('span', { 'class': 'mt-ui-summary-desc' }, _('数据通路与入站转发的只读展示（经 QModem）。'))
						]),
						E('span', { 'class': 'mt-ui-chevron', 'aria-hidden': 'true' }, '›')
					]),
					E('div', { 'class': 'mtconn-advanced-body mt-ui-details-body' }, [ inboundPanel ])
				]),
				logDetails
			]);
		}).catch(function(err) {
			return E('div', { 'class': 'mtconn-page mt-ui-page' }, [
				self.styleNode(),
				controls.styleNode(),
				E('div', { 'class': 'alert-message danger' }, _('页面渲染失败：') + ((err && err.message) || String(err)))
			]);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
