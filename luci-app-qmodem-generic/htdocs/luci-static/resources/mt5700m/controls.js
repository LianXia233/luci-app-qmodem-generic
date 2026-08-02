'use strict';
'require baseclass';
'require ui';
'require uci';
'require rpc';

/*
 * 通用 QModem LuCI 前端 — QModem 数据层（美化版 UI 的数据桥梁）
 *
 * 本文件把原先基于 /usr/sbin/mt5700m-at 文本输出的数据获取方式，全面替换为
 * 经由 QModem 的 `qmodem` ubus 对象读取/下发。"显示的数据"与"控制动作"全部来自 QModem，
 * 不再依赖任何模组私有的文本后端。
 *
 * 设计原则（通用、不绑定任何具体模组型号）：
 *  - 本包对 QModem 管理的"任意模组"生效：QModem 识别到什么模组，这里就显示什么。
 *    UI 不假定某个型号（如 MT5700M），所有字段、能力、模式都按 QModem 实际返回渲染。
 *  - 信息方法（base_info/sim_info/network_info/cell_info/info）返回
 *    { "modem_info": [ { key, value, full_name, type, class, extra_info }, ... ] }，
 *    使用 findEntry(arr, key) 取字段，使用 groupByClass(arr) 按 class 分组渲染"全部信息"。
 *  - 其它方法返回各自的具体 JSON（见各封装函数说明）。
 *  - config_section 指向 /etc/config/qmodem 中的 modem-device 配置节
 *    （多模组时由模组选择器切换，见 renderModemBar / getModemList）。
 */

/* ------------------------------------------------------------------ */
/* QModem ubus RPC 声明                                                */
/* ------------------------------------------------------------------ */

var callBaseInfo = rpc.declare({ object: 'qmodem', method: 'base_info', params: ['config_section'], expect: { } });
var callCellInfo = rpc.declare({ object: 'qmodem', method: 'cell_info', params: ['config_section'], expect: { } });
var callInfo = rpc.declare({ object: 'qmodem', method: 'info', params: ['config_section'], expect: { } });
var callNetworkInfo = rpc.declare({ object: 'qmodem', method: 'network_info', params: ['config_section'], expect: { } });
var callSimInfo = rpc.declare({ object: 'qmodem', method: 'sim_info', params: ['config_section'], expect: { } });

var callGetAtCfg = rpc.declare({ object: 'qmodem', method: 'get_at_cfg', params: ['config_section'], expect: { } });
var callGetImei = rpc.declare({ object: 'qmodem', method: 'get_imei', params: ['config_section'], expect: { } });
var callGetMode = rpc.declare({ object: 'qmodem', method: 'get_mode', params: ['config_section'], expect: { } });
var callGetLockband = rpc.declare({ object: 'qmodem', method: 'get_lockband', params: ['config_section'], expect: { } });
var callGetNeighborcell = rpc.declare({ object: 'qmodem', method: 'get_neighborcell', params: ['config_section'], expect: { } });
var callGetNetworkPrefer = rpc.declare({ object: 'qmodem', method: 'get_network_prefer', params: ['config_section'], expect: { } });
var callGetDns = rpc.declare({ object: 'qmodem', method: 'get_dns', params: ['config_section'], expect: { } });
var callGetSms = rpc.declare({ object: 'qmodem', method: 'get_sms', params: ['config_section'], expect: { } });
var callGetDisabledFeatures = rpc.declare({ object: 'qmodem', method: 'get_disabled_features', params: ['config_section'], expect: { } });
var callGetRebootCaps = rpc.declare({ object: 'qmodem', method: 'get_reboot_caps', params: ['config_section'], expect: { } });
var callGetCopyright = rpc.declare({ object: 'qmodem', method: 'get_copyright', params: ['config_section'], expect: { } });
var callGetCurrentBand = rpc.declare({ object: 'qmodem', method: 'get_current_band', params: ['config_section'], expect: { } });
var callGetConnectStatus = rpc.declare({ object: 'qmodem', method: 'get_connect_status', params: ['config_section'], expect: { } });
var callGetDialStatus = rpc.declare({ object: 'qmodem', method: 'dial_status', params: ['config_section'], expect: { } });
var callGetDialLog = rpc.declare({ object: 'qmodem', method: 'get_dial_log', params: ['config_section'], expect: { } });
var callGetSimSlot = rpc.declare({ object: 'qmodem', method: 'get_sim_slot', params: ['config_section'], expect: { } });
var callGetSimSwitchCapabilities = rpc.declare({ object: 'qmodem', method: 'get_sim_switch_capabilities', params: ['config_section'], expect: { } });
var callGetUsageStats = rpc.declare({ object: 'qmodem', method: 'get_stats', params: ['config_section'], expect: { } });

