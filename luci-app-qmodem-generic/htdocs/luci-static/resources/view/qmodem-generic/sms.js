'use strict';
'require view';
'require ui';
'require dom';
'require qmodem-generic.controls as controls';

var E = controls.element;

/*
 * 短信（Messages）— 现代白色毛玻璃 (Glassmorphism) + 动态 SVG 交互重构
 * 数据与动作经由 QModem 官方接口（封装于 qmodem-generic.controls）：
 *    qmodem.sms → 数据库收发记录；服务不存在/direct 模式时使用下面的旧接口
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
	if (Array.isArray(raw)) return raw.filter(function(item) { return item && typeof item === 'object' && !Array.isArray(item); });
	if (!raw || typeof raw !== 'object') return [];
	var keys = [ 'messages', 'received', 'msg', 'sms' ];
	for (var i = 0; i < keys.length; i++)
		if (raw[keys[i]] && typeof raw[keys[i]] === 'object') return smsEntries(raw[keys[i]]);
	return Object.keys(raw).map(function(key) { return raw[key]; }).filter(function(item) {
		return item && typeof item === 'object' && !Array.isArray(item) && pick(item, [ 'content', 'text', 'sender', 'recipient', 'index', 'id' ]) !== '';
	});
}

function atText(res) {
	return controls.atResponseText(res);
}

function formatTime(value) {
	var text = String(value == null ? '' : value).replace(/"/g, '').trim();
	if (!text)
		return '';
	if (/^\d{10,13}$/.test(text)) {
		var date = new Date(Number(text) * (text.length <= 10 ? 1000 : 1));
		if (!isNaN(date.getTime())) return '%s-%s-%s %s:%s'.format(date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'), String(date.getHours()).padStart(2, '0'), String(date.getMinutes()).padStart(2, '0'));
	}

	var m = text.match(/^(\d{2})\/(\d{2})\/(\d{2})\s*,?\s*(\d{2}):(\d{2})/);
	if (m)
		return '20%s-%s-%s %s:%s'.format(m[1], m[2], m[3], m[4], m[5]);

	m = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})[\sT,]+(\d{2}):(\d{2})/);
	if (m)
		return '%s-%s-%s %s:%s'.format(m[1], m[2], m[3], m[4], m[5]);

	return text.replace(/[+-]\d{2}$/, '').trim();
}

function normalizeMessage(item, position, source) {
	var rawIndex = pick(item, [ 'index', 'idx', 'id', 'sms_index', 'message_index' ]);
	/* 官方 QModem 的分段短信索引可能为 "1 2 3"，也可能是数组；
	 * index=0 仍是有效存储位置。 */
	var indexes = [], values = Array.isArray(rawIndex) ? rawIndex : rawIndex === '' ? [] : [ rawIndex ];
	values.forEach(function(raw) {
		String(raw).trim().split(/[\s,;]+/).forEach(function(index) {
			if (/^\d+$/.test(index) && indexes.indexOf(index) === -1) indexes.push(index);
		});
	});
	var index = indexes[0] || '';
	var status = String(pick(item, [ 'status', 'state', 'stat', 'type' ]) || '');
	var number = String(pick(item, [ 'sender', 'number', 'phone_number', 'phone', 'from', 'address', 'oa', 'recipient' ]) || '');
	var text = String(pick(item, [ 'content', 'text', 'message', 'message_content', 'body', 'msg' ]) || '');
	var date = formatTime(pick(item, [ 'time', 'date', 'timestamp', 'datetime', 'send_time', 'received' ]));
	var outgoing = /sent|sto|out/i.test(status) && !/rec/i.test(status);
	var timestamp = Number(item.timestamp);
	var order = timestamp > 0 ? timestamp * (timestamp < 1e12 ? 1000 : 1) : Date.parse(date.replace(' ', 'T')) || Number(index) || position;

	return {
		index: index,
		indexes: indexes,
		source: source || 'modem',
		number: number || '未知号码',
		date: date,
		text: text,
		status: status,
		direction: outgoing ? 'out' : 'in',
		unread: !outgoing && source === 'database' && !controls.isEnabled(item.is_read),
		failed: outgoing && (item.success === false || item.success === 0 || item.success === '0'),
		order: isFinite(order) ? order : position
	};
}

