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
	 * AT 终端数据来自官方 qmodem get_at_cfg（rpcd 自带 10 秒缓存，首屏也很快）。
	 * 本页**不做轮询重绘**：输出区是用户的 AT 会话日志，重绘会把它清掉。
	 * AT 命令下发经 controls.sendAt → 官方 qmodem send_at。
	 */

	load: function() {
		var self = this;
		var errors = [];

		return controls.bootstrap().then(function(ctx) {
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
				/* QModem 官方快捷命令表（at_commands_zh/en.json），按系统语言选择 */
				var cmds = Array.isArray(at.cmds) ? at.cmds.filter(function(item) {
					return item && typeof item.name === 'string' && typeof item.value === 'string' &&
						item.name && item.value;
				}) : [];
				return { section: section, port: port, ports: ports, cmds: cmds, base: base, errors: errors };
			});
		});
	},

	styleNode: function() {
		return controls.injectStyleOnce('qm-terminal-style', [
			'.mt-terminal{position:relative;max-width:1220px;margin:0 auto;color:var(--qm-text);padding-bottom:36px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
			'.mt-term-glow1{position:absolute;top:-60px;left:10%;width:420px;height:420px;background:var(--qm-glow-a);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',
			'.mt-term-glow2{position:absolute;top:340px;right:8%;width:380px;height:380px;background:var(--qm-glow-b);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',
			'.mt-terminal-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:26px 32px;margin:0 0 20px;border:1px solid var(--qm-glass-border);border-radius:var(--qm-radius);background:linear-gradient(135deg,rgba(15,23,42,0.92) 0%,rgba(30,41,59,0.9) 60%,rgba(14,165,233,0.8) 100%);color:#fff;backdrop-filter:var(--qm-glass-blur);-webkit-backdrop-filter:var(--qm-glass-blur);box-shadow:0 14px 34px -8px rgba(15,23,42,0.4), inset 0 1px 2px rgba(255,255,255,0.3);position:relative;overflow:hidden;z-index:1}',
			'.mt-terminal-hero::before{content:"";position:absolute;top:-50%;right:-10%;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,0.2) 0%,transparent 70%);pointer-events:none}',
			'.mt-terminal-hero h2{margin:0 0 6px;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.02em}',
			'.mt-terminal-hero p{margin:0;color:rgba(255,255,255,0.82);font-size:12.5px;line-height:1.55;max-width:780px}',
			'.mt-terminal-card{position:relative;z-index:1;padding:26px;border:1px solid var(--qm-glass-border)!important;border-radius:var(--qm-radius)!important;background:var(--qm-glass)!important;backdrop-filter:var(--qm-glass-blur)!important;-webkit-backdrop-filter:var(--qm-glass-blur)!important;box-shadow:var(--qm-shadow)!important}',
			'.mt-terminal-warning{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;background:var(--qm-warn-soft);border:1px solid var(--qm-warn-border);color:var(--qm-warn);font-size:12px;font-weight:600;line-height:1.5;margin-bottom:18px}',
			'.qmodem-generic-terminal-row{display:flex;gap:12px;align-items:center;margin-bottom:16px}',
			'.qmodem-generic-terminal-row input{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px;font-weight:600;letter-spacing:0.02em}',
			'.qmodem-generic-terminal-row label{font-size:12px;font-weight:750;letter-spacing:0.04em;color:var(--qm-text-soft);text-transform:uppercase;white-space:nowrap}',
			'.qmodem-generic-quick{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}',
			'.mt-quick-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;border:1px solid var(--qm-glass-inner-border);background:var(--qm-glass-inner);font-size:12px;font-weight:700;color:var(--qm-text);cursor:pointer;transition:all 0.18s cubic-bezier(0.16,1,0.3,1)}',
			'.mt-quick-pill:hover{background:#fff;border-color:var(--qm-accent);color:var(--qm-accent);transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,114,245,0.12)}',
			'.mt-quick-pill:active{transform:scale(0.97)}',
			'.mt-terminal-saved-item{display:inline-flex;border-radius:999px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);border:1px solid var(--qm-glass-inner-border)}',
			'.mt-terminal-saved-item .btn{border-radius:0!important;border:0!important;background:var(--qm-glass-inner)!important;font-size:12px!important;padding:6px 12px!important}',
			'.mt-terminal-saved-item .btn:first-child{color:var(--qm-text)!important;font-weight:700!important}',
			'.mt-terminal-saved-item .btn:first-child:hover{background:#fff!important;color:var(--qm-accent)!important}',
			'.mt-terminal-saved-item .btn:last-child{color:var(--qm-danger)!important;padding:6px 9px!important}',
			'.mt-terminal-saved-item .btn:last-child:hover{background:var(--qm-danger-soft)!important}',
			/* Obsidian Glass Terminal Console */
			'.qm-app .mt-terminal-output{border-radius:18px;overflow:hidden;margin-top:20px;background:rgba(15,23,42,0.96);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.15);box-shadow:0 18px 45px -8px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.15)}',
			'.qm-app .mt-terminal-output-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid rgba(255,255,255,0.08);background:rgba(30,41,59,0.8)}',
			'.qm-term-dots{display:flex;align-items:center;gap:7px}',
			'.qm-term-dot{width:11px;height:11px;border-radius:50%;display:inline-block;box-shadow:0 1px 2px rgba(0,0,0,0.3)}',
			'.qm-term-dot.r{background:#ff5f56;border:1px solid #e0443e}',
			'.qm-term-dot.y{background:#ffbd2e;border:1px solid #dea123}',
			'.qm-term-dot.g{background:#27c93f;border:1px solid #1aab29}',
			'.qm-term-title-box{display:flex;align-items:center;gap:10px}',
			'.qm-term-title{font-size:12.5px;font-weight:750;letter-spacing:0.02em;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
			'.qm-app .mt-terminal-output-tools{display:flex;align-items:center;gap:10px}',
			'.qm-app .qm-at-state{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:750;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12)}',
			'.qm-app .qm-at-state::before{content:"";width:6px;height:6px;border-radius:50%;background:#94a3b8}',
			'.qm-app .qm-at-state.is-busy{color:#38bdf8;background:rgba(56,189,248,0.15);border-color:rgba(56,189,248,0.35)}',
			'.qm-app .qm-at-state.is-busy::before{background:#38bdf8;box-shadow:0 0 8px #38bdf8}',
			'.qm-app .qm-at-state.is-ok{color:#4ade80;background:rgba(74,222,128,0.15);border-color:rgba(74,222,128,0.35)}',
			'.qm-app .qm-at-state.is-ok::before{background:#4ade80;box-shadow:0 0 8px #4ade80}',
			'.qm-app .qm-at-state.is-error{color:#f87171;background:rgba(248,113,113,0.15);border-color:rgba(248,113,113,0.35)}',
			'.qm-app .qm-at-state.is-error::before{background:#f87171;box-shadow:0 0 8px #f87171}',
			'.qm-term-btn-clear{background:rgba(255,255,255,0.08)!important;color:#cbd5e1!important;border:1px solid rgba(255,255,255,0.12)!important;font-size:11.5px!important;padding:4px 12px!important;border-radius:8px!important}',
			'.qm-term-btn-clear:hover{background:rgba(255,255,255,0.16)!important;color:#fff!important}',
			'.qm-app .qmodem-generic-output{white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;background:transparent;color:#f8fafc;border:0;border-radius:0;padding:18px 22px;margin:0;min-height:320px;max-height:560px;overflow-y:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.75}',
			'.qm-app .qmodem-generic-output.is-empty{color:#64748b;font-style:italic}',
			'.qm-app .qm-at-entry{display:block;padding:4px 0;white-space:pre-wrap}',
			'.qm-app .qm-at-entry.is-command{color:#38bdf8;font-weight:700}',
			'.qm-app .qm-at-entry.is-error{color:#f87171;background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;padding-left:12px;border-radius:0 6px 6px 0}',
			'.qm-app .qm-at-time{font-size:11px;color:#64748b;font-weight:400}',
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

	/* 官方快捷命令分类（按命令语义正则归类，随固件/模组平台变化的命令表
	   也能落入正确分组；未命中的进「其他」）。顺序即优先级：写操作优先于
	   查询判定（如 AT+CGDCONT? 是查询，AT+CGDCONT=3,... 是写 APN）。 */
	CMD_GROUP_DEFS: [
		{ title: _('维护与写入（危险）'), danger: true,
		  re: /CFUN=[015]|GTSN=1,|GTFCCLOCK|GTTHERMAL|GTESIMCFG/ },
		{ title: _('SIM 卡槽与 eSIM'),
		  re: /GTDUALSIM/ },
		{ title: _('拨号与 APN'),
		  re: /CGDCONT=[^?]|CGACT=/ },
		{ title: _('网络模式与锁网'),
		  re: /GTACT=[0-9]|GTUSBMODE=[0-9]/ }
	],

	classifyCommands: function(cmds) {
		var defs = this.CMD_GROUP_DEFS;
		var groups = defs.map(function(d) { return { title: d.title, danger: !!d.danger, items: [] }; });
		var other = [];
		cmds.forEach(function(item) {
			var value = item.value || '';
			/* 官方命令表 name 形如「动作描述 > AT 命令」：主标签取描述，
			   命令本体作为小字副标签展示，不能让用户对着裸命令猜 */
			var desc = item.name.indexOf('>') >= 0 ? item.name.split('>')[0].trim() : item.name;
			var entry = { label: desc || value, value: value };
			for (var i = 0; i < defs.length; i++) {
				if (defs[i].re.test(value)) {
					groups[i].items.push(entry);
					return;
				}
			}
			other.push(entry);
		});
		/* 查询组 = 剩余全部（多为 '?' 结尾的只读命令），排在最前最常用 */
		var out = [{ title: _('基础查询与其他'), danger: false, items: other }].concat(groups);
		return out.filter(function(g) { return g.items.length > 0; });
	},

	buildCommandGroups: function(cmds, input, output) {
		var self = this;
		return this.classifyCommands(cmds).map(function(g) {
			return E('details', { 'class': 'qm-cmd-group' + (g.danger ? ' qm-cmd-danger' : '') }, [
				E('summary', {}, [
					g.title,
					E('span', { 'class': 'qm-cmd-count' }, String(g.items.length))
				]),
				E('div', { 'class': 'qmodem-generic-quick qm-cmd-group-body' }, g.items.map(function(item) {
					var self2 = self;
					var button = E('button', {
						'type': 'button',
						'class': 'btn cbi-button qm-cmd-btn',
						'data-at-command': item.value,
						'title': item.value,
						'click': function() {
							input.value = item.value;
							self2.sendCommand(output, input);
						}
					}, [
						E('span', { 'class': 'qm-cmd-btn-label' }, item.label),
						E('span', { 'class': 'qm-cmd-btn-cmd' }, item.value)
					]);
					(self.commandButtons || (self.commandButtons = [])).push(button);
					return button;
				}))
			]);
		});
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
		var enter = !self.painted;
		self.painted = true;
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
			controls.pageTitle('terminal', _('AT command console')),
			E('p', {}, _('Diagnostic console for advanced users. Commands are sent directly to the module and are not automatically validated.'))
		]) ]);

		if (!this.section) {
			return E('div', { 'class':'mt-terminal mt-ui-page' + (enter ? ' qm-enter' : '') }, [
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
		this.clearButton = E('button', { 'type': 'button', 'class': 'btn qm-term-btn-clear', 'click': function() { self.clearOutput(output); } }, _('清空记录'));
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

		return E('div', { 'class':'mt-terminal mt-ui-page' + (enter ? ' qm-enter' : '') }, [
			E('div', { 'class': 'mt-term-glow1' }),
			E('div', { 'class': 'mt-term-glow2' }),
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
			/* QModem 官方快捷命令（get_at_cfg.cmds，随固件语言与模组平台变化）。
			   33+ 条按钮平铺过长，改为按语义分组的折叠面板，默认全部收起。 */
			(res.cmds || []).length ? E('div', { 'class': 'qm-cmd-groups' }, [
				this.buildCommandGroups(res.cmds, input, output)
			]) : null,
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
