'use strict';
'require view';
'require ui';
'require dom';
'require mt5700m.controls as controls';

/*
 * 高级设置（Advanced）
 *
 * 数据与动作全部经由 QModem 的 `qmodem` ubus 对象（由 mt5700m.controls 封装）：
 *   get_disabled_features / get_reboot_caps / get_at_cfg / get_copyright /
 *   base_info / get_mode / get_network_prefer / get_lockband
 * 控制动作：do_reboot / set_mode / set_network_prefer / set_lockband / send_at。
 *
 * 旧的 AT 文本后端、旧 ubus 对象与所有 AT 文本正则解析已全部移除。
 * QModem 没有通用方法的模块专有能力（USB 模式、PCIe、SIM 热插拔、热保护阈值）
 * 只能经 QModem 的 send_at 做 AT 透传，属尽力而为，失败时给出告警而不回退旧后端。
 */

/* ------------------------------------------------------------------ */
/* 防御式取值辅助                                                       */
/* ------------------------------------------------------------------ */

/* 出错时不抛异常，记入 errors 数组，返回 null，避免白屏 */
function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

/* 忽略大小写/空格/下划线的键查找，支持多个候选键名 */
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

/* 取出 { <key>: {...} } 里的子对象，取不到时返回空对象 */
function plainObject(raw, key) {
	if (!raw || typeof raw !== 'object')
		return {};
	var inner = ci(raw, [ key ]);
	if (inner && typeof inner === 'object' && !Array.isArray(inner))
		return inner;
	return {};
}

/* 从字典里按多个候选键名取第一个有值的标量字段 */
function pick(map, names) {
	var v = ci(map, names);
	if (v === undefined || v === null || typeof v === 'object')
		return '';
	return String(v).trim();
}

/* 显示值：空/未知一律显示 -- */
function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

/* getDisabledFeatures → 归一化后的特性名数组 */
function disabledSet(raw) {
	var list = (raw && (ci(raw, [ 'disabled_features' ]) || raw)) || [];
	if (!Array.isArray(list))
		list = [];
	return list.map(function(x) { return String(x).toLowerCase().replace(/[\s_\-]/g, ''); });
}

function isDisabled(list, name) {
	return list.indexOf(String(name).toLowerCase().replace(/[\s_\-]/g, '')) !== -1;
}

/* send_at 返回值形态不固定，尽力取出文本 */
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

/* lockband 的 lock_band / available_band 元素统一成 {id, name} */
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

/* 频段类别中文名 */
var BAND_CLASS_LABEL = {
	GW: _('2G / 3G（GSM / WCDMA）'),
	LTE: _('4G LTE'),
	NRNSA: _('5G NR（NSA 非独立组网）'),
	NRSA: _('5G NR（SA 独立组网）')
};

/* 拨号/网络模式中文名 */
var MODE_LABEL = {
	auto: _('自动'), ecm: 'ECM', ncm: 'NCM', rndis: 'RNDIS',
	mbim: 'MBIM', qmi: 'QMI', gobinet: 'GobiNet', ppp: 'PPP'
};

function modeLabel(key) {
	return MODE_LABEL[String(key).toLowerCase()] || String(key).toUpperCase();
}

/* QModem 上报的被禁用特性名 → 中文说明 */
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

