'use strict';
'require view';
'require ui';
'require mt5700m.controls as controls';

/*
 * AT 命令终端（AT Terminal）
 *
 * 命令下发经由 QModem 的 `qmodem` ubus 对象（封装于 mt5700m.controls）：
 *   get_at_cfg → AT 端口（at_port）与可选端口列表（ports）
 *   send_at    → 发送 AT 命令并回显响应
 * 旧的 AT 文本后端（command 子命令）已移除。
 */

/* 出错时不抛异常，记入 errors 数组，返回 null，避免白屏 */
function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

/* send_at 的返回可能是 {result:'...'}、{response:'...'} 或裸字符串，逐一兜底 */
function atText(res) {
	if (res == null)
		return '';

	if (typeof res === 'string')
		return res;

	var keys = [ 'result', 'response', 'at_response', 'output', 'data', 'message', 'stdout' ];
	for (var i = 0; i < keys.length; i++) {
		var value = res[keys[i]];
		if (typeof value === 'string' && value !== '')
			return value;
	}

	if (Array.isArray(res))
		return res.join('\n');

	try { return JSON.stringify(res, null, 2); } catch (e) { return String(res); }
}

/* AT 端口列表归一化（字符串数组或 [{port|path|name}] 均可） */
function portList(raw) {
	var list = [];

	if (Array.isArray(raw))
		list = raw;
	else if (raw && typeof raw === 'object')
		list = Object.keys(raw).map(function(key) { return raw[key]; });

	return list.map(function(item) {
		if (typeof item === 'string')
			return item;
		if (item && typeof item === 'object')
			return String(item.port || item.path || item.device || item.name || '');
		return '';
	}).filter(Boolean);
}

