'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require mt5700m.controls as controls';

/*
 * 设备参数（Settings）
 *
 * 本页编辑的是 QModem 的 UCI 配置 /etc/config/qmodem 中当前模组的
 * modem-device 配置节，不再使用旧的 /etc/config/mt5700m。
 * 配置节 id 由 controls.resolveSection() 解析（任意 QModem 支持的模组）。
 * 仅暴露 QModem 真实存在的选项，不再提供 mt5700m 私有的 host/port/timeout。
 */

/* 显示值：空/未知一律显示 -- */
function shown(value) {
	return (value === undefined || value === null || value === '') ? '--' : String(value);
}

return view.extend({
	load: function() {
		var self = this;
		var errors = [];

		return controls.resolveSection().then(function(section) {
			self.section = section;

			if (!section)
				return { section: null, errors: errors };

			return uci.load('qmodem').then(function() {
				return { section: section, errors: errors };
			}).catch(function(err) {
				errors.push('读取 qmodem 配置失败：' + ((err && err.message) || String(err)));
				return { section: section, errors: errors };
			});
		}).catch(function(err) {
			errors.push('加载失败：' + ((err && err.message) || String(err)));
			return { section: null, errors: errors };
		});
	},

	styleNode: function() {
		return E('style', {}, [
			'.mt-diag-page{max-width:900px;margin:0 auto}.mt-diag-hero{display:flex;justify-content:space-between;align-items:center;gap:18px;padding:20px 22px;margin-bottom:16px;border-radius:15px;background:linear-gradient(135deg,#304667,#3b587d);color:#fff}.mt-diag-hero h2{margin:0 0 5px;color:#fff;font-size:22px}.mt-diag-hero p{margin:0;font-size:12px;opacity:.8}.mt-diag-badge{padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.14);font-size:11px;white-space:nowrap}',
			'.mt-diag-card{padding:18px 20px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-diag-card-head{margin-bottom:10px}.mt-diag-card-head h3{margin:0 0 5px;font-size:16px}.mt-diag-card-head p{margin:0;color:var(--text-color-medium,#69717d);font-size:12px;line-height:1.5}.mt-diag-card .cbi-map>h2,.mt-diag-card .cbi-map-descr,.mt-diag-card .cbi-section>h3{display:none}.mt-diag-card .cbi-section{margin:0;padding:0;border:0;box-shadow:none}.mt-diag-card .cbi-section-node{padding:0}.mt-diag-card .cbi-value{padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4)}.mt-diag-card .cbi-value:last-child{border-bottom:0}.mt-diag-back{margin-top:14px;display:flex;gap:9px;flex-wrap:wrap}',
			'@media(max-width:720px){.mt-diag-hero{display:block}.mt-diag-badge{display:inline-block;margin-top:12px}.mt-diag-card{padding:16px}}'
		].join(''));
	},

	render: function(res) {
		var self = this;
		res = res || {};

		var warnings = (res.errors || []).map(function(msg) {
			return E('div', { 'class': 'alert-message warning' }, msg);
		});

		var modems = controls.getModemSectionsSync();
		var modemBar = controls.renderModemBar(modems, res.section, function(id) {
			controls.setStoredSection(id);
			window.location.reload();
		});

		if (!res.section)
			return E('div', { 'class': 'mt-diag-page mt-ui-page' }, [
				this.styleNode(),
				controls.styleNode(),
				modemBar,
				E('section', { 'class': 'mt-diag-hero mt-ui-hero' }, [
					E('div', {}, [
						E('h2', {}, _('设备参数')),
						E('p', {}, _('编辑 QModem 配置（/etc/config/qmodem）中当前模组的设备参数。'))
					]),
					E('span', { 'class': 'mt-diag-badge' }, 'QModem')
				]),
				E('div', { 'class': 'alert-message warning' },
					_('未检测到模组（请确认 QModem 已识别该设备）。'))
			].concat(warnings));

		var section = res.section;

		/* ---- QModem modem-device 配置节（仅 QModem 真实存在的选项） ---- */
		var m = new form.Map('qmodem', section);
		var s, o;

		s = m.section(form.NamedSection, section, 'modem-device');
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('启用该模组'));
		o.description = _('关闭后 QModem 将不再管理此模组。');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('模组名称 / 网络接口'));
		o.placeholder = 'wwan0';
		o.description = _('QModem 用于该模组数据接口与配置节的名称。');
		o.rmempty = true;

		o = s.option(form.Value, 'at_port', _('AT 端口'));
		o.placeholder = '/dev/ttyUSB0';
		o.description = _('QModem 下发 AT 命令使用的端口设备节点。留空则由 QModem 自动选择。');
		o.rmempty = true;

		o = s.option(form.Value, 'pdp_index', _('PDP 上下文索引'));
		o.datatype = 'uinteger';
		o.placeholder = '1';
		o.description = _('拨号使用的 PDP 上下文序号（AT+CGDCONT 的 cid）。');
		o.rmempty = true;

		o = s.option(form.DynamicList, 'modes', _('可用拨号模式'));
		o.value('ecm', 'ECM');
		o.value('ncm', 'NCM');
		o.value('rndis', 'RNDIS');
		o.value('mbim', 'MBIM');
		o.value('qmi', 'QMI');
		o.value('ppp', 'PPP');
		o.description = _('QModem 允许该模组使用的拨号模式列表，按模组实际能力显示。');
		o.rmempty = true;

		o = s.option(form.Value, 'apn', 'APN');
		o.placeholder = _('留空使用运营商默认值');
		o.description = _('与「移动数据」页共用同一份 QModem 配置。');
		o.rmempty = true;

		o = s.option(form.ListValue, 'pdp_type', _('IP 协议'));
		o.value('IPV4V6', 'IPv4 / IPv6');
		o.value('IPV4', 'IPv4');
		o.value('IPV6', 'IPv6');
		o.default = 'IPV4V6';
		o.rmempty = false;

		var saveConfig = function() {
			return m.save(null, true).then(function() {
				return uci.commit('qmodem');
			}).then(function() {
				ui.addNotification(null, E('p', {},
					_('设备参数已保存到 QModem 配置（/etc/config/qmodem），请重拨或重启模组使其生效。')));
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
			});
		};

		return m.render().then(function(formNode) {
			return E('div', { 'class': 'mt-diag-page mt-ui-page' }, [
				self.styleNode(),
				controls.styleNode()
			].concat(warnings).concat([
				modemBar,
				E('section', { 'class': 'mt-diag-hero mt-ui-hero' }, [
					E('div', {}, [
						E('h2', {}, _('设备参数')),
						E('p', {}, _('编辑 QModem 配置中当前模组的设备参数（配置节：%s）。').format(shown(section)))
					]),
					E('span', { 'class': 'mt-diag-badge' }, _('由 QModem 管理'))
				]),
				E('section', { 'class': 'mt-diag-card mt-ui-card' }, [
					E('div', { 'class': 'mt-diag-card-head' }, [
						E('h3', {}, _('模组设备配置')),
						E('p', {}, _('这些选项写入 /etc/config/qmodem 的 modem-device 配置节。除非自动识别有误，否则无需修改 AT 端口与拨号模式。'))
					]),
					formNode,
					E('div', { 'class': 'mt-control-actions' }, E('button', {
						'type': 'button',
						'class': 'btn cbi-button-apply',
						'click': ui.createHandlerFn(self, saveConfig)
					}, _('保存设备参数')))
				]),
				E('div', { 'class': 'mt-diag-back' }, [
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/mt5700m/system') }, _('返回模组与 SIM')),
					E('a', { 'class': 'btn', 'href': L.url('admin/modem/mt5700m/advanced') }, _('返回高级设置'))
				])
			]));
		}).catch(function(err) {
			return E('div', { 'class': 'mt-diag-page mt-ui-page' }, [
				self.styleNode(),
				controls.styleNode(),
				modemBar,
				E('div', { 'class': 'alert-message danger' },
					_('页面渲染失败：') + ((err && err.message) || String(err)))
			]);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