function parseMessages(raw) {
	var source = raw && raw._smsSource;
	var groups = [], multipart = Object.create(null);
	smsEntries(raw).forEach(function(item, position) {
		var reference = pick(item, [ 'reference' ]);
		/* QModem 的 get_sms 把长短信按存储槽位拆开；官方页面按
		 * reference + sender 合并，删除时需要带上每段的 index。 */
		if (source !== 'database' && reference !== '') {
			var key = String(reference) + '\u001f' + String(pick(item, [ 'sender', 'number', 'phone_number', 'phone', 'from', 'address', 'oa' ])) +
				'\u001f' + String(pick(item, [ 'total' ]));
			if (!multipart[key]) {
				multipart[key] = [];
				groups.push(multipart[key]);
			}
			multipart[key].push({ item: item, position: position });
		} else {
			groups.push([ { item: item, position: position } ]);
		}
	});
	return groups.map(function(parts) {
		parts.sort(function(a, b) { return (Number(a.item.part) || 0) - (Number(b.item.part) || 0); });
		var message = normalizeMessage(parts[0].item, parts[0].position, source);
		if (parts.length > 1) {
			message.indexes = [];
			message.text = '';
			parts.forEach(function(part) {
				var fragment = normalizeMessage(part.item, part.position, source);
				message.text += fragment.text;
				fragment.indexes.forEach(function(index) {
					if (message.indexes.indexOf(index) === -1) message.indexes.push(index);
				});
			});
			message.index = message.indexes[0] || '';
		}
		return message;
	}).sort(function(a, b) {
		return (a.order || 0) - (b.order || 0);
	});
}

/* 用户已确认删除的记录在本次会话中立即隐藏，避免被旧版 SMS 缓存重新画回。 */
function smsMessageKey(message) {
	/* 加上号码、时间及内容，避免运营商随后复用同一 SIM 槽位时误隐藏新短信。 */
	return [ message.source || 'modem', (message.indexes || []).join(','),
		String(message.index == null ? '' : message.index), message.number || '',
		message.date || '', message.text || '' ].join('\u001f');
}