return view.extend({
	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

			if (!section)
				return { section: null, errors: errors };

			return guard(controls.getAtCfg(section), '读取 AT 端口配置失败', errors).then(function(cfg) {
				var at = (cfg && cfg.at_cfg) ? cfg.at_cfg : (cfg || {});
				var ports = portList(at.ports);
				var port = at.at_port || '';

				if (port)
					return { section: section, port: port, ports: ports, errors: errors };

				/* at_cfg 未给出端口时，从基本信息里取 at_port */
				return guard(controls.getBaseInfo(section), '读取基本信息失败', errors).then(function(base) {
					return { section: section, port: controls.findEntry(base, 'at_port') || '', ports: ports, errors: errors };
				});
			});
		}).catch(function(err) {
			errors.push('读取 QModem 配置失败：' + ((err && err.message) || String(err)));
			return { section: null, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-terminal-hero{padding:22px 24px;border-radius:14px;background:linear-gradient(135deg,#202733,#313d4c);color:#fff;margin-bottom:16px}',
			'.mt-terminal-hero h2{color:#fff;margin:0 0 6px}.mt-terminal-hero p{color:#cbd2da;margin:0;max-width:760px}',
			'.mt-terminal-card{border:1px solid var(--border-color-low,#e4e8ec);border-radius:12px;background:var(--background-color-high,#fff);padding:18px}',
			'.mt-terminal-warning{padding:11px 13px;border-radius:8px;background:#fff7e5;color:#795300;font-size:12px;margin-bottom:14px}',
			'.mt5700m-terminal-row{display:flex;gap:8px;align-items:center;margin-bottom:14px}',
			'.mt5700m-terminal-row input{flex:1;font-family:monospace}',
			'.mt5700m-terminal-row label{font-size:12px;color:var(--text-color-medium,#6e7783);white-space:nowrap}',
			'.mt5700m-quick{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}',
			'.mt-terminal-saved-item{display:inline-flex}.mt-terminal-saved-item .btn:first-child{border-radius:4px 0 0 4px}.mt-terminal-saved-item .btn:last-child{border-radius:0 4px 4px 0;margin-left:-1px;color:#a33}',
			'.mt5700m-output{white-space:pre-wrap;word-break:break-word;background:#111820;color:#d7e1ea;border-radius:9px;padding:15px;min-height:320px;max-height:560px;overflow:auto;font-family:monospace;font-size:13px;line-height:1.55}',
			'@media(max-width:680px){.mt5700m-terminal-row{flex-wrap:wrap}.mt5700m-terminal-row input{flex-basis:100%}.mt-terminal-hero{padding:20px}}'
		].join(''));
	},

	appendOutput: function(node, text, prefix) {
		var timestamp = new Date().toLocaleTimeString();

		node.textContent += '[%s] %s %s\n'.format(timestamp, prefix, text || '');
		node.scrollTop = node.scrollHeight;
	},

	/* 当前选中的 AT 端口（为空则由 QModem 选择默认端口） */
	currentPort: function() {
		return (this.portSelect && this.portSelect.value) || this.atPort || '';
	},

	sendCommand: function(output, input) {
		var cmd = (input.value || '').trim();
		var self = this;

		if (!cmd) {
			ui.addNotification(null, E('p', {}, _('Command is empty.')), 'warning');
			return;
		}

		if (!this.section) {
			this.appendOutput(output, _('未检测到模组（请确认 QModem 已识别该设备）。'), 'ERR');
			return;
		}

		this.appendOutput(output, cmd, '>>>');
		input.value = '';

		return controls.sendAt(this.section, this.currentPort(), cmd).then(function(res) {
			var text = atText(res);

			self.appendOutput(output, text || _('No response.'), '<<<');

			if (res && typeof res === 'object' && res.error)
				self.appendOutput(output, String(res.error), 'ERR');
		}).catch(function(err) {
			self.appendOutput(output, (err && err.message) || String(err), 'ERR');
		});
	},

	quickButton: function(label, cmd, input, output) {
		var self = this;

		return E('button', {
			'class': 'btn cbi-button',
			'click': function() {
				input.value = cmd;
				self.sendCommand(output, input);
			}
		}, label);
	},

	loadSaved: function() {
		try { return JSON.parse(window.localStorage.getItem('mt5700m.at.saved') || '[]'); }
		catch (e) { return []; }
	},

	saveCommand: function(input, container, output) {
		var command = (input.value || '').trim(), self = this;
		if (!command)
			return ui.addNotification(null, E('p', {}, _('Command is empty.')), 'warning');
		var label = window.prompt(_('Name this command'), command);
		if (!label)
			return;
		var saved = this.loadSaved().filter(function(item) { return item.command !== command; });
		saved.push({ label:label.substring(0, 40), command:command });
		window.localStorage.setItem('mt5700m.at.saved', JSON.stringify(saved.slice(-20)));
		this.renderSaved(container, input, output);
	},

	renderSaved: function(container, input, output) {
		var self = this, saved = this.loadSaved();
		container.innerHTML = '';
		saved.forEach(function(item) {
			container.appendChild(E('span', { 'class':'mt-terminal-saved-item' }, [
				self.quickButton(item.label, item.command, input, output),
				E('button', { 'type':'button', 'class':'btn', 'title':_('Remove saved command'), 'click':function() {
					window.localStorage.setItem('mt5700m.at.saved', JSON.stringify(self.loadSaved().filter(function(entry) { return entry.command !== item.command; })));
					self.renderSaved(container, input, output);
				} }, '×')
			]));
		});
		container.style.display = saved.length ? '' : 'none';
	},

	render: function(res) {
		var self = this;

		res = res || {};
		this.section = res.section || null;
		this.atPort = res.port || '';
		this.portSelect = null;

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		var hero = E('section', { 'class': 'mt-terminal-hero mt-ui-hero' }, [ E('div', {}, [
			E('h2', {}, _('AT command console')),
			E('p', {}, _('Diagnostic console for advanced users. Commands are sent directly to the module and are not automatically validated.'))
		]) ]);

		if (!this.section) {
			return E('div', { 'class':'mt-terminal mt-ui-page' }, [
				this.styleNode(),
				controls.styleNode(),
				modemBar,
				hero,
				E('div', { 'class': 'alert-message warning' }, _('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null
			]);
		}

		var input = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': _('Enter AT command, for example AT^HCSQ?')
		});
		var output = E('pre', { 'class': 'mt5700m-output' }, _('Ready.'));
		var saved = E('div', { 'class':'mt5700m-quick' });

		/* AT 端口选择：来自 get_at_cfg().at_cfg.ports，默认使用解析出的 at_port */
		var ports = Array.isArray(res.ports) ? res.ports.slice() : [];
		if (this.atPort && ports.indexOf(this.atPort) === -1)
			ports.unshift(this.atPort);

		var portRow = null;
		if (ports.length) {
			this.portSelect = controls.select(ports.map(function(port) { return [ port, port ]; }), this.atPort || ports[0]);
			portRow = E('div', { 'class': 'mt5700m-terminal-row' }, [
				E('label', {}, 'AT 端口'),
				this.portSelect,
				E('span', { 'class': 'mt-control-desc', 'style': 'margin:0' }, '命令经 QModem 的 send_at 下发')
			]);
		}
		else {
			portRow = E('div', { 'class': 'mt-terminal-warning' }, 'QModem 未提供 AT 端口列表，将使用模组默认端口发送命令。');
		}

		input.addEventListener('keydown', function(ev) {
			if (ev.key === 'Enter')
				self.sendCommand(output, input);
		});
		window.setTimeout(function() { self.renderSaved(saved, input, output); }, 0);

		return E('div', { 'class':'mt-terminal mt-ui-page' }, [
			this.styleNode(),
			controls.styleNode(),
			modemBar,
			hero,
			(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null,
			E('section', { 'class': 'mt-terminal-card mt-ui-card' }, [
			E('div', { 'class': 'mt-terminal-warning' }, _('Use query commands whenever possible. Configuration and reset commands may interrupt mobile connectivity.')),
			portRow,
			E('div', { 'class': 'mt5700m-terminal-row' }, [
				input,
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': function() {
						self.sendCommand(output, input);
					}
				}, _('Send')),
				E('button', {
					'class': 'btn',
					'click': function() {
						output.textContent = '';
					}
				}, _('Clear'))
				,E('button', { 'class':'btn', 'click':function() { self.saveCommand(input, saved, output); } }, _('Save command'))
			]),
			E('div', { 'class': 'mt5700m-quick' }, [
				this.quickButton('AT', 'AT', input, output),
				this.quickButton('ATI', 'ATI', input, output),
				this.quickButton('SIM', 'AT+CPIN?', input, output),
				this.quickButton(_('Signal'), 'AT^HCSQ?', input, output),
				this.quickButton(_('Temperature'), 'AT^CHIPTEMP?', input, output),
				this.quickButton(_('Operator'), 'AT+COPS?', input, output),
				this.quickButton(_('Cell Info'), 'AT^MONSC', input, output),
				this.quickButton(_('NR Lock'), 'AT^NRFREQLOCK?', input, output),
				this.quickButton(_('LTE Lock'), 'AT^LTEFREQLOCK?', input, output)
			]),
			saved,
			output
			])
		]);
	},handleSave:null,handleSaveApply:null,handleReset:null
});
