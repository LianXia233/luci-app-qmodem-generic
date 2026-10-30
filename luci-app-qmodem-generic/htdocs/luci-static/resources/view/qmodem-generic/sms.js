'use strict';
'require view';
'require ui';
'require dom';
'require qmodem-generic.controls as controls';
'require qmodem-generic.theme as theme';
/* global L */

var E = controls.element;

/*
 * MT5700 Soft Anime Cloned & Adapted SMS IM Dashboard for QModem Generic
 * 萌系 IM 会话态交互 · 气泡收发 · 头像系统 · 完全复刻无英雄栏
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
	var indexes = [], values = Array.isArray(rawIndex) ? rawIndex : rawIndex === '' ? [] : [ rawIndex ];
	values.forEach(function(raw) {
		String(raw).trim().split(/[\s,;]+/).forEach(function(index) {
			if (/^\d+$/.test(index) && indexes.indexOf(index) === -1) indexes.push(index);
		});
	});

	var sender = pick(item, [ 'sender', 'from', 'phone', 'number', 'address' ]);
	var recipient = pick(item, [ 'recipient', 'to', 'dest', 'destination' ]);
	var type = String(pick(item, [ 'type', 'box', 'folder', 'direction' ])).toLowerCase();
	var stat = String(pick(item, [ 'stat', 'status', 'state' ])).toLowerCase();
	var unread = stat.indexOf('unread') !== -1 || stat.indexOf('rec unread') !== -1 || type.indexOf('unread') !== -1 || item.read === false || item.read === 0 || item.read === '0';
	var direction = (type.indexOf('sent') !== -1 || type.indexOf('out') !== -1 || stat.indexOf('sto sent') !== -1 || (!sender && recipient)) ? 'out' : 'in';
	var number = direction === 'out' ? (recipient || sender || _('未知号码')) : (sender || recipient || _('未知号码'));
	var text = pick(item, [ 'content', 'text', 'message', 'body', 'data' ]);
	var time = formatTime(pick(item, [ 'time', 'date', 'timestamp', 'received', 'sent' ]));
	var order = Date.parse(time) || (Date.now() - position * 1000);

	return {
		id: indexes[0] != null ? indexes[0] : (item.id || position),
		indexes: indexes,
		source: source || 'modem',
		direction: direction,
		number: number,
		text: text,
		date: time,
		unread: unread,
		order: order
	};
}

function smsMessageKey(msg) {
	return [ msg.source || 'modem', msg.direction || '', msg.number || '', (msg.indexes && msg.indexes.length) ? msg.indexes.join(',') : '', msg.date || '', msg.text || '' ].join('|');
}

function parseMessages(smsPayload) {
	var list = smsEntries(smsPayload), out = [];
	list.forEach(function(item, idx) {
		var msg = normalizeMessage(item, idx, smsPayload && smsPayload._smsSource);
		if (msg.text || msg.number) out.push(msg);
	});
	return out;
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

function smsAvatar(isSent, sizeClass) {
	var img = E('img', {
		'class': 'mt5700-sms-avatar ' + (sizeClass || 'mt5700-sms-avatar-md'),
		'src': isSent ? '/luci-static/resources/qmodem-generic/avatar-sent.png' : '/luci-static/resources/qmodem-generic/avatar-recv.png',
		'alt': isSent ? '我' : '对方'
	});
	return img;
}

return view.extend({
	POLL_INTERVAL: 10000,
	smsSelected: '',
	smsSource: 'modem',

	sentHistory: function() {
		try {
			return JSON.parse(window.localStorage.getItem('modem.sms.sent') || window.localStorage.getItem('sms_sent_messages_cache') || '[]').map(function(item) {
				return item && item.content ? { number: item.number, text: item.content, date: item.time, order: Date.parse(item.time) || 0 } : item;
			}).filter(function(item) { return item && item.number && item.text; }).map(function(item) {
				item.direction = 'out'; item.source = 'browser'; item.indexes = []; return item;
			});
		} catch (e) { return []; }
	},

	saveSent: function(number, content) {
		try {
			var list = this.sentHistory();
			var now = new Date();
			var time = '%s-%s-%s %s:%s'.format(now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0'), String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'));
			list.push({ number: number, text: content, date: time, direction: 'out', source: 'browser', indexes: [], order: now.getTime() });
			window.localStorage.setItem('modem.sms.sent', JSON.stringify(list));
		} catch (e) {}
	},

	load: function() {
		var self = this;
		return controls.bootstrap().then(function(ctx) {
			self.section = ctx.section;
			return self.collect(ctx);
		});
	},

	collect: function(ctx) {
		var self = this, errors = [];
		var section = (ctx && ctx.section) || 'modem1';
		self.modems = (ctx && ctx.sections) || [];

		if (!section) return { section: null, errors: errors };

		return Promise.all([
			guard(controls.getSmsInbox(section), '获取短信失败', errors),
			guard(controls.getSimInfo(section), '获取 SIM 信息失败', errors),
			guard(controls.getAtCfg(section), '获取 AT 端口配置失败', errors)
		]).then(function(results) {
			return { section: section, sms: results[0], sim: results[1], atcfg: results[2], errors: errors };
		});
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

		var modeSelect = controls.select([
			[ 'direct', _('直接模式（AT 直接收发）') ],
			[ 'database_poll', _('数据库轮询') ],
			[ 'database_urc', _('数据库 URC 推送') ]
		]);
		var pollInput = E('input', { 'type': 'number', 'min': '60', 'max': '3600', 'class': 'cbi-input-text', 'style': 'width:120px' });
		var autoDeleteBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		var forwardBox = E('input', { 'type': 'checkbox', 'class': 'cbi-input-checkbox' });
		var countryInput = E('input', { 'class': 'cbi-input-text', 'placeholder': '+86', 'style': 'width:120px' });
		var serviceStateLine = E('div', { 'class': 'mt-control-note', 'style': 'display:none' });
		var mem1 = E('select', { 'class': 'cbi-input-select' }, [ E('option', { 'value': 'SM' }, _('SIM card')), E('option', { 'value': 'ME' }, _('Module storage')) ]);
		var mem2 = mem1.cloneNode(true);
		var mem3 = mem1.cloneNode(true);
		var storageUsage = E('span', { 'style': 'font-size:11px;color:var(--mt5700-text-secondary)' }, '--');

		function memRow(label, sel) {
			return E('div', { 'class': 'mt-sms-settings-row', 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--mt5700-border-subtle);' }, [ E('label', {}, label), sel ]);
		}

		var serviceSection = E('div', {}, [
			E('h4', { 'style': 'margin:14px 0 6px;font-size:13px;color:var(--mt5700-accent);font-weight:750;' }, _('后台短信服务 (qmodem_smsd)')),
			serviceStateLine,
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('工作模式')), modeSelect ]),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('轮询间隔(秒)')), pollInput ]),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('读取后自 SIM 删除')), autoDeleteBox ]),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('转发短信')), forwardBox ]),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('默认国家代码')), countryInput ]),
			database ? E('div', { 'class': 'right', 'style': 'margin:8px 0' }, [
				E('button', { 'type': 'button', 'class': 'btn cbi-button-apply', 'click': function() {
					controls.refreshSmsInbox(self.section, 'database').then(function() {
						controls.notify(null, E('p', {}, _('短信同步完成。')));
					}).catch(function(err) {
						controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				} }, _('立即同步数据库'))
			]) : null
		]);

		var storageSection = E('div', {}, [
			E('h4', { 'style': 'margin:14px 0 6px;font-size:13px;color:var(--mt5700-accent);font-weight:750;' }, _('存储位置 (CPMS)')),
			E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;padding:8px 0;' }, [ E('label', {}, _('存储占用')), storageUsage ]),
			memRow(_('读取存储 (mem1)'), mem1),
			memRow(_('写入存储 (mem2)'), mem2),
			memRow(_('接收存储 (mem3)'), mem3)
		]);

		ui.showModal(_('短信配置与存储设置'), [
			serviceSection,
			storageSection,
			E('div', { 'class': 'right', 'style': 'margin-top:18px;' }, [
				E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('关闭')), ' ',
				E('button', {
					'type': 'button', 'class': 'btn cbi-button-apply',
					'click': function() {
						ui.hideModal();
						controls.saveSmsCountryCode(self.section, countryInput.value.trim()).catch(function() {});
						controls.notify(null, E('p', {}, _('设置已更新。')));
					}
				}, _('保存'))
			])
		]);
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
		var enter = !self.painted;
		self.painted = true;
		theme.apply();

		if (!res.section) {
			return E('div', { 'class': 'mt5700-page mt5700-sms-shell qm-app' + (enter ? ' qm-enter' : '') }, [
				E('div', { 'class': 'alert-message warning' }, _('未检测到模组（请确认 QModem 已识别设备）。')),
				(res.errors || []).length ? E('div', { 'class': 'alert-message warning' }, res.errors.join('；')) : null
			]);
		}

		this.section = res.section;
		this.smsSource = res.sms && res.sms._smsSource || 'modem';
		var database = this.smsSource === 'database';

		var selfDeleted = this.smsDeletedKeys || {};
		var modemMessages = parseMessages(res.sms).filter(function(msg) { return !selfDeleted[smsMessageKey(msg)]; });
		var messages = modemMessages.concat(this.sentHistory());
		var groups = groupMessages(messages);
		var simNumber = controls.findEntry(controls.entryList(res.sim), 'SIM Number') || '';

		var selected = self.smsSelected || (groups[0] && groups[0].number) || '';
		var keyword = '';
		var filterTab = 'all';

		/* 顶层容器：完全复刻 MT5700 SMS Shell，删除任何英雄栏 */
		var shell = E('div', { 'class': 'mt5700-page mt5700-sms-shell qm-app' + (enter ? ' qm-enter' : '') });

		var modems = self.modems || (controls.getModemSectionsSync ? controls.getModemSectionsSync() : []);
		var modemBar = (controls.renderModemBar && modems.length > 0) ? controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		}) : null;
		if (modemBar) shell.appendChild(modemBar);

		var layout = E('div', { 'class': 'mt5700-sms-layout' });
		shell.appendChild(layout);

		/* ---------------- 左栏：会话列表 (mt5700-sms-side) ---------------- */
		var side = E('div', { 'class': 'mt5700-sms-side' });
		layout.appendChild(side);

		var storageText = (simNumber ? '本机:' + simNumber + ' · ' : '') + (database ? '数据库短信: ' : 'SIM卡: ') + modemMessages.length + ' 条';
		var storageEl = E('span', { 'class': 'mt5700-sms-storage' }, storageText);

		side.appendChild(E('div', { 'class': 'mt5700-sms-side-head' }, [
			E('div', { 'class': 'mt5700-sms-mark' }, '✦'),
			E('span', {}, '短信会话'),
			storageEl
		]));

		/* 搜索框 */
		var searchInput = E('input', {
			'type': 'text',
			'placeholder': '搜索号码或内容...',
			'aria-label': '搜索会话'
		});
		side.appendChild(E('div', { 'class': 'mt5700-sms-search' }, [
			E('span', { 'aria-hidden': 'true', 'style': 'font-size:16px;line-height:1;' }, '⌕'),
			searchInput
		]));

		/* 筛选标签栏 */
		var filterBar = E('div', { 'class': 'mt5700-sms-filters' });
		var tabButtons = {};
		[
			{ id: 'all', title: '全部' },
			{ id: 'unread', title: '未读' },
			{ id: 'sent', title: '已发' }
		].forEach(function(td) {
			var tb = E('button', {
				'type': 'button',
				'class': (td.id === 'all' ? 'active' : '')
			}, td.title);
			tb.addEventListener('click', function() {
				filterTab = td.id;
				filterBar.querySelectorAll('button').forEach(function(b) { b.classList.remove('active'); });
				tb.classList.add('active');
				renderContactList();
			});
			filterBar.appendChild(tb);
			tabButtons[td.id] = tb;
		});
		side.appendChild(filterBar);

		/* 会话卡片滚动容器 */
		var convList = E('div', { 'class': 'mt5700-sms-convs' });
		side.appendChild(convList);

		/* 底部操作脚栏 */
		var sideFoot = E('div', { 'class': 'mt5700-sms-side-foot' });
		var newBtn = E('button', {
			'type': 'button',
			'class': 'btn cbi-button-apply',
			'style': 'width:100%;margin-bottom:8px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:6px;',
			'click': function() {
				newConversation();
			}
		}, [
			svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'),
			'新建短信'
		]);
		sideFoot.appendChild(newBtn);

		var footRow = E('div', { 'style': 'display:flex;justify-content:space-between;align-items:center;' }, [
			E('span', { 'style': 'font-size:12px;color:var(--mt5700-text-secondary);' }, '会话: ' + groups.length + ' 个'),
			E('button', {
				'type': 'button',
				'class': 'btn',
				'style': 'font-size:12px;padding:4px 12px;border-radius:10px;',
				'click': function() { self.settingsModal(messages); }
			}, '短信设置')
		]);
		sideFoot.appendChild(footRow);
		side.appendChild(sideFoot);

		/* ---------------- 右栏：聊天对话流 (mt5700-sms-chat) ---------------- */
		var chat = E('div', { 'class': 'mt5700-sms-chat' });
		layout.appendChild(chat);

		var backBtn = E('button', {
			'type': 'button',
			'class': 'mt5700-sms-back',
			'title': '返回会话列表',
			'aria-label': '返回会话列表'
		}, '‹');
		backBtn.addEventListener('click', function() {
			shell.classList.remove('is-mobile-chat');
		});

		var headAvatar = smsAvatar(false, 'mt5700-sms-avatar-md');
		var chatTitle = E('h2', {}, selected || '请选择会话');
		var chatChannel = E('span', { 'class': 'mt5700-sms-channel' }, [
			E('span', { 'class': 'mt5700-sms-dot online' }),
			E('span', {}, database ? '数据库会话就绪' : '5G 蜂窝短信通道就绪')
		]);

		var refreshBtn = E('button', {
			'type': 'button',
			'class': 'btn',
			'style': 'padding:6px 12px;border-radius:10px;display:flex;align-items:center;gap:4px;',
			'click': function(ev) {
				var b = ev.currentTarget;
				b.disabled = true;
				controls.refreshSmsInbox(self.section, self.smsSource).then(function() {
					window.location.reload();
				}).catch(function(err) {
					controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
				}).then(function() { b.disabled = false; });
			}
		}, [
			svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'),
			'刷新'
		]);

		var settingsBtn = E('button', {
			'type': 'button',
			'class': 'btn',
			'style': 'padding:6px 12px;border-radius:10px;display:flex;align-items:center;gap:4px;',
			'click': function() { self.settingsModal(messages); }
		}, [
			svgNode('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'),
			'设置'
		]);

		var chatHead = E('div', { 'class': 'mt5700-sms-chat-head' }, [
			backBtn,
			headAvatar,
			E('div', { 'class': 'mt5700-sms-chat-copy' }, [ chatTitle, chatChannel ]),
			E('div', { 'class': 'mt5700-sms-chat-actions' }, [ refreshBtn, settingsBtn ])
		]);
		chat.appendChild(chatHead);

		/* 气泡滚动消息区 (mt5700-sms-msgs) */
		var msgsBox = E('div', { 'class': 'mt5700-sms-msgs' });
		chat.appendChild(msgsBox);

		/* 底部输入框 (mt5700-sms-composer) */
		var recipientWrap = E('div', { 'style': 'display:none;margin-bottom:8px;' }, [
			E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'placeholder': '请输入对方 5-19 位手机号码...',
				'style': 'width:100%;border-radius:12px;padding:8px 14px;'
			})
		]);
		var recipientInput = recipientWrap.firstElementChild;

		var textarea = E('textarea', {
			'rows': 2,
			'maxlength': 500,
			'placeholder': '输入短信内容...',
			'style': 'resize:none;'
		});

		var sendBtn = E('button', {
			'type': 'button',
			'class': 'mt5700-sms-send',
			'click': function() { doSend(); }
		}, [
			svgNode('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'),
			'发送'
		]);

		var composer = E('div', { 'class': 'mt5700-sms-composer', 'style': 'flex-direction:column;align-items:stretch;' }, [
			recipientWrap,
			E('div', { 'style': 'display:flex;gap:10px;align-items:flex-end;' }, [
				textarea,
				sendBtn
			])
		]);
		chat.appendChild(composer);

		/* 交互逻辑：渲染会话列表 */
		function renderContactList() {
			convList.innerHTML = '';
			var filtered = groups.filter(function(g) {
				if (keyword) {
					var matchNum = g.number.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
					var matchText = g.messages.some(function(m) { return (m.text || '').toLowerCase().indexOf(keyword.toLowerCase()) !== -1; });
					if (!matchNum && !matchText) return false;
				}
				if (filterTab === 'unread') {
					return g.messages.some(function(m) { return m.unread; });
				}
				if (filterTab === 'sent') {
					return g.messages.some(function(m) { return m.direction === 'out'; });
				}
				return true;
			});

			if (!filtered.length) {
				convList.appendChild(E('div', { 'style': 'text-align:center;padding:40px 10px;color:var(--mt5700-text-secondary);font-size:13px;' }, '暂无符合条件的短信会话'));
				return;
			}

			filtered.forEach(function(g) {
				var lastMsg = g.messages[g.messages.length - 1] || {};
				var isAct = g.number === selected;
				var unreadCount = g.messages.filter(function(m) { return m.unread; }).length;

				var item = E('button', {
					'type': 'button',
					'class': 'mt5700-sms-conv' + (isAct ? ' active' : '')
				}, [
					smsAvatar(false, 'mt5700-sms-avatar-md'),
					E('div', { 'class': 'mt5700-sms-conv-copy' }, [
						E('div', { 'class': 'mt5700-sms-conv-name' }, g.number),
						E('div', { 'class': 'mt5700-sms-conv-preview' }, lastMsg.text || '(空短信)')
					]),
					E('div', { 'style': 'display:flex;flex-direction:column;align-items:flex-end;gap:4px;' }, [
						E('time', { 'class': 'mt5700-sms-conv-time' }, (lastMsg.date || '').substring(5)),
						unreadCount > 0 ? E('span', { 'style': 'background:#ef4444;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;' }, String(unreadCount)) : null
					])
				]);

				item.addEventListener('click', function() {
					selectConversation(g.number);
				});
				convList.appendChild(item);
			});
		}

		/* 交互逻辑：选择某个会话 */
		function selectConversation(num) {
			selected = num;
			self.smsSelected = num;
			chatTitle.textContent = num;
			recipientWrap.style.display = 'none';
			recipientInput.value = num;
			shell.classList.add('is-mobile-chat');

			renderContactList();
			renderChatMessages();
		}

		/* 交互逻辑：新建短信 */
		function newConversation() {
			selected = '';
			self.smsSelected = '';
			chatTitle.textContent = '新建短信';
			recipientWrap.style.display = 'block';
			recipientInput.value = '';
			recipientInput.focus();
			shell.classList.add('is-mobile-chat');

			renderContactList();
			msgsBox.innerHTML = '';
			msgsBox.appendChild(E('div', { 'style': 'text-align:center;padding:60px 20px;color:var(--mt5700-text-secondary);' }, [
				E('div', { 'style': 'font-size:36px;margin-bottom:10px;' }, '✉'),
				E('strong', { 'style': 'font-size:15px;color:var(--mt5700-text);' }, '创建新短信'),
				E('p', { 'style': 'margin-top:4px;font-size:13px;' }, '在下方输入对方手机号码和短信内容后点击发送')
			]));
		}

		/* 交互逻辑：渲染当前选中会话的消息流 */
		function renderChatMessages() {
			msgsBox.innerHTML = '';
			var g = groups.find(function(item) { return item.number === selected; });
			if (!g || !g.messages.length) {
				msgsBox.appendChild(E('div', { 'style': 'text-align:center;padding:60px 20px;color:var(--mt5700-text-secondary);' }, '暂无对话消息'));
				return;
			}

			g.messages.forEach(function(m) {
				var isSent = m.direction === 'out';
				var row = E('div', { 'class': 'mt5700-sms-row ' + (isSent ? 'outgoing' : 'incoming') });

				var bubble = E('div', { 'class': 'mt5700-sms-bubble' }, [
					E('div', { 'style': 'word-break:break-word;' }, m.text || '(空短信)'),
					E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px;' }, [
						E('button', {
							'type': 'button',
							'class': 'mt5700-sms-del',
							'title': '删除该短信',
							'click': function(ev) {
								ev.stopPropagation();
								confirmDeleteMessage(m, g);
							}
						}, '删除'),
						E('div', { 'class': 'mt5700-sms-time' }, m.date || '')
					])
				]);

				if (isSent) {
					row.appendChild(bubble);
					row.appendChild(smsAvatar(true, 'mt5700-sms-avatar-sm'));
				} else {
					row.appendChild(smsAvatar(false, 'mt5700-sms-avatar-sm'));
					row.appendChild(bubble);
				}
				msgsBox.appendChild(row);
			});

			/* 自动平滑滚动到底部 */
			setTimeout(function() {
				msgsBox.scrollTop = msgsBox.scrollHeight;
			}, 30);
		}

		/* 交互逻辑：确认删除短信 */
		function confirmDeleteMessage(msg, group) {
			ui.showModal(_('删除短信确认'), [
				E('p', {}, msg.source === 'browser' ? _('此操作将删除本地发送历史记录。') : (database ? _('此操作将从路由器数据库中删除此条短信。') : _('此操作将从 SIM 卡中删除此条短信。'))),
				E('div', { 'class': 'right', 'style': 'margin-top:16px;' }, [
					E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('取消')), ' ',
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button-negative',
						'click': function() {
							ui.hideModal();
							if (msg.source === 'browser') {
								var newHist = self.sentHistory().filter(function(item) { return item.order !== msg.order; });
								window.localStorage.setItem('modem.sms.sent', JSON.stringify(newHist));
								window.location.reload();
								return;
							}
							self.removeMessages([msg]).then(function() {
								self.smsDeletedKeys = self.smsDeletedKeys || {};
								self.smsDeletedKeys[smsMessageKey(msg)] = true;
								group.messages = group.messages.filter(function(m) { return m !== msg; });
								controls.notify(null, E('p', {}, _('短信已删除。')));
								renderChatMessages();
								renderContactList();
							}).catch(function(err) {
								controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
							});
						}
					}, _('删除'))
				])
			]);
		}

		/* 交互逻辑：发送短信 */
		function doSend() {
			if (self.smsSending) return;
			var targetNumber = (selected || recipientInput.value).trim();
			var bodyText = textarea.value.trim();

			if (!/^\+?[0-9]{5,20}$/.test(targetNumber)) {
				controls.notify(null, E('p', {}, _('请输入正确的 5-20 位手机号码。')), 'warning');
				return;
			}
			if (!bodyText) {
				controls.notify(null, E('p', {}, _('短信内容不能为空。')), 'warning');
				return;
			}

			ui.showModal(_('发送短信确认'), [
				E('p', {}, _('确认发送短信至 %s 吗？').format(targetNumber)),
				E('div', { 'class': 'right', 'style': 'margin-top:16px;' }, [
					E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('取消')), ' ',
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button-apply',
						'click': function() {
							ui.hideModal();
							self.smsSending = true;
							sendBtn.disabled = true;
							textarea.disabled = true;
							controls.sendSmsInbox(self.section, targetNumber, bodyText, self.smsSource).then(function() {
								if (!database) self.saveSent(targetNumber, bodyText);
								textarea.value = '';
								controls.notify(null, E('p', {}, _('短信发送成功。')));
								setTimeout(function() { window.location.reload(); }, 900);
							}).catch(function(err) {
								controls.notify(null, E('p', {}, (err && err.message) || String(err)), 'danger');
							}).then(function() {
								self.smsSending = false;
								sendBtn.disabled = false;
								textarea.disabled = false;
							});
						}
					}, _('立即发送'))
				])
			]);
		}

		/* 绑定搜索输入事件 */
		searchInput.addEventListener('input', function() {
			keyword = (searchInput.value || '').trim();
			renderContactList();
		});

		/* 初始化渲染 */
		renderContactList();
		if (selected) {
			selectConversation(selected);
		} else {
			newConversation();
		}

		return shell;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