function groupMessages(messages) {
	var groups = Object.create(null);
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
				item.direction = 'out'; item.source = 'browser'; item.indexes = []; return item;
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
			return controls.notify(null, E('p', {}, _('There is no sent history to export.')), 'info');
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
				controls.notify(null, E('p', {}, _('The selected file is not a valid sent-history backup.')), 'danger');
			}
		};
		reader.onerror = function() { controls.notify(null, E('p', {}, _('The selected history file could not be read.')), 'danger'); };
		reader.readAsText(file);
	},

	DOMAINS: [ 'sms', 'sim', 'device' ],
	POLL_INTERVAL: 5000,

	load: function() {
		var self = this;
		return controls.bootstrap().then(function(ctx) {
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
			guard(controls.getSmsInbox(section), '读取短信失败', errors),
			guard(controls.getSimInfo(section), '读取 SIM 信息失败', errors),
			guard(controls.getAtCfg(section), '读取 AT 端口配置失败', errors)
		]).then(function(results) {
			return { section: section, sms: results[0], sim: results[1], atcfg: results[2], errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.qm-app{--qm-glass-bg:var(--qm-glass);--qm-glass-border:var(--qm-border);--qm-glass-shadow:var(--qm-shadow-md);--qm-primary:var(--qm-accent);--qm-success:var(--qm-ok);--qm-warning:var(--qm-warn)}',
			'.mt-sms{position:relative;max-width:1160px;margin:0 auto;color:var(--qm-text);padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境漫反射光晕 */
			'.mt-sms-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:var(--qm-glow-a);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-sms-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:var(--qm-glow-b);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-sms-hero{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:26px 30px;margin-bottom:16px;background:var(--qm-surface-gradient);border-radius:20px;border:1px solid var(--qm-glass-border);box-shadow:var(--qm-glass-shadow);backdrop-filter:blur(20px)}',
			'.mt-sms-hero h2{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:var(--qm-hero-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;display:flex;align-items:center;gap:10px}',
			'.mt-sms-hero p{margin:0;font-size:13px;color:var(--qm-text-muted);line-height:1.5}',
			'.mt-sms-storage{font-size:11px;color:var(--qm-accent);font-weight:600;margin-top:6px;display:flex;align-items:center;gap:6px}',
			'.mt-sms-hero-actions{display:flex;gap:10px}',

			/* 毛玻璃主聊天界面框架 */
			'.mt-sms-shell{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:620px;border-radius:20px;border:1px solid var(--qm-glass-border);background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);box-shadow:var(--qm-glass-shadow);overflow:hidden}',

			/* 左侧联系人侧边栏 */
			'.mt-sms-sidebar{border-right:1px solid var(--qm-border-soft);background:var(--qm-surface-2);display:flex;flex-direction:column}',
			'.mt-sms-sidehead{padding:18px 20px;border-bottom:1px solid var(--qm-border-soft);display:flex;align-items:center;justify-content:space-between}',
			'.mt-sms-sidehead strong{font-size:14px;font-weight:750;color:var(--qm-text)}',
			'.mt-sms-count-badge{padding:2px 8px;border-radius:999px;background:var(--qm-border-soft);font-size:11px;font-weight:700;color:var(--qm-text-soft)}',
			'.mt-sms-contacts-scroll{flex:1;overflow-y:auto}',

			/* 联系人条目 */
			'.mt-sms-contact{display:flex;align-items:center;gap:12px;width:100%;border:0;border-bottom:1px solid var(--qm-border-soft);padding:14px 18px;text-align:left;background:transparent;cursor:pointer;transition:all .18s ease}',
			'.mt-sms-contact:hover{background:var(--qm-glass)}',
			'.mt-sms-contact.active{background:var(--qm-accent-soft);box-shadow:inset 3px 0 0 var(--qm-accent)}',
			'.mt-sms-avatar{width:36px;height:36px;border-radius:50%;background:var(--qm-accent-gradient);color:var(--qm-on-hero);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:750;flex-shrink:0}',
			'.mt-sms-contact-info{flex:1;min-width:0}',
			'.mt-sms-contact-top{display:flex;justify-content:space-between;align-items:center;gap:6px}',
			'.mt-sms-contact-number{font-weight:750;font-size:12.5px;color:var(--qm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.mt-sms-contact-date{font-size:10px;color:var(--qm-text-muted);flex-shrink:0}',
			'.mt-sms-contact-preview{font-size:11px;color:var(--qm-text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.mt-sms-unread{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;margin-left:6px;border-radius:999px;background:var(--qm-accent);color:var(--qm-on-hero);font-size:10px}',
			'.mt-sms-source-note{font-size:12px;line-height:1.6;color:var(--qm-text-muted);margin:0 0 14px}',

			/* 右侧消息气泡与对话区 */
			'.mt-sms-chat{display:flex;flex-direction:column;min-width:0;background:var(--qm-glass)}',
			'.mt-sms-chathead{padding:18px 24px;border-bottom:1px solid var(--qm-border-soft);display:flex;align-items:center;justify-content:space-between;background:var(--qm-glass)}',
			'.mt-sms-chathead strong{font-size:15px;font-weight:800;color:var(--qm-text)}',
			'.mt-sms-thread{flex:1;padding:24px;overflow-y:auto;max-height:480px;display:flex;flex-direction:column;gap:14px}',

			/* 气泡样式 */
			'.mt-sms-bubblewrap{display:flex;align-items:flex-end;gap:8px;max-width:80%}',
			'.mt-sms-bubblewrap.in{align-self:flex-start}',
			'.mt-sms-bubblewrap.out{align-self:flex-end;flex-direction:row-reverse}',
			'.mt-sms-bubble{padding:12px 16px;border-radius:18px;font-size:13px;line-height:1.55;word-break:break-word;position:relative}',
			'.mt-sms-bubblewrap.in .mt-sms-bubble{background:var(--qm-glass);border:1px solid var(--qm-border-soft);color:var(--qm-text);border-bottom-left-radius:4px;box-shadow:0 2px 8px var(--qm-shadow-color)}',
			'.mt-sms-bubblewrap.out .mt-sms-bubble{background:var(--qm-accent-gradient);color:var(--qm-on-hero);border-bottom-right-radius:4px;box-shadow:0 4px 14px var(--qm-accent-border)}',
			'.mt-sms-bubbledate{font-size:9.5px;margin-top:5px;opacity:.7;text-align:right}',
			'.mt-sms-delete{border:1px solid var(--qm-border-soft);background:var(--qm-surface);color:var(--qm-text-muted);cursor:pointer;font-size:15px;min-width:30px;min-height:30px;padding:4px;opacity:.72;transition:all .2s ease;border-radius:8px}',
			'.mt-sms-bubblewrap:hover .mt-sms-delete,.mt-sms-delete:focus-visible{opacity:1;color:var(--qm-danger);border-color:var(--qm-danger)}',

			/* 输入与发送区 */
			'.mt-sms-compose{border-top:1px solid var(--qm-border-soft);padding:16px 20px;background:var(--qm-glass)}',
			'.mt-sms-recipient{display:none;margin-bottom:10px}',
			'.mt-sms-recipient.show{display:block}',
			'.mt-sms-recipient input{width:100%;border-radius:10px;padding:8px 14px;border:1px solid var(--qm-border);background:var(--qm-glass);font-size:13px}',
			'.mt-sms-recipient input:focus{border-color:var(--qm-accent);outline:none;box-shadow:0 0 0 3px var(--qm-accent-soft)}',
			'.mt-sms-compose-row{display:flex;gap:12px;align-items:flex-end}',
			'.mt-sms-compose textarea{flex:1;resize:vertical;min-height:56px;max-height:140px;border-radius:12px;padding:10px 14px;border:1px solid var(--qm-border);background:var(--qm-glass);font-size:13px;line-height:1.5;transition:all .2s ease}',
			'.mt-sms-compose textarea:focus{border-color:var(--qm-accent);outline:none;box-shadow:0 0 0 3px var(--qm-accent-soft);background:var(--qm-surface)}',

			/* 空状态动态插图 */
			'.mt-sms-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:420px;color:var(--qm-text-muted);text-align:center;padding:30px}',
			'.mt-sms-empty strong{font-size:15px;color:var(--qm-text-soft);margin-top:14px}',
			'.mt-sms-empty p{font-size:12px;margin:4px 0 0}',

			/* 按钮系统 */
			'.mt-sms-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:10px;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .2s ease;border:1px solid transparent}',
			'.mt-sms-btn-primary{background:var(--qm-accent-gradient);color:var(--qm-on-hero);box-shadow:0 4px 12px var(--qm-accent-soft)}',
			'.mt-sms-btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px var(--qm-accent-border)}',
			'.mt-sms-btn-secondary{background:var(--qm-glass);color:var(--qm-text-soft);border-color:var(--qm-border-soft)}',
			'.mt-sms-btn-secondary:hover{background:var(--qm-surface);color:var(--qm-accent);border-color:var(--qm-accent-border);transform:translateY(-1px)}',

			/* 模态框设置排版 */
			'.mt-sms-settings-row{display:grid;grid-template-columns:135px 1fr;gap:12px;align-items:center;margin:12px 0}',
			'.mt-sms-danger{margin-top:20px;padding-top:16px;border-top:1px solid var(--qm-border-soft)}',

			/* 响应式适配 */
			'@media(max-width:780px){.mt-sms-shell{grid-template-columns:1fr}.mt-sms-sidebar{max-height:260px}.mt-sms-hero{flex-direction:column;align-items:flex-start}.mt-sms-hero-actions{width:100%;justify-content:flex-start}}'
		].join(''));
	},

	removeMessages: function(messages) {
		var self = this;
		var chain = Promise.resolve();
		(messages || []).forEach(function(message) {
			chain = chain.then(function() {
				return controls.deleteSmsMessage(self.section, message);
			});
		});
		return chain;
	},

	settingsModal: function(messages) {
		var self = this;
		var database = this.smsSource === 'database';
		var tdtech = controls.supportsTdTechAt(this.section);
		var smsc = E('input', { 'class': 'cbi-input-text', 'placeholder': '--' });
		var ims = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': '1' }, _('Enabled')), E('option', { 'value': '0' }, _('Disabled')) ]);
		var legacyStorage = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': 'SM' }, _('SIM card')), E('option', { 'value': 'ME' }, _('Module storage')) ]);
		var current = { ims: '', smsc: '', storage: '' };
		var importFile = E('input', { 'type': 'file', 'accept': 'application/json,.json', 'style': 'display:none', 'change': function() { if (importFile.files && importFile.files[0]) self.importSent(importFile.files[0]); } });

		/* ---- 官方 qmodem.sms 短信守护进程管理 ---- */
		var serviceRows = [];
		var modeSelect = controls.select([
			[ 'direct', _('直连模式（AT 直接收发）') ],
			[ 'database_poll', _('数据库轮询') ],
			[ 'database_urc', _('数据库 URC 触发') ]
		]);
		var pollInput = E('input', { 'type': 'number', 'min': '60', 'max': '3600', 'class': 'cbi-input-text', 'style': 'width:120px' });
		var autoDeleteBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		var forwardBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		var countryInput = E('input', { 'class': 'cbi-input-text', 'placeholder': '+86', 'style': 'width:120px' });
		var serviceStateLine = E('div', { 'class': 'mt-control-note', 'style': 'display:none' });
		var mem1 = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': 'SM' }, _('SIM card')), E('option', { 'value': 'ME' }, _('Module storage')) ]);
		var mem2 = mem1.cloneNode(true);
		var mem3 = mem1.cloneNode(true);
		var storageUsage = E('span', { 'style': 'font-size:11px;color:var(--qm-text-muted)' }, '--');
		var pduInput = E('textarea', { 'class': 'cbi-input-text', 'rows': 3, 'placeholder': _('粘贴 PDU 十六进制串（含短信中心号），经 qmodem.send_raw_pdu 直发'), 'style': 'font-family:ui-monospace,monospace' });

		function memRow(label, sel) {
			var row = E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, label), sel ]);
			return row;
		}
		var serviceSection = E('div', {}, [
			E('h4', { 'style': 'margin:18px 0 4px;font-size:13px;color:var(--qm-accent)' }, _('短信服务（qmodem_smsd）')),
			serviceStateLine,
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('接收模式')), modeSelect ]),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('轮询间隔（秒）')), pollInput ]),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('读取后从 SIM 删除')), autoDeleteBox ]),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('启用转发')), forwardBox ]),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('国家码')), countryInput ]),
			database ? E('div', { 'class': 'right', 'style': 'margin:6px 0' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() {
					controls.refreshSmsInbox(self.section, 'database').then(function() {
						controls.notify(null, E('p', {}, _('短信同步完成。')));
					}).catch(function(err) {
						controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				} }, _('立即同步'))
			]) : null
		]);
		var storageSection = E('div', {}, [
			E('h4', { 'style': 'margin:18px 0 4px;font-size:13px;color:var(--qm-accent)' }, _('短信存储位置')),
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('存储占用')), storageUsage ]),
			memRow(_('读取存储 (mem1)'), mem1),
			memRow(_('写入存储 (mem2)'), mem2),
			memRow(_('其它存储 (mem3)'), mem3)
		]);
		var legacyStorageRow = E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('Storage location')), legacyStorage ]);
		var pduSection = E('div', {}, [
			E('h4', { 'style': 'margin:18px 0 4px;font-size:13px;color:var(--qm-accent)' }, _('PDU 直发（高级）')),
			pduInput,
			E('div', { 'class': 'right', 'style': 'margin-top:8px' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() {
					var pdu = pduInput.value.replace(/[^0-9a-fA-F]/g, '');
					if (pdu.length < 2 || pdu.length % 2)
						return controls.notify(null, E('p', {}, _('PDU 必须是偶数长度的十六进制串。')), 'warning');
					controls.sendRawPdu(self.section, pdu).then(function() {
						controls.notify(null, E('p', {}, _('PDU 已提交模组发送。')));
					}).catch(function(err) {
						controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				} }, _('发送 PDU'))
			])
		]);

		function failed(err) { controls.notify(null, E('p', {}, err && err.message ? err.message : _('Message operation failed.')), 'danger'); }
		function query(cmd) { return controls.sendAt(self.section, self.atPort, cmd).then(atText).catch(function() { return ''; }); }

		ui.showModal(_('Message settings'), [ E('div', { 'style': 'max-height:70vh;overflow-y:auto' }, [
			E('p', { 'class': 'mt-control-note' }, database ? _('当前会话来自路由器短信数据库，读取后从 SIM 卡删除不会清除这些记录。') : _('当前会话来自模组存储，浏览器单独保存本页面发送的历史记录。')),
			tdtech ? E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('SMS service')), ims ]) : null,
			tdtech ? E('div', { 'class': 'alert-message warning' }, _('Changing SMS service cycles airplane mode and also changes the IMS PDP context. Leave it enabled unless the carrier does not support IMS messaging.')) : null,
			E('div', { 'class': 'mt-sms-settings-row' }, [ E('label', {}, _('Message center')), smsc ]),
			legacyStorageRow,
			serviceSection,
			storageSection,
			pduSection,
			E('div', { 'class': 'mt-control-note' }, _('短信中心 / IMS 等模组参数经 QModem 的 send_at 下发；短信服务与存储经官方 qmodem.sms 接口下发。部分参数可能不被本模组支持。')),
			E('div', { 'class': 'right' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Close')), ' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function() {
					var value = smsc.value.trim(), commands = [];
					if (value !== current.smsc) {
						if (!/^\+?[0-9]{5,20}$/.test(value)) return controls.notify(null, E('p', {}, _('Enter a valid message center number.')), 'warning');
						commands.push('AT+CSCA="' + value + '"');
					}
					if (!legacyStorage.disabled && legacyStorage.value !== current.storage) commands.push('AT+CPMS="' + legacyStorage.value + '","' + legacyStorage.value + '","' + legacyStorage.value + '"');
					if (tdtech && current.ims && ims.value !== current.ims) commands.push('AT^IMSSWITCH=' + ims.value);
					var atChain = commands.reduce(function(chain, cmd) { return chain.then(function() { return controls.sendAt(self.section, self.atPort, cmd); }); }, Promise.resolve());
					var serviceSave = serviceSection.parentNode ? controls.configureSmsService(self.section, {
						mode: modeSelect.value,
						pollInterval: Number(pollInput.value) || null,
						forwarding: forwardBox.checked,
						autoDelete: autoDeleteBox.checked,
						countryCode: countryInput.value.trim()
					}).catch(function(err) {
						if (serviceAvailable) throw err;
						return null;   /* 服务不可用时跳过，保持旧行为 */
					}) : Promise.resolve();
					var storageSave = storageAvailable ? controls.setSmsStorageService(self.section, mem1.value, mem2.value, mem3.value).catch(function(err) {
						if (storageAvailable) throw err;
						return null;
					}) : Promise.resolve();
					atChain.then(function() { return serviceSave; })
						.then(function() { return storageSave; })
						.then(function() {
							ui.hideModal(); controls.notify(null, E('p', {}, _('Message settings saved.')));
							window.setTimeout(function() { window.location.reload(); }, 1200);
						}).catch(failed);
				} }, _('Save settings'))
			]),
			E('div', { 'class': 'mt-sms-danger' }, [
				E('p', { 'style': 'font-size:12px;color:var(--qm-text-muted);margin-bottom:8px' }, database ? _('数据库收发记录保存在路由器。下方备份和清空操作仅处理旧版浏览器发送历史。') : _('Sent messages are stored in this browser. Export a backup before clearing browser data or moving to another device.')),
				importFile,
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.exportSent(); } }, database ? _('导出浏览器发送历史') : _('Export sent history')), ' ',
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { importFile.click(); } }, database ? _('导入浏览器发送历史') : _('Import sent history')),
				E('p', { 'style': 'font-size:12px;color:var(--qm-text-muted);margin:12px 0 8px' }, _('Clearing message history cannot be undone.')),
				E('button', { 'type': 'button', 'class': 'btn', 'click': function() { self.clearSent(); ui.hideModal(); window.location.reload(); } }, database ? _('清空浏览器发送历史') : _('Clear sent history')), ' ',
				E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
					ui.hideModal();
					ui.showModal(_('Clear all messages?'), [
						E('p', {}, database ? _('当前已加载的数据库接收记录将被永久删除。') : _('Every received message stored on the module will be permanently deleted.')),
						E('div', { 'class': 'right' }, [
							E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
							E('button', { 'type': 'button', 'class': 'btn cbi-button-negative', 'click': function() {
								ui.hideModal();
								var received = (messages || []).filter(function(msg) { return msg.direction !== 'out' && msg.indexes && msg.indexes.length; });
								if (!received.length) return controls.notify(null, E('p', {}, _('没有可删除的接收短信。')), 'info');
								self.removeMessages(received).then(function() { window.location.reload(); }).catch(failed);
							} }, _('Clear all'))
						])
					]);
				} }, _('Clear received messages'))
			])
		]) ]);

		legacyStorage.disabled = true; ims.disabled = true;
		mem1.disabled = mem2.disabled = mem3.disabled = true;
		var serviceAvailable = false, storageAvailable = false;

		Promise.all([
			query('AT+CSCA?'),
			tdtech ? query('AT^IMSSWITCH?') : Promise.resolve(''),
			controls.getSmsServiceConfig(self.section).catch(function() { return null; })
		]).then(function(res) {
			current.smsc = ((String(res[0]).match(/\+CSCA:\s*"([^"]+)"/) || [])[1] || '');
			current.ims = ((String(res[1]).match(/IMSSWITCH:\s*(\d+)/) || [])[1] || '');
			smsc.value = current.smsc;
			ims.value = current.ims === '0' ? '0' : '1';
			ims.disabled = !current.ims;

			var config = res[2];
			if (!config) {
				/* 旧版 QModem：无短信守护进程，退回 AT+CPMS 管理存储 */
				serviceStateLine.textContent = _('未检测到短信服务（qmodem_smsd），存储管理退回 AT+CPMS。');
				serviceStateLine.style.display = '';
				serviceSection.querySelectorAll('.mt-sms-settings-row, .right').forEach(function(node) { node.style.display = 'none'; });
				storageSection.style.display = 'none';
				return query('AT+CPMS?').then(function(text) {
					current.storage = ((String(text).match(/\+CPMS:\s*"([A-Z]+)"/) || [])[1] || '');
					legacyStorage.value = current.storage === 'ME' ? 'ME' : 'SM';
					legacyStorage.disabled = !/^(SM|ME)$/.test(current.storage);
				});
			}

			serviceAvailable = true;
			modeSelect.value = config.mode;
			pollInput.value = config.poll_interval != null ? config.poll_interval : 300;
			autoDeleteBox.checked = !!config.auto_delete;
			forwardBox.checked = !!config.forwarding;
			countryInput.value = config.country_code || '';

			controls.getSmsServiceStatus().then(function(status) {
				if (!status) return;
				serviceStateLine.style.display = '';
				serviceStateLine.textContent = _('服务状态：%s · 默认模式：%s · 数据库：%s').format(
					status.status || '--', status.default_mode || '--', status.database || '--');
			});
			controls.getSmsSyncStatus().then(function(sync) {
				if (!sync) return;
				var last = sync.last_sync_at ? new Date(Number(sync.last_sync_at) * 1000).toLocaleString() : '--';
				serviceStateLine.style.display = '';
				serviceStateLine.textContent += '　·　' + _('最近同步：%s（导入 %s 条）').format(last, sync.imported != null ? sync.imported : '--');
			});

			return controls.getSmsStorageService(self.section).then(function(storage) {
				storageAvailable = true;
				mem1.disabled = mem2.disabled = mem3.disabled = false;
				mem1.value = /^(SM|ME)$/.test(storage.mem1) ? storage.mem1 : 'SM';
				mem2.value = /^(SM|ME)$/.test(storage.mem2) ? storage.mem2 : storage.mem1;
				mem3.value = /^(SM|ME)$/.test(storage.mem3) ? storage.mem3 : storage.mem2;
				storageUsage.textContent = _('ME %s/%s · SM %s/%s').format(
					storage.ME.used, storage.ME.total, storage.SM.used, storage.SM.total);
				legacyStorageRow.style.display = 'none';
			}, function() {
				/* storage_get 失败：保持 AT+CPMS 通道 */
				return query('AT+CPMS?').then(function(text) {
					current.storage = ((String(text).match(/\+CPMS:\s*"([A-Z]+)"/) || [])[1] || '');
					legacyStorage.value = current.storage === 'ME' ? 'ME' : 'SM';
					legacyStorage.disabled = !/^(SM|ME)$/.test(current.storage);
					storageSection.style.display = 'none';
				});
			});
		}).catch(function() {});
	},

	render: function(res) {
		return controls.liveView(this, res, {
			interval: this.POLL_INTERVAL,
			skipIfFocused: false,
			wakeOn: res && res.section ? controls.smsReadInFlight(res.section) : null,
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
						controls.pageTitle('sms', _('Messages')),
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
		this.smsSource = res.sms && res.sms._smsSource || 'modem';
		var database = this.smsSource === 'database';

		var selfDeleted = this.smsDeletedKeys || {};
		var modemMessages = parseMessages(res.sms).filter(function(msg) { return !selfDeleted[smsMessageKey(msg)]; });
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

		function failed(err) { controls.notify(null, E('p', {}, err && err.message ? err.message : _('Message operation failed.')), 'danger'); }

		function showThread(group, button, markRead) {
			selected = group ? group.number : '';
			self.smsSelected = selected;
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
						msg.failed ? E('div', { 'class': 'mt-sms-bubbledate' }, _('发送失败')) : null,
						E('div', { 'class': 'mt-sms-bubbledate' }, msg.date || '--')
					]),
					E('button', {
						'type': 'button',
						'class': 'mt-sms-delete',
						'title': _('Delete'),
						'disabled': msg.source !== 'browser' && !msg.indexes.length ? 'disabled' : null,
						'click': function() {
							ui.showModal(_('Delete message?'), [
								E('p', {}, msg.source === 'browser' ? _('This removes the local sent-history entry.') : msg.source === 'database' ? _('这将永久删除路由器数据库中的这条短信。') : _('This removes the selected message from the module.')),
								E('div', { 'class': 'right' }, [
									E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
									E('button', {
										'type': 'button', 'class': 'btn cbi-button-negative',
										'click': function() {
											if (self.smsDeleting) return;
											ui.hideModal();
											if (msg.source === 'browser') {
												window.localStorage.setItem('modem.sms.sent', JSON.stringify(self.sentHistory().filter(function(item) { return item.order !== msg.order; })));
												window.location.reload();
												return;
											}
											self.smsDeleting = true;
											self.removeMessages([msg]).then(function() {
												self.smsDeletedKeys = self.smsDeletedKeys || {};
												self.smsDeletedKeys[smsMessageKey(msg)] = true;
												/* 不直接重载旧缓存：立即从会话删除，轮询再从后台确认状态。 */
												var removed = modemMessages.indexOf(msg);
												if (removed !== -1) modemMessages.splice(removed, 1);
												removed = messages.indexOf(msg);
												if (removed !== -1) messages.splice(removed, 1);
												var page = contacts.closest('.mt-sms');
												if (page) {
													var storageCount = page.querySelector('.mt-sms-storage-text');
													if (storageCount) storageCount.textContent = (simNumber ? '本机号码：' + simNumber + '　·　' : '') +
														(database ? '数据库短信：' : '模组内短信：') + modemMessages.length + ' 条';
												}
												group.messages = group.messages.filter(function(item) { return item !== msg; });
												if (group.messages.length) {
													var last = group.messages[group.messages.length - 1];
													var preview = button && button.querySelector('.mt-sms-contact-preview');
													var date = button && button.querySelector('.mt-sms-contact-date');
													if (preview) preview.textContent = last.text || _('Empty message');
													if (date) date.textContent = String(last.date || '').substring(5);
													showThread(group, button, false);
												} else {
													if (button && button.parentNode) button.parentNode.removeChild(button);
													if (page) page.querySelector('.mt-sms-count-badge').textContent = String(contacts.children.length);
													showThread(null, null, false);
												}
												controls.notify(null, E('p', {}, _('短信已删除。')), 'info');
											}).catch(failed).then(function() { self.smsDeleting = false; });
										}
									}, _('Delete'))
								])
							]);
						}
					}, '✕')
				]);
			}));
			thread.scrollTop = thread.scrollHeight;
			if (markRead && database && group.messages.some(function(msg) { return msg.unread; }))
				controls.markSmsRead(self.section, group.messages).then(function() {
					group.messages.forEach(function(msg) { msg.unread = false; });
					var badge = button && button.querySelector('.mt-sms-unread');
					if (badge) badge.remove();
				}).catch(failed);
		}

		groups.forEach(function(group, index) {
			var last = group.messages[group.messages.length - 1];
			var initial = (group.number || '').replace(/^\+/, '').slice(-2) || '信';
			var button = E('button', { 'type': 'button', 'class': 'mt-sms-contact' + (index ? '' : ' active') }, [
				E('div', { 'class': 'mt-sms-avatar' }, initial),
				E('div', { 'class': 'mt-sms-contact-info' }, [
					E('div', { 'class': 'mt-sms-contact-top' }, [
						E('span', { 'class': 'mt-sms-contact-number' }, group.number),
						group.messages.some(function(msg) { return msg.unread; }) ? E('span', { 'class': 'mt-sms-unread', 'aria-label': _('未读短信') }, String(group.messages.filter(function(msg) { return msg.unread; }).length)) : null,
						E('span', { 'class': 'mt-sms-contact-date' }, String(last.date || '').substring(5))
					]),
					E('div', { 'class': 'mt-sms-contact-preview' }, last.text || _('Empty message'))
				])
			]);
			button.addEventListener('click', function() { showThread(group, button, true); });
			contacts.appendChild(button);
		});

		function newMessage() {
			showThread(null, null);
			recipientWrap.classList.add('show');
			recipient.focus();
		}

		function send() {
			if (self.smsSending) return;
			if (!res.sms) return failed(new Error(_('短信读取失败，请恢复短信服务后再发送。')));
			var number = (selected || recipient.value).trim(), body = text.value.trim();
			if (!/^\+?[0-9]{5,20}$/.test(number) || !body)
				return controls.notify(null, E('p', {}, _('Enter a valid phone number and message.')), 'warning');

			ui.showModal(_('Send message?'), [
				E('p', {}, _('Send this message to %s?').format(number)),
				E('div', { 'class': 'right' }, [
					E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')), ' ',
					E('button', {
						'type': 'button', 'class': 'btn cbi-button-apply',
						'click': function() {
							if (self.smsSending) return;
							ui.hideModal();
							self.smsSending = true; sendButton.disabled = true; text.disabled = true; recipient.disabled = true;
							controls.sendSmsInbox(self.section, number, body, self.smsSource).then(function() {
								if (!database) self.saveSent(number, body);
								text.value = '';
								controls.notify(null, E('p', {}, _('Message sent.')));
								window.setTimeout(function() { window.location.reload(); }, 900);
							}).catch(failed).then(function() { self.smsSending = false; sendButton.disabled = false; text.disabled = false; recipient.disabled = false; });
						}
					}, _('Send'))
				])
			]);
		}

		var activeIndex = Math.max(0, groups.findIndex(function(group) { return group.number === self.smsSelected; }));
		if (groups.length) showThread(groups[activeIndex], contacts.children[activeIndex]);
		else showThread(null, null);
		var sendButton = E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-primary', 'click': send }, [
			svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'), _('Send')
		]);

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
					controls.pageTitle('sms', _('Messages')),
					E('p', {}, _('Conversations using the SIM installed in the module.')),
					E('div', { 'class': 'mt-sms-storage' }, [
						svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>'),
						E('span', { 'class': 'mt-sms-storage-text' },
							(simNumber ? '本机号码：' + simNumber + '　·　' : '') + (res.sms && res.sms._smsPending ? '正在读取模组短信…' : res.sms ? (database ? '数据库短信：' : '模组内短信：') + modemMessages.length + ' 条' : '短信读取失败'))
					])
				]),
				E('div', { 'class': 'mt-sms-hero-actions' }, [
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-primary', 'click': newMessage }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'),
						_('New message')
					]),
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-secondary', 'click': function(ev) {
						if (!res.sms) { window.location.reload(); return; }
						var button = ev.currentTarget;
						button.disabled = true;
						controls.refreshSmsInbox(self.section, self.smsSource).then(function() {
							return controls.getSmsInbox(self.section);
						}).then(function(inbox) {
							res.sms = inbox;
							var page = button.closest('.mt-sms');
							if (page && page.parentNode) dom.content(page.parentNode, self.paintContent(res));
						}).catch(failed).then(function() { button.disabled = false; });
					} }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'),
						_('Refresh')
					]),
					E('button', { 'type': 'button', 'class': 'mt-sms-btn mt-sms-btn-secondary', 'click': function() { self.settingsModal(messages); } }, [
						svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
						_('Settings')
					])
				])
			]),

			database ? E('p', { 'class': 'mt-sms-source-note' }, _('短信保存在路由器数据库中，与 QModem 原界面共用收发记录。') + (res.sms._smsTruncated ? _('当前仅显示已加载的最近记录。') : '')) : null,

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
							sendButton
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
