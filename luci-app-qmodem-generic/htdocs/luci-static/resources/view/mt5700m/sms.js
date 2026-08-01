'use strict';
'require view';
'require ui';
'require dom';
'require mt5700m.controls as controls';

/*
 * 短信（Messages）
 *
 * 数据与动作全部经由 QModem 的 `qmodem` ubus 对象（封装于 mt5700m.controls）：
 *   get_sms   → 会话列表 / 消息内容
 *   send_sms  → 发送短信
 *   delete_sms→ 删除模组内短信
 *   sim_info  → 本机号码（发件上下文）
 *   get_at_cfg/send_at → 短信中心号码、存储位置、IMS 开关等模块级设置
 * 旧的 AT 文本后端（短信列表/发送/删除）已全部移除。
 */

/* 出错时不抛异常，记入 errors 数组，返回 null，避免白屏 */
function guard(promise, label, errors) {
	return Promise.resolve(promise).catch(function(err) {
		errors.push(label + '：' + ((err && err.message) || String(err)));
		return null;
	});
}

/* 从对象里按候选键顺序取第一个有值的字段 */
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

/* 把 get_sms 的返回值统一成数组（兼容 {sms:[]} / {sms:{}} / [] 等形态） */
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

/* AT 响应文本（send_at 可能返回 {result:'...'} 或裸字符串） */
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

/* 时间戳尽量归一成 YYYY-MM-DD HH:MM，取不到则原样显示 */
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

/* 单条 QModem 短信 → 视图内部结构（字段名按模组实现可能不同，逐一兜底） */
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
	return Object.keys(groups).map(function(number) { return { number:number, messages:groups[number].sort(function(a,b){return (a.order||0)-(b.order||0);}) }; }).sort(function(a,b){return (b.messages[b.messages.length-1].order||0)-(a.messages[a.messages.length-1].order||0);});
}