var callSendAt = rpc.declare({ object: 'qmodem', method: 'send_at', params: ['config_section', 'params'], expect: { } });
var callSendSms = rpc.declare({ object: 'qmodem', method: 'send_sms', params: ['config_section', 'params'], expect: { } });
var callDeleteSms = rpc.declare({ object: 'qmodem', method: 'delete_sms', params: ['config_section', 'index'], expect: { } });
var callSetMode = rpc.declare({ object: 'qmodem', method: 'set_mode', params: ['config_section', 'mode'], expect: { } });
var callSetImei = rpc.declare({ object: 'qmodem', method: 'set_imei', params: ['config_section', 'imei'], expect: { } });
var callSetLockband = rpc.declare({ object: 'qmodem', method: 'set_lockband', params: ['config_section', 'params'], expect: { } });
var callSetNetworkPrefer = rpc.declare({ object: 'qmodem', method: 'set_network_prefer', params: ['config_section', 'params'], expect: { } });
var callSetSimSlot = rpc.declare({ object: 'qmodem', method: 'set_sim_slot', params: ['config_section', 'slot'], expect: { } });
var callDoReboot = rpc.declare({ object: 'qmodem', method: 'do_reboot', params: ['config_section', 'params'], expect: { } });
var callClearDialLog = rpc.declare({ object: 'qmodem', method: 'clear_dial_log', params: ['config_section'], expect: { } });
var callModemDial = rpc.declare({ object: 'qmodem', method: 'modem_dial', params: ['config_section'], expect: { } });
var callModemHang = rpc.declare({ object: 'qmodem', method: 'modem_hang', params: ['config_section'], expect: { } });
var callModemRedial = rpc.declare({ object: 'qmodem', method: 'modem_redial', params: ['config_section'], expect: { } });

var callRcList = rpc.declare({ object: 'rc', method: 'list', params: ['name'], expect: { } });
// 网络接口状态（用于获取模组数据接口的 IP 地址等；huawei 的 network_info 为空，IP 由此取得）
var callInterfaceStatus = rpc.declare({ object: 'network.interface', method: 'status', params: ['name'], expect: { } });

/* ------------------------------------------------------------------ */
/* 通用辅助                                                            */
/* ------------------------------------------------------------------ */

// 从 { modem_info: [ {key,value,...} ] } 数组中按 key 取出 value
function findEntry(arr, key) {
	if (!Array.isArray(arr)) return undefined;
	for (var i = 0; i < arr.length; i++) {
		if (arr[i] && arr[i].key === key) return arr[i].value;
	}
	return undefined;
}

// 确保是数组
function entryList(v) {
	return Array.isArray(v) ? v : [];
}

// 把 modem_info 数组转成 { key: value } 字典，方便取用
function entryMap(arr) {
	var map = {};
	entryList(arr).forEach(function(item) {
		if (item && item.key != null) map[item.key] = item.value;
	});
	return map;
}

/* ------------------------------------------------------------------ */
/* 数据获取封装（返回 Promise）                                        */
/* ------------------------------------------------------------------ */

