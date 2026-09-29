'use strict';
'require view';
'require ui';
'require qmodem-generic.controls as controls';

/*
 * 模组与 SIM（Module & SIM）— 现代白色毛玻璃 (Glassmorphism) + 动态 SVG 芯片拓扑重构
 * 数据与动作全部经 QModem 的 `qmodem` ubus 对象。
 */

var SIM_STATUS_TEXT = {
	'READY': _('就绪'),
	'SIM READY': _('就绪'),
	'SIM PIN': _('需要输入 PIN 码'),
	'SIM PUK': _('需要输入 PUK 码'),
	'SIM PIN2': _('需要输入 PIN2 码'),
	'SIM PUK2': _('需要输入 PUK2 码'),
	'NOT INSERTED': _('未检测到 SIM 卡'),
	'NOT READY': _('SIM 未就绪'),
	'NOSIM': _('未检测到 SIM 卡')
};

function simStatusText(value) {
	if (!value) return '--';
	return SIM_STATUS_TEXT[String(value).toUpperCase().trim()] || value;
}

function svgNode(xmlString) {
	var wrap = document.createElement('div');
	wrap.innerHTML = xmlString.trim();
	return wrap.firstElementChild;
}

return view.extend({
	DOMAINS: [ 'sim', 'device', 'status' ],
	POLL_INTERVAL: 8000,

	load: function() {
		var self = this;
		return controls.bootstrap(this.DOMAINS).then(function(ctx) {
			self.section = ctx.section;
			return self.collect(ctx);
		});
	},

	collect: function(ctx) {
		var section = ctx.section;
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
			guard(controls.getSimInfo(section), [], _('SIM 信息')),
			guard(controls.getBaseInfo(section), [], _('模组信息')),
			guard(controls.getImei(section), {}, 'IMEI'),
			guard(controls.getSimSlot(section), {}, _('SIM 卡槽')),
			guard(controls.getSimSwitchCapabilities(section), {}, _('SIM 卡槽切换')),
			guard(controls.getAtCfg(section), {}, _('AT 串口'))
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
	},

	styleNode: function() {
		return E('style', {}, [
			':root{--qm-glass-bg:rgba(255,255,255,0.72);--qm-glass-border:rgba(255,255,255,0.85);--qm-glass-shadow:0 8px 32px rgba(31,64,120,0.06),0 1px 3px rgba(0,0,0,0.03);--qm-primary:#0072f5;--qm-success:#10b981;--qm-warning:#f59e0b;--qm-danger:#ef4444}',
			'.mt-system{position:relative;max-width:1160px;margin:0 auto;color:#1e293b;padding-bottom:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
			/* 背景环境漫反射光晕 */
			'.mt-sys-bg-glow1{position:absolute;top:-50px;left:6%;width:440px;height:440px;background:radial-gradient(circle,rgba(0,114,245,0.12) 0%,rgba(16,185,129,0.04) 50%,transparent 70%);border-radius:50%;filter:blur(50px);pointer-events:none;z-index:0}',
			'.mt-sys-bg-glow2{position:absolute;top:380px;right:4%;width:420px;height:420px;background:radial-gradient(circle,rgba(99,102,241,0.09) 0%,rgba(14,165,233,0.05) 50%,transparent 70%);border-radius:50%;filter:blur(60px);pointer-events:none;z-index:0}',

			/* 白色毛玻璃卡片通用规则 */
			'.mt-system-card{position:relative;z-index:1;background:var(--qm-glass-bg);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--qm-glass-border);border-radius:20px;box-shadow:var(--qm-glass-shadow);padding:22px;transition:transform .24s cubic-bezier(.2,.8,.4,1),box-shadow .24s ease}',
			'.mt-system-card:hover{transform:translateY(-2px);box-shadow:0 12px 38px rgba(31,64,120,0.08),0 2px 6px rgba(0,0,0,0.04)}',
			'.mt-system-card.wide{grid-column:1/-1}',

			/* 顶部 Hero 玻璃卡片 */
			'.mt-system-hero{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:26px 30px;margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(240,246,255,0.7) 100%)}',
			'.mt-system-kicker{font-size:12px;color:#0072f5;font-weight:750;letter-spacing:.04em;margin-bottom:4px}',
			'.mt-system-title{margin:0 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}',
			'.mt-system-sub{font-size:13px;color:#64748b;line-height:1.5}',
			'.mt-system-temp-box{display:flex;align-items:center;gap:12px;padding:10px 18px;border-radius:16px;background:rgba(255,255,255,0.8);border:1px solid rgba(226,232,240,0.85);box-shadow:0 4px 12px rgba(0,0,0,0.03)}',
			'.mt-system-temp-val{font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-.02em;font-variant-numeric:tabular-nums}',
			'.mt-system-temp-desc{font-size:11px;color:#64748b}',

			/* 芯片与 SIM 动态 SVG 架构拓扑 */
			'.mt-sys-topo-card{padding:20px 24px;margin-bottom:16px}',
			'.mt-sys-topo-svg{width:100%;height:100px;display:block}',
			'@keyframes qmPulseChip{0%{opacity:.6}50%{opacity:1}100%{opacity:.6}}',
			'.qm-chip-glow{animation:qmPulseChip 2.2s infinite ease-in-out}',

			/* 2 列信息网格 */
			'.mt-system-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}',
			'.mt-card-title{font-size:15px;font-weight:750;color:#0f172a;display:flex;align-items:center;gap:8px;margin-bottom:14px}',
			'.mt-system-row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(226,232,240,0.6);font-size:12px}',
			'.mt-system-row:last-child{border-bottom:0}',
			'.mt-system-row span{color:#64748b;font-weight:500}',
			'.mt-system-row strong{color:#0f172a;font-weight:600;text-align:right;word-break:break-word;font-variant-numeric:tabular-nums}',

			/* 操作与交互控制卡片 */
			'.mt-sys-actions-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0 16px}',
			'.mt-sys-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:12px;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .2s ease;border:1px solid transparent;backdrop-filter:blur(8px)}',
			'.mt-sys-btn-primary{background:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);color:#fff;box-shadow:0 4px 12px rgba(0,114,245,0.2)}',
			'.mt-sys-btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(0,114,245,0.3)}',
			'.mt-sys-btn-danger{background:rgba(254,242,242,0.85);color:#dc2626;border-color:rgba(254,202,202,0.8)}',
			'.mt-sys-btn-danger:hover{background:#fee2e2;transform:translateY(-1px)}',
			'.mt-sys-btn-secondary{background:rgba(255,255,255,0.85);color:#334155;border-color:rgba(226,232,240,0.8)}',
			'.mt-sys-btn-secondary:hover{background:#fff;color:#0072f5;transform:translateY(-1px);border-color:rgba(0,114,245,0.3)}',

			/* 维护面板与工具栏 */
			'.mt-system-maintenance{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:16px}',
			'.mt-system-maint-tools{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}',

			/* 固件升级 (FOTA) 玻璃卡片 */
			'.mt-system-fota{margin-bottom:16px;background:linear-gradient(135deg,rgba(255,255,255,0.85) 0%,rgba(254,249,235,0.7) 100%)}',
			'.mt-system-fota-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}',
			'.mt-system-state{padding:4px 12px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:700}',
			'.mt-system-progress{height:8px;margin:16px 0 6px;border-radius:999px;background:#e2e8f0;overflow:hidden}',
			'.mt-system-progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0072f5,#10b981)}',
			'.mt-system-url{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:14px}',
			'.mt-system-url input{background:rgba(255,255,255,0.9);border:1px solid rgba(203,213,225,0.8);border-radius:10px;padding:8px 14px;font-size:13px;width:100%;box-sizing:border-box}',
			'.mt-system-url input:focus{border-color:#0072f5;box-shadow:0 0 0 3px rgba(0,114,245,0.15);outline:none}',

			/* 技术细节折叠区 */
			'.mt-system-details{margin-bottom:16px}',
			'.mt-system-details summary{list-style:none;cursor:pointer;padding:16px 20px;font-size:13.5px;font-weight:750;color:#0f172a;display:flex;align-items:center;justify-content:space-between}',
			'.mt-system-details summary::-webkit-details-marker{display:none}',
			'.mt-system-raw{background:#0f172a;padding:16px;border-radius:14px;color:#38bdf8;font:11.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:360px;overflow:auto}',

			/* 模态框热保护表单 */
			'.mt-system-thermal-form{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;max-height:46vh;overflow:auto;padding-right:6px}',

			/* 响应式 */
			'@media(max-width:980px){.mt-system-grid{grid-template-columns:1fr}.mt-system-card.wide{grid-column:auto}}',
			'@media(max-width:680px){.mt-system-hero{flex-direction:column;align-items:flex-start}.mt-system-maintenance{flex-direction:column;align-items:flex-start}.mt-system-maint-tools{width:100%;justify-content:flex-start}.mt-system-url{grid-template-columns:1fr}.mt-system-thermal-form{grid-template-columns:1fr}}'
		].join(''));
	},

	row: function(label, value) {
		return E('div', { 'class': 'mt-system-row' }, [
			E('span', {}, label),
			E('strong', {}, value || '--')
		]);
	},

	/* 动态 SVG 模组 SoC 与 SIM 物理拓扑链路 */
	renderSvgChipTopo: function(slot, slotSupported, simOk) {
		var activeSlot = slot !== '' ? slot : '0';
		var simColor = simOk ? '#10b981' : '#f59e0b';
		var simText = simOk ? _('SIM 在位 · 就绪') : _('SIM 异常 / 未就绪');

		var svgStr = [
			'<svg class="mt-sys-topo-svg" viewBox="0 0 540 86">',
			'  <!-- 节点 1: 蜂窝通信基带芯片 (Modem SoC) -->',
			'  <g transform="translate(20, 14)">',
			'    <rect x="0" y="0" width="130" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <rect x="14" y="16" width="24" height="24" rx="5" fill="#0072f5" class="qm-chip-glow"/>',
			'    <text x="46" y="27" font-size="12" font-weight="750" fill="#0f172a">基带 SoC</text>',
			'    <text x="46" y="42" font-size="10" fill="#64748b">射频核心 RF</text>',
			'  </g>',
			'  <!-- 通信总线链路 -->',
			'  <line x1="150" y1="42" x2="225" y2="42" stroke="#0072f5" stroke-width="2.4" stroke-dasharray="6,4" class="qm-stream-line"/>',
			'  <!-- 节点 2: 卡槽复用切换开关 (SIM Multiplexer) -->',
			'  <g transform="translate(225, 14)">',
			'    <rect x="0" y="0" width="115" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="22" cy="28" r="5.5" fill="#0072f5"/>',
			'    <text x="36" y="27" font-size="12" font-weight="750" fill="#0f172a">SIM 切换开关</text>',
			'    <text x="36" y="42" font-size="10" fill="#64748b">' + (slotSupported ? _('支持双槽切换') : _('单卡槽架构')) + '</text>',
			'  </g>',
			'  <!-- 通信链路到活动卡槽 -->',
			'  <line x1="340" y1="42" x2="400" y2="42" stroke="' + simColor + '" stroke-width="2.4" stroke-linecap="round"/>',
			'  <!-- 节点 3: 活动 SIM 卡槽 -->',
			'  <g transform="translate(400, 14)">',
			'    <rect x="0" y="0" width="125" height="56" rx="12" fill="rgba(241,245,249,0.85)" stroke="#cbd5e1" stroke-width="1.6"/>',
			'    <circle cx="20" cy="28" r="5.5" fill="' + simColor + '"/>',
			'    <text x="34" y="27" font-size="12" font-weight="750" fill="#0f172a">' + _('SIM 卡槽 %s').format(activeSlot) + '</text>',
			'    <text x="34" y="42" font-size="10" fill="' + simColor + '">' + simText + '</text>',
			'  </g>',
			'</svg>'
		].join('');
		return svgNode(svgStr);
	},

	atRun: function(command, okMessage) {
		return controls.sendAt(this.section, this.atPort, command).then(function(res) {
			var text = (res && (res.result || res.response || res.at_response)) || '';
			if (/ERROR/i.test(String(text))) {
				ui.addNotification(null, E('p', {}, _('模组拒绝了 AT 透传指令 %s：%s').format(command, String(text).trim())), 'warning');
				return Promise.reject(new Error(String(text).trim()));
			}
			ui.addNotification(null, E('p', {}, (okMessage || _('模组已接受该指令。')) + ' [' + command + ']'));
			return res;
		}, function(err) {
			ui.addNotification(null, E('p', {}, _('模组不支持通过 QModem 执行 AT 透传指令 %s：%s').format(command, (err && err.message) || String(err))), 'warning');
			return Promise.reject(err);
		});
	},

	reloadLater: function(delay) {
		window.setTimeout(function() { window.location.reload(); }, delay || 1500);
	},

	showPinManager: function(simState) {
		var self = this;
		var operation = controls.select([
			['verify',_('验证当前 PIN')],['enable',_('启用 PIN 锁')],['disable',_('禁用 PIN 锁')],
			['change',_('修改 PIN')],['unblock',_('用 PUK 解锁')]
		], /PUK/i.test(simState || '') ? 'unblock' : 'verify');
		var first = E('input', { 'class':'cbi-input-text', 'type':'password', 'inputmode':'numeric', 'autocomplete':'off' });
		var second = E('input', { 'class':'cbi-input-text', 'type':'password', 'inputmode':'numeric', 'autocomplete':'new-password' });
		var firstLabel = E('label', {}, _('PIN 码'));
		var secondRow = controls.row(_('新 PIN'), second);
		function update() {
			firstLabel.textContent = operation.value === 'unblock' ? _('PUK 码') : operation.value === 'change' ? _('当前 PIN') : _('PIN 码');
			secondRow.style.display = operation.value === 'change' || operation.value === 'unblock' ? '' : 'none';
		}
		operation.addEventListener('change', update);
		window.setTimeout(update, 0);
		return ui.showModal(_('SIM PIN 管理'), [
			E('div', { 'class':'alert-message warning' }, _('输入错误的 PIN 或 PUK 次数过多将永久锁定 SIM 卡，操作前请查阅运营商文档。')),
			E('div', { 'class':'mt-control-note' }, _('PIN 操作将经由 QModem 以 AT 指令下发给模组。')),
			controls.row(_('操作类型'), operation), E('div', { 'class':'mt-control-row' }, [ firstLabel, first ]), secondRow,
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('取消')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var firstValue = first.value.trim(), secondValue = second.value.trim();
				if ((operation.value === 'unblock' ? !/^\d{8}$/.test(firstValue) : !/^\d{4,8}$/.test(firstValue)) || ((operation.value === 'change' || operation.value === 'unblock') && !/^\d{4,8}$/.test(secondValue)))
					return ui.addNotification(null, E('p', {}, _('PIN 需为 4–8 位数字；PUK 必须恰好 8 位数字。')), 'warning');
				var command;
				switch (operation.value) {
				case 'change':  command = 'AT+CPWD="SC","' + firstValue + '","' + secondValue + '"'; break;
				case 'enable':  command = 'AT+CLCK="SC",1,"' + firstValue + '"'; break;
				case 'disable': command = 'AT+CLCK="SC",0,"' + firstValue + '"'; break;
				case 'unblock': command = 'AT+CPIN="' + firstValue + '","' + secondValue + '"'; break;
				default:        command = 'AT+CPIN="' + firstValue + '"'; break;
				}
				ui.hideModal();
				self.atRun(command, _('SIM PIN 指令已接受。')).then(function() {
					self.reloadLater(1200);
				}).catch(function() {});
			} }, _('应用')) ])
		]);
	},

	showThermalManager: function(temperature) {
		var self = this;
		var labels = [
			_('正常工作阈值'), _('第一档功耗降低'), _('第一档恢复'),
			_('第二档功耗降低'), _('第二档恢复'), _('持续功耗上限'),
			_('持续限制恢复'), _('紧急飞行模式'), _('紧急恢复')
		];
		var inputs = labels.map(function() {
			return E('input', { 'class':'cbi-input-text', 'type':'number', 'min':'0', 'max':'150', 'value':'' });
		});
		var serialLog = controls.select([['0',_('关闭')],['1',_('开启')]], '0');
		var fileLog = controls.select([['0',_('关闭')],['1',_('开启')]], '0');
		return ui.showModal(_('热保护参数设置'), [
			E('div', { 'class':'alert-message warning' }, _('阈值设置不当可能导致性能下降、过热或射频紧急关断，每个恢复值必须低于对应的触发值。')),
			E('div', { 'class':'mt-control-note' }, _('QModem 仅上报模组温度（当前 %s）。阈值写入没有通用的 QModem 方法，将以 AT 透传指令下发，模组可能拒绝。').format(temperature || '--')),
			E('div', { 'class':'mt-system-thermal-form' }, labels.map(function(label, index) { return controls.row(label + ' (°C)', inputs[index]); })),
			controls.row(_('串行温度日志'), serialLog), controls.row(_('本地存储温度日志'), fileLog),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('取消')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var next = inputs.map(function(input) { return String(input.value || ''); });
				if (next.some(function(value) { return !/^\d+$/.test(value) || Number(value) > 150; }))
					return ui.addNotification(null, E('p', {}, _('每个阈值必须是 0–150°C 之间的温度。')), 'warning');
				if (!(Number(next[1]) > Number(next[0]) && Number(next[3]) > Number(next[1]) && Number(next[5]) > Number(next[3]) && Number(next[7]) > Number(next[5]) && Number(next[2]) < Number(next[1]) && Number(next[4]) < Number(next[3]) && Number(next[6]) < Number(next[5]) && Number(next[8]) < Number(next[7])))
					return ui.addNotification(null, E('p', {}, _('触发温度须逐级升高，且每个恢复温度必须低于对应触发值。')), 'warning');
				ui.hideModal();
				self.atRun('AT^THERMLDAUTOPARA=' + next.join(','), _('热保护设置已保存。')).then(function() {
					return self.atRun('AT^THERMLDLOGSW=' + serialLog.value + ',' + fileLog.value, _('温度日志设置已更新。'));
				}).then(function() {
					self.reloadLater(1200);
				}).catch(function() {});
			} }, _('应用')) ])
		]);
	},

	showIdentityLab: function(currentImei) {
		var self = this;
		var input = E('input', { 'class':'cbi-input-text', 'inputmode':'numeric', 'maxlength':'15', 'placeholder':currentImei || '123456789012345' });
		return ui.showModal(_('设备标识实验室'), [
			E('div', { 'class':'alert-message warning' }, _('写入 IMEI 可能受当地法律或运营商限制，本选项仅用于恢复模组出厂标识。')),
			controls.row(_('当前 IMEI'), E('strong', {}, currentImei || '--')),
			controls.row(_('新 IMEI'), input),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('取消')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				var value = input.value.trim();
				if (!/^\d{15}$/.test(value) || value === currentImei)
					return ui.addNotification(null, E('p', {}, _('请输入一个不同的 15 位 IMEI。')), 'warning');
				ui.hideModal();
				controls.confirmModal(_('写入设备标识'), _('该操作可能导致无法入网，仅在恢复模组标签所印标识时继续。'), function() {
					return controls.setImei(self.section, value).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('IMEI 写入失败：%s').format((err && err.message) || String(err))), 'danger');
						throw err;
					});
				}, true);
			} }, _('确认修改')) ])
		]);
	},

	showFactoryReset: function() {
		var self = this;
		var confirm = E('input', { 'class':'cbi-input-text', 'placeholder':'RESET', 'autocomplete':'off' });
		return ui.showModal(_('恢复模组出厂设置'), [
			E('div', { 'class':'alert-message warning' }, _('该操作将清除模组的 APN、射频、SIM、接口和热保护设置并重启模组，不会影响 OpenWrt 设置。')),
			controls.row(_('输入 RESET 以确认'), confirm),
			E('div', { 'class':'right' }, [ E('button', { 'class':'btn', 'click':ui.hideModal }, _('取消')), ' ', E('button', { 'class':'btn cbi-button-negative', 'click':function() {
				if (confirm.value !== 'RESET') return ui.addNotification(null, E('p', {}, _('确认文本不匹配。')), 'warning');
				ui.hideModal();
				controls.confirmModal(_('恢复出厂设置'), _('模组将重置自身配置并重启。'), function() {
					return controls.sendAt(self.section, self.atPort, 'AT+CFUN=1').catch(function() {
						return controls.doReboot(self.section, 'hard');
					}).catch(function(err) {
						ui.addNotification(null, E('p', {}, _('恢复出厂设置失败：%s').format((err && err.message) || String(err))), 'danger');
						throw err;
					});
				}, true);
			} }, _('恢复出厂设置')) ])
		]);
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
			return E('div', { 'class': 'mt-system' }, [
				this.styleNode(), controls.styleNode(),
				E('div', { 'class': 'mt-system-card', 'style': 'color:#b91c1c;background:rgba(254,242,242,0.85)' },
					_('未检测到模组（请确认 QModem 已识别该设备）。')),
				(res.errors || []).length ? E('div', { 'class': 'mt-system-card', 'style': 'margin-top:10px;color:#b91c1c' }, (res.errors || []).join(' / ')) : null
			]);
		}

		this.section = res.section;
		var atCfg = (res.atCfg && res.atCfg.at_cfg) ? res.atCfg.at_cfg : (res.atCfg || {});
		this.atPort = atCfg.at_port || controls.findEntry(res.base, 'at_port') || '';
		var atPortLabel = this.atPort;

		var baseMap = controls.entryMap(res.base);
		var simMap = controls.entryMap(res.sim);

		var model = baseMap['name'] || _('模组');
		var manufacturer = baseMap['manufacturer'] || '--';
		var revision = baseMap['revision'] || '';
		var temperature = controls.normalizeTemperature(controls.findEntry(res.base, 'temperature')) || '';

		var simStatusRaw = simMap['SIM Status'] || '';
		var simStatus = simStatusText(simStatusRaw);
		var simOk = /READY|正常|OK/i.test(simStatusRaw);
		var simNumber = simMap['SIM Number'] || _('SIM 卡中未存储');
		var imsi = simMap['IMSI'] || '--';
		var imei = (res.imei && res.imei.imei) || controls.findEntry(res.sim, 'IMEI') || '--';
		var currentSlot = (res.slot && res.slot.sim_slot != null) ? String(res.slot.sim_slot) : (simMap['SIM Slot'] != null ? String(simMap['SIM Slot']) : '');

		var caps = res.caps || {};
		var slotList = Array.isArray(caps.simSlots) && caps.simSlots.length ? caps.simSlots : [ '0', '1' ];
		var slotSupported = String(caps.supportSwitch) === '1';
		var simSlot = controls.select(slotList.map(function(slot) {
			return [ String(slot), _('SIM 卡槽 %s').format(slot) ];
		}), currentSlot || String(slotList[0]));
		if (!slotSupported) simSlot.setAttribute('disabled', 'disabled');

		var ledSelect = controls.select([['1',_('开启')],['0',_('关闭')]], '1');
		var simEnabled = controls.select([['1',_('已启用')],['0',_('已停用')]], '1');
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

		return E('div', { 'class': 'mt-system' }, [
			this.styleNode(),
			controls.styleNode(),
			/* 背景环境光晕 */
			E('div', { 'class': 'mt-sys-bg-glow1' }),
			E('div', { 'class': 'mt-sys-bg-glow2' }),

			(res.errors || []).length ? E('div', { 'class': 'mt-system-card', 'style': 'color:#b91c1c;margin-bottom:12px' }, (res.errors || []).join(' / ')) : null,
			modemBar,

			/* 顶部 Hero 玻璃卡片 */
			E('section', { 'class': 'mt-system-card mt-system-hero' }, [
				E('div', {}, [
					E('div', { 'class': 'mt-system-kicker' }, _('模组系统与 SIM 卡')),
					E('h2', { 'class': 'mt-system-title' }, model),
					E('div', { 'class': 'mt-system-sub' }, revision || _('硬件标识与订阅卡管理'))
				]),
				E('div', { 'class': 'mt-system-temp-box' }, [
					svgNode('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>'),
					E('div', {}, [
						E('div', { 'class': 'mt-system-temp-val' }, temperature || '--'),
						E('div', { 'class': 'mt-system-temp-desc' }, _('模组温度'))
					])
				])
			]),

			/* 动态 SVG 芯片与 SIM 卡槽物理链路拓扑 */
			E('section', { 'class': 'mt-system-card mt-sys-topo-card' }, [
				E('div', { 'class': 'mt-card-title' }, [
					svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/></svg>'),
					_('模组基带与卡槽架构拓扑')
				]),
				this.renderSvgChipTopo(currentSlot, slotSupported, simOk)
			]),

			/* 2x2 信息卡片网格 */
			E('div', { 'class': 'mt-system-grid' }, [
				E('section', { 'class': 'mt-system-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'),
						_('模组信息')
					]),
					this.row(_('型号'), model),
					this.row(_('制造商'), manufacturer),
					this.row(_('固件版本'), revision),
					this.row('IMEI', imei),
					this.row(_('AT 串口'), atPortLabel)
				]),
				E('section', { 'class': 'mt-system-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="8" y="10" width="8" height="8" rx="1"/></svg>'),
						_('SIM 与订阅')
					]),
					this.row(_('手机号码'), simNumber),
					this.row('ICCID', '--'),
					this.row('IMSI', imsi),
					this.row(_('SIM 卡槽'), currentSlot !== '' ? currentSlot : '--'),
					E('div', { 'class':'mt-control-note', 'style': 'margin-top:8px' }, _('QModem 未向此模组暴露 ICCID。'))
				]),
				E('section', { 'class': 'mt-system-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>'),
						_('运行状态')
					]),
					this.row(_('SIM 状态'), simStatus),
					this.row(_('连接状态'), baseMap['connect_status'] || '--'),
					this.row(_('SIM 卡槽切换'), slotSupported ? _('支持') : _('不支持')),
					this.row(_('模组温度'), temperature || '--')
				]),
				E('section', { 'class': 'mt-system-card' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'),
						_('热保护状态')
					]),
					this.row(_('当前温度'), temperature || '--'),
					this.row(_('保护等级'), '--'),
					this.row(_('已配置阈值'), '--'),
					E('div', { 'class':'mt-control-note', 'style': 'margin-top:8px' }, _('阈值写入使用 AT 透传指令。'))
				]),

				/* 宽卡片：SIM 与射频高级控制 */
				E('section', { 'class': 'mt-system-card wide' }, [
					E('div', { 'class': 'mt-card-title' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'),
						_('SIM 与射频控制')
					]),
					E('div', { 'style': 'font-size:12px;color:#64748b;margin-bottom:12px' }, _('日常 SIM 与射频控制，经由 QModem ubus 接口执行。')),
					controls.state(_('当前 SIM 状态'), simStatus),
					E('div', { 'class': 'mt-sys-actions-bar' }, [
						E('button', { 'class':'mt-sys-btn mt-sys-btn-danger', 'click': function() {
							controls.confirmModal(_('变更射频功能'), _('飞行模式将立即断开移动数据与语音服务。'), function() {
								return controls.sendAt(self.section, self.atPort, 'AT+CFUN=0').catch(function(err) {
									ui.addNotification(null, E('p', {}, _('Airplane mode failed: %s').format((err && err.message) || String(err))), 'danger');
									throw err;
								});
							}, false);
						} }, [
							svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>'),
							_('进入飞行模式')
						]),
						E('button', { 'class':'mt-sys-btn mt-sys-btn-primary', 'click': function() {
							controls.confirmModal(_('变更射频功能'), _('恢复移动网络注册与数据服务？'), function() {
								return controls.sendAt(self.section, self.atPort, 'AT+CFUN=1,1').catch(function() {
									return controls.doReboot(self.section, 'soft');
								}).catch(function(err) {
									ui.addNotification(null, E('p', {}, _('恢复射频失败：%s').format((err && err.message) || String(err))), 'danger');
									throw err;
								});
							}, true);
						} }, [
							svgNode('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>'),
							_('恢复移动射频')
						])
					]),
					controls.row(_('模组状态 LED'), ledSelect),
					controls.action(_('应用 LED 设置'), function() {
						controls.confirmModal(_('模组状态 LED'), _('QModem 没有通用 LED 方法，该设置将以模组专用 AT 指令下发，重启后生效。'), function() {
							return self.atRun('AT^LEDSWITCH=' + ledSelect.value, _('LED 设置已接受。'));
						}, true);
					}),
					controls.action(_('管理 SIM PIN'), function() { self.showPinManager(simStatusRaw); }),
					controls.row(_('SIM 卡启用'), simEnabled),
					controls.action(_('应用 SIM 启用'), function() {
						controls.confirmModal(_('SIM 卡启用'), simEnabled.value === '1' ? _('启用物理 SIM 卡以进行网络注册？') : _('停用 SIM 卡将立即移除移动服务。'), function() {
							return self.atRun('AT^HVSST=' + simEnabled.value, _('SIM 启用指令已接受。'));
						}, simEnabled.value === '0');
					}),
					controls.row(_('当前 SIM 卡槽'), simSlot),
					controls.action(_('切换 SIM 卡槽'), function() {
						if (!slotSupported)
							return ui.addNotification(null, E('p', {}, _('QModem 未报告此模组支持 SIM 卡槽切换。')), 'warning');
						controls.confirmModal(_('切换 SIM 卡槽'), _('切换物理 SIM 通路时模组将短暂脱离网络。'), function() {
							return controls.setSimSlot(self.section, simSlot.value).catch(function(err) {
								ui.addNotification(null, E('p', {}, _('SIM 卡槽切换失败：%s').format((err && err.message) || String(err))), 'danger');
								throw err;
							});
						}, true);
					}),
					caps.ExtraInfo ? E('div', { 'class':'mt-control-note', 'style': 'margin-top:10px' }, caps.ExtraInfo) : null
				])
			]),

			/* 维护与安全工具箱 */
			E('section', { 'class':'mt-system-card mt-system-maintenance' }, [
				E('div', {}, [
					E('div', { 'class': 'mt-card-title', 'style': 'margin-bottom:4px' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'),
						_('防护与维护')
					]),
					E('p', { 'style': 'margin:0;font-size:12px;color:#64748b' }, _('模组防护、恢复与通信排障工具。'))
				]),
				E('div', { 'class':'mt-system-maint-tools' }, [
					E('a', { 'class':'mt-sys-btn mt-sys-btn-secondary', 'href':L.url('admin/modem/qmodem-generic/settings') }, _('诊断')),
					E('button', { 'class':'mt-sys-btn mt-sys-btn-secondary', 'click':function() { self.showThermalManager(temperature); } }, _('热保护阈值')),
					E('button', { 'class':'mt-sys-btn mt-sys-btn-secondary', 'click':function() { self.showIdentityLab(imei !== '--' ? imei : ''); } }, _('标识实验室')),
					E('button', { 'class':'mt-sys-btn mt-sys-btn-danger', 'click':function() { self.showFactoryReset(); } }, _('恢复出厂设置'))
				])
			]),

			/* 固件在线升级 (FOTA) */
			E('section', { 'class': 'mt-system-card mt-system-fota' }, [
				E('div', { 'class': 'mt-system-fota-head' }, [
					E('div', {}, [
						E('div', { 'class': 'mt-card-title', 'style': 'margin-bottom:4px' }, [
							svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'),
							_('固件在线升级（FOTA）')
						]),
						E('p', { 'style': 'margin:0;color:#64748b;font-size:12px' }, _('QModem 以 AT 指令发起升级请求，安装期间请勿断电。'))
					]),
					E('span', { 'class': 'mt-system-state' }, _('状态不可用'))
				]),
				E('div', { 'class': 'mt-system-progress' }, E('span', { 'style': 'width:0%' })),
				E('div', { 'style': 'font-size:11px;color:#64748b;text-align:right' }, _('%d%% 完成').format(0)),
				E('div', { 'class': 'mt-system-url' }, [
					fotaUrl,
					E('button', { 'class': 'mt-sys-btn mt-sys-btn-primary', 'click': function() {
						if (!/^http:\/\//.test(fotaUrl.value || ''))
							return ui.addNotification(null, E('p', {}, _('请输入有效的 HTTP 升级服务器地址。')), 'warning');
						controls.confirmModal(_('开始固件下载'), _('模组将连接指定服务器，可能短暂消耗移动数据流量。'), function() {
							return self.atRun('AT^FOTADL="' + fotaUrl.value.replace(/"/g, '') + '"', _('固件下载请求已接受。'));
						}, false);
					} }, _('下载并升级'))
				]),
				E('div', { 'style': 'display:flex;justify-content:flex-end;gap:10px;margin-top:14px' }, [
					E('button', { 'class': 'mt-sys-btn mt-sys-btn-secondary', 'click': function() { window.location.reload(); } }, _('刷新状态')),
					E('button', { 'class': 'mt-sys-btn mt-sys-btn-danger', 'click': function() {
						controls.confirmModal(_('重启模组'), _('将重启模组并短暂中断移动连接。'), function() {
							return controls.doReboot(self.section, 'soft').catch(function(err) {
								ui.addNotification(null, E('p', {}, _('模组重启失败：%s').format((err && err.message) || String(err))), 'danger');
								throw err;
							});
						}, true);
					} }, _('重启模组'))
				])
			]),

			/* 技术细节调试折叠栏 */
			E('details', { 'class': 'mt-system-card mt-system-details' }, [
				E('summary', {}, [
					E('span', { 'style': 'display:flex;align-items:center;gap:8px' }, [
						svgNode('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0072f5" stroke-width="2.2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'),
						_('技术细节（QModem 原始 JSON）')
					]),
					E('span', { 'style': 'font-size:18px;color:#94a3b8;font-weight:700' }, '›')
				]),
				E('pre', { 'class': 'mt-system-raw' }, raw || _('无响应。'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
