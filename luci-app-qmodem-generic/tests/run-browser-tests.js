/* Run: node tests/run-browser-tests.js
 * Requires Playwright + Chromium. Real view/controls/theme code runs in Chromium;
 * only RPC/UCI and LuCI form widgets are replaced. The DOM stub deliberately
 * retains LuCI 25.12's null-array behaviour to catch the reported regression.
 * Optional: QM_SCREENSHOT_DIR=/tmp/qm-ui for screenshots.
 * DOM-only fallback (no browser, no layout assertions): install happy-dom,
 * then node tests/run-browser-tests.js --dom.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const resources = path.resolve(__dirname, '../htdocs/luci-static/resources');
const views = ['status', 'connection', 'network', 'sms', 'system', 'advanced', 'settings', 'terminal'];
const sources = {};
for (const name of ['qmodem-generic/theme', 'qmodem-generic/controls', ...views.map(v => 'view/qmodem-generic/' + v)])
  sources[name] = fs.readFileSync(path.join(resources, name + '.js'), 'utf8');
const po = fs.readFileSync(path.resolve(__dirname, '../po/zh_Hans/qmodem-generic.po'), 'utf8');
const translations = {};
for (const match of po.matchAll(/^msgid (".*")\nmsgstr (".*")/gm)) {
  try { translations[JSON.parse(match[1])] = JSON.parse(match[2]); } catch (_) {}
}

async function mount({ sources, translations, viewName, scenario, dark, multi }) {
  const baseclass = { extend: value => value };
  // Matches native LuCI create/attr/append semantics, including the null bug.
  const dom = {
    create(tag, attrs, children) {
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs || {})) {
        if (value == null) continue;
        if (typeof value === 'function') el.addEventListener(key, value);
        else el.setAttribute(key, String(value));
      }
      this.append(el, children);
      return el;
    },
    append(el, children) {
      if (Array.isArray(children)) children.forEach(child => el.appendChild(child instanceof Node ? child : document.createTextNode(String(child))));
      else if (children instanceof Node) el.appendChild(children);
      else if (children != null) el.innerHTML = String(children);
      return el;
    },
    content(el, children) { el.replaceChildren(); return this.append(el, children); }
  };
  const config = {
    '.name': '6_1', name: '6_1', model: scenario === 'tdtech' ? 'MT5700M-CN' : 'FM350-GL',
    manufacturer: scenario === 'tdtech' ? 'huawei' : 'fibocom', enabled: '1',
    at_port: '/dev/ttyUSB1', network: 'eth2', apn: '3gnet', modes: ['rndis'], pdp_type: 'IPV4V6', auth: 'none'
  };
  const list = scenario === 'absent' ? [] : [config];
  if (multi) list.push({ ...config, '.name': '6_2', name: '6_2', model: 'RM520N-GL' });
  const uci = {
    load: () => Promise.resolve(),
    sections: (file, type, cb) => { if (cb) list.forEach(cb); return list; },
    get: (file, section, key) => (list.find(c => c['.name'] === section) || {})[key],
    set: (file, section, key, val) => { (list.find(c => c['.name'] === section) || {})[key] = val; },
    unset: () => {}, save: () => Promise.resolve(), commit: () => Promise.resolve()
  };
  const entry = (key, value, cls) => ({ key, value, class: cls || 'Modem' });
  const base = [entry('name', config.model), entry('manufacturer', 'Fibocom Wireless Inc.'),
    entry('revision', '81600.0000.00.29.23.08'), entry('at_port', config.at_port),
    entry('temperature', '53°C'), entry('connect_status', 'Yes')];
  const sim = [entry('SIM Status', 'READY'), entry('ICCID', '89860118802028653177'), entry('IMSI', '460011234567890'),
    entry('IMEI', '860000000000001'), entry('SIM Number', '13800000000'), entry('ISP', 'CHINA UNICOM')];
  const cell = [entry('network_mode', 'NR5G-SA Mode'), entry('RSRP', '-91'), entry('RSRQ', '-11.5'), entry('SINR', 0),
    entry('MCC', '460'), entry('MNC', 1), entry('Band', 78), entry('ARFCN', 6502788),
    entry('Physical Cell ID', 0), entry('Cell ID', '59626938646'), entry('TAC', '14557185'),
    entry('DL Bandwidth', '100M'), entry('UL Bandwidth', '100M')];
  const iface = { interface: '6_1', up: true, l3_device: 'eth2', proto: 'static', mtu: 1500, uptime: 1560,
    'ipv4-address': [{ address: '10.35.198.222', mask: 24 }],
    'ipv6-address': [{ address: '2408:843c:5620:9189:200:11ff:fe12:1314', mask: 64 }],
    'dns-server': ['58.240.57.33', '2400:3200::1'] };
  const lockband = {};
  for (const [rat, count] of [['UMTS', 5], ['LTE', 32], ['NRSA', 20]]) {
    lockband[rat] = { available_band: [], lock_band: [] };
    for (let i = 1; i <= count; i++) {
      const band = { band_id: i, band_name: String(i) };
      lockband[rat].available_band.push(band);
      lockband[rat].lock_band.push(band);
    }
  }
  let data = {
    status: { base_info: { modem_info: base }, connect_status: { connect_status: 'Yes' },
      dial_status: { dial_status: { running: false, retry: 0, message: null } },
      dns: { dns: { ipv4_dns1: '58.240.57.33', ipv6_dns1: '2400:3200::1' } },
      ifaces: { names: ['6_1'], entries: { '6_1': iface } }, device: { mtu: 1500, up: true } },
    sim: { sim_info: { modem_info: sim }, imei: { imei: '860000000000001' }, sim_slot: { sim_slot: 0 },
      sim_switch_capabilities: { supportSwitch: '1', simSlots: ['0', '1'] } },
    signal: { cell_info: { modem_info: cell }, current_band: { current_band: { status: 'supported', network_mode: 'NR5G-SA',
      cells: [{ role: 'PCC', rat: 'NR', band: 78, band_name: 'n78', pci: 0, channel: 6502788, dl_bandwidth: '100', ul_bandwidth: null }] } } },
    network: { network_info: { modem_info: [entry('APN', '3gnet')] }, mode: { mode: { rndis: '1' } },
      network_prefer: { network_prefer: { '4G': '1', '5G': '1' } }, lockband: { lockband },
      disabled_features: { disabled_features: [] }, neighborcell: {} },
    device: { at_cfg: { at_cfg: { at_port: config.at_port, ports: [config.at_port] } }, info: { modem_info: base.concat(sim) },
      reboot_caps: { reboot_caps: { soft_reboot_caps: 1, hard_reboot_caps: scenario === 'tdtech' ? 1 : 0 } } },
    stats: { usage: { available: 0 }, daily: { available: true, today_rx: 0, today_tx: 0, total_rx: 0, total_tx: 0, days: [] } },
    qos: {}, radio: {}, sms: { get_sms: { sms: [] } },
    support: { available: 1, path: '/usr/share/qmodem/modem_support.json', builtin: ['rg520n-cn'], added: [], missing: [] }
  };
  if (scenario === 'sparse') {
    base.splice(2, 1); // no firmware
    base.splice(base.findIndex(x => x.key === 'temperature'), 1);
    sim.splice(sim.findIndex(x => x.key === 'ICCID'), 1);
    sim.push(entry('ICCID', 'N/A'), entry('unused', '--'), entry('nullfield', null));
    cell.splice(cell.findIndex(x => x.key === 'RSRQ'), 1);
    cell.splice(cell.findIndex(x => x.key === 'UL Bandwidth'), 1);
    delete iface['ipv6-address'];
    data.status.dns.dns.ipv6_dns1 = null;
  }
  if (scenario === 'empty' || scenario === 'absent') data = {};
  if (scenario === 'sms_legacy') data.sms.get_sms = { sms: { msg: [{ index:0, sender:'10010', content:'SIM 保留短信', timestamp:'26/10/17,20:10:00+32' }] } };
  if (scenario === 'sms_legacy_missing') delete data.sms;
  window.calls = [];
  window.notifications = [];
  let task = 0;
  const tasks = {};
  const rpc = { declare: def => (...args) => {
    window.calls.push({ object: def.object, method: def.method, args });
    if (def.object === 'qmodem_support' && def.method === 'ports') return Promise.resolve({ ports: [
      {port:'/dev/ttyUSB2', bus:'usb', id:'2c7c:0801', location:'2-1', model:'RG502Q-EA', section:'6_1', confirmed:1},
      {port:'/dev/wwan0at0', bus:'pcie', id:'17cb:0308', location:'0000:01:00.0', model:'RG650E-EU', section:'', confirmed:0}
    ] });
    if (def.object === 'qmodem_support' && def.method === 'custom_list') return Promise.resolve({ entries: [] });
    if (def.object === 'qmodem' && def.method === 'get_sms' && scenario === 'sms_legacy_missing')
      return Promise.resolve({ sms: { msg: [{ index: 0, sender: '10010', content: '旧版直读短信', timestamp: '26/10/17,20:10:00+32' }] } });
    if (def.object === 'qmodem' && def.method === 'get_sms' && scenario === 'sms_legacy')
      return Promise.resolve({ sms: { msg: [{ index: 0, sender: '10010', content: '实时收到短信', timestamp: '26/10/17,20:10:00+32' }] } });
    if (def.object === 'qmodem.sms') {
      if (!['sms_database','sms_database_error'].includes(scenario))
        return Promise.reject(new Error('RPC call to qmodem.sms/config_get failed with error -32000: Object not found at ClassConstructor.handleCallReply'));
      if (def.method === 'config_get') return Promise.resolve({mode:'database_poll',auto_delete:true,poll_interval:300});
      if (def.method === 'list') return Promise.resolve(scenario === 'sms_database_error' ? {status:'error',error:'SMS database is unavailable'} : {
        mode:'database_poll', messages:[
          {id:71,type:'received',sender:'10010',content:'<b>数据库接收短信</b>',timestamp:1792239000,is_read:0},
          {id:72,type:'sent',recipient:'10010',content:'数据库发送记录',timestamp:1792239060,success:1}
        ]
      });
      if (def.method === 'send' && window.smsSendError) return Promise.resolve({status:'error',error:window.smsSendError});
      return Promise.resolve({status:'success'});
    }
    if (def.method === 'snapshot') {
      const domains = {};
      for (const key of Object.keys(data)) domains[key] = { status: 'ready', stale: false, updated: Date.now() / 1000, ttl: 600, data: data[key] };
      return Promise.resolve({ config_section: args[0], now: Date.now() / 1000, domains });
    }
    if (def.method === 'get_task') return Promise.resolve(tasks[args[0]] || { state: 'missing' });
    if (['action', 'send_at', 'stats_reset'].includes(def.method)) {
      if (def.method === 'action' && args[1] === 'qmodem') {
        const payload = args[3];
        if (!payload || payload.config_section !== args[0]) return Promise.resolve({ error: 'explicit valid modem section required' });
        if (['send_at','send_sms','do_reboot'].includes(args[2]) && (!payload.params || typeof payload.params !== 'object')) return Promise.resolve({ error: 'missing params object' });
      }
      const id = 'test-' + (++task);
      tasks[id] = { config_section: args[0], state: window.atTaskFailure ? 'failed' : 'success',
        error: window.atTaskFailure || null,
        result: window.atTaskReply || { at_cfg: { status: '1', res: 'Fibocom\r\nFM350-GL\r\nOK' } } };
      return Promise.resolve({ task_id: id, state: 'running' });
    }
    return Promise.resolve({});
  } };
  const ui = {
    showModal: (title, children) => { document.querySelector('#modal')?.remove(); const node = dom.create('div', { id: 'modal' }, children); document.body.append(node); return node; },
    hideModal: () => document.querySelector('#modal')?.remove(), addNotification: (...args) => window.notifications.push(args),
    createHandlerFn: (ctx, fn) => function(...args) { return fn.apply(ctx, args); }
  };
  const form = {};
  for (const type of ['NamedSection', 'Value', 'ListValue', 'DynamicList', 'Flag']) form[type] = function() {};
  form.Map = function() {
    const options = [];
    this.section = () => ({ option: (type, key, label) => {
      const opt = { type, key, label, choices: [], value: function(k, label) { this.choices.push([k, label]); }, depends: () => {} };
      options.push(opt); return opt;
    } });
    this.save = () => Promise.resolve();
    this.render = async () => {
      const map = document.createElement('div'); map.className = 'cbi-map';
      for (const opt of options) {
        if (['username', 'password'].includes(opt.key)) continue;
        const row = document.createElement('div'); row.className = 'cbi-value';
        const label = document.createElement('label'); label.className = 'cbi-value-title'; label.textContent = opt.label;
        const field = document.createElement('div'); field.className = 'cbi-value-field';
        let input;
        if (opt.type === form.ListValue) {
          input = document.createElement('select');
          for (const [val, label] of opt.choices) { const node = document.createElement('option'); node.value = val; node.textContent = label; input.append(node); }
        } else { input = document.createElement('input'); input.type = opt.type === form.Flag ? 'checkbox' : 'text'; }
        input.className = opt.type === form.ListValue ? 'cbi-input-select' : 'cbi-input-text';
        input.value = config[opt.key] || opt.default || ''; field.append(input); row.append(label, field); map.append(row);
      }
      return map;
    };
  };
  const modules = {};
  const L = { env: { rpctimeout: 20 }, url: str => '/' + str, bind: (fn, ctx) => fn.bind(ctx) };
  function load(name) {
    if (modules[name]) return modules[name];
    return modules[name] = new Function('baseclass', 'view', 'rpc', 'uci', 'ui', 'dom', 'form', 'controls', 'theme', 'L', '_', sources[name])(
      baseclass, baseclass, rpc, uci, ui, dom, form,
      name.startsWith('view/') ? load('qmodem-generic/controls') : null,
      name !== 'qmodem-generic/theme' ? load('qmodem-generic/theme') : null,
      L, s => translations[s] || s
    );
  }
  const controls = load('qmodem-generic/controls');
  window.controls = controls;
  window.qmTheme = load('qmodem-generic/theme');
  // Both versions of LuCI must work: a broken legacy E must never be invoked.
  window.E = () => { throw new Error('global E must not be used'); };
  const view = load('view/qmodem-generic/' + viewName);
  window.currentView = view;
  const res = await view.load();
  const node = await (view.paintContent ? view.paintContent(res) : view.render(res));
  document.querySelector('#app').replaceChildren(node);
  window.initialCalls = window.calls.slice();
  return true;
}

async function run() {
  const { chromium } = require('playwright');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><main id="app"></main></body></html>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [];
  let passed = 0;
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 768, 375]) for (const dark of [false, true]) for (const viewName of views) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      page.on('pageerror', e => errors.push(viewName + ': ' + e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.addStyleTag({ content: `body{margin:0;padding:20px;background:${dark ? '#121820' : '#f5f7fa'};color:${dark ? '#eef2f7' : '#16202c'};font:14px Arial,sans-serif}body *{box-sizing:border-box}button,a,input,select,textarea{font:inherit}.cbi-value-title{float:left;width:200px}.cbi-value-field{margin-left:220px}input,select{min-width:240px}.btn{display:inline-flex;padding:8px 14px;border:1px solid #ccd2dc;border-radius:8px}#app{max-width:1280px;margin:auto}` });
      await page.evaluate(mount, { sources, translations, viewName, scenario: 'full', dark });
      const report = await page.evaluate(() => {
        const app = document.querySelector('#app');
        const text = app.innerText;
        const badRows = [...app.querySelectorAll('.qm-list-row,.mt-net-row,.mt-system-row,.mtconn-kv-row,.mt-info-row,.mt-control-state')].filter(row => row.children.length > 1 && /^(--|null|undefined|N\/A)$/.test(row.lastElementChild.innerText.trim())).map(row => row.innerText);
        const overflowing = [...app.querySelectorAll('input:not([type=checkbox]),select,textarea')].filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > el.closest('section,.mt-control-card,.mt-sms-compose,#app').getBoundingClientRect().right + 1).map(el => el.outerHTML.slice(0, 100));
        const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT); let node, leaked = [];
        while ((node = walker.nextNode())) if (!['STYLE', 'SCRIPT', 'PRE'].includes(node.parentElement.tagName) && /^(null|undefined|nullnull)$/.test(node.textContent.trim())) leaked.push(node.textContent);
        return { text, badRows, overflowing, leaked, width: document.documentElement.scrollWidth, viewport: innerWidth,
          slowCalls: window.initialCalls.filter(c => ['qmodem', 'qos', 'luci-rpc'].includes(c.object)),
          chips: [...app.querySelectorAll('.mt-locksum-chips')].map(el => getComputedStyle(el).display) };
      });
      assert(!/页面渲染失败|页面渲染失败|拨号设置渲染失败/.test(report.text), `${viewName}: render failed`);
      assert.deepEqual(report.leaked, [], `${viewName}: null nodes`);
      assert.deepEqual(report.badRows, [], `${viewName}: missing-data rows`);
      assert.deepEqual(report.overflowing, [], `${viewName} ${width}: overflowing fields`);
      assert(report.width <= report.viewport + 1, `${viewName} ${width}: page overflow ${report.width}`);
      assert.deepEqual(report.slowCalls, [], `${viewName}: read touched modem`);
      if (viewName === 'network') assert(report.chips.every(v => v === 'flex'));
      if (viewName === 'system') assert(report.text.includes('89860118802028653177'), 'ICCID should use actual data');
      if (viewName === 'status') assert(!report.text.includes('QoS 等级') && !report.text.includes('签约速率'), 'Missing QoS must hide rows');
      if (process.env.QM_SCREENSHOT_DIR && width !== 768 && !dark) {
        fs.mkdirSync(process.env.QM_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.QM_SCREENSHOT_DIR, `${viewName}-${width}.png`), fullPage: true });
      }
      await page.close(); passed++;
    }
    // Sparse/offline/missing-device data: every actual page still renders.
    for (const scenario of ['sparse', 'empty', 'absent', 'tdtech']) for (const viewName of views) {
      const page = await browser.newPage({ viewport: { width: 375, height: 1000 } });
      page.on('pageerror', e => errors.push(viewName + '/' + scenario + ': ' + e.message));
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.addStyleTag({ content: 'body{margin:0;padding:16px;font:14px Arial;background:#f5f7fa}*{box-sizing:border-box}select,input{min-width:240px}.btn{display:inline-flex;padding:8px;border:1px solid #ccc}' });
      await page.evaluate(mount, { sources, translations, viewName, scenario, dark: false, multi: scenario === 'tdtech' });
      const text = await page.locator('#app').innerText();
      assert(!/渲染失败/.test(text), `${viewName}/${scenario}: render error`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${viewName}/${scenario}: page overflow`);
      if (scenario === 'sparse' && viewName === 'system') assert(!(await page.locator('.mt-system-row').allTextContents()).some(t => /^ICCID/.test(t)));
      if (scenario === 'tdtech' && viewName === 'advanced') assert(text.includes('USB 数据模式'));
      if (scenario !== 'tdtech' && viewName === 'advanced') assert(!text.includes('USB 数据模式'));
      if (scenario === 'sparse' && viewName === 'network') {
        const pci = await page.locator('.mt-net-row').allTextContents();
        assert(pci.some(t => t.includes('PCI') && t.endsWith('0')), 'Valid PCI 0 must remain visible');
      }
      if (scenario === 'tdtech' && viewName === 'advanced' && process.env.QM_SCREENSHOT_DIR)
        await page.screenshot({ path: path.join(process.env.QM_SCREENSHOT_DIR, 'advanced-tdtech-375.png'), fullPage: true });
      if (scenario === 'empty' && viewName === 'sms') {
        await page.getByRole('button', { name: '新短信', exact: true }).click();
        assert(await page.locator('input').evaluate(el => document.activeElement === el), 'New message button must bind click');
      }
      await page.close(); passed++;
    }
    assert.deepEqual(errors, [], 'Uncaught browser errors');
    console.log(`PASS: ${passed} real-page cases (8 pages, desktop/tablet/mobile, light/dark, full/sparse/offline/multiple modems).`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
async function runDom() {
  const { Window } = await import(require.resolve('happy-dom'));
  let cases = 0;
  for (const dark of [false, true]) for (const width of [1440, 375]) for (const scenario of ['full', 'sparse', 'empty', 'absent', 'tdtech', 'sms_database', 'sms_database_error', 'sms_legacy', 'sms_legacy_missing']) for (const viewName of views) {
    if (scenario.startsWith('sms_') && viewName !== 'sms') continue;
    const window = new Window({ url: 'http://qmodem.test', width, height: 1000 });
    try {
      window.document.body.innerHTML = '<main id="app"></main>';
      window.document.body.style.backgroundColor = dark ? '#121820' : '#f5f7fa';
      const args = { sources, translations, viewName, scenario, dark, multi: scenario === 'tdtech' };
      await window.eval('(' + mount.toString() + ')(' + JSON.stringify(args) + ')');
      const app = window.document.querySelector('#app');
      const text = app.innerText;
      assert(!/渲染失败/.test(text), `${viewName}/${scenario}: render error`);
      for (const row of app.querySelectorAll('.qm-list-row,.mt-net-row,.mt-system-row,.mtconn-kv-row,.mt-info-row,.mt-control-state')) {
        if (row.children.length > 1) assert(!/^(--|null|undefined|N\/A)$/.test(row.lastElementChild.innerText.trim()), `${viewName}/${scenario}: ${row.innerText}`);
      }
      const walker = window.document.createTreeWalker(app, window.NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (!['STYLE', 'SCRIPT', 'PRE'].includes(node.parentElement.tagName))
        assert(!/^(null|undefined|nullnull)$/.test(node.textContent.trim()), `${viewName}/${scenario}: null node`);
      assert(!window.initialCalls.some(c =>
        ['qmodem', 'qos', 'luci-rpc'].includes(c.object) &&
        !(viewName === 'sms' && ['sms_legacy', 'sms_legacy_missing'].includes(scenario) &&
          c.object === 'qmodem' && c.method === 'get_sms')),
        `${viewName}/${scenario}: unexpected modem request`);
      assert.equal(window.document.body.getAttribute('data-qm-palette'), 'ocean', 'Default palette must be blue/green');
      let fired = false;
      const button = window.controls.element('button', { click: () => { fired = true; } }, 'check');
      button.click();
      assert(fired, 'DOM factory must bind event listeners');
      for (const el of app.querySelectorAll('.qm-hero button,.mt-sms-hero button')) {
        const css = window.getComputedStyle(el);
        assert(css.color !== css.backgroundColor, 'Hero button text must differ from background');
      }
      if (scenario === 'full' && viewName === 'system') assert(text.includes('89860118802028653177'), 'Actual ICCID must display');
      if (scenario === 'sparse' && viewName === 'system') assert(![...app.querySelectorAll('.mt-system-row')].some(row => /^ICCID/.test(row.innerText)), 'Missing ICCID must hide');
      if (viewName === 'status') assert(![...app.querySelectorAll('.qm-list-row')].some(row => /QoS 等级|签约速率/.test(row.innerText)), 'Missing QoS must hide');
      if (scenario === 'sparse' && viewName === 'network') assert([...app.querySelectorAll('.mt-net-row')].some(row => row.innerText.includes('PCI') && row.lastElementChild.innerText === '0'), 'Valid PCI 0 must display');
      if (viewName === 'advanced' && scenario !== 'absent') assert.equal(text.includes('USB 数据模式'), scenario === 'tdtech', 'Private commands must match model');
      if (viewName === 'advanced') {
        assert.equal(app.querySelectorAll('.qm-palette-option').length, 8, 'Theme choices remain available with no modem');
        assert.equal(app.querySelectorAll('.qm-port-row').length, 2, 'USB/PCIe port mappings are displayed');
        assert(text.includes('2c7c:0801') && text.includes('17cb:0308'), 'Hardware IDs are displayed');
        app.querySelector('.qm-port-actions button:last-child').click();
        assert.equal(app.querySelector('[data-custom-field="model"]').value, 'rg502q-ea', 'Detected model prefills custom entry');
        const start = app.querySelector('input[aria-label="渐变起始颜色"]');
        start.value = '#123456'; start.dispatchEvent(new window.Event('change'));
        assert.equal(window.document.body.getAttribute('data-qm-palette'), 'custom');
        assert.equal(JSON.parse(window.localStorage.getItem('qmodem-generic-appearance')).customStart, '#123456');
        assert(!app.querySelector('input[placeholder="AT^SETMODE?"]'), 'AT console lives on its dedicated page');
        assert(![...app.querySelectorAll('button')].some(b => /软重启模组|硬重启模组|应用网络优选|应用锁定|切换为/.test(b.textContent)), 'Advanced must not duplicate radio and reboot actions');
        const callCount = window.calls.length;
        app.querySelector('[data-palette="violet"]').click();
        assert.equal(window.document.body.getAttribute('data-qm-palette'), 'violet');
        assert.equal(app.querySelector('[data-palette="violet"]').getAttribute('aria-pressed'), 'true');
        const tone = app.querySelector('select[aria-label="明暗模式"]');
        window.document.documentElement.style.setProperty('--background-color-high', '#ffffff');
        window.document.documentElement.style.setProperty('--text-color-high', '#16202c');
        tone.value = 'dark'; tone.dispatchEvent(new window.Event('change'));
        assert(window.document.body.classList.contains('qm-dark'), 'Explicit dark mode must apply immediately');
        assert.match(window.getComputedStyle(app.querySelector('.qm-appearance-card')).backgroundColor.replace(/\s/g, ''), /^(#161f29|rgb\(22,31,41\))$/, 'Manual dark mode must override a light LuCI surface');
        assert.equal(JSON.parse(window.localStorage.getItem('qmodem-generic-appearance')).tone, 'dark');
        assert.equal(window.calls.length, callCount, 'Changing appearance must not call the modem');
        const reloadTheme = () => new window.Function('baseclass', sources['qmodem-generic/theme'])({ extend: v => v });
        let reloaded = reloadTheme();
        assert.equal(reloaded.getAppearance().palette, 'violet', 'Palette survives reloading the module');
        assert.equal(reloaded.getAppearance().tone, 'dark', 'Tone survives reload');
        const rerendered = window.currentView.appearanceCard();
        assert.equal(rerendered.querySelector('[aria-pressed="true"]').getAttribute('data-palette'), 'violet', 'Polling preserves selected palette');
        window.localStorage.setItem('qmodem-generic-appearance', '{broken');
        reloaded = reloadTheme();
        assert.equal(reloaded.getAppearance().palette, 'ocean', 'Broken settings fall back to default');
        window.localStorage.setItem('qmodem-generic-appearance', JSON.stringify({ palette: 'unknown', tone: 'invalid' }));
        reloaded = reloadTheme();
        assert.equal(reloaded.getAppearance().palette, 'ocean');
        assert.equal(reloaded.getAppearance().tone, 'auto');
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
        reloaded = reloadTheme();
        assert.equal(reloaded.getAppearance().palette, 'ocean');
        assert.equal(reloaded.setAppearance({ palette: 'blue', tone: 'light' }), false);
        assert.equal(window.document.body.getAttribute('data-qm-palette'), 'blue', 'Theme still applies with storage blocked');
      }
      if (['advanced', 'system'].includes(viewName) && scenario !== 'absent') {
        const topology = app.querySelector('.qm-topology');
        assert.equal(topology.querySelectorAll('.qm-topology-node').length, 3);
        assert.equal(topology.querySelectorAll('.qm-topology-link').length, 2);
        for (const title of topology.querySelectorAll('.qm-topology-title'))
          assert.equal(window.getComputedStyle(title).whiteSpace, 'normal', 'Topology labels must wrap');
        assert(!/Host Processor|Bus Ctrl|Cellular Core|Hardware Target/.test(topology.textContent), 'Topology nodes must use Chinese labels');
      }
      if (viewName === 'system' && scenario !== 'absent') {
        const grid = app.querySelector('.qm-system-info-grid');
        assert.equal(grid.children.length, 3, 'Three information cards fill their own grid');
        assert(!grid.textContent.includes('SIM 与射频控制'), 'Full-width controls must not hold empty grid columns open');
        assert.equal([...app.querySelectorAll('button')].filter(b => b.textContent === '硬重启模组').length, scenario === 'tdtech' ? 1 : 0, 'Hard reboot is moved here only when supported');
        const unknown = window.currentView.renderChipTopo('', undefined, '');
        assert.equal(unknown.querySelectorAll('.qm-topology-link.is-idle').length, 2, 'Unknown SIM must not show an active link');
        assert.equal(unknown.querySelectorAll('.qm-topology-title')[2].textContent, 'SIM 卡槽', 'Missing slot must not invent slot zero');
        const escaped = window.currentView.renderChipTopo('<b>9</b>', undefined, 'READY');
        assert(!escaped.querySelector('b'), 'Dynamic slot text cannot create markup');
        assert.equal(app.querySelectorAll('.qm-topology-link:not(.is-idle)').length, scenario === 'empty' ? 0 : 2, 'Ready SIM enables both animated links');
      }
      if (viewName === 'network' && scenario === 'full') {
        assert(!text.includes('切换为 ECM') && !text.includes('切换为 NCM'), 'No invented modem modes');
        for (const el of app.querySelectorAll('.mt-locksum-chips')) assert.equal(window.getComputedStyle(el).display, 'flex', 'Bands wrap in flex rows');
        assert.equal(window.getComputedStyle(app.querySelector('.mt-net-row-block')).display, 'block', 'Band summary must stay below its label');
      }
      if (viewName === 'system' && scenario === 'full') {
        const count = window.calls.length;
        window.currentView.showFactoryReset();
        assert(window.document.querySelector('#modal').innerText.includes('未提供通用的出厂重置接口'));
        assert.equal(window.calls.length, count, 'Opening reset instructions must not send a misleading reset command');
      }
      if (viewName === 'terminal' && scenario !== 'absent') {
        const input = app.querySelector('input[aria-label="AT 命令"]');
        const output = app.querySelector('.qmodem-generic-output');
        assert.equal(app.querySelectorAll('[data-at-command="AT^CHIPTEMP?"]').length, scenario === 'tdtech' ? 1 : 0, 'Private quick commands must match modem');
        assert(app.querySelector('[data-at-command="AT+CSQ"]'), 'Common signal command must be vendor neutral');
        assert([...app.querySelectorAll('button')].every(b => b.type === 'button'), 'Console buttons must not submit the enclosing LuCI form');
        const before = window.calls.filter(c => ['action','send_at'].includes(c.method)).length;
        input.value = 'ATI';
        const first = window.currentView.sendCommand(output, input);
        const duplicate = window.currentView.sendCommand(output, input);
        assert.equal(input.disabled, true);
        assert.equal(app.querySelector('.qm-at-state').classList.contains('is-busy'), true);
        await Promise.all([first, duplicate]);
        const submissions = window.calls.filter(c => ['action','send_at'].includes(c.method)).slice(before);
        assert.equal(submissions.length, 1, 'Repeated clicks must create only one AT task');
        const sent = submissions[0];
        assert.equal(sent.args[0], '6_1', 'AT must target the selected dynamic modem');
        if (sent.method === 'action') {
          assert.equal(sent.args[3].config_section, '6_1');
          assert.equal(sent.args[3].params.at, 'ATI');
          assert.equal(sent.args[3].params.port, '/dev/ttyUSB1');
        } else assert.equal(sent.args[1], 'ATI');
        assert(output.textContent.includes('FM350-GL') && output.textContent.includes('OK'), 'Official at_cfg.res must display as plain response text');
        assert(!output.textContent.includes('"at_cfg"'), 'Response pane must show the modem response, not the protocol envelope');
        assert.equal(input.value, 'ATI', 'Keep commands for retry and saving');
        assert.equal(input.disabled, false);
        assert(app.querySelector('.qm-at-state.is-ok'));
        const style = window.getComputedStyle(output);
        assert(contrastRatio(style.color, style.backgroundColor) >= 4.5, 'Response text must have readable contrast');
        window.atTaskReply = { at_cfg: { status: '1', res: '+CME ERROR: 10' } };
        input.value = 'AT+BAD';
        await window.currentView.sendCommand(output, input);
        assert(app.querySelector('.qm-at-state.is-error'));
        assert(output.querySelector('.is-error').textContent.includes('CME ERROR: 10'));
        assert(contrastRatio(window.getComputedStyle(output.querySelector('.is-error')).color, style.backgroundColor) >= 4.5, 'Error text must also have readable contrast');
        assert.equal(input.value, 'AT+BAD');
        window.atTaskReply = { response: '<b>AT reply</b>\r\nOK' };
        input.value = 'AT';
        const enter = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
        input.dispatchEvent(enter);
        assert(enter.defaultPrevented, 'Enter must not submit the LuCI form');
        await window.currentView.request;
        assert(!output.querySelector('b') && output.textContent.includes('<b>AT reply</b>'), 'AT output must remain text');
        window.atTaskFailure = 'AT port busy';
        input.value = 'ATI';
        await window.currentView.sendCommand(output, input);
        assert(app.querySelector('.qm-at-state.is-error'));
        assert(output.textContent.includes('AT port busy'));
        assert.equal(input.disabled, false, 'Failed requests must re-enable typing');
        window.currentView.clearButton.click();
        assert(output.classList.contains('is-empty'));
        assert(!output.textContent.includes('AT port busy'), 'Clear results must reset the pane');
      }
      if (viewName === 'status' && scenario !== 'absent') {
        assert.deepEqual([...app.querySelectorAll('.qm-shortcut-item')].map(a => a.getAttribute('href').split('/').pop()), ['connection','network','system'], 'Restyled shortcuts preserve their page destinations');
      }
      if (viewName === 'sms' && scenario === 'empty') {
        const newButton = [...app.querySelectorAll('button')].find(el => el.textContent.trim() === '新短信');
        assert(newButton); newButton.click();
        assert.equal(window.document.activeElement, app.querySelector('input'), 'New SMS click must focus recipient');
      }
      if (viewName === 'sms' && scenario === 'sms_database') {
        assert(text.includes('数据库短信：2 条'), 'Auto-deleted SIM messages must remain visible from the database');
        assert.equal(app.querySelectorAll('.mt-sms-contact').length, 1);
        assert.equal(app.querySelectorAll('.mt-sms-bubblewrap.in').length, 1);
        assert.equal(app.querySelectorAll('.mt-sms-bubblewrap.out').length, 1);
        assert(app.querySelector('.mt-sms-thread').textContent.includes('<b>数据库接收短信</b>'));
        assert(!app.querySelector('.mt-sms-thread b'), 'SMS content must remain plain text');
        assert(/2026-\d{2}-\d{2} \d{2}:\d{2}/.test(app.querySelector('.mt-sms-bubbledate').textContent), 'Unix timestamps must display as dates');
        assert(app.querySelector('.mt-sms-unread'));
        assert(!window.initialCalls.some(c => c.object === 'qmodem.sms' && ['sync','mark_read','send','delete'].includes(c.method)), 'Rendering the inbox must only read the database');
        app.querySelector('.mt-sms-contact').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(Array.from(window.calls.find(c => c.method === 'mark_read').args), ['6_1',71]);
        assert(!app.querySelector('.mt-sms-unread'));

        const draft = app.querySelector('textarea');
        const sendButton = app.querySelector('.mt-sms-compose button');
        draft.value = '来自新界面的回复'; sendButton.click();
        const confirm = window.document.querySelector('#modal .cbi-button-apply');
        confirm.click(); confirm.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(window.calls.filter(c => c.object === 'qmodem.sms' && c.method === 'send').length, 1, 'Double confirmation must send only once');
        assert.deepEqual(Array.from(window.calls.find(c => c.object === 'qmodem.sms' && c.method === 'send').args), ['6_1','10010','来自新界面的回复']);
        assert.equal(window.localStorage.getItem('modem.sms.sent'), null, 'Database sends must not duplicate browser sent history');
        assert.equal(draft.value, '');
        window.smsSendError = 'SMS transport failed';
        draft.value = '发送失败后保留的草稿'; sendButton.click();
        window.document.querySelector('#modal .cbi-button-apply').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(draft.value, '发送失败后保留的草稿');
        assert.equal(sendButton.disabled, false);
        assert(window.notifications.some(args => args[1]?.textContent.includes('SMS transport failed')));
        assert(!window.calls.some(c => c.method === 'action' && c.args[2] === 'send_sms'), 'A failed database send must not fall back and resend');

        app.querySelector('.mt-sms-bubblewrap.out .mt-sms-delete').click();
        window.document.querySelector('#modal .cbi-button-negative').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(Array.from(window.calls.find(c => c.object === 'qmodem.sms' && c.method === 'delete').args), ['6_1',72], 'Sent records must delete from the database using their id');
        const refresh = [...app.querySelectorAll('.mt-sms-hero button')].find(b => b.textContent.trim() === '刷新');
        refresh.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert(window.calls.some(c => c.object === 'qmodem.sms' && c.method === 'sync'));
      }
      if (viewName === 'sms' && scenario === 'sms_database_error') {
        assert(text.includes('SMS database is unavailable'));
        assert(text.includes('短信读取失败'));
        assert(!text.includes('模组内短信：0'), 'Database errors must not be shown as an empty SIM inbox');
      }
      if (viewName === 'sms' && scenario === 'sms_legacy_missing') {
        assert(text.includes('模组内短信：1 条') && text.includes('旧版直读短信'), 'Missing SMS cache must fall back to legacy qmodem.get_sms');
        assert.equal(window.calls.filter(c => c.object === 'qmodem' && c.method === 'get_sms').length, 1, 'Legacy SMS should not be read repeatedly during page load');
      }
      if (viewName === 'sms' && scenario === 'sms_legacy') {
        assert(text.includes('模组内短信：1 条') && text.includes('SIM 保留短信'), 'Legacy nested sms.msg responses must remain supported');
        assert(window.initialCalls.some(c => c.object === 'qmodem' && c.method === 'get_sms'),
          'Legacy cached SMS should kick off one background get_sms');
        app.querySelector('.mt-sms-delete').click();
        window.document.querySelector('#modal .cbi-button-negative').click();
        await new Promise(resolve => setTimeout(resolve, 0));
        const action = window.calls.find(c => c.method === 'action' && c.args[2] === 'delete_sms');
        assert.equal(action.args[3].index, 0, 'SIM index zero must remain valid');
        const settings = [...app.querySelectorAll('.mt-sms-hero button')].find(b => b.textContent.trim() === '设置');
        settings.click();
        assert(!window.calls.some(c => c.method === 'action' && c.args[3]?.params?.at === 'AT^IMSSWITCH?'), 'Fibocom settings must not issue TD-Tech private queries');
      }
      console.log('PASS ' + viewName + '/' + scenario + '/' + width + (dark ? '/dark' : '/light'));
      cases++;
    } finally { await window.happyDOM.close(); }
  }
  console.log(`PASS: ${cases} DOM page cases. Browser layout and real hardware remain unverified.`);
}

function contrastRatio(foreground, background) {
  function luminance(color) {
    const hex = /^#([a-f0-9]{6})$/i.exec(color);
    const rgb = hex ? [0,2,4].map(i => parseInt(hex[1].slice(i,i+2),16)) : (color.match(/[\d.]+/g) || []).slice(0,3).map(Number);
    assert.equal(rgb.length, 3, 'Expected resolved CSS color: ' + color);
    const channels = rgb.map(c => { c /= 255; return c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; });
    return channels[0]*0.2126 + channels[1]*0.7152 + channels[2]*0.0722;
  }
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}

if (process.argv[2] === '--dom') {
  runDom().catch(err => { console.error(err); process.exitCode = 1; });
} else {
  run().catch(err => { console.error(err); process.exitCode = 1; });
}