function getBaseInfo(section) {
	return callBaseInfo(section).then(function(r) { return (r && r.modem_info) ? r.modem_info : (r || []); });
}
function getInfo(section) {
	return callInfo(section).then(function(r) { return (r && r.modem_info) ? r.modem_info : (r || []); });
}
function getSimInfo(section) {
	return callSimInfo(section).then(function(r) { return (r && r.modem_info) ? r.modem_info : (r || []); });
}
function getNetworkInfo(section) {
	return callNetworkInfo(section).then(function(r) { return (r && r.modem_info) ? r.modem_info : (r || []); });
}
function getCellInfo(section) {
	return callCellInfo(section).then(function(r) { return (r && r.modem_info) ? r.modem_info : (r || []); });
}
function getAtCfg(section) { return callGetAtCfg(section); }
function getImei(section) { return callGetImei(section); }
function getMode(section) { return callGetMode(section); }
function getLockBand(section) { return callGetLockband(section); }
function getNeighborCell(section) { return callGetNeighborcell(section); }
function getNetworkPrefer(section) { return callGetNetworkPrefer(section); }
function getDns(section) { return callGetDns(section); }
function getSms(section) { return callGetSms(section); }
function getDisabledFeatures(section) { return callGetDisabledFeatures(section); }
function getRebootCaps(section) { return callGetRebootCaps(section); }
function getCopyright(section) { return callGetCopyright(section); }
function getCurrentBand(section) {
	return callGetCurrentBand(section).then(function(r) {
		/* 部分模组返回 { status: "unsupported" }，统一为空载波列表 */
		if (r && r.status === 'unsupported' && !Array.isArray(r.cells))
			r = { cells: [], status: 'unsupported' };
		return r;
	});
}
/* 兼容实机差异：部分 QModem 版本返回 connection_status 而非 connect_status */
function getConnectStatus(section) {
	return callGetConnectStatus(section).then(function(r) {
		if (r && r.connection_status != null && r.connect_status == null)
			r.connect_status = r.connection_status;
		return r;
	});
}
function getDialStatus(section) { return callGetDialStatus(section); }
function getDialLog(section) { return callGetDialLog(section); }
function getSimSlot(section) { return callGetSimSlot(section); }
function getSimSwitchCapabilities(section) { return callGetSimSwitchCapabilities(section); }
function getUsageStats(section) {
	return callGetUsageStats(section).catch(function() { return { available: 0 }; });
}

/* ------------------------------------------------------------------ */
/* 控制动作封装（写操作，返回 Promise）                                */
/* ------------------------------------------------------------------ */

// 发送 AT 命令（经 QModem ubus）。atPort 可为空，由 QModem 自行选择默认端口。
function sendAt(section, atPort, command, useUbus) {
	var params = { at: command };
	if (atPort) params.port = atPort;
	if (useUbus !== undefined && useUbus !== null) params.use_ubus = useUbus;
	return callSendAt(section, params);
}
function sendSms(section, phoneNumber, content) {
	return callSendSms(section, { phone_number: phoneNumber, message_content: content });
}
function deleteSms(section, index) { return callDeleteSms(section, index); }
function setMode(section, mode) { return callSetMode(section, mode); }
function setImei(section, imei) { return callSetImei(section, imei); }
function setLockBand(section, params) { return callSetLockband(section, params); }
function setNetworkPrefer(section, params) { return callSetNetworkPrefer(section, params); }
function setSimSlot(section, slot) { return callSetSimSlot(section, slot); }
function doReboot(section, method) {
	return callDoReboot(section, { method: method || 'soft' });
}
function clearDialLog(section) { return callClearDialLog(section); }
function modemDial(section) { return callModemDial(section); }
function modemHang(section) { return callModemHang(section); }
function modemRedial(section) { return callModemRedial(section); }
function rcList(name) { return callRcList(name); }
function getInterfaceStatus(name) { return callInterfaceStatus(name); }

/* ------------------------------------------------------------------ */
/* 配置节解析                                                          */
/* ------------------------------------------------------------------ */

// 列出 /etc/config/qmodem 中所有 modem-device 配置节
function getModemSections() {
	return uci.load('qmodem').then(function() {
		var sections = [];
		uci.sections('qmodem', 'modem-device', function(s) {
			sections.push({
				id: s['.name'],
				name: s.name || s.model || s['.name'],
				model: s.model || '',
				manufacturer: s.manufacturer || '',
				at_port: s.at_port || '',
				enabled: s.enabled !== '0'
			});
		});
		return sections;
	});
}

// 模组选择器的持久化键（localStorage）：记住用户上次查看的模组
var SECTION_KEY = 'mt5700m_active_section';

function getStorage() {
	try { return window.localStorage; } catch (e) { return null; }
}
function getStoredSection() {
	var s = getStorage();
	return s ? s.getItem(SECTION_KEY) : null;
}
function setStoredSection(id) {
	var s = getStorage();
	if (s && id) s.setItem(SECTION_KEY, id);
}