return view.extend({
	sentHistory:function(){
		try{return JSON.parse(window.localStorage.getItem('modem.sms.sent')||window.localStorage.getItem('sms_sent_messages_cache')||'[]').map(function(item){return item&&item.content?{number:item.number,text:item.content,date:item.time,order:Date.parse(item.time)||0}:item;}).filter(function(item){return item&&item.number&&item.text;}).map(function(item){item.direction='out';item.indexes=[];return item;});}catch(e){return[];}
	},
	saveSent:function(number,text){
		var now=new Date(),history=this.sentHistory();
		history.push({number:number,text:text,date:'%s-%s-%s %s:%s'.format(now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0'),String(now.getHours()).padStart(2,'0'),String(now.getMinutes()).padStart(2,'0')),order:now.getTime(),direction:'out',indexes:[]});
		window.localStorage.setItem('modem.sms.sent',JSON.stringify(history.slice(-500)));
	},
	clearSent:function(){window.localStorage.removeItem('modem.sms.sent');window.localStorage.removeItem('sms_sent_messages_cache');},
	exportSent:function(){
		var history=this.sentHistory();
		if(!history.length)return ui.addNotification(null,E('p',{},_('There is no sent history to export.')),'info');
		var blob=new Blob([JSON.stringify({format:'modem-sent-history',version:1,messages:history},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
		link.href=url;link.download='modem-sent-history.json';document.body.appendChild(link);link.click();link.remove();window.setTimeout(function(){URL.revokeObjectURL(url);},0);
	},
	importSent:function(file){
		var self=this,reader=new FileReader();
		reader.onload=function(){
			try{
				var parsed=JSON.parse(reader.result),items=Array.isArray(parsed)?parsed:parsed.messages;
				if(!Array.isArray(items))throw new Error('format');
				var clean=items.map(function(item){
					var number=String(item.number||''),text=String(item.text||item.content||''),order=Number(item.order||Date.parse(item.date||item.time)||0);
					if(!/^\+?[0-9]{5,20}$/.test(number)||!text||!order)return null;
					return {number:number,text:text,date:String(item.date||item.time||''),order:order,direction:'out',indexes:[]};
				}).filter(Boolean).slice(-500);
				if(!clean.length&&items.length)throw new Error('content');
				window.localStorage.setItem('modem.sms.sent',JSON.stringify(clean));window.localStorage.removeItem('sms_sent_messages_cache');window.location.reload();
			}catch(e){ui.addNotification(null,E('p',{},_('The selected file is not a valid sent-history backup.')),'danger');}
		};
		reader.onerror=function(){ui.addNotification(null,E('p',{},_('The selected history file could not be read.')),'danger');};reader.readAsText(file);
	},

	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

			if (!section)
				return { section: null, errors: errors };

			return Promise.all([
				guard(controls.getSms(section), '读取短信失败', errors),
				guard(controls.getSimInfo(section), '读取 SIM 信息失败', errors),
				guard(controls.getAtCfg(section), '读取 AT 端口配置失败', errors)
			]).then(function(results) {
				return { section: section, sms: results[0], sim: results[1], atcfg: results[2], errors: errors };
			});
		}).catch(function(err) {
			errors.push('读取 QModem 配置失败：' + ((err && err.message) || String(err)));
			return { section: null, errors: errors };
		});
	},

	styleNode: function(){return E('style',{},[
		'.mt-sms{max-width:1120px;margin:0 auto}.mt-sms-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:21px 23px;border-radius:14px;background:linear-gradient(135deg,#173550,#17616c);color:#fff;margin-bottom:15px}.mt-sms-hero h2{color:#fff;margin:0 0 5px}.mt-sms-hero p{margin:0;color:#c8e0e3}.mt-sms-hero-actions{display:flex;gap:8px}.mt-sms-hero .btn{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.35);color:#fff}',
		'.mt-sms-shell{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:590px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff);overflow:hidden}.mt-sms-sidebar{border-right:1px solid var(--border-color-low,#e9edf0);background:var(--background-color-low,#fafbfc)}.mt-sms-sidehead,.mt-sms-chathead{padding:15px 17px;border-bottom:1px solid var(--border-color-low,#e9edf0);display:flex;align-items:center;justify-content:space-between;gap:10px}.mt-sms-sidehead strong,.mt-sms-chathead strong{font-size:14px}',
		'.mt-sms-contact{display:block;width:100%;border:0;border-bottom:1px solid var(--border-color-low,#edf0f3);padding:14px 16px;text-align:left;background:transparent;cursor:pointer}.mt-sms-contact:hover,.mt-sms-contact.active{background:#eaf3fb}.mt-sms-contact-top{display:flex;justify-content:space-between;gap:8px}.mt-sms-contact-number{font-weight:700}.mt-sms-contact-date{font-size:10px;color:#78818a}.mt-sms-contact-preview{font-size:11px;color:#727c85;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
		'.mt-sms-chat{display:flex;flex-direction:column;min-width:0}.mt-sms-thread{flex:1;padding:20px;overflow:auto;max-height:470px;background:linear-gradient(#f8fafc,#fff)}.mt-sms-bubblewrap{display:flex;align-items:flex-end;gap:8px;margin-bottom:15px}.mt-sms-bubblewrap.out{justify-content:flex-end}.mt-sms-bubble{max-width:78%;padding:11px 13px;border-radius:4px 14px 14px 14px;background:#fff;border:1px solid #e0e6eb;box-shadow:0 2px 7px rgba(25,45,65,.04);white-space:pre-wrap;line-height:1.55}.mt-sms-bubblewrap.out .mt-sms-bubble{order:2;border-radius:14px 4px 14px 14px;background:#e7f4ff;border-color:#c7e1f5}.mt-sms-bubblewrap.out .mt-sms-delete{order:1}.mt-sms-bubbledate{font-size:10px;color:#87909a;margin-top:6px}.mt-sms-delete{border:0;background:transparent;color:#a66;cursor:pointer;font-size:11px;opacity:.65}.mt-sms-delete:hover{opacity:1}',
		'.mt-sms-compose{border-top:1px solid var(--border-color-low,#e9edf0);padding:13px 15px}.mt-sms-recipient{display:none;margin-bottom:9px}.mt-sms-recipient.show{display:block}.mt-sms-recipient input{width:100%}.mt-sms-compose-row{display:flex;gap:9px;align-items:flex-end}.mt-sms-compose textarea{flex:1;resize:vertical;min-height:54px;max-height:130px}.mt-sms-empty{display:flex;align-items:center;justify-content:center;min-height:420px;color:#78818a;text-align:center;padding:30px}.mt-sms-storage{font-size:11px;color:#d6eaed;margin-top:7px}',
		'.mt-sms-settings-row{display:grid;grid-template-columns:135px 1fr;gap:10px;align-items:center;margin:12px 0}.mt-sms-settings-row input,.mt-sms-settings-row select{width:100%}.mt-sms-danger{margin-top:18px;padding-top:14px;border-top:1px solid #eee}',
		'@media(max-width:760px){.mt-sms-shell{grid-template-columns:1fr}.mt-sms-sidebar{border-right:0;border-bottom:1px solid #e9edf0;max-height:250px;overflow:auto}.mt-sms-hero{display:block}.mt-sms-hero-actions{margin-top:13px}.mt-sms-thread{max-height:430px}.mt-sms-bubble{max-width:90%}}'
	].join(''));},

	/* 模组内短信删除（QModem delete_sms） */
	removeMessages:function(indexes){
		var self=this;
		var chain=Promise.resolve();
		(indexes||[]).forEach(function(index){
			chain=chain.then(function(){
				var value=Number(index);
				return controls.deleteSms(self.section,isFinite(value)?value:index);
			});
		});
		return chain;
	},

	settingsModal:function(messages){
		var self=this;
		var smsc=E('input',{'class':'cbi-input-text','placeholder':'--'});
		var storage=E('select',{'class':'cbi-input-select'},[E('option',{'value':'SM'},_('SIM card')),E('option',{'value':'ME'},_('Module storage'))]);
		var ims=E('select',{'class':'cbi-input-select'},[E('option',{'value':'1'},_('Enabled')),E('option',{'value':'0'},_('Disabled'))]);
		var current={ims:'',smsc:'',storage:''};
		var importFile=E('input',{'type':'file','accept':'application/json,.json','style':'display:none','change':function(){if(importFile.files&&importFile.files[0])self.importSent(importFile.files[0]);}});
		function failed(err){ui.addNotification(null,E('p',{},err&&err.message?err.message:_('Message operation failed.')),'danger');}
		function query(cmd){return controls.sendAt(self.section,self.atPort,cmd).then(atText).catch(function(){return '';});}

		ui.showModal(_('Message settings'),[E('div',{},[
			E('div',{'class':'mt-sms-settings-row'},[E('label',{},_('SMS service')),ims]),
			E('div',{'class':'alert-message warning'},_('Changing SMS service cycles airplane mode and also changes the IMS PDP context. Leave it enabled unless the carrier does not support IMS messaging.')),
			E('div',{'class':'mt-sms-settings-row'},[E('label',{},_('Message center')),smsc]),
			E('div',{'class':'mt-sms-settings-row'},[E('label',{},_('Storage location')),storage]),
			E('div',{'class':'mt-control-note'},'以上设置经 QModem 的 send_at 下发到模组，部分参数可能不被本模组支持。'),
			E('div',{'class':'right'},[E('button',{'type':'button','class':'btn','click':ui.hideModal},_('Close')),' ',E('button',{'type':'button','class':'btn cbi-button-apply','click':function(){
				var value=smsc.value.trim();
				if(!/^\+?[0-9]{5,20}$/.test(value))return ui.addNotification(null,E('p',{},_('Enter a valid message center number.')),'warning');
				var tasks=[controls.sendAt(self.section,self.atPort,'AT+CSCA="'+value+'"')];
				tasks.push(controls.sendAt(self.section,self.atPort,'AT+CPMS="'+storage.value+'","'+storage.value+'","'+storage.value+'"'));
				if(ims.value!==current.ims)tasks.push(controls.sendAt(self.section,self.atPort,'AT^IMSSWITCH='+ims.value));
				Promise.all(tasks).then(function(){ui.hideModal();ui.addNotification(null,E('p',{},_('Message settings saved.')));window.setTimeout(function(){window.location.reload();},1200);}).catch(failed);
			}},_('Save settings'))]),
			E('div',{'class':'mt-sms-danger'},[
				E('p',{},_('Sent messages are stored in this browser. Export a backup before clearing browser data or moving to another device.')),importFile,
				E('button',{'type':'button','class':'btn','click':function(){self.exportSent();}},_('Export sent history')),' ',
				E('button',{'type':'button','class':'btn','click':function(){importFile.click();}},_('Import sent history')),
				E('p',{},_('Clearing message history cannot be undone.')),
				E('button',{'type':'button','class':'btn','click':function(){self.clearSent();ui.hideModal();window.location.reload();}},_('Clear sent history')),' ',
				E('button',{'type':'button','class':'btn cbi-button-negative','click':function(){
					ui.hideModal();
					ui.showModal(_('Clear all messages?'),[E('p',{},_('Every received message stored on the module will be permanently deleted.')),E('div',{'class':'right'},[E('button',{'type':'button','class':'btn','click':ui.hideModal},_('Cancel')),' ',E('button',{'type':'button','class':'btn cbi-button-negative','click':function(){
						ui.hideModal();
						var indexes=[];
						(messages||[]).forEach(function(msg){if(msg.direction!=='out')indexes=indexes.concat(msg.indexes||[]);});
						if(!indexes.length)return ui.addNotification(null,E('p',{},'模组内没有可删除的短信。'),'info');
						self.removeMessages(indexes).then(function(){window.location.reload();}).catch(failed);
					}},_('Clear all'))])]);
				}},_('Clear received messages'))
			])
		])]);

		/* 现有配置经 QModem send_at 读取，取不到时保持占位符 */
		Promise.all([query('AT+CSCA?'),query('AT+CPMS?'),query('AT^IMSSWITCH?')]).then(function(res){
			current.smsc=((String(res[0]).match(/\+CSCA:\s*"([^"]+)"/)||[])[1]||'');
			current.storage=((String(res[1]).match(/\+CPMS:\s*"([A-Z]+)"/)||[])[1]||'');
			current.ims=((String(res[2]).match(/IMSSWITCH:\s*(\d+)/)||[])[1]||'');
			smsc.value=current.smsc;
			storage.value=current.storage==='ME'?'ME':'SM';
			ims.value=current.ims==='0'?'0':'1';
		}).catch(function(){});
	},

	render:function(res){
		var self=this;
		res=res||{};

		if(!res.section){
			return E('div',{'class':'mt-sms mt-ui-page'},[this.styleNode(),controls.styleNode(),
				E('section',{'class':'mt-sms-hero mt-ui-hero'},[E('div',{},[E('h2',{},_('Messages')),E('p',{},_('Conversations using the SIM installed in the module.'))])]),
				E('div',{'class':'alert-message warning'},_('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors||[]).length?E('div',{'class':'alert-message warning'},res.errors.join('；')):null
			]);
		}

		this.section=res.section;
		var atcfg=(res.atcfg&&res.atcfg.at_cfg)?res.atcfg.at_cfg:(res.atcfg||{});
		this.atPort=atcfg.at_port||'';

		var modemMessages=parseMessages(res.sms);
		var messages=modemMessages.concat(this.sentHistory());
		var groups=groupMessages(messages);
		var simNumber=controls.findEntry(controls.entryList(res.sim),'SIM Number')||'';

		var contacts=E('div',{}),thread=E('div',{'class':'mt-sms-thread'}),chatTitle=E('strong',{},_('Select a conversation')),recipient=E('input',{'class':'cbi-input-text','placeholder':'+8613800000000','inputmode':'tel'}),recipientWrap=E('div',{'class':'mt-sms-recipient'},recipient),text=E('textarea',{'class':'cbi-input-text','rows':2,'maxlength':500,'placeholder':_('Write a message…')}),selected='';

		function failed(err){ui.addNotification(null,E('p',{},err&&err.message?err.message:_('Message operation failed.')),'danger');}

		function showThread(group,button){selected=group?group.number:'';recipient.value=selected;recipientWrap.classList.toggle('show',!group);chatTitle.textContent=group?group.number:_('New message');contacts.querySelectorAll('.mt-sms-contact').forEach(function(node){node.classList.toggle('active',node===button);});dom.content(thread,group?group.messages.map(function(msg){return E('div',{'class':'mt-sms-bubblewrap '+(msg.direction==='out'?'out':'in')},[E('div',{'class':'mt-sms-bubble'},[msg.text||_('Empty message'),E('div',{'class':'mt-sms-bubbledate'},msg.date||'--')]),E('button',{'type':'button','class':'mt-sms-delete','title':_('Delete'),'click':function(){ui.showModal(_('Delete message?'),[E('p',{},msg.direction==='out'?_('This removes the local sent-history entry.'):_('This removes the selected message from the module.')),E('div',{'class':'right'},[E('button',{'type':'button','class':'btn','click':ui.hideModal},_('Cancel')),' ',E('button',{'type':'button','class':'btn cbi-button-negative','click':function(){ui.hideModal();if(msg.direction==='out'){window.localStorage.setItem('modem.sms.sent',JSON.stringify(self.sentHistory().filter(function(item){return item.order!==msg.order;})));window.location.reload();return;}self.removeMessages(msg.indexes).then(function(){window.location.reload();}).catch(failed);}},_('Delete'))])]);}},'×')]);}):E('div',{'class':'mt-sms-empty'},[E('div',{},[E('strong',{},_('Start a new conversation')),E('p',{},_('Enter a phone number below and write your message.'))])]));thread.scrollTop=thread.scrollHeight;}

		groups.forEach(function(group,index){var last=group.messages[group.messages.length-1],button=E('button',{'type':'button','class':'mt-sms-contact'+(index?'':' active')},[E('div',{'class':'mt-sms-contact-top'},[E('span',{'class':'mt-sms-contact-number'},group.number),E('span',{'class':'mt-sms-contact-date'},String(last.date||'').substring(5))]),E('div',{'class':'mt-sms-contact-preview'},last.text||_('Empty message'))]);button.addEventListener('click',function(){showThread(group,button);});contacts.appendChild(button);});

		function newMessage(){showThread(null,null);recipientWrap.classList.add('show');recipient.focus();}

		function send(){
			var number=(selected||recipient.value).trim(),body=text.value.trim();
			if(!/^\+?[0-9]{5,20}$/.test(number)||!body)return ui.addNotification(null,E('p',{},_('Enter a valid phone number and message.')),'warning');
			ui.showModal(_('Send message?'),[E('p',{},_('Send this message to %s?').format(number)),E('div',{'class':'right'},[E('button',{'type':'button','class':'btn','click':ui.hideModal},_('Cancel')),' ',E('button',{'type':'button','class':'btn cbi-button-apply','click':function(){
				ui.hideModal();
				controls.sendSms(self.section,number,body).then(function(){
					self.saveSent(number,body);text.value='';
					ui.addNotification(null,E('p',{},_('Message sent.')));
					window.setTimeout(function(){window.location.reload();},900);
				}).catch(failed);
			}},_('Send'))])]);
		}

		if(groups.length)showThread(groups[0],contacts.firstChild);else showThread(null,null);

		var modems=controls.getModemSectionsSync();
		var modemBar=controls.renderModemBar(modems,res.section,function(id){
			controls.setStoredSection(id);
			window.location.reload();
		});

		return E('div',{'class':'mt-sms mt-ui-page'},[this.styleNode(),controls.styleNode(),
			(res.errors||[]).length?E('div',{'class':'alert-message warning'},res.errors.join('；')):null,
			modemBar,
			E('section',{'class':'mt-sms-hero mt-ui-hero'},[
				E('div',{},[
					E('h2',{},_('Messages')),
					E('p',{},_('Conversations using the SIM installed in the module.')),
					E('div',{'class':'mt-sms-storage'},'本机号码：'+(simNumber||'--')+'　·　模组内短信：'+modemMessages.length+' 条（数据来自 QModem）')
				]),
				E('div',{'class':'mt-sms-hero-actions'},[
					E('button',{'type':'button','class':'btn','click':newMessage},_('New message')),
					E('button',{'type':'button','class':'btn','click':function(){window.location.reload();}},_('Refresh')),
					E('button',{'type':'button','class':'btn','click':function(){self.settingsModal(messages);}},_('Settings'))
				])
			]),
			E('div',{'class':'mt-sms-shell mt-ui-card'},[
				E('aside',{'class':'mt-sms-sidebar'},[E('div',{'class':'mt-sms-sidehead'},[E('strong',{},_('Conversations')),E('span',{},String(groups.length))]),contacts]),
				E('section',{'class':'mt-sms-chat'},[E('div',{'class':'mt-sms-chathead'},chatTitle),thread,E('div',{'class':'mt-sms-compose'},[recipientWrap,E('div',{'class':'mt-sms-compose-row'},[text,E('button',{'type':'button','class':'btn cbi-button-apply','click':send},_('Send'))])])])
			])
		]);
	},handleSave:null,handleSaveApply:null,handleReset:null
});
