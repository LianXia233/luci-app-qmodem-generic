'use strict';
'require view';
'require ui';
'require qmodem-generic.controls as controls';

var E = controls.element;

/*
 * AT 命令终端（AT Terminal）
 *
 * 命令下发经由 QModem 的 `qmodem` ubus 对象（封装于 qmodem-generic.controls）：
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
	return controls.atResponseText(res);
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
	/*
	 * AT 终端只读缓存拿端口配置，首屏不碰 modem。
	 * 本页**不做轮询重绘**：输出区是用户的 AT 会话日志，重绘会把它清掉。
	 * AT 命令下发经 controls.sendAt → 后台任务队列（AT 通道串行化 + 超时）。
	 */
	DOMAINS: [ 'device', 'status' ],

	load: function() {
		var self = this;
		var errors = [];

		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
			self.section = ctx.section;
			var section = ctx.section;

			if (!section)
				return { section: null, errors: errors };

			return Promise.all([
				guard(controls.getAtCfg(section), '读取 AT 端口配置失败', errors),
				guard(controls.getBaseInfo(section), '读取模组信息失败', errors)
			]).then(function(results) {
				var cfg = results[0], base = controls.entryList(results[1]);
				var at = (cfg && cfg.at_cfg) ? cfg.at_cfg : (cfg || {});
				var ports = portList(at.ports);
				var port = at.at_port || controls.findEntry(base, 'at_port') || '';
				return { section: section, port: port, ports: ports, base: base, errors: errors };
			});
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-terminal-hero{padding:22px 24px;border-radius:14px;background:var(--qm-terminal-gradient);color:var(--qm-on-hero);margin-bottom:16px}',
			'.mt-terminal-hero h2{color:var(--qm-on-hero);margin:0 0 6px}.mt-terminal-hero p{color:var(--qm-border);margin:0;max-width:760px}',
			'.mt-terminal-card{border:1px solid var(--qm-border-soft);border-radius:14px;background:var(--qm-surface);padding:20px}',
			'.mt-terminal-warning{padding:11px 13px;border-radius:8px;background:var(--qm-warn-soft);color:var(--qm-warn);font-size:12px;margin-bottom:14px}',
			'.qmodem-generic-terminal-row{display:flex;gap:8px;align-items:center;margin-bottom:14px}',
			'.qmodem-generic-terminal-row input{flex:1;min-width:0;font-family:var(--qm-font-mono)}',
			'.qmodem-generic-terminal-row label{font-size:12px;color:var(--qm-text-muted);white-space:nowrap}',
			'.qmodem-generic-quick{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}',
			'.mt-terminal-saved-item{display:inline-flex}.mt-terminal-saved-item .btn:first-child{border-radius:4px 0 0 4px}.mt-terminal-saved-item .btn:last-child{border-radius:0 4px 4px 0;margin-left:-1px;color:var(--qm-danger)}',
			'.qm-app .mt-terminal-output{border:1px solid var(--qm-border);border-radius:14px;overflow:hidden;margin-top:18px;background:var(--qm-surface-2)}',
			'.qm-app .mt-terminal-output-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid var(--qm-border);background:var(--qm-surface)}',
			'.qm-app .mt-terminal-output-head h3{font-size:14px;margin:0 0 3px}.qm-app .mt-terminal-output-head p{font-size:12px;color:var(--qm-text-muted)}',
			'.qm-app .mt-terminal-output-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
			'.qm-app .qm-at-state{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--qm-border);font-size:12px;color:var(--qm-text-soft);background:var(--qm-surface-2)}',
			'.qm-app .qm-at-state.is-busy{color:var(--qm-accent);background:var(--qm-accent-soft);border-color:var(--qm-accent-border)}',
			'.qm-app .qm-at-state.is-ok{color:var(--qm-ok);background:var(--qm-ok-soft);border-color:var(--qm-ok-border)}',
			'.qm-app .qm-at-state.is-error{color:#b42318;background:var(--qm-danger-soft);border-color:var(--qm-danger-border)}',
			'.qm-app .qmodem-generic-output{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;background:var(--qm-surface-2);color:var(--qm-text);border:0;border-radius:0;padding:16px 18px;margin:0;min-height:300px;max-height:560px;overflow:auto;font-family:var(--qm-font-mono);font-size:13px;line-height:1.75}',
			'.qm-app .qmodem-generic-output.is-empty{color:var(--qm-text-muted)}',
			'.qm-app .qm-at-entry{display:block;padding:5px 0;white-space:pre-wrap}',
			'.qm-app .qm-at-entry.is-command{color:var(--qm-accent);font-weight:650}',
			'.qm-app .qm-at-entry.is-error{color:#b42318;border-left:3px solid var(--qm-danger);padding-left:10px}',
			'.qm-app.qm-dark .qm-at-entry.is-error,.qm-app.qm-dark .qm-at-state.is-error{color:#ffb4ab}',
			'.qm-app .qm-at-time{font-size:11px;color:var(--qm-text-muted);font-weight:400}',
			'@media(max-width:680px){.qmodem-generic-terminal-row{flex-wrap:wrap}.qmodem-generic-terminal-row input{flex-basis:100%}.mt-terminal-hero{padding:20px}}'
		].join(''));
	},

	appendOutput: function(node, text, prefix) {
		var timestamp = new Date().toLocaleTimeString();
		if (node.classList.contains('is-empty')) node.textContent = '';
		node.classList.remove('is-empty');
		node.appendChild(E('span', { 'class': 'qm-at-entry' + (prefix === 'ERR' ? ' is-error' : prefix === '>>>' ? ' is-command' : '') }, [
			E('span', { 'class': 'qm-at-time' }, '[' + timestamp + '] '),
			prefix + ' ' + String(text || '').replace(/\r\n?/g, '\n') + '\n'
		]));
		node.scrollTop = node.scrollHeight;
	},

	setOutputState: function(label, state) {
		if (!this.outputState) return;
		this.outputState.textContent = label;
		this.outputState.className = 'qm-at-state' + (state ? ' is-' + state : '');
	},

	setSending: function(sending, output, input) {
		this.sending = sending;
		input.disabled = sending;
		output.setAttribute('aria-busy', String(sending));
		if (this.sendButton) {
			this.sendButton.disabled = sending;
			this.sendButton.textContent = sending ? _('发送中…') : _('Send');
		}
		if (this.clearButton) this.clearButton.disabled = sending;
		if (this.portSelect) this.portSelect.disabled = sending;
		(this.commandButtons || []).forEach(function(button) { button.disabled = sending; });
	},

	clearOutput: function(output) {
		output.textContent = _('输入命令后点击发送或按 Enter，返回内容会显示在这里。');
		output.classList.add('is-empty');
		this.setOutputState(_('就绪'), '');
	},

	/* 当前选中的 AT 端口（为空则由 QModem 选择默认端口） */
	currentPort: function() {
		return (this.portSelect && this.portSelect.value) || this.atPort || '';
	},

	sendCommand: function(output, input) {
		var cmd = (input.value || '').trim();
		var self = this;
		if (this.sending) return this.request || Promise.resolve();

		if (!cmd) {
			controls.notify(null, E('p', {}, _('Command is empty.')), 'warning');
			return;
		}

		if (!this.section) {
			this.appendOutput(output, _('未检测到模组（请确认 QModem 已识别该设备）。'), 'ERR');
			return;
		}

		this.appendOutput(output, cmd, '>>>');
		this.setSending(true, output, input);
		this.setOutputState(_('发送中…'), 'busy');
		var started = Date.now();
		this.request = controls.sendAt(this.section, this.currentPort(), cmd).then(function(res) {
			var text = atText(res);
			self.appendOutput(output, text || _('No response.'), '<<<');
			self.setOutputState(_('已返回') + ' · ' + ((Date.now() - started) / 1000).toFixed(1) + ' s', 'ok');
		}).catch(function(err) {
			self.appendOutput(output, (err && err.message) || String(err), 'ERR');
			self.setOutputState(_('返回错误'), 'error');
		}).then(function() {
			self.setSending(false, output, input);
			input.focus();
		});
		return this.request;
	},

	quickButton: function(label, cmd, input, output) {
		var self = this;

		var button = E('button', {
			'type': 'button', 'class': 'btn cbi-button', 'data-at-command': cmd,
			'click': function() {
				input.value = cmd;
				self.sendCommand(output, input);
			}
		}, label);
		(this.commandButtons || (this.commandButtons = [])).push(button);
		return button;
	},

	loadSaved: function() {
		try {
			var saved = JSON.parse(window.localStorage.getItem('qmodem-generic.at.saved') || '[]');
			return Array.isArray(saved) ? saved.filter(function(item) { return item && typeof item.label === 'string' && typeof item.command === 'string'; }) : [];
		}
		catch (e) { return []; }
	},

	saveCommand: function(input, container, output) {
		var command = (input.value || '').trim(), self = this;
		if (!command)
			return controls.notify(null, E('p', {}, _('Command is empty.')), 'warning');
		var label = window.prompt(_('Name this command'), command);
		if (!label)
			return;
		var saved = this.loadSaved().filter(function(item) { return item.command !== command; });
		saved.push({ label:label.substring(0, 40), command:command });
		window.localStorage.setItem('qmodem-generic.at.saved', JSON.stringify(saved.slice(-20)));
		this.renderSaved(container, input, output);
	},

	renderSaved: function(container, input, output) {
		var self = this, saved = this.loadSaved();
		container.innerHTML = '';
		saved.forEach(function(item) {
			container.appendChild(E('span', { 'class':'mt-terminal-saved-item' }, [
				self.quickButton(item.label, item.command, input, output),
				E('button', { 'type':'button', 'class':'btn', 'title':_('Remove saved command'), 'click':function() {
					window.localStorage.setItem('qmodem-generic.at.saved', JSON.stringify(self.loadSaved().filter(function(entry) { return entry.command !== item.command; })));
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
		this.commandButtons = [];
		this.sending = false;

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
			'autocomplete': 'off', 'spellcheck': 'false', 'autocapitalize': 'off',
			'aria-label': _('AT 命令'), 'placeholder': _('输入 AT 命令，例如 ATI 或 AT+CSQ')
		});
		var output = E('pre', { 'class': 'qmodem-generic-output is-empty', 'tabindex': '0', 'aria-labelledby': 'qm-at-output-title', 'aria-busy': 'false' });
		this.outputState = E('span', { 'class': 'qm-at-state', 'role': 'status', 'aria-live': 'polite' }, _('就绪'));
		this.clearOutput(output);
		this.sendButton = E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function() { self.sendCommand(output, input); } }, _('Send'));
		this.clearButton = E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.clearOutput(output); } }, _('清空记录'));
		var saved = E('div', { 'class':'qmodem-generic-quick' });

		/* AT 端口选择：来自 get_at_cfg().at_cfg.ports，默认使用解析出的 at_port */
		var ports = Array.isArray(res.ports) ? res.ports.slice() : [];
		if (this.atPort && ports.indexOf(this.atPort) === -1)
			ports.unshift(this.atPort);

		var portRow = null;
		if (ports.length) {
			this.portSelect = controls.select(ports.map(function(port) { return [ port, port ]; }), this.atPort || ports[0]);
			portRow = E('div', { 'class': 'qmodem-generic-terminal-row' }, [
				E('label', {}, 'AT 端口'),
				this.portSelect,
				E('span', { 'class': 'mt-control-desc', 'style': 'margin:0' }, _('使用当前模组的 AT 通道'))
			]);
		}
		else {
			portRow = E('div', { 'class': 'mt-terminal-warning' }, 'QModem 未提供 AT 端口列表，将使用模组默认端口发送命令。');
		}

		input.addEventListener('keydown', function(ev) {
			if (ev.key === 'Enter' && !ev.isComposing) {
				ev.preventDefault();
				self.sendCommand(output, input);
			}
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
			E('div', { 'class': 'qmodem-generic-terminal-row' }, [
				input,
				this.sendButton,
				E('button', { 'type': 'button', 'class':'btn', 'click':function() { self.saveCommand(input, saved, output); } }, _('Save command'))
			]),
			E('div', { 'class': 'qmodem-generic-quick' }, [
				this.quickButton('AT', 'AT', input, output),
				this.quickButton('ATI', 'ATI', input, output),
				this.quickButton('SIM', 'AT+CPIN?', input, output),
				this.quickButton(_('Signal'), 'AT+CSQ', input, output),
				this.quickButton(_('Operator'), 'AT+COPS?', input, output)
			]),
			controls.supportsTdTechAt(this.section, res.base) ? E('div', { 'class': 'qmodem-generic-quick' }, [
				this.quickButton(_('Temperature'), 'AT^CHIPTEMP?', input, output),
				this.quickButton(_('Cell Info'), 'AT^MONSC', input, output),
				this.quickButton(_('NR Lock'), 'AT^NRFREQLOCK?', input, output),
				this.quickButton(_('LTE Lock'), 'AT^LTEFREQLOCK?', input, output)
			]) : null,
			saved,
			E('section', { 'class': 'mt-terminal-output' }, [
				E('div', { 'class': 'mt-terminal-output-head' }, [
					E('div', {}, [ E('h3', { 'id': 'qm-at-output-title' }, _('命令返回')), E('p', {}, _('当前模组的返回内容与错误信息')) ]),
					E('div', { 'class': 'mt-terminal-output-tools' }, [ this.outputState, this.clearButton ])
				]), output
			])
			])
		]);
	},handleSave:null,handleSaveApply:null,handleReset:null
});