// 供模组选择器使用：仅返回已启用且提供了 AT 端口的模组（与 QModem-next 的判定一致）
function getModemList() {
	return getModemSections().then(function(sections) {
		return sections.filter(function(s) {
			return s.enabled && s.at_port;
		});
	});
}

// 同步读取模组列表（在 load 之后、render 内调用；此时 uci 已加载）。
// 供视图在 render 中直接构建模组选择器，无需再次异步加载。
function getModemSectionsSync() {
	var sections = [];
	try {
		uci.sections('qmodem', 'modem-device', function(s) {
			sections.push({
				id: s['.name'],
				name: s.name || s.model || s['.name'],
				model: s.model || '',
				manufacturer: s.manufacturer || '',
				enabled: s.enabled !== '0',
				at_port: s.at_port || ''
			});
		});
	} catch (e) { sections = []; }
	return sections;
}

// 解析当前要展示的模组配置节 id：优先使用用户上次在模组选择器中的选择，
// 否则回退到第一个启用的模组。不绑定任何具体型号。
function resolveSection() {
	return getModemSections().then(function(sections) {
		if (!sections.length) return null;
		var stored = getStoredSection();
		if (stored) {
			for (var i = 0; i < sections.length; i++) {
				if (sections[i].id === stored && sections[i].enabled) return stored;
			}
		}
		var enabled = sections.filter(function(s) { return s.enabled; });
		return (enabled[0] || sections[0]).id;
	});
}

// 通用模组选择器：多于一个模组时渲染下拉框，切换时回调 onSwitch(sectionId)。
function renderModemBar(sections, currentId, onSwitch) {
	if (!sections || sections.length <= 1) return null;
	var select = E('select', { 'class': 'cbi-input-select mt-modem-select' }, sections.map(function(s) {
		var label = s.name;
		if (s.manufacturer && String(s.manufacturer).toLowerCase() !== String(s.name).toLowerCase()) {
			label = String(s.manufacturer).toUpperCase() + ' ' + s.name;
		}
		return E('option', { 'value': s.id }, label);
	}));
	select.value = currentId || (sections[0] && sections[0].id);
	if (onSwitch) {
		select.addEventListener('change', function() {
			onSwitch(select.value);
		});
	}
	return E('div', { 'class': 'mt-modem-bar' }, [
		E('label', { 'class': 'mt-modem-bar-label' }, _('Modem')),
		select
	]);
}

// 把 QModem 返回的 modem_info 数组按 class 分组（用于"全部信息"动态渲染）
function groupByClass(entries) {
	var grouped = {};
	entryList(entries).forEach(function(item) {
		if (!item || item.type === 'warning_message') return;
		var cls = item['class'] || 'General';
		if (!grouped[cls]) grouped[cls] = [];
		grouped[cls].push(item);
	});
	return grouped;
}

// 信号质量分级（与 QModem-next 一致），把原始 dBm/dB 值加上 优/良/中/差 文案
function formatSignal(value, type) {
	if (!value || value === 'N/A') return String(value || '--');
	var num = parseInt(value, 10);
	if (isNaN(num)) return String(value);
	switch (type) {
		case 'rssi':
			if (num >= -70) return value + ' dBm (' + _('Excellent') + ')';
			if (num >= -85) return value + ' dBm (' + _('Good') + ')';
			if (num >= -100) return value + ' dBm (' + _('Fair') + ')';
			return value + ' dBm (' + _('Poor') + ')';
		case 'rsrp':
			if (num >= -80) return value + ' dBm (' + _('Excellent') + ')';
			if (num >= -90) return value + ' dBm (' + _('Good') + ')';
			if (num >= -100) return value + ' dBm (' + _('Fair') + ')';
			return value + ' dBm (' + _('Poor') + ')';
		case 'rsrq':
			if (num >= -10) return value + ' dB (' + _('Excellent') + ')';
			if (num >= -15) return value + ' dB (' + _('Good') + ')';
			if (num >= -20) return value + ' dB (' + _('Fair') + ')';
			return value + ' dB (' + _('Poor') + ')';
		case 'sinr':
		case 'snr':
			if (num >= 20) return value + ' dB (' + _('Excellent') + ')';
			if (num >= 13) return value + ' dB (' + _('Good') + ')';
			if (num >= 0) return value + ' dB (' + _('Fair') + ')';
			return value + ' dB (' + _('Poor') + ')';
		default:
			return String(value);
	}
}