return view.extend({
	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

			if (!section)
				return { section: null, errors: errors };

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
			return { section: null, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-hardware{max-width:1120px;margin:0 auto}.mt-hardware-head{padding:22px 24px;border-radius:15px;background:linear-gradient(135deg,#263b59,#354d70);color:#fff;margin-bottom:16px}.mt-hardware-head h2{color:#fff;margin:0 0 7px;font-size:24px}.mt-hardware-head p{margin:0;opacity:.84;font-size:13px;line-height:1.55}',
			'.mt-hardware-warning{margin-bottom:14px}.mt-hardware-details{margin-top:14px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:11px;overflow:hidden}.mt-hardware-details summary{cursor:pointer;padding:12px 14px;font-size:12px;font-weight:650}.mt-hardware-raw{margin:0;padding:14px;background:#17202a;color:#dce6ef;white-space:pre-wrap;word-break:break-word;font:11px/1.55 monospace;max-height:420px;overflow:auto}',
			'.mt-hardware-tools{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:18px;padding:16px 18px}.mt-hardware-tools h3{margin:0 0 4px;font-size:14px}.mt-hardware-tools p{margin:0;color:var(--mt-ui-muted);font-size:10px;line-height:1.45}.mt-hardware-tool-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}',
			'.mt-hardware-caps{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.mt-hardware-cap{padding:4px 10px;border-radius:999px;background:#fdecec;color:#a43e2c;font-size:11px;font-weight:650}.mt-hardware-cap.ok{background:#e0f5ed;color:#08775d}',
			'.mt-hardware-bands{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}.mt-hardware-band{padding:17px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-hardware-band h4{margin:0 0 4px;font-size:14px}.mt-hardware-band p{margin:0 0 11px;color:var(--text-color-medium,#6d7680);font-size:11px;line-height:1.45}',
			'.mt-band-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.mt-band-option{display:flex;align-items:center;gap:9px;min-height:40px;padding:7px 10px;border:1px solid var(--border-color-low,#e8ecf0);border-radius:9px;background:var(--background-color-low,#f8fafb);cursor:pointer;font-size:12px}.mt-band-option:hover{border-color:#9cc5ee;background:#f1f7fd}.mt-band-option input{flex:0 0 auto;width:16px!important;height:16px;margin:0}.mt-band-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
			'.mt-hardware-at{display:flex;gap:8px;align-items:center;margin-top:12px}.mt-hardware-at .btn{border-radius:9px}',
			'@media(max-width:760px){.mt-hardware-head{padding:20px}.mt-hardware-tools{display:block}.mt-hardware-tool-actions{justify-content:flex-start;margin-top:12px}.mt-hardware-bands{grid-template-columns:1fr}.mt-band-options{grid-template-columns:repeat(2,minmax(0,1fr))}}',
			'@media(max-width:430px){.mt-band-options{grid-template-columns:1fr}}'
		].join(''));
	},

	/* ---------------- AT 透传（无专用 QModem 方法时使用） ---------------- */

	/* 下发 AT，失败或模组返回 ERROR 时仅告警，不回退旧后端 */
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

	/* 读取当前值按钮：QModem 不上报这些模块私有参数，只能查询 AT 后回填下拉框 */
	queryButton: function(section, atPort, command, re, target) {
		var self = this;
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

	/* 一个「下拉框 + 读取 + 应用」的 AT 透传卡片 */
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

	/* ---------------- 模组能力与重启 ---------------- */

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
			_('由 QModem 的 get_disabled_features / get_reboot_caps 上报。被禁用的特性在本插件中已隐藏或降级为只读。'), [
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
						_('模组将断电复位。若模组供电受主板控制，可能同时影响 PCIe/USB 链路。'))
				]),
				(!soft && !hard) ? E('div', { 'class': 'mt-control-note' },
					_('本模组经 QModem 未上报任何可用的重启方式（reboot_caps 全为 0）。')) : null
			]);
	},

	/* ---------------- 有专用 QModem 方法的无线控制 ---------------- */

	modeCard: function(section, modeRaw, disabled) {
		if (isDisabled(disabled, 'setmode'))
			return controls.card(_('网络模式'), _('模组对外呈现的拨号模式。'), [
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用拨号模式切换（disabled_features 含 "SetMode"）。'))
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
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用网络优选（disabled_features 含 "NetworkPrefer"）。'))
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
			return E('label', { 'class': 'mt-band-option' }, [ box, E('span', {}, k) ]);
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
				return E('section', { 'class': 'mt-hardware-band mt-ui-card' }, [
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
			boxes.push(box);
			return E('label', { 'class': 'mt-band-option' }, [ box, E('span', {}, item.name) ]);
		});

		return E('section', { 'class': 'mt-hardware-band mt-ui-card' }, [
			E('h4', {}, label),
			E('p', {}, _('已锁定 %d 个频段，共 %d 个可用频段。不勾选任何频段表示解除锁定。')
				.format(locked.length, available.length)),
			E('div', { 'class': 'mt-band-options' }, options),
			E('div', { 'class': 'mt-band-actions' }, [
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() { boxes.forEach(function(b) { b.checked = false; }); }
				}, _('清空')),
				E('button', {
					'type': 'button', 'class': 'btn',
					'click': function() { boxes.forEach(function(b) { b.checked = true; }); }
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
				E('div', { 'class': 'mt-control-note' }, _('本模组经 QModem 已禁用频段锁定（disabled_features 含 "LockBand"），相关设置已隐藏。'))
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

	/* ---------------- AT 透传控制台（任意命令） ---------------- */

	passthroughCard: function(section, atPort) {
		var self = this;
		var input = E('input', { 'class': 'cbi-input-text', 'placeholder': 'AT^SETMODE?' });
		var output = E('pre', { 'class': 'mt-hardware-raw', 'style': 'margin-top:12px;max-height:220px' },
			_('尚未下发命令。'));

		return controls.card(_('AT 透传'),
			_('经 QModem 的 send_at 向模组下发任意 AT 命令，用于本页未覆盖的模块私有设置。'), [
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

	/* ---------------- 渲染 ---------------- */

	render: function(res) {
		var self = this;
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
			return E('div', { 'class': 'mt-hardware mt-ui-page' }, [].concat(
				[ this.styleNode(), controls.styleNode() ],
				warnings,
				[ modemBar,
				E('section', { 'class': 'mt-hardware-head mt-ui-hero' }, [
					E('h2', {}, _('高级设置')),
					E('p', {}, _('模组能力、重启与无线策略，全部经 QModem 的 qmodem ubus 下发。'))
				]),
				E('div', { 'class': 'alert-message warning mt-hardware-warning' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')) ]
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

		return E('div', { 'class': 'mt-hardware mt-ui-page' }, [
			this.styleNode(),
			controls.styleNode(),
			modemBar,
			E('section', { 'class': 'mt-hardware-head mt-ui-hero' }, [
				E('h2', {}, _('高级设置')),
				E('p', {}, _('模组能力、重启、无线策略与 AT 透传，供有经验的用户使用。日常使用无需修改本页设置。'))
			])
		].concat(warnings).concat([
			E('div', { 'class': 'alert-message warning mt-hardware-warning' },
				_('修改硬件接口档位可能同时中断移动数据与模组管理通道。应用前请记录当前取值。')),
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
			this.lockBandSection(section, res.lockband, disabled),
			E('section', { 'class': 'mt-control-section' }, [
				E('div', { 'class': 'mt-control-section-head' }, [
					E('h3', {}, _('模块专有硬件设置（AT 透传）')),
					E('p', {}, _('以下能力在 QModem 中没有通用方法，只能经 send_at 以模块私有 AT 命令下发；QModem 也无法回读，故默认显示「保持不变」，可点击「读取当前值」向模组查询。'))
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
						note: _('切换后 USB 网络接口会重新枚举，管理通道可能短暂中断。若已使用 QModem 的拨号模式（ECM/NCM），请优先使用上方「网络模式」。')
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
						note: _('此处选择的是硬件 PHY 档位，不会强制以太网链路协商速率。')
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
						desc: _('模组内置温度保护的轮询开关与周期。QModem 仅能读取温度，写入只能走 AT 透传。'),
						label: _('轮询周期'),
						options: [ [ '1', '1 s' ], [ '2', '2 s' ], [ '3', '3 s' ], [ '5', '5 s' ],
							[ '10', '10 s' ], [ '30', '30 s' ], [ '60', '60 s' ] ],
						query: 'AT^THERMAUTOFUN?',
						queryRe: /\^THERMAUTOFUN:\s*\d+[,\s]+\d+[,\s]+(\d+)/,
						command: function(v) { return 'AT^THERMAUTOFUN=1,1,' + v; },
						apply: _('应用热保护设置'),
						ok: _('热保护命令已被接受。'),
						note: _('日常使用请保持热保护开启。当前模组温度：%s').format(shown(baseMap['temperature'])),
						restart: false
					}),
					this.passthroughCard(section, atPort)
				])
			]),
			E('section', { 'class': 'mt-hardware-tools mt-ui-card' }, [
				E('div', {}, [
					E('h3', {}, _('诊断与开发者工具')),
					E('p', {}, _('查看模组设备参数，或直接向模组发送 AT 命令。'))
				]),
				E('div', { 'class': 'mt-hardware-tool-actions' }, [
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/mt5700m/settings') }, _('设备参数设置')),
					E('a', { 'class': 'btn cbi-button-action', 'href': L.url('admin/modem/mt5700m/terminal') }, _('AT 控制台')),
					E('button', {
						'type': 'button', 'class': 'btn',
						'click': function() { window.location.reload(); }
					}, _('刷新状态'))
				])
			]),
			E('details', { 'class': 'mt-hardware-details mt-ui-details' }, [
				E('summary', {}, [
					E('span', { 'class': 'mt-ui-summary-copy' }, [
						E('span', { 'class': 'mt-ui-summary-title' }, _('技术细节（QModem 原始数据）')),
						E('span', { 'class': 'mt-ui-summary-desc' },
							_('AT 端口：%s　供应商：%s').format(shown(atPort), shown(cr.Vendor || baseMap['manufacturer'])))
					]),
					E('span', { 'class': 'mt-ui-chevron', 'aria-hidden': 'true' }, '›')
				]),
				E('pre', { 'class': 'mt-hardware-raw mt-ui-details-body' }, rawDump || _('无响应。'))
			])
		]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
