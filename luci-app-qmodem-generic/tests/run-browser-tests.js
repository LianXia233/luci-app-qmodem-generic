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
  window.calls = [];
  let task = 0;
  const rpc = { declare: def => (...args) => {
    window.calls.push({ object: def.object, method: def.method, args });
    if (def.method === 'snapshot') {
      const domains = {};
      for (const key of Object.keys(data)) domains[key] = { status: 'ready', stale: false, updated: Date.now() / 1000, ttl: 600, data: data[key] };
      return Promise.resolve({ config_section: args[0], now: Date.now() / 1000, domains });
    }
    if (def.method === 'get_task') return Promise.resolve({ state: 'success', result: { response: 'AT+CGMI\r\nOK', success: true } });
    if (['action', 'send_at', 'stats_reset'].includes(def.method)) return Promise.resolve({ task_id: 'test-' + (++task), state: 'running' });
    return Promise.resolve({});
  } };
  const ui = {
    showModal: (title, children) => { document.querySelector('#modal')?.remove(); const node = dom.create('div', { id: 'modal' }, children); document.body.append(node); return node; },
    hideModal: () => document.querySelector('#modal')?.remove(), addNotification: () => {},
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
  for (const dark of [false, true]) for (const width of [1440, 375]) for (const scenario of ['full', 'sparse', 'empty', 'absent', 'tdtech']) for (const viewName of views) {
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
      assert(!window.initialCalls.some(c => ['qmodem', 'qos', 'luci-rpc'].includes(c.object)), `${viewName}/${scenario}: read touched modem`);
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
        assert.equal(app.querySelectorAll('.qm-palette-option').length, 4, 'Theme choices remain available with no modem');
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
      if (viewName === 'sms' && scenario === 'empty') {
        const newButton = [...app.querySelectorAll('button')].find(el => el.textContent.trim() === '新短信');
        assert(newButton); newButton.click();
        assert.equal(window.document.activeElement, app.querySelector('input'), 'New SMS click must focus recipient');
      }
      console.log('PASS ' + viewName + '/' + scenario + '/' + width + (dark ? '/dark' : '/light'));
      cases++;
    } finally { await window.happyDOM.close(); }
  }
  console.log(`PASS: ${cases} DOM page cases. Browser layout and real hardware remain unverified.`);
}

if (process.argv[2] === '--dom') {
  runDom().catch(err => { console.error(err); process.exitCode = 1; });
} else {
  run().catch(err => { console.error(err); process.exitCode = 1; });
}