// 设备信息参数中文标签映射表
var LABEL_ZH = {
	'Name': '型号名称',
	'Manufacturer': '制造商',
	'Revision': '固件版本',
	'AT Port': 'AT 端口',
	'Connect Status': '连接状态',
	'Temperature': '温度',
	'Network Mode': '网络模式',
	'MCC': '移动国家码 (MCC)',
	'MNC': '移动网络码 (MNC)',
	'Cell ID': '小区 ID',
	'PCI': '物理小区 ID (PCI)',
	'TAC': '跟踪区码 (TAC)',
	'ARFCN': '绝对频点号 (ARFCN)',
	'EARFCN': '下行频点号 (EARFCN)',
	'NR-ARFCN': 'NR 频点号 (NR-ARFCN)',
	'RSRP': '参考信号接收功率 (RSRP)',
	'RSRQ': '参考信号接收质量 (RSRQ)',
	'SINR': '信号干扰噪声比 (SINR)',
	'SCS': '子载波间隔 (SCS)',
	'SIM Status': 'SIM 状态',
	'SIM Slot': 'SIM 卡槽',
	'IMEI': '国际移动设备识别码 (IMEI)',
	'IMSI': '国际移动用户识别码 (IMSI)',
	'ICCID': '集成电路卡识别码 (ICCID)',
	'Band': '频段',
	'Bandwidth': '带宽',
	'DL Bandwidth': '下行带宽',
	'UL Bandwidth': '上行带宽',
	'RSSI': '接收信号强度指示 (RSSI)',
	'CQI': '信道质量指示 (CQI)',
	'Serving Cell': '服务小区',
	'Neighbor Cell': '邻区',
	'Network Type': '网络类型',
	'LAC': '位置区码 (LAC)',
	'RAC': '路由区码 (RAC)',
	'eNodeB ID': 'eNodeB ID',
	'gNodeB ID': 'gNodeB ID',
	'Sector ID': '扇区 ID',
	'UTRAN Cell ID': 'UTRAN 小区 ID',
	'NR Cell ID': 'NR 小区 ID',
	'Physical Cell ID': '物理小区 ID (PCI)',
	'Mobile Country Code': '移动国家码 (MCC)',
	'Mobile Network Code': '移动网络码 (MNC)',
	'Absolute Radio-Frequency Channel Number': '绝对频点号 (ARFCN)',
	'Reference Signal Received Power': '参考信号接收功率 (RSRP)',
	'Reference Signal Received Quality': '参考信号接收质量 (RSRQ)',
	'Signal to Interference plus Noise Ratio': '信号干扰噪声比 (SINR)',
	'International Mobile Equipment Identity': '国际移动设备识别码 (IMEI)',
	'International Mobile Subscriber Identity': '国际移动用户识别码 (IMSI)',
	'Tracking Area Code': '跟踪区码 (TAC)',
	'Tracking area code of cell served by neighbor Enb': '跟踪区码 (TAC)',
	'Subcarrier Spacing': '子载波间隔 (SCS)',
	'APN': '接入点名称 (APN)',
	'PLMN': '公共陆地移动网 (PLMN)',
	'MSISDN': '电话号码 (MSISDN)',
	'Radio Access Technology': '无线接入技术',
	'Registration Status': '注册状态'
};

// 把 QModem 的 modem_info 渲染为分组卡片（每 class 一张 mt-ui-card），
// 用于"完整信息"面板——QModem 返回什么就显示什么。
function renderInfoGrouped(entries) {
	var grouped = groupByClass(entries);
	var cards = [];
	Object.keys(grouped).forEach(function(cls) {
		var rows = grouped[cls].map(function(item) {
			var rawName = item.full_name || item.key || '';
			var name = LABEL_ZH[rawName] || rawName;
			var display = item.extra_info ? (name + ' (' + item.extra_info + ')') : name;
			var val = (item.value == null || item.value === '') ? '--' : String(item.value);
			return E('div', { 'class': 'mt-info-row' }, [
				E('span', { 'class': 'mt-info-key' }, display),
				E('strong', { 'class': 'mt-info-val' }, val)
			]);
		});
		cards.push(E('section', { 'class': 'mt-info-card mt-ui-card' }, [
			E('h3', {}, cls),
			E('div', { 'class': 'mt-info-body' }, rows)
		]));
	});
	return cards;
}

