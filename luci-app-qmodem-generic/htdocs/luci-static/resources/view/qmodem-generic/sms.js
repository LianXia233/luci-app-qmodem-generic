'use strict';
'require view';
'require ui';
'require dom';
'require qmodem-generic.controls as controls';

/*
 * 短信（Messages）— 现代白色毛玻璃 (Glassmorphism) + 动态 SVG 交互重构
 * 数据与动作全部经由 QModem 的 `qmodem` ubus 对象（封装于 qmodem-generic.controls）：
 *    get_sms   → 会话列表 / 消息内容
 *    send_sms  → 发送短信
 *    delete_sms→ 删除模组内短信
 *    sim_info  → 本机号码（发件上下文）
 *    get_at_cfg/send_at → 短信中心号码、存储位置、IMS 开关等设置
 */

function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

function pick(item, keys) {
	if (!item || typeof item !== 'object')
		return '';
	for (var i = 0; i < keys.length; i++) {
		var value = item[keys[i]];
		if (value != null && value !== '')
			return value;
	}
	return '';
}

function smsEntries(raw) {
	var list = [];
	if (Array.isArray(raw))
		list = raw;
	else if (raw && Array.isArray(raw.sms))
		list = raw.sms;
	else if (raw && raw.sms && typeof raw.sms === 'object')
		list = Object.keys(raw.sms).map(function(key) { return raw.sms[key]; });
	else if (raw && Array.isArray(raw.messages))
		list = raw.messages;

	return list.filter(function(item) { return item && typeof item === 'object'; });
}

function atText(res) {
	if (res == null)
		return '';
	if (typeof res === 'string')
		return res;
	var text = pick(res, [ 'result', 'response', 'at_response', 'output', 'data', 'message' ]);
	if (typeof text === 'string')
		return text;
	try { return JSON.stringify(res); } catch (e) { return String(res); }
}

function formatTime(value) {
	var text = String(value == null ? '' : value).replace(/"/g, '').trim();
	if (!text)
		return '';

	var m = text.match(/^(\d{2})\/(\d{2})\/(\d{2})\s*,?\s*(\d{2}):(\d{2})/);
	if (m)
		return '20%s-%s-%s %s:%s'.format(m[1], m[2], m[3], m[4], m[5]);

	m = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[\sT,]+(\d{2}):(\d{2})/);
	if (m)
		return '%s-%s-%s %s:%s'.format(m[1], m[2], m[3], m[4], m[5]);

	return text.replace(/[+-]\d{2}$/, '').trim();
}

function normalizeMessage(item, position) {
	var rawIndex = pick(item, [ 'index', 'idx', 'id', 'sms_index', 'message_index' ]);
	var index = (rawIndex === '' ? String(position) : String(rawIndex));
	var status = String(pick(item, [ 'status', 'state', 'stat', 'type' ]) || '');
	var number = String(pick(item, [ 'sender', 'number', 'phone_number', 'phone', 'from', 'address', 'oa', 'recipient' ]) || '');
	var text = String(pick(item, [ 'content', 'text', 'message', 'message_content', 'body', 'msg' ]) || '');
	var date = formatTime(pick(item, [ 'time', 'date', 'timestamp', 'datetime', 'send_time', 'received' ]));
	var outgoing = /sent|sto|out/i.test(status) && !/rec/i.test(status);
	var order = Number(index);

	return {
		index: index,
		indexes: [ index ],
		number: number || '未知号码',
		date: date,
		text: text,
		status: status,
		direction: outgoing ? 'out' : 'in',
		order: isFinite(order) ? order : position
	};
}

function parseMessages(raw) {
	return smsEntries(raw).map(normalizeMessage).sort(function(a, b) {
		return (a.order || 0) - (b.order || 0);
	});
}

