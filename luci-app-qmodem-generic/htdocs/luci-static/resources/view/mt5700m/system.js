'use strict';
'require view';
'require ui';
'require mt5700m.controls as controls';

/*
 * 模组与 SIM 页面 — 数据与动作全部经 QModem 的 `qmodem` ubus 对象。
 * 旧的文本后端已全部移除。部分模块专有能力（LED、热保护阈值写入、
 * SIM 激活、FOTA）QModem 没有通用方法，只能通过 sendAt 做 AT 透传，失败时给出告警。
 */

var SIM_STATUS_TEXT = {
	'READY': _('Ready'),
	'SIM READY': _('Ready'),
	'SIM PIN': _('PIN required'),
	'SIM PUK': _('PUK required'),
	'SIM PIN2': _('PIN2 required'),
	'SIM PUK2': _('PUK2 required'),
	'NOT INSERTED': _('No SIM detected'),
	'NOT READY': _('SIM not ready'),
	'NOSIM': _('No SIM detected')
};

function simStatusText(value) {
	if (!value) return '--';
	return SIM_STATUS_TEXT[String(value).toUpperCase().trim()] || value;
}

return view.extend({
	load: function() {
		var self = this;
		return controls.resolveSection().then(function(section) {
			self.section = section;
			if (!section)
				return { section: null, errors: [] };

			var errors = [];
			function guard(promise, fallback, label) {
				return promise.then(function(value) { return value; }, function(err) {
					errors.push(label + ': ' + ((err && err.message) || String(err)));
					return fallback;
				});
			}

			return Promise.all([
				guard(controls.getSimInfo(section), [], _('SIM information')),
				guard(controls.getBaseInfo(section), [], _('Module information')),
				guard(controls.getImei(section), {}, 'IMEI'),
				guard(controls.getSimSlot(section), {}, _('SIM slot')),
				guard(controls.getSimSwitchCapabilities(section), {}, _('SIM slot switching')),
				guard(controls.getAtCfg(section), {}, _('AT port'))
			]).then(function(results) {
				return {
					section: section,
					sim: controls.entryList(results[0]),
					base: controls.entryList(results[1]),
					imei: results[2] || {},
					slot: results[3] || {},
					caps: results[4] || {},
					atCfg: results[5] || {},
					errors: errors
				};
			});
		}).catch(function(err) {
			return { section: null, errors: [ (err && err.message) || String(err) ] };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-system{max-width:1120px;margin:0 auto;color:var(--text-color-high,#20242a)}',
			'.mt-system-hero{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px 24px;border-radius:15px;background:linear-gradient(135deg,#304667,#3b587d);color:#fff;margin-bottom:15px}',
			'.mt-system-kicker{font-size:12px;font-weight:700;opacity:.72;margin-bottom:5px}.mt-system-title{font-size:25px;font-weight:720;margin:0 0 6px;color:#fff}.mt-system-sub{font-size:13px;opacity:.8}',
			'.mt-system-temp{min-width:92px;text-align:center;padding:11px 14px;border-radius:12px;background:rgba(255,255,255,.12)}.mt-system-temp strong{display:block;font-size:24px}.mt-system-temp span{font-size:11px;opacity:.75}',
			'.mt-system-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.mt-system-card{padding:16px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff);box-shadow:0 3px 12px rgba(20,32,50,.04)}.mt-system-card.wide{grid-column:1/-1}',
			'.mt-system-card h3{font-size:14px;margin:0 0 11px}.mt-system-row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4);font-size:12px}.mt-system-row:last-child{border-bottom:0}.mt-system-row span{color:var(--text-color-medium,#6e7783)}.mt-system-row strong{text-align:right;word-break:break-word}',
			'.mt-system-fota{margin-top:14px;padding:18px;border:1px solid #ead7b2;border-radius:13px;background:linear-gradient(135deg,#fffdf8,#fff9ec)}.mt-system-fota-head{display:flex;justify-content:space-between;align-items:flex-start;gap:15px}.mt-system-fota h3{font-size:16px;margin:0 0 5px}.mt-system-fota p{font-size:12px;color:#74664c;margin:0;line-height:1.5}',
			'.mt-system-state{padding:5px 10px;border-radius:999px;background:#edf1f7;color:#4e5d73;font-size:11px;font-weight:700;white-space:nowrap}.mt-system-state.active{background:#e0f5ed;color:#08775d}.mt-system-state.error{background:#fde7e3;color:#a43e2c}',
			'.mt-system-progress{height:8px;margin:16px 0 7px;border-radius:999px;background:#eadfc8;overflow:hidden}.mt-system-progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#328df4,#15aa8d)}.mt-system-progress-label{font-size:11px;color:#7b6d52;text-align:right}',
			'.mt-system-url{display:grid;grid-template-columns:1fr auto;gap:9px;margin-top:14px}.mt-system-url input{width:100%;box-sizing:border-box}.mt-system-url .btn,.mt-system-actions .btn{border-radius:9px}',
			'.mt-system-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.mt-system-details{margin-top:14px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:11px;overflow:hidden}.mt-system-details summary{cursor:pointer;padding:12px 14px;font-size:12px;font-weight:650}.mt-system-raw{margin:0;padding:14px;background:#17202a;color:#dce6ef;white-space:pre-wrap;word-break:break-word;font:11px/1.55 monospace;max-height:420px;overflow:auto}',
			'.mt-system-maintenance{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-top:14px;padding:16px 18px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-system-maintenance h3{margin:0 0 4px;font-size:15px}.mt-system-maintenance p{margin:0;color:var(--text-color-medium,#6e7783);font-size:11px}.mt-system-maintenance .mt-system-actions{margin:0;justify-content:flex-end}.mt-system-thermal-form{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;max-height:46vh;overflow:auto}',
			'@media(max-width:720px){.mt-system-hero{align-items:flex-start}.mt-system-grid{grid-template-columns:1fr}.mt-system-card.wide{grid-column:auto}.mt-system-url{grid-template-columns:1fr}.mt-system-url .btn{width:100%}.mt-system-maintenance{display:block}.mt-system-maintenance .mt-system-actions{margin-top:12px;justify-content:flex-start}.mt-system-thermal-form{grid-template-columns:1fr}}'
		].join(''));
	},

	row: function(label, value) {
		return E('div', { 'class': 'mt-system-row' }, [ E('span', {}, label), E('strong', {}, value || '--') ]);
	},

	// AT 透传：QModem 无通用方法的模块专有动作走这里，失败只告警不回退旧后端。
	atRun: function(command, okMessage) {
		return controls.sendAt(this.section, this.atPort, command).then(function(res) {
			var text = (res && (res.result || res.response || res.at_response)) || '';
			if (/ERROR/i.test(String(text))) {
				ui.addNotification(null, E('p', {}, _('The module rejected the AT passthrough command %s: %s').format(command, String(text).trim())), 'warning');
				return Promise.reject(new Error(String(text).trim()));
			}
			ui.addNotification(null, E('p', {}, (okMessage || _('Command accepted by the modem.')) + ' [' + command + ']'));
			return res;
		}, function(err) {
			ui.addNotification(null, E('p', {}, _('This module does not support the AT passthrough command %s via QModem: %s').format(command, (err && err.message) || String(err))), 'warning');
			return Promise.reject(err);
		});
	},

	reloadLater: function(delay) {
		window.setTimeout(function() { window.location.reload(); }, delay || 1500);
	},

	showPinManager: function(simState) {
		var self = this;
		var operation = controls.select([
			['verify',_('Verify current PIN')],['enable',_('Enable PIN lock')],['disable',_('Disable PIN lock')],
			['change',_('Change PIN')],['unblock',_('Unlock with PUK')]
		], /PUK/i.test(simState || '') ? 'unblock' : 'verify');
		var first = E('input', { 'class':'cbi-input-text', 'type':'password', 'inputmode':'numeric', 'autocomplete':'off' });
		var second = E('input', { 'class':'cbi-input-text', 'type':'password', 'inputmode':'numeric', 'autocomplete':'new-password' });
		var firstLabel = E('label', {}, _('PIN'));
		var secondRow = controls.row(_('New PIN'), second);
		function update() {
			firstLabel.textContent = operation.value === 'unblock' ? _('PUK code') : operation.value === 'change' ? _('Current PIN') : _('PIN');
			secondRow.style.display = operation.value === 'change' || operation.value === 'unblock' ? '' : 'none';
		}
		operation.addEventListener('change', update);
		window.setTimeout(update, 0);
		return ui.showModal(_('SIM PIN management'), [
			E('div', { 'class':'alert-message warning' }, _('Incorrect PIN or PUK attempts can permanently lock the SIM. Check the carrier documentation before continuing.')),
			E('div', { 'class':'mt-control-note' }, _('PIN operations are sent to the module as AT commands through QModem.')),
			controls.row(_('Operation'), operation), E('div', { 'class':'mt-control-row' }, [ firstLabel, first ]), secondRow,
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('Cancel')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var firstValue = first.value.trim(), secondValue = second.value.trim();
				if ((operation.value === 'unblock' ? !/^\d{8}$/.test(firstValue) : !/^\d{4,8}$/.test(firstValue)) || ((operation.value === 'change' || operation.value === 'unblock') && !/^\d{4,8}$/.test(secondValue)))
					return ui.addNotification(null, E('p', {}, _('PIN must contain 4–8 digits; PUK must contain exactly 8 digits.')), 'warning');
				var command;
				switch (operation.value) {
				case 'change':  command = 'AT+CPWD="SC","' + firstValue + '","' + secondValue + '"'; break;
				case 'enable':  command = 'AT+CLCK="SC",1,"' + firstValue + '"'; break;
				case 'disable': command = 'AT+CLCK="SC",0,"' + firstValue + '"'; break;
				case 'unblock': command = 'AT+CPIN="' + firstValue + '","' + secondValue + '"'; break;
				default:        command = 'AT+CPIN="' + firstValue + '"'; break;
				}
				ui.hideModal();
				self.atRun(command, _('SIM PIN command accepted.')).then(function() {
					self.reloadLater(1200);
				}).catch(function() {});
			} }, _('Apply')) ])
		]);
	},

	// 热保护阈值：QModem 只能读取温度，写入无通用方法，走 AT 透传，失败提示。
	showThermalManager: function(temperature) {
		var self = this;
		var labels = [
			_('Normal threshold'), _('First power reduction'), _('First recovery'),
			_('Second power reduction'), _('Second recovery'), _('Continuous power limit'),
			_('Continuous-limit recovery'), _('Emergency airplane mode'), _('Emergency recovery')
		];
		var inputs = labels.map(function() {
			return E('input', { 'class':'cbi-input-text', 'type':'number', 'min':'0', 'max':'150', 'value':'' });
		});
		var serialLog = controls.select([['0',_('Disabled')],['1',_('Enabled')]], '0');
		var fileLog = controls.select([['0',_('Disabled')],['1',_('Enabled')]], '0');
		return ui.showModal(_('Thermal protection settings'), [
			E('div', { 'class':'alert-message warning' }, _('Incorrect thresholds can cause performance loss, overheating or an emergency radio shutdown. Keep every recovery value below its matching trigger value.')),
			E('div', { 'class':'mt-control-note' }, _('QModem only reports the module temperature (currently %s). Threshold writing has no generic QModem method and is sent as an AT passthrough command; the module may reject it.').format(temperature || '--')),
			E('div', { 'class':'mt-system-thermal-form' }, labels.map(function(label, index) { return controls.row(label + ' (°C)', inputs[index]); })),
			controls.row(_('Serial thermal log'), serialLog), controls.row(_('Stored thermal log'), fileLog),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('Cancel')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var next = inputs.map(function(input) { return String(input.value || ''); });
				if (next.some(function(value) { return !/^\d+$/.test(value) || Number(value) > 150; }))
					return ui.addNotification(null, E('p', {}, _('Every threshold must be a temperature from 0 to 150°C.')), 'warning');
				if (!(Number(next[1]) > Number(next[0]) && Number(next[3]) > Number(next[1]) && Number(next[5]) > Number(next[3]) && Number(next[7]) > Number(next[5]) && Number(next[2]) < Number(next[1]) && Number(next[4]) < Number(next[3]) && Number(next[6]) < Number(next[5]) && Number(next[8]) < Number(next[7])))
					return ui.addNotification(null, E('p', {}, _('Trigger temperatures must rise by level, and each recovery temperature must be lower than its trigger.')), 'warning');
				ui.hideModal();
				self.atRun('AT^THERMLDAUTOPARA=' + next.join(','), _('Thermal settings saved.')).then(function() {
					return self.atRun('AT^THERMLDLOGSW=' + serialLog.value + ',' + fileLog.value, _('Thermal logging updated.'));
				}).then(function() {
					self.reloadLater(1200);
				}).catch(function() {});
			} }, _('Apply')) ])
		]);
	},

	showIdentityLab: function(currentImei) {
		var self = this;
		var input = E('input', { 'class':'cbi-input-text', 'inputmode':'numeric', 'maxlength':'15', 'placeholder':currentImei || '123456789012345' });
		return ui.showModal(_('Device identity laboratory'), [
			E('div', { 'class':'alert-message warning' }, _('IMEI writing may be restricted by local law or the mobile operator. This control is provided only for restoring the original device identity.')),
			controls.row(_('Current IMEI'), E('strong', {}, currentImei || '--')),
			controls.row(_('New IMEI'), input),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('Cancel')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var value = input.value.trim();
				if (!/^\d{15}$/.test(value) || value === currentImei)
					return ui.addNotification(null, E('p', {}, _('Enter a different 15-digit IMEI.')), 'warning');
				ui.hideModal();
				controls.confirmModal(_('Write device identity'), _('This operation can prevent network registration. Continue only when restoring the identity printed on the module label.'), function() {
					return controls.setImei(self.section, value).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('IMEI write failed: %s').format((err && err.message) || String(err))), 'danger');
						throw err;
					});
				}, true);
			} }, _('Review change')) ])
		]);
	},

	showFactoryReset: function() {
		var self = this;
		var confirm = E('input', { 'class':'cbi-input-text', 'placeholder':'RESET', 'autocomplete':'off' });
		return ui.showModal(_('Restore module factory settings'), [
			E('div', { 'class':'alert-message warning' }, _('This erases module-side APN, radio, SIM, interface and thermal settings, then restarts the module. OpenWrt settings are not erased.')),
			controls.row(_('Type RESET to confirm'), confirm),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('Cancel')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				if (confirm.value !== 'RESET') return ui.addNotification(null, E('p', {}, _('Confirmation text does not match.')), 'warning');
				ui.hideModal();
				controls.confirmModal(_('Restore factory settings'), _('The module will reset its own configuration and restart.'), function() {
					return controls.sendAt(self.section, self.atPort, 'AT+CFUN=1').catch(function() {
						return controls.doReboot(self.section, 'hard');
					}).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('Factory reset failed: %s').format((err && err.message) || String(err))), 'danger');
						throw err;
					});
				}, true);
			} }, _('Restore factory settings')) ])
		]);
	},

	render: function(res) {
		var self = this;
		res = res || {};

		if (!res.section) {
			return E('div', { 'class': 'mt-system mt-ui-page' }, [
				this.styleNode(), controls.styleNode(),
				E('div', { 'class': 'alert-message warning' }, _('Modem not detected (make sure QModem has recognised the device).')),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, (res.errors || []).join(' / ')) : null
			]);
		}

		this.section = res.section;
		var atCfg = (res.atCfg && res.atCfg.at_cfg) ? res.atCfg.at_cfg : (res.atCfg || {});
		this.atPort = atCfg.at_port || controls.findEntry(res.base, 'at_port') || '';
		var atPortLabel = this.atPort;

		var baseMap = controls.entryMap(res.base);
		var simMap = controls.entryMap(res.sim);

		var model = baseMap['name'] || _('Modem');
		var manufacturer = baseMap['manufacturer'] || '--';
		var revision = baseMap['revision'] || '';
		var temperature = controls.findEntry(res.base, 'temperature') || '';

		var simStatusRaw = simMap['SIM Status'] || '';
		var simStatus = simStatusText(simStatusRaw);
		var simNumber = simMap['SIM Number'] || _('Not stored on SIM');
		var imsi = simMap['IMSI'] || '--';
		var imei = (res.imei && res.imei.imei) || controls.findEntry(res.sim, 'IMEI') || '--';
		var currentSlot = (res.slot && res.slot.sim_slot != null) ? String(res.slot.sim_slot) : (simMap['SIM Slot'] != null ? String(simMap['SIM Slot']) : '');

		var caps = res.caps || {};
		var slotList = Array.isArray(caps.simSlots) && caps.simSlots.length ? caps.simSlots : [ '0', '1' ];
		var slotSupported = String(caps.supportSwitch) === '1';
		var simSlot = controls.select(slotList.map(function(slot) {
			return [ String(slot), _('SIM slot %s').format(slot) ];
		}), currentSlot || String(slotList[0]));
		if (!slotSupported) simSlot.setAttribute('disabled', 'disabled');

		var ledSelect = controls.select([['1',_('Enabled')],['0',_('Disabled')]], '1');
		var simEnabled = controls.select([['1',_('Active')],['0',_('Inactive')]], '1');
		var fotaUrl = E('input', { 'class': 'cbi-input-text', 'placeholder': 'http://server/path/' });

		var raw = JSON.stringify({
			config_section: res.section,
			base_info: res.base,
			sim_info: res.sim,
			imei: res.imei,
			sim_slot: res.slot,
			sim_switch_capabilities: res.caps,
			at_cfg: atCfg
		}, null, 2);

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		return E('div', { 'class': 'mt-system mt-ui-page' }, [
			this.styleNode(),
			controls.styleNode(),
			(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, (res.errors || []).join(' / ')) : null,
			modemBar,
			E('section', { 'class': 'mt-system-hero mt-ui-hero' }, [
				E('div', {}, [
					E('div', { 'class': 'mt-system-kicker' }, _('MODULE SYSTEM')),
					E('h2', { 'class': 'mt-system-title' }, model),
					E('div', { 'class': 'mt-system-sub' }, revision || _('Module information'))
				]),
				E('div', { 'class': 'mt-system-temp' }, [
					E('strong', {}, temperature || '--'),
					E('span', {}, _('Module temperature'))
				])
			]),
			E('div', { 'class': 'mt-system-grid' }, [
				E('section', { 'class': 'mt-system-card mt-ui-card' }, [
					E('h3', {}, _('Module information')),
					this.row(_('Model'), model),
					this.row(_('Manufacturer'), manufacturer),
					this.row(_('Firmware version'), revision),
					this.row('IMEI', imei),
					this.row(_('AT port'), atPortLabel)
				]),
				E('section', { 'class': 'mt-system-card mt-ui-card' }, [
					E('h3', {}, _('SIM and subscription')),
					this.row(_('Phone Number'), simNumber),
					this.row('ICCID', '--'),
					this.row('IMSI', imsi),
					this.row(_('SIM slot'), currentSlot !== '' ? currentSlot : '--'),
					E('div', { 'class':'mt-control-note' }, _('ICCID is not exposed by QModem for this module. Device and SIM identifiers are displayed only in this local management page.'))
				]),
				E('section', { 'class': 'mt-system-card mt-ui-card' }, [
					E('h3', {}, _('Runtime status')),
					this.row(_('SIM Status'), simStatus),
					this.row(_('Connection status'), baseMap['connect_status'] || '--'),
					this.row(_('SIM slot switching'), slotSupported ? _('Supported') : _('Not supported')),
					this.row(_('Radio function'), _('Use the buttons below')),
					this.row(_('Module temperature'), temperature || '--')
				]),
				E('section', { 'class': 'mt-system-card mt-ui-card' }, [
					E('h3', {}, _('Thermal protection status')),
					this.row(_('Current temperature'), temperature || '--'),
					this.row(_('Protection level'), '--'),
					this.row(_('Configured thresholds'), '--'),
					E('div', { 'class':'mt-control-note' }, _('QModem only reports the module temperature; thermal thresholds cannot be read back. Writing them uses an AT passthrough command.'))
				]),
				E('section', { 'class': 'mt-system-card wide mt-ui-card' }, [
					E('h3', {}, _('SIM and radio')),
					E('div', { 'class':'mt-control-desc' }, _('Daily SIM and radio controls, executed through the QModem ubus interface.')),
					controls.state(_('Current SIM state'), simStatus),
					E('div', { 'class': 'mt-system-actions' }, [
						E('button', { 'class':'btn cbi-button-negative', 'click': function() {
							controls.confirmModal(_('Change radio function'), _('Airplane mode immediately disconnects mobile data and voice service.'), function() {
								return controls.sendAt(self.section, self.atPort, 'AT+CFUN=0').catch(function(err) {
									ui.addNotification(null, E('p', {}, _('Airplane mode failed: %s').format((err && err.message) || String(err))), 'danger');
									throw err;
								});
							}, false);
						} }, _('Enter airplane mode')),
						E('button', { 'class':'btn cbi-button-apply', 'click': function() {
							controls.confirmModal(_('Change radio function'), _('Resume mobile registration and data service?'), function() {
								return controls.sendAt(self.section, self.atPort, 'AT+CFUN=1,1').catch(function() {
									return controls.doReboot(self.section, 'soft');
								}).catch(function(err) {
									ui.addNotification(null, E('p', {}, _('Resuming the radio failed: %s').format((err && err.message) || String(err))), 'danger');
									throw err;
								});
							}, true);
						} }, _('Resume mobile radio'))
					]),
					controls.row(_('Module status LED'), ledSelect),
					controls.action(_('Apply LED setting'), function() {
						controls.confirmModal(_('Module status LED'), _('QModem has no generic LED method; the setting is sent as a module-specific AT command and takes effect after restart.'), function() {
							return self.atRun('AT^LEDSWITCH=' + ledSelect.value, _('LED setting accepted.'));
						}, true);
					}),
					controls.action(_('Manage SIM PIN'), function() { self.showPinManager(simStatusRaw); }),
					controls.row(_('SIM activation'), simEnabled),
					controls.action(_('Apply SIM activation'), function() {
						controls.confirmModal(_('SIM activation'), simEnabled.value === '1' ? _('Activate the physical SIM for network registration?') : _('Deactivating the SIM immediately removes mobile service.'), function() {
							return self.atRun('AT^HVSST=' + simEnabled.value, _('SIM activation command accepted.'));
						}, simEnabled.value === '0');
					}),
					controls.row(_('Active SIM slot'), simSlot),
					controls.action(_('Switch SIM slot'), function() {
						if (!slotSupported)
							return ui.addNotification(null, E('p', {}, _('This module does not report SIM slot switching support through QModem.')), 'warning');
						controls.confirmModal(_('Switch SIM slot'), _('The module will detach from the network while changing the physical SIM path.'), function() {
							return controls.setSimSlot(self.section, simSlot.value).catch(function(err) {
								ui.addNotification(null, E('p', {}, _('SIM slot switch failed: %s').format((err && err.message) || String(err))), 'danger');
								throw err;
							});
						}, true);
					}),
					caps.ExtraInfo ? E('div', { 'class':'mt-control-note' }, caps.ExtraInfo) : null
				])
			]),
			E('section', { 'class':'mt-system-maintenance mt-ui-card' }, [
				E('div', {}, [ E('h3', {}, _('Protection and maintenance')), E('p', {}, _('Module protection, recovery and communication troubleshooting tools.')) ]),
				E('div', { 'class':'mt-system-actions' }, [
					E('a', { 'class':'btn', 'href':L.url('admin/modem/mt5700m/settings') }, _('Communication diagnostics')),
					E('button', { 'class':'btn', 'click':function() { self.showThermalManager(temperature); } }, _('Configure thermal protection')),
					E('button', { 'class':'btn', 'click':function() { self.showIdentityLab(imei !== '--' ? imei : ''); } }, _('Device identity laboratory')),
					E('button', { 'class':'btn cbi-button-negative', 'click':function() { self.showFactoryReset(); } }, _('Restore factory settings'))
				])
			]),
			E('section', { 'class': 'mt-system-fota mt-ui-card' }, [
				E('div', { 'class': 'mt-system-fota-head' }, [
					E('div', {}, [ E('h3', {}, _('Firmware update')), E('p', {}, _('QModem does not expose FOTA status for this module; the download request is sent as an AT passthrough command. Do not interrupt power during installation.')) ]),
					E('span', { 'class': 'mt-system-state' }, _('Status unavailable'))
				]),
				E('div', { 'class': 'mt-system-progress' }, E('span', { 'style': 'width:0%' })),
				E('div', { 'class': 'mt-system-progress-label' }, _('%d%% complete').format(0)),
				E('div', { 'class': 'mt-system-url' }, [ fotaUrl, E('button', { 'class': 'btn cbi-button-action', 'click': function() {
					if (!/^http:\/\//.test(fotaUrl.value || ''))
						return ui.addNotification(null, E('p', {}, _('Enter a valid HTTP update-server URL.')), 'warning');
					controls.confirmModal(_('Start firmware download'), _('The modem will contact the specified server and may temporarily use mobile data.'), function() {
						return self.atRun('AT^FOTADL="' + fotaUrl.value.replace(/"/g, '') + '"', _('Firmware download request accepted.'));
					}, false);
				} }, _('Check and download')) ]),
				E('div', { 'class': 'mt-system-actions' }, [
					E('button', { 'class': 'btn cbi-button', 'click': function() { window.location.reload(); } }, _('Refresh status')),
					E('button', { 'class': 'btn cbi-button-negative', 'click': function() {
						controls.confirmModal(_('Restart Module'), _('This will restart the module and temporarily interrupt mobile connectivity.'), function() {
							return controls.doReboot(self.section, 'soft').catch(function(err) {
								ui.addNotification(null, E('p', {}, _('Module restart failed: %s').format((err && err.message) || String(err))), 'danger');
								throw err;
							});
						}, true);
					} }, _('Restart Module'))
				])
			]),
			E('details', { 'class': 'mt-system-details mt-ui-details' }, [
				E('summary', {}, [
					E('span', { 'class':'mt-ui-summary-copy' }, E('span', { 'class':'mt-ui-summary-title' }, _('Technical details'))),
					E('span', { 'class':'mt-ui-chevron', 'aria-hidden':'true' }, '›')
				]),
				E('pre', { 'class': 'mt-system-raw mt-ui-details-body' }, raw || _('No response.'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