/* ------------------------------------------------------------------ */
/* UI 辅助（保留原 styles/排版/中文文案）                              */
/* ------------------------------------------------------------------ */

function formatBytes(value) {
	var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], index = 0;
	value = Math.max(0, Number(value) || 0);
	while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
	return (index ? value.toFixed(value >= 10 ? 1 : 2) : String(Math.round(value))) + ' ' + units[index];
}

function formatDuration(seconds) {
	seconds = Math.max(0, Number(seconds) || 0);
	var days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
	return (days ? days + _('d') + ' ' : '') + (hours ? hours + _('h') + ' ' : '') + minutes + _('min');
}

function formatRate(value) {
	value = Number(value) || 0;
	if (value >= 1000000000) return (value / 1000000000).toFixed(2) + ' Gbps';
	if (value >= 1000000) return (value / 1000000).toFixed(1) + ' Mbps';
	return value ? Math.round(value / 1000) + ' Kbps' : '--';
}

function select(options, value) {
	var node = E('select', { 'class': 'cbi-input-select' }, options.map(function(item) {
		return E('option', { 'value': item[0] }, item[1]);
	}));
	if (value != null)
		node.value = String(value);
	return node;
}

function row(label, input) {
	return E('div', { 'class': 'mt-control-row' }, [ E('label', {}, label), input ]);
}

function action(label, handler) {
	return E('div', { 'class': 'mt-control-actions' }, E('button', {
		'type': 'button',
		'class': 'btn cbi-button-apply',
		'click': handler
	}, label));
}

function card(title, desc, body, wide) {
	return E('section', { 'class': 'mt-control-card mt-ui-card' + (wide ? ' wide' : '') }, [
		E('h3', {}, title),
		E('div', { 'class': 'mt-control-desc' }, desc)
	].concat(body));
}

function state(label, value) {
	return E('div', { 'class': 'mt-control-state' }, [ E('span', {}, label), E('strong', {}, value || '--') ]);
}