function groupMessages(messages) {
	var groups = {};
	messages.forEach(function(msg) { (groups[msg.number] || (groups[msg.number] = [])).push(msg); });
	return Object.keys(groups).map(function(number) {
		return { number: number, messages: groups[number].sort(function(a, b) { return (a.order || 0) - (b.order || 0); }) };
	}).sort(function(a, b) {
		return (b.messages[b.messages.length - 1].order || 0) - (a.messages[a.messages.length - 1].order || 0);
	});
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	sentHistory: function() {
		try {
			return JSON.parse(window.localStorage.getItem('modem.sms.sent') || window.localStorage.getItem('sms_sent_messages_cache') || '[]').map(function(item) {
				return item && item.content ? { number: item.number, text: item.content, date: item.time, order: Date.parse(item.time) || 0 } : item;
			}).filter(function(item) { return item && item.number && item.text; }).map(function(item) {
				item.direction = 'out'; item.indexes = []; return item;
			});
		} catch (e) { return []; }
	},

	saveSent: function(number, text) {
		var now = new Date(), history = this.sentHistory();
		history.push({
			number: number,
			text: text,
			date: '%s-%s-%s %s:%s'.format(now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')),
			order: now.getTime(),
			direction: 'out',
			indexes: []
		});
		window.localStorage.setItem('modem.sms.sent', JSON.stringify(history.slice(-500)));
	},

	clearSent: function() {
		window.localStorage.removeItem('modem.sms.sent');
		window.localStorage.removeItem('sms_sent_messages_cache');
	},

	exportSent: function() {
		var history = this.sentHistory();
		if (!history.length)
			return ui.addNotification(null, E('p', {}, _('There is no sent history to export.')), 'info');
		var blob = new Blob([ JSON.stringify({ format: 'modem-sent-history', version: 1, messages: history }, null, 2) ], { type: 'application/json' });
		var url = URL.createObjectURL(blob), link = document.createElement('a');
		link.href = url; link.download = 'modem-sent-history.json';
		document.body.appendChild(link); link.click(); link.remove();
		window.setTimeout(function() { URL.revokeObjectURL(url); }, 0);
	},

	importSent: function(file) {
		var self = this, reader = new FileReader();
		reader.onload = function() {
			try {
				var parsed = JSON.parse(reader.result), items = Array.isArray(parsed) ? parsed : parsed.messages;
				if (!Array.isArray(items)) throw new Error('format');
				var clean = items.map(function(item) {
					var number = String(item.number || ''), text = String(item.text || item.content || ''), order = Number(item.order || Date.parse(item.date || item.time) || 0);
					if (!/^\+?[0-9]{5,20}$/.test(number) || !text || !order) return null;
					return { number: number, text: text, date: String(item.date || item.time || ''), order: order, direction: 'out', indexes: [] };
				}).filter(Boolean).slice(-500);
				if (!clean.length && items.length) throw new Error('content');
				window.localStorage.setItem('modem.sms.sent', JSON.stringify(clean));
				window.localStorage.removeItem('sms_sent_messages_cache');
				window.location.reload();
			} catch (e) {
				ui.addNotification(null, E('p', {}, _('The selected file is not a valid sent-history backup.')), 'danger');
			}
		};
		reader.onerror = function() { ui.addNotification(null, E('p', {}, _('The selected history file could not be read.')), 'danger'); };
		reader.readAsText(file);
	},

	DOMAINS: [ 'sms', 'sim', 'device' ],
	POLL_INTERVAL: 4000,

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

		if (!section)
			return { section: null, errors: errors };

		return Promise.all([
			guard(controls.getSms(section), '读取短信失败', errors),
			guard(controls.getSimInfo(section), '读取 SIM 信息失败', errors),
			guard(controls.getAtCfg(section), '读取 AT 端口配置失败', errors)
		]).then(function(results) {
			return { section: section, sms: results[0], sim: results[1], atcfg: results[2], errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mt-sms{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境漫反射光晕 */
			'.mt-sms-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-sms-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(14,165,233,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-sms-hero{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%);border-radius:20px;border:1px solid var(--qm-glass-border);box-shadow:var(--qm-glass-shadow);backdrop-filter:blur(20px)}',
			'.mt-sms-hero h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:10px}',
			'.mt-sms-hero p{margin:0;font-size:13px;color:#64748b;line-height:1.5}',
			'.mt-sms-storage{font-size:11px;color:#0072f5;font-weight:600;margin-top:6px;display:flex;align-items:center;gap:6px}',
			'.mt-sms-hero-actions{display:flex;gap:10px}',

			/* 毛玻璃主聊天界面框架 */
			'.mt-sms-shell{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:620px;border-radius:20px;border:1px solid var(--qm-glass-border);background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);box-shadow:var(--qm-glass-shadow);overflow:hidden}',

			/* 左侧联系人侧边栏 */
			'.mt-sms-sidebar{border-right:1px solid rgba(226,232,240,0.8);background:rgba(248,250,252,0.65);display:flex;flex-direction:column}',
			'.mt-sms-sidehead{padding:18px 20px;border-bottom:1px solid rgba(226,232,240,0.8);display:flex;align-items:center;justify-content:space-between}',
			'.mt-sms-sidehead strong{font-size:14px;font-weight:750;color:#0f172a}',
			'.mt-sms-count-badge{padding:2px 8px;border-radius:999px;background:#e2e8f0;font-size:11px;font-weight:700;color:#475569}',
			'.mt-sms-contacts-scroll{flex:1;overflow-y:auto}',

			/* 联系人条目 */
			'.mt-sms-contact{display:flex;align-items:center;gap:12px;width:100%;border:0;border-bottom:1px solid rgba(226,232,240,0.6);padding:14px 18px;text-align:left;background:transparent;cursor:pointer;transition:all .18s ease}',
			'.mt-sms-contact:hover{background:rgba(255,255,255,0.7)}',
			'.mt-sms-contact.active{background:rgba(239,246,255,0.85);box-shadow:inset 3px 0 0 #0072f5}',
			'.mt-sms-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#0072f5 0%,#38bdf8 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:750;flex-shrink:0}',
			'.mt-sms-contact-info{flex:1;min-width:0}',
			'.mt-sms-contact-top{display:flex;justify-content:space-between;align-items:center;gap:6px}',
			'.mt-sms-contact-number{font-weight:750;font-size:12.5px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.mt-sms-contact-date{font-size:10px;color:#94a3b8;flex-shrink:0}',
			'.mt-sms-contact-preview{font-size:11px;color:#64748b;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

			/* 右侧消息气泡与对话区 */
			'.mt-sms-chat{display:flex;flex-direction:column;min-width:0;background:rgba(255,255,255,0.5)}',
			'.mt-sms-chathead{padding:18px 24px;border-bottom:1px solid rgba(226,232,240,0.8);display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.7)}',
			'.mt-sms-chathead strong{font-size:15px;font-weight:800;color:#0f172a}',
			'.mt-sms-thread{flex:1;padding:24px;overflow-y:auto;max-height:480px;display:flex;flex-direction:column;gap:14px}',

			/* 气泡样式 */
			'.mt-sms-bubblewrap{display:flex;align-items:flex-end;gap:8px;max-width:80%}',
			'.mt-sms-bubblewrap.in{align-self:flex-start}',
			'.mt-sms-bubblewrap.out{align-self:flex-end;flex-direction:row-reverse}',
			'.mt-sms-bubble{padding:12px 16px;border-radius:18px;font-size:13px;line-height:1.55;word-break:break-word;position:relative}',
			'.mt-sms-bubblewrap.in .mt-sms-bubble{background:rgba(255,255,255,0.9);border:1px solid rgba(226,232,240,0.9);color:#0f172a;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.03)}',
			'.mt-sms-bubblewrap.out .mt-sms-bubble{background:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);color:#fff;border-bottom-right-radius:4px;box-shadow:0 4px 14px rgba(0,114,245,0.25)}',
			'.mt-sms-bubbledate{font-size:9.5px;margin-top:5px;opacity:.7;text-align:right}',
			'.mt-sms-delete{border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px;padding:4px;opacity:0;transition:all .2s ease;border-radius:6px}',
			'.mt-sms-bubblewrap:hover .mt-sms-delete{opacity:1;color:#ef4444}',

			/* 输入与发送区 */
			'.mt-sms-compose{border-top:1px solid rgba(226,232,240,0.8);padding:16px 20px;background:rgba(255,255,255,0.75)}',
			'.mt-sms-recipient{display:none;margin-bottom:10px}',
			'.mt-sms-recipient.show{display:block}',
			'.mt-sms-recipient input{width:100%;border-radius:10px;padding:8px 14px;border:1px solid rgba(203,213,225,0.8);background:rgba(255,255,255,0.9);font-size:13px}',
			'.mt-sms-recipient input:focus{border-color:#0072f5;outline:none;box-shadow:0 0 0 3px rgba(0,114,245,0.15)}',
			'.mt-sms-compose-row{display:flex;gap:12px;align-items:flex-end}',
			'.mt-sms-compose textarea{flex:1;resize:vertical;min-height:56px;max-height:140px;border-radius:12px;padding:10px 14px;border:1px solid rgba(203,213,225,0.8);background:rgba(255,255,255,0.9);font-size:13px;line-height:1.5;transition:all .2s ease}',
			'.mt-sms-compose textarea:focus{border-color:#0072f5;outline:none;box-shadow:0 0 0 3px rgba(0,114,245,0.15);background:#fff}',

			/* 空状态动态插图 */
			'.mt-sms-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:420px;color:#94a3b8;text-align:center;padding:30px}',
			'.mt-sms-empty strong{font-size:15px;color:#334155;margin-top:14px}',
			'.mt-sms-empty p{font-size:12px;margin:4px 0 0}',

			/* 按钮系统 */
			'.mt-sms-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:10px;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .2s ease;border:1px solid transparent}',
			'.mt-sms-btn-primary{background:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);color:#fff;box-shadow:0 4px 12px rgba(0,114,245,0.2)}',
			'.mt-sms-btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,114,245,0.3)}',
			'.mt-sms-btn-secondary{background:rgba(255,255,255,0.85);color:#334155;border-color:rgba(226,232,240,0.8)}',
			'.mt-sms-btn-secondary:hover{background:#fff;color:#0072f5;border-color:rgba(0,114,245,0.3);transform:translateY(-1px)}',

			/* 模态框设置排版 */
			'.mt-sms-settings-row{display:grid;grid-template-columns:135px 1fr;gap:12px;align-items:center;margin:12px 0}',
			'.mt-sms-danger{margin-top:20px;padding-top:16px;border-top:1px solid rgba(226,232,240,0.8)}',

			/* 响应式适配 */
			'@media(max-width:780px){.mt-sms-shell{grid-template-columns:1fr}.mt-sms-sidebar{max-height:260px}.mt-sms-hero{flex-direction:column;align-items:flex-start}.mt-sms-hero-actions{width:100%;justify-content:flex-start}}'
		].join(''));
	},

	removeMessages: function(indexes) {
		var self = this;
		var chain = Promise.resolve();
		(indexes || []).forEach(function(index) {
			chain = chain.then(function() {
				var value = Number(index);
				return controls.deleteSms(self.section, isFinite(value) ? value : index);
			});
		});
		return chain;
	},

	settingsModal: function(messages) {
		var self = this;
		var smsc = E('input', { 'class': 'cbi-input-text', 'placeholder': '--' });
		var storage = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': 'SM' }, _('SIM card')), E('option', { 'value': 'ME' }, _('Module storage')) ]);
		var ims = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': '1' }, _('Enabled')), E('option', { 'value': '0' }, _('Disabled')) ]);
		var current = { ims: '', smsc: '', storage: '' };
		var importFile = E('input', { 'type': 'file', 'accept': 'application/json,.json', 'style': 'display:none', 'change': function() { if (importFile.files && importFile.files[0]) self.importSent(importFile.files[0]); } });

		function failed(err) { ui.addNotification(null, E('p', {}, err && err.message ? err.message : _('Message operation failed.')), 'danger'); }
		function query(cmd) { return controls.sendAt(self.section, self.atPort, cmd).then(atText).catch(function() { return ''; }); }

		ui.showModal(_('Message settings'), [ E('div', {}, [
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('SMS service')), ims ]),
			E('div', { 'class': 'alert-message warning' }, _('Changing SMS service cycles airplane mode and also changes the IMS PDP context. Leave it enabled unless the carrier does not support IMS messaging.')),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('Message center')), smsc ]),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('Storage location')), storage ]),
			E('div', { 'class': 'mt-control-note' }, '以上设置经 QModem 的 send_at 下发到模组，部分参数可能不被本模组支持。'),
			E('div', { 'class': 'right' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Close')), ' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function() {
					var value = smsc.value.trim();
					if (!/^\+?[0-9]{5,20}$/.test(value)) return ui.addNotification(null, E('p', {}, _('Enter a valid message center number.')), 'warning');
					var tasks = [ controls.sendAt(self.section, self.atPort, 'AT+CSCA="' + value + '"') ];
					tasks.push(controls.sendAt(self.section, self.atPort, 'AT+CPMS="' + storage.value + '","' + storage.value + '","' + storage.value + '"'));
					if (ims.value !== current.ims) tasks.push(controls.sendAt(self.section, self.atPort, 'AT^IMSSWITCH=' + ims.value));
					Promise.all(tasks).then(function() {
						ui.hideModal(); ui.addNotification(null, E('p', {}, _('Message settings saved.')));
						window.setTimeout(function() { window.location.reload(); }, 1200);
					}).catch(failed);
				} }, _('Save settings'))
			]),
			E('div', { 'class': 'mt-sms-danger' }, [
				E('p', { 'style': 'font-size:12px;color:#64748b;margin-bottom:8px' }, _('Sent messages are stored in this browser. Export a backup before clearing browser data or moving to another device.')),
				importFile,
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.exportSent(); } }, _('Export sent history')), ' ',
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { importFile.click(); } }, _('Import sent history')),
				E('p', { 'style': 'font-size:12px;color:#64748b;margin:12px 0 8px' }, _('Clearing message history cannot be undone.')),
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.clearSent(); ui.hideModal(); window.location.reload(); } }, _('Clear sent history')), ' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
					ui.hideModal();
					ui.showModal(_('Clear all messages?'), [
						E('p', {}, _('Every received message stored on the module will be permanently deleted.')),
						E('div', { 'class': 'right' }, [
							E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
							E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
								ui.hideModal();
								var indexes = [];
								(messages || []).forEach(function(msg) { if (msg.direction !== 'out') indexes = indexes.concat(msg.indexes || []); });
								if (!indexes.length) return ui.addNotification(null, E('p', {}, '模组内没有可删除的短信。'), 'info');
								self.removeMessages(indexes).then(function() { window.location.reload(); }).catch(failed);
							} }, _('Clear all'))
						])
					]);
				} }, _('Clear received messages'))
			])
		]) ]);

		Promise.all([ query('AT+CSCA?'), query('AT+CPMS?'), query('AT^IMSSWITCH?') ]).then(function(res) {
			current.smsc = ((String(res[0]).match(/\+CSCA:\s*"([^"]+)"/) || [])[1] || '');
			current.storage = ((String(res[1]).match(/\+CPMS:\s*"([A-Z]+)"/) || [])[1] || '');
			current.ims = ((String(res[2]).match(/IMSSWITCH:\s*(\d+)/) || [])[1] || '');
			smsc.value = current.smsc;
			storage.value = current.storage === 'ME' ? 'ME' : 'SM';
			ims.value = current.ims === '0' ? '0' : '1';
		}).catch(function() {});
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
		var self = this;
		res = res || {};

		if (!res.section) {
			return E('div', { 'class': 'mt-sms' }, [
				this.styleNode(), controls.styleNode(),
				E('section', { 'class': 'mt-sms-hero' }, [
					E('div', {}, [
						E('h2', {}, _('Messages')),
						E('p', {}, _('Conversations using the SIM installed in the module.'))
					])
				]),
				E('div', { 'class': 'alert-message warning' }, _('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null
			]);
		}

		this.section = res.section;
		var atcfg = (res.atcfg && res.atcfg.at_cfg) ? res.atcfg.at_cfg : (res.atcfg || {});
		this.atPort = atcfg.at_port || '';

		var modemMessages = parseMessages(res.sms);
		var messages = modemMessages.concat(this.sentHistory());
		var groups = groupMessages(messages);
		var simNumber = controls.findEntry(controls.entryList(res.sim), 'SIM Number') || '';

		var contacts = E('div', { 'class': 'mt-sms-contacts-scroll' });
		var thread = E('div', { 'class': 'mt-sms-thread' });
		var chatTitle = E('strong', {}, _('Select a conversation'));
		var recipient = E('input', { 'class': 'cbi-input-text', 'placeholder': '+8613800000000', 'inputmode': 'tel' });
		var recipientWrap = E('div', { 'class': 'mt-sms-recipient' }, recipient);
		var text = E('textarea', { 'class': 'cbi-input-text', 'rows': 2, 'maxlength': 500, 'placeholder': _('Write a message…') });
		var selected = '';

		function failed(err) { ui.addNotification(null, E('p', {}, err && err.message ? err.message : _('Message operation failed.')), 'danger'); }

		function showThread(group, button) {
			selected = group ? group.number : '';
			recipient.value = selected;
			recipientWrap.classList.toggle('show', !group);
			chatTitle.textContent = group ? group.number : _('New message');
			contacts.querySelectorAll('.mt-sms-contact').forEach(function(node) {
				node.classList.toggle('active', node === button);
			});

			if (!group) {
				dom.content(thread, E('div', { 'class': 'mt-sms-empty' }, [
					svgNode('<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.6" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'),
					E('strong', {}, _('Start a new conversation')),
					E('p', {}, _('Enter a phone number below and write your message.'))
				]));
				return;
			}

			dom.content(thread, group.messages.map(function(msg) {
				return E('div', { 'class': 'mt-sms-bubblewrap ' + (msg.direction === 'out' ? 'out' : 'in') }, [
					E('div', { 'class': 'mt-sms-bubble' }, [
						msg.text || _('Empty message'),
						E('div', { 'class': 'mt-sms-bubbledate' }, msg.date || '--')
					]),
					E('button', {
						'type': 'button',
						'class': 'mt-sms-delete',
						'title': _('Delete'),
						'click': function() {
							ui.showModal(_('Delete message?'), [
								E('p', {}, msg.direction === 'out' ? _('This removes the local sent-history entry.') : _('This removes the selected message from the module.')),
								E('div', { 'class': 'right' }, [
									E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
									E('button', {
										'type': 'button', 'class': 'btn cbi-button-negative',
										'click': function() {
											ui.hideModal();
											if (msg.direction === 'out') {
												window.localStorage.setItem('modem.sms.sent', JSON.stringify(self.sentHistory().filter(function(item) { return item.order !== msg.order; })));
												window.location.reload();
												return;
											}
											self.removeMessages(msg.indexes).then(function() { window.location.reload(); }).catch(failed);
										}
									}, _('Delete'))
								])
							]);
						}
					}, '✕')
				]);
			}));
			thread.scrollTop = thread.scrollHeight;
		}

		groups.forEach(function(group, index) {
			var last = group.messages[group.messages.length - 1];
			var initial = (group.number || '').replace(/^\+/, '').slice(-2) || '信';
			var button = E('button', { 'type': 'button', 'class': 'mt-sms-contact' + (index ? '' : ' active') }, [
				E('div', { 'class': 'mt-sms-avatar' }, initial),
				E('div', { 'class': 'mt-sms-contact-info' }, [
					E('div', { 'class': 'mt-sms-contact-top' }, [
						E('span', { 'class': 'mt-sms-contact-number' }, group.number),
						E('span', { 'class': 'mt-sms-contact-date' }, String(last.date || '').substring(5))
					]),
					E('div', { 'class': 'mt-sms-contact-preview' }, last.text || _('Empty message'))
				])
			]);
			button.addEventListener('click', function() { showThread(group, button); });
			contacts.appendChild(button);
		});

		function newMessage() {
			showThread(null, null);
			recipientWrap.classList.add('show');
			recipient.focus();
		}

		function send() {
			var number = (selected || recipient.value).trim(), body = text.value.trim();
			if (!/^\+?[0-9]{5,20}$/.test(number) || !body)
				return ui.addNotification(null, E('p', {}, _('Enter a valid phone number and message.')), 'warning');

			ui.showModal(_('Send message?'), [
				E('p', {}, _('Send this message to %s?').format(number)),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
					E('button', {
						'type': 'button', 'class': 'btn cbi-button-apply',
						'click': function() {
							ui.hideModal();
							controls.sendSms(self.section, number, body).then(function() {
								self.saveSent(number, body); text.value = '';
								ui.addNotification(null, E('p', {}, _('Message sent.')));
								window.setTimeout(function() { window.location.reload(); }, 900);
							}).catch(failed);
						}
					}, _('Send'))
				])
			]);
		}

		if (groups.length) showThread(groups[0], contacts.firstChild);
		else showThread(null, null);

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		return E('div', { 'class': 'mt-sms' }, [
			this.styleNode(),
			controls.styleNode(),
			/* 背景环境光晕 */
			E('div', { 'class': 'mt-sms-bg-glow1' }),
			E('div', { 'class': 'mt-sms-bg-glow2' }),

			(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null,
			modemBar,

			/* 顶部 Hero 玻璃卡片 */
			E('section', { 'class': 'mt-sms-hero' }, [
				E('div', {}, [
					E('h2', {}, [
						svgNode('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'),
						_('Messages')
					]),
					E('p', {}, _('Conversations using the SIM installed in the module.')),
					E('div', { 'class': 'mt-sms-storage' }, [
						svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>'),
						'本机号码：' + (simNumber || '--') + '　·　模组内短信：' + modemMessages.length + ' 条'
					])
				]),
				E('div', { 'class': 'mt-sms-hero-actions' }, [
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-primary', 'click': newMessage }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'),
						_('New message')
					]),
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-secondary', 'click': function() { window.location.reload(); } }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'),
						_('Refresh')
					]),
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-secondary', 'click': function() { self.settingsModal(messages); } }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
						_('Settings')
					])
				])
			]),

			/* 毛玻璃对话主视窗 */
			E('div', { 'class': 'mt-sms-shell' }, [
				E('aside', { 'class': 'mt-sms-sidebar' }, [
					E('div', { 'class': 'mt-sms-sidehead' }, [
						E('strong', {}, _('Conversations')),
						E('span', { 'class': 'mt-sms-count-badge' }, String(groups.length))
					]),
					contacts
				]),
				E('section', { 'class': 'mt-sms-chat' }, [
					E('div', { 'class': 'mt-sms-chathead' }, chatTitle),
					thread,
					E('div', { 'class': 'mt-sms-compose' }, [
						recipientWrap,
						E('div', { 'class': 'mt-sms-compose-row' }, [
							text,
							E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-primary', 'click': send }, [
								svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'),
								_('Send')
							])
						])
					])
				])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