function styleNode() {
	return E('style', {}, [
		'.mt-ui-page{--mt-ui-accent:#1264d8;--mt-ui-teal:#07988e;--mt-ui-border:var(--border-color-medium,#d9dde4);--mt-ui-border-soft:var(--border-color-low,#edf0f4);--mt-ui-surface:var(--background-color-high,#fff);--mt-ui-muted:var(--text-color-medium,#69717d);max-width:1120px;margin:0 auto;color:var(--text-color-high,#20242a)}',
		'.mt-ui-hero{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 24px;margin:0 0 16px;border:0;border-radius:16px;background:linear-gradient(135deg,#1264d8 0%,#087eae 58%,#07988e 100%);color:#fff;box-shadow:0 10px 28px rgba(14,92,155,.16)}.mt-ui-hero h2{margin:0 0 6px;color:#fff;font-size:24px;line-height:1.2}.mt-ui-hero p,.mt-ui-hero [class*="-sub"]{margin:0;color:rgba(255,255,255,.78);font-size:12px;line-height:1.5}.mt-ui-hero [class*="kicker"],.mt-ui-hero [class*="eyebrow"]{color:rgba(255,255,255,.68);font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}',
		'.mt-ui-card{border:1px solid var(--mt-ui-border);border-radius:14px;background:var(--mt-ui-surface);box-shadow:0 3px 12px rgba(20,32,50,.04)}',
		'.mt-ui-page .btn{border-radius:9px}.mt-ui-page input,.mt-ui-page select,.mt-ui-page textarea{border-radius:8px}',
		'.mt-ui-details{margin-top:14px;border:1px solid var(--mt-ui-border);border-radius:14px;background:var(--mt-ui-surface);overflow:hidden}.mt-ui-details>summary{display:grid;grid-template-columns:minmax(0,1fr) 34px;align-items:center;gap:14px;min-height:54px;padding:10px 12px 10px 18px;cursor:pointer;list-style:none;transition:background-color .16s ease}.mt-ui-details>summary::-webkit-details-marker{display:none}.mt-ui-details>summary:hover{background:var(--background-color-low,#f6f8fa)}.mt-ui-summary-copy{min-width:0}.mt-ui-summary-title{display:block;font-size:14px;font-weight:700;line-height:1.35}.mt-ui-summary-desc{display:block;margin-top:3px;color:var(--mt-ui-muted);font-size:11px;font-weight:400;line-height:1.45}.mt-ui-chevron{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--mt-ui-border-soft);border-radius:9px;background:var(--background-color-low,#f5f7f9);color:var(--mt-ui-muted);font-size:22px;line-height:1;transform:rotate(0deg);transition:transform .18s ease,background-color .18s ease,color .18s ease}.mt-ui-details[open]>summary .mt-ui-chevron{transform:rotate(90deg);background:#eaf4ff;color:#176bc1}.mt-ui-details[open]>summary{border-bottom:1px solid var(--mt-ui-border-soft)}.mt-ui-details:not([open])>.mt-ui-details-body{display:none}',
		'.mt-control-section{margin-top:20px}.mt-control-section-head{margin:0 0 11px}.mt-control-section-head h3{margin:0 0 4px;font-size:17px}.mt-control-section-head p{margin:0;color:var(--text-color-medium,#6e7783);font-size:12px;line-height:1.5}',
		'.mt-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.mt-control-card{padding:18px;border:1px solid var(--border-color-medium,#d9dde4);border-radius:13px;background:var(--background-color-high,#fff)}.mt-control-card.wide{grid-column:1/-1}',
		'.mt-control-card h3{margin:0 0 5px;font-size:15px}.mt-control-desc{font-size:12px;color:var(--text-color-medium,#6e7783);margin-bottom:14px;line-height:1.5}.mt-control-row{display:grid;grid-template-columns:145px 1fr;gap:10px;align-items:center;margin:11px 0}.mt-control-row label{font-size:12px;color:var(--text-color-medium,#6e7783)}.mt-control-row input,.mt-control-row select{width:100%;box-sizing:border-box}',
		'.mt-control-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.mt-control-note{padding:10px 12px;border-radius:8px;background:#fff7e5;color:#795300;font-size:11px;line-height:1.5;margin-top:12px}.mt-control-state{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--border-color-low,#edf0f4);font-size:12px}.mt-control-state:last-child{border-bottom:0}.mt-control-state span{color:var(--text-color-medium,#6e7783)}.mt-control-state strong{text-align:right}',
		'.mt-control-card.mt-ui-card{border-radius:14px}',
		'.mt-modem-bar{display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:10px 14px;border:1px solid var(--mt-ui-border);border-radius:12px;background:var(--mt-ui-surface)}.mt-modem-bar-label{font-size:12px;font-weight:700;color:var(--mt-ui-muted);white-space:nowrap}.mt-modem-select{min-width:220px;max-width:420px}',
		'.mt-info-all{margin-top:14px}.mt-info-all>h3{margin:0 0 4px;font-size:16px}.mt-info-all>p{margin:0 0 12px;color:var(--mt-ui-muted);font-size:12px;line-height:1.5}.mt-info-grid-all{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
		'.mt-info-card{padding:15px 17px}.mt-info-card h3{margin:0 0 10px;font-size:13px;font-weight:750;color:#176bc1}.mt-info-body{display:flex;flex-direction:column}.mt-info-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:7px 0;border-bottom:1px solid var(--mt-ui-border-soft,#edf0f4);font-size:12px}.mt-info-row:last-child{border-bottom:0}.mt-info-key{color:var(--mt-ui-muted)}.mt-info-val{text-align:right;word-break:break-all;font-weight:600;font-variant-numeric:tabular-nums}',
		'@media(max-width:760px){.mt-ui-hero{display:block;padding:20px}.mt-ui-card{border-radius:13px}.mt-ui-page .btn{min-height:36px}.mt-ui-page input:not([type="checkbox"]):not([type="radio"]),.mt-ui-page select{min-height:36px}.mt-ui-details>summary{grid-template-columns:minmax(0,1fr) 32px;padding-left:15px}.mt-control-grid{grid-template-columns:1fr}.mt-control-row{grid-template-columns:1fr;gap:5px}.mt-info-grid-all{grid-template-columns:1fr}}'
	].join(''));
}

// 确认弹窗（替代原 confirmRun）。onConfirm 回调中执行 QModem ubus 动作。
function confirmModal(title, message, onConfirm, restartRequired) {
	return ui.showModal(title, [
		E('p', {}, message),
		restartRequired ? E('div', { 'class': 'alert-message warning' }, _('A module restart or airplane-mode cycle is required before this change takes effect.')) : null,
		E('div', { 'class': 'right' }, [
			E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, _('Cancel')),
			' ',
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button-negative',
				'click': function() {
					ui.hideModal();
					Promise.resolve(onConfirm()).then(function() {
						ui.addNotification(null, E('p', {}, _('Settings applied.')));
						window.setTimeout(function() { window.location.reload(); }, 900);
					}, function(err) {
						ui.addNotification(null, E('p', {}, (err && err.message) || String(err)), 'danger');
					});
				}
			}, _('Apply'))
		])
	]);
}

// 根据 MCC/MNC（或运营商名）返回中文名 + logo。
function operatorInfo(name, mcc, mnc) {
	var n = (name || '').toUpperCase().replace(/\s+/g, ' ').trim();
	var code = (mcc && mnc) ? String(mcc) + String(mnc) : '';
	if (!code && /^\d{5,6}$/.test(n)) code = n;
	if (/^4600[02478]$/.test(code)) n = 'CHINA MOBILE';
	else if (/^4600[169]$/.test(code)) n = 'CHINA UNICOM';
	else if (/^460(03|05|11)$/.test(code)) n = 'CHINA TELECOM';
	else if (/^46015$/.test(code)) n = 'CHINA BROADNET';
	if (n.indexOf('CHINA MOBILE') !== -1 || n.indexOf('CMCC') !== -1)
		return { name: '中国移动', logo: null };
	if (n.indexOf('CHINA UNICOM') !== -1 || n.indexOf('UNICOM') !== -1)
		return { name: '中国联通', logo: null };
	if (n.indexOf('CHINA TELECOM') !== -1 || n.indexOf('TELECOM') !== -1)
		return { name: '中国电信', logo: null };
	if (n.indexOf('BROADNET') !== -1 || n.indexOf('CBN') !== -1)
		return { name: '中国广电', logo: null };
	return { name: name || _('Mobile Network'), logo: null };
}

return baseclass.extend({
	findEntry: findEntry,
	entryList: entryList,
	entryMap: entryMap,

	getBaseInfo: getBaseInfo,
	getInfo: getInfo,
	getSimInfo: getSimInfo,
	getNetworkInfo: getNetworkInfo,
	getCellInfo: getCellInfo,
	getAtCfg: getAtCfg,
	getImei: getImei,
	getMode: getMode,
	getLockBand: getLockBand,
	getNeighborCell: getNeighborCell,
	getNetworkPrefer: getNetworkPrefer,
	getDns: getDns,
	getSms: getSms,
	getDisabledFeatures: getDisabledFeatures,
	getRebootCaps: getRebootCaps,
	getCopyright: getCopyright,
	getCurrentBand: getCurrentBand,
	getConnectStatus: getConnectStatus,
	getDialStatus: getDialStatus,
	getDialLog: getDialLog,
	getSimSlot: getSimSlot,
	getSimSwitchCapabilities: getSimSwitchCapabilities,
	getUsageStats: getUsageStats,

	sendAt: sendAt,
	sendSms: sendSms,
	deleteSms: deleteSms,
	setMode: setMode,
	setImei: setImei,
	setLockBand: setLockBand,
	setNetworkPrefer: setNetworkPrefer,
	setSimSlot: setSimSlot,
	doReboot: doReboot,
	clearDialLog: clearDialLog,
	modemDial: modemDial,
	modemHang: modemHang,
	modemRedial: modemRedial,
	rcList: rcList,
	getInterfaceStatus: getInterfaceStatus,

	getModemSections: getModemSections,
	resolveSection: resolveSection,
	getModemList: getModemList,
	getModemSectionsSync: getModemSectionsSync,
	getStoredSection: getStoredSection,
	setStoredSection: setStoredSection,
	renderModemBar: renderModemBar,
	groupByClass: groupByClass,
	formatSignal: formatSignal,
	renderInfoGrouped: renderInfoGrouped,

	formatBytes: formatBytes,
	formatDuration: formatDuration,
	formatRate: formatRate,
	select: select,
	row: row,
	action: action,
	card: card,
	state: state,
	styleNode: styleNode,
	confirmModal: confirmModal,
	operatorInfo: operatorInfo
});
