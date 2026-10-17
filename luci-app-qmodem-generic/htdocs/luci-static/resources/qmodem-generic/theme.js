'use strict';
'require baseclass';

/*
 * QM UI v2 —— 统一视觉层（设计令牌 + 组件皮肤 + 响应式 + 旧类适配）
 *
 * 目标（只改前端、不动任何后端与数据链路）：
 *   1) 兼容 OpenWrt/ImmortalWrt 的任意 LuCI 主题（bootstrap / argon / material /
 *      openwrt-2020 / 各 fork 的暗色变体 …）——所有颜色一律走 CSS 变量：
 *      优先取主题自带的变量（--background-color-* / --border-color-* /
 *      --text-color-* / --success-color …），取不到才用内置 fallback 调色板。
 *      主色默认蓝绿渐变，也可选择其它配色或跟随 LuCI 主色。
 *   2) 明/暗自适应：JS 探测主题底色亮度，给 body 加 qm-app / qm-dark，
 *      fallback 调色板随之切换；手动选择明暗时采用对应表面与文字令牌。
 *   3) 响应式：一套栅格 + 四个断点（1280 / 1024 / 820 / 560），卡片、表单、
 *      表格、SMS 会话、终端在手机上一律可用，触摸目标 ≥ 38px。
 *   4) 旧类适配：历史视图的 mt-* / qm-* / mtconn-* 等私有类名由本层统一"换肤"，
 *      JS 里的硬编码颜色也已令牌化（见 tools 脚本执行记录），无需改视图逻辑。
 *
 * 用法（视图内）：
 *   'require qmodem-generic.theme as theme';
 *   render: function() { return E('div', {}, [ theme.stylesheet(), ... ]); }
 * stylesheet() 会把 <style> 注入到 document.head（幂等，只注入一次），
 * 返回的占位节点可直接放进视图节点数组。
 */

/* ------------------------------------------------------------------ */
/* 1) 设计令牌                                                          */
/* ------------------------------------------------------------------ */
/* 说明：所有令牌都写成 var(<主题变量>, <内置 fallback>)。
 * 主题提供了变量 → 自动跟随主题；没有变量的老主题 → 用内置调色板。 */

var CSS_TOKENS = [
	/* 亮色（默认） */
	'.qm-app{',
	'--qm-maxw:1360px;--qm-gap:16px;--qm-radius:14px;--qm-radius-sm:10px;--qm-radius-xs:8px;',
	'--qm-surface:var(--background-color-high,#ffffff);',
	'--qm-surface-2:var(--background-color-low,#f4f6f9);',
	'--qm-surface-3:var(--background-color-normal,#eaeef3);',
	'--qm-glass:var(--background-color-high,#ffffff);',
	'--qm-border:var(--border-color-medium,#d7dde5);',
	'--qm-border-soft:var(--border-color-low,#e7ecf2);',
	'--qm-border-strong:var(--border-color-high,rgba(15,23,42,.22));',
	'--qm-text:var(--text-color-high,#16202c);',
	'--qm-text-soft:var(--text-color-medium,#3d4756);',
	'--qm-text-muted:var(--text-color-low,#6b7684);',
	'--qm-accent:var(--primary-color,var(--link-color,#0072f5));',
	'--qm-accent-2:var(--primary-color,#38bdf8);',
	'--qm-accent-3:var(--primary-color,#0d9488);',
	'--qm-ok:var(--success-color,#10b981);',
	'--qm-warn:var(--warning-color,#f59e0b);',
	'--qm-danger:var(--error-color,#ef4444);',
	'--qm-on-accent:#ffffff;--qm-on-hero:#ffffff;--qm-scrim:rgba(15,23,42,.45);',
	'--qm-shadow-color:rgba(15,23,42,.10);',
	'--qm-shadow:0 2px 8px var(--qm-shadow-color);',
	'--qm-shadow-md:0 6px 18px var(--qm-shadow-color);',
	'--qm-shadow-lg:0 14px 34px var(--qm-shadow-color);',
	'--qm-accent-soft:rgba(0,114,245,.10);--qm-accent-border:rgba(0,114,245,.32);',
	'--qm-ok-soft:rgba(16,185,129,.12);--qm-ok-border:rgba(16,185,129,.38);',
	'--qm-warn-soft:rgba(245,158,11,.12);--qm-warn-border:rgba(245,158,11,.38);',
	'--qm-danger-soft:rgba(239,68,68,.10);--qm-danger-border:rgba(239,68,68,.36);',
	'--qm-accent-gradient:linear-gradient(135deg,#0072f5 0%,#2563eb 100%);',
	'--qm-hero-gradient:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);',
	'--qm-surface-gradient:linear-gradient(135deg,rgba(255,255,255,.92) 0%,rgba(240,246,255,.72) 100%);',
	'--qm-glow-a:radial-gradient(circle,rgba(0,114,245,.12) 0%,rgba(16,185,129,.04) 50%,transparent 70%);',
	'--qm-glow-b:radial-gradient(circle,rgba(99,102,241,.09) 0%,rgba(14,165,233,.05) 50%,transparent 70%);',
	'--qm-terminal-gradient:linear-gradient(135deg,#111820,#1d2733);',
	'--qm-font-mono:var(--font-family-monospace,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);',
	'color:var(--qm-text);',

	'}',

	/* 暗色：主题变量优先，fallback 换成暗色调色板 */
	'.qm-app.qm-dark{',
	'--qm-surface:var(--background-color-high,#161b22);',
	'--qm-surface-2:var(--background-color-low,#1d232c);',
	'--qm-surface-3:var(--background-color-normal,#232a34);',
	'--qm-glass:var(--background-color-high,#161b22);',
	'--qm-border:var(--border-color-medium,#2d3540);',
	'--qm-border-soft:var(--border-color-low,#242c36);',
	'--qm-border-strong:var(--border-color-high,rgba(255,255,255,.24));',
	'--qm-text:var(--text-color-high,#e6edf3);',
	'--qm-text-soft:var(--text-color-medium,#c2ccd6);',
	'--qm-text-muted:var(--text-color-low,#93a0ad);',
	'--qm-ok:var(--success-color,#34d399);',
	'--qm-warn:var(--warning-color,#fbbf24);',
	'--qm-danger:var(--error-color,#f87171);',
	'--qm-accent-2:var(--primary-color,#7dd3fc);',
	'--qm-scrim:rgba(0,0,0,.60);',
	'--qm-shadow-color:rgba(0,0,0,.45);',
	'--qm-accent-soft:rgba(56,189,248,.14);--qm-accent-border:rgba(56,189,248,.40);',
	'--qm-ok-soft:rgba(52,211,153,.14);--qm-ok-border:rgba(52,211,153,.40);',
	'--qm-warn-soft:rgba(251,191,36,.14);--qm-warn-border:rgba(251,191,36,.40);',
	'--qm-danger-soft:rgba(248,113,113,.14);--qm-danger-border:rgba(248,113,113,.40);',
	'--qm-accent-gradient:linear-gradient(135deg,var(--qm-accent) 0%,#1d4ed8 100%);',
	'--qm-hero-gradient:linear-gradient(135deg,#0b1220 0%,var(--qm-accent) 100%);',
	'--qm-surface-gradient:linear-gradient(135deg,rgba(30,37,47,.92) 0%,rgba(23,30,40,.82) 100%);',
	'--qm-glow-a:radial-gradient(circle,rgba(56,189,248,.10) 0%,rgba(52,211,153,.04) 50%,transparent 70%);',
	'--qm-glow-b:radial-gradient(circle,rgba(129,140,248,.09) 0%,rgba(56,189,248,.05) 50%,transparent 70%);',
	'--qm-terminal-gradient:linear-gradient(135deg,#0b1017,#151d27);',
	'}',

	/* 浏览器支持 color-mix 时，半透明/渐变令牌全部从主题主色实时派生，
	 * 主题换主色（如 argon 的 #5e72e4）本插件的强调色也会跟着变。 */
	'@supports (background:color-mix(in srgb,red 50%,blue)){',
	'.qm-app{',
	'--qm-accent-soft:color-mix(in srgb,var(--qm-accent) 12%,var(--qm-surface));',
	'--qm-accent-border:color-mix(in srgb,var(--qm-accent) 34%,var(--qm-surface));',
	'--qm-ok-soft:color-mix(in srgb,var(--qm-ok) 12%,var(--qm-surface));',
	'--qm-ok-border:color-mix(in srgb,var(--qm-ok) 38%,var(--qm-surface));',
	'--qm-warn-soft:color-mix(in srgb,var(--qm-warn) 13%,var(--qm-surface));',
	'--qm-warn-border:color-mix(in srgb,var(--qm-warn) 38%,var(--qm-surface));',
	'--qm-danger-soft:color-mix(in srgb,var(--qm-danger) 11%,var(--qm-surface));',
	'--qm-danger-border:color-mix(in srgb,var(--qm-danger) 36%,var(--qm-surface));',
	'--qm-glass:color-mix(in srgb,var(--qm-surface) 90%,transparent);',
	'--qm-accent-gradient:linear-gradient(135deg,var(--qm-accent) 0%,color-mix(in srgb,var(--qm-accent) 60%,#0b1220) 100%);',
	'--qm-hero-gradient:linear-gradient(135deg,color-mix(in srgb,var(--qm-accent) 72%,#060b14) 0%,var(--qm-accent) 100%);',
	'--qm-glow-a:radial-gradient(circle,color-mix(in srgb,var(--qm-accent) 14%,transparent) 0%,color-mix(in srgb,var(--qm-ok) 5%,transparent) 50%,transparent 70%);',
	'--qm-glow-b:radial-gradient(circle,color-mix(in srgb,var(--qm-accent-2) 12%,transparent) 0%,color-mix(in srgb,var(--qm-accent) 6%,transparent) 50%,transparent 70%);',
	'}}'
].join('');

/* ------------------------------------------------------------------ */
/* 2) 基础排版与页面容器                                                */
/* ------------------------------------------------------------------ */

var CSS_BASE = [
	'.qm-app *,.qm-app *::before,.qm-app *::after{box-sizing:border-box}',
	/* 页面容器：历史视图各自的根类统一宽度与居中 */
	'.qm-app .qm-shell,.qm-app [class$="-page"],.qm-app .mt-net,.qm-app .mt-system,.qm-app .mt-sms,',
	'.qm-app .mt-hardware,.qm-app .mt-terminal,.qm-app .mt-ui-page{width:100%;max-width:var(--qm-maxw);margin:0 auto}',
	'.qm-app h1,.qm-app h2,.qm-app h3,.qm-app h4{margin:0;color:var(--qm-text);line-height:1.32}',
	'.qm-app p{margin:0}',
	'.qm-app a{color:var(--qm-accent);text-decoration:none}',
	'.qm-app a:hover{text-decoration:underline}',
	'.qm-app hr{border:0;border-top:1px solid var(--qm-border-soft);margin:14px 0}',
	/* 数字/指标统一等宽数字，避免跳动 */
	'.qm-app strong,.qm-app b{color:var(--qm-text)}',
	'.qm-app :focus-visible{outline:2px solid var(--qm-accent);outline-offset:2px;border-radius:6px}',
	/* 历史视图里的"背景光斑"装饰在统一皮肤下全部移除（暗色主题会脏） */
	'.qm-app [class*="bg-glow"]{display:none!important}'
].join('');

/* 独立配色保留 LuCI 的明暗表面；只有手动选择明暗时才覆盖表面令牌。 */
var PALETTES = [
	{ id: 'ocean', name: '蓝绿渐变', sub: '默认 · 海蓝与翠绿', gradient: 'linear-gradient(115deg,#0866c4,#087f70)' },
	{ id: 'blue', name: '清爽蓝', sub: '简洁明亮的蓝色', gradient: 'linear-gradient(115deg,#0755a8,#1678cc)' },
	{ id: 'violet', name: '暮光紫', sub: '柔和的紫色渐变', gradient: 'linear-gradient(115deg,#6041ae,#8a4387)' },
	{ id: 'forest', name: '森林绿', sub: '深绿与青绿', gradient: 'linear-gradient(115deg,#146b54,#119690)' },
	{ id: 'sunset', name: '落日橙', sub: '琥珀与暖橙', gradient: 'linear-gradient(115deg,#b45d0a,#d07326)' },
	{ id: 'rose', name: '莓果红', sub: '玫红与莓紫', gradient: 'linear-gradient(115deg,#ad3865,#894596)' },
	{ id: 'custom', name: '自定义颜色', sub: '自行挑选渐变两端颜色', gradient: 'linear-gradient(115deg,var(--qm-custom-start,#0755a8),var(--qm-custom-end,#087f70))' },
	{ id: 'follow', name: '跟随系统主题', sub: '使用 LuCI 的主色', gradient: 'linear-gradient(115deg,#64748b,#94a3b8)' }
];
var CSS_PALETTES = [
	'.qm-app[data-qm-palette="ocean"]{--qm-accent:#0878cf;--qm-accent-2:#08a6ac;--qm-accent-3:#07856d;',
	'--qm-accent-gradient:linear-gradient(115deg,#0866c4 0%,#087d9c 52%,#087f70 100%);',
	'--qm-hero-gradient:linear-gradient(115deg,#0754a6 0%,#087d9c 52%,#087f70 100%)}',
	'.qm-app[data-qm-palette="blue"]{--qm-accent:#096bd0;--qm-accent-2:#38a7df;--qm-accent-3:#2868bd;',
	'--qm-accent-gradient:linear-gradient(115deg,#0755a8,#1678cc);--qm-hero-gradient:linear-gradient(115deg,#064b96,#126bb8)}',
	'.qm-app[data-qm-palette="violet"]{--qm-accent:#7750c4;--qm-accent-2:#a574d6;--qm-accent-3:#b75c94;',
	'--qm-accent-gradient:linear-gradient(115deg,#6041ae,#8a4387);--qm-hero-gradient:linear-gradient(115deg,#4f338f,#803c7d)}',
	'.qm-app[data-qm-palette="forest"]{--qm-accent:#117c66;--qm-accent-2:#119690;--qm-accent-3:#146b54;',
	'--qm-accent-gradient:linear-gradient(115deg,#146b54,#119690);--qm-hero-gradient:linear-gradient(115deg,#125d4e,#117d78)}',
	'.qm-app[data-qm-palette="sunset"]{--qm-accent:#a95a0d;--qm-accent-2:#d07326;--qm-accent-3:#ad511f;',
	'--qm-accent-gradient:linear-gradient(115deg,#b45d0a,#d07326);--qm-hero-gradient:linear-gradient(115deg,#96500a,#af5419)}',
	'.qm-app[data-qm-palette="rose"]{--qm-accent:#b34072;--qm-accent-2:#a64eae;--qm-accent-3:#894596;',
	'--qm-accent-gradient:linear-gradient(115deg,#ad3865,#894596);--qm-hero-gradient:linear-gradient(115deg,#932f5d,#763b88)}',
	'.qm-app[data-qm-palette="custom"]{--qm-accent:var(--qm-custom-start);--qm-accent-2:var(--qm-custom-end);--qm-accent-3:var(--qm-custom-end);',
	'--qm-accent-gradient:linear-gradient(115deg,var(--qm-custom-start),var(--qm-custom-end));',
	'--qm-hero-gradient:linear-gradient(115deg,var(--qm-custom-start),var(--qm-custom-end))}',
	'.qm-app[data-qm-tone="light"]{--qm-surface:#fff;--qm-surface-2:#f3f6f9;--qm-surface-3:#e9eef4;--qm-glass:#fff;',
	'--qm-border:#d7e0e8;--qm-border-soft:#e6edf3;--qm-border-strong:#aabac9;',
	'--qm-text:#162b3d;--qm-text-soft:#425669;--qm-text-muted:#65798b}',
	'.qm-app[data-qm-tone="dark"]{--qm-surface:#161f29;--qm-surface-2:#1d2935;--qm-surface-3:#253443;--qm-glass:#161f29;',
	'--qm-border:#344353;--qm-border-soft:#293847;--qm-border-strong:#62778b;',
	'--qm-text:#e7f0f8;--qm-text-soft:#c1cfdd;--qm-text-muted:#98aabc}',
	'.qm-app.qm-dark[data-qm-palette="ocean"]{--qm-accent:#54c6ec;--qm-accent-2:#59d6ce;--qm-accent-3:#5ad7b1}',
	'.qm-app.qm-dark[data-qm-palette="blue"]{--qm-accent:#74b9ff;--qm-accent-2:#76d4ff}',
	'.qm-app.qm-dark[data-qm-palette="violet"]{--qm-accent:#b7a1ff;--qm-accent-2:#d2a6ed}',
	'.qm-app.qm-dark[data-qm-palette="forest"]{--qm-accent:#61d4b6;--qm-accent-2:#5bdfd1}',
	'.qm-app.qm-dark[data-qm-palette="sunset"]{--qm-accent:#f4b65e;--qm-accent-2:#ffc78d}',
	'.qm-app.qm-dark[data-qm-palette="rose"]{--qm-accent:#f39abc;--qm-accent-2:#d3a2ed}'
].join('');

var CSS_APPEARANCE = [
	'.qm-app .qm-appearance-card{margin-bottom:16px}',
	'.qm-app .qm-btn-primary,.qm-app .mt-sys-btn-primary,.qm-app .mtconn-btn-primary,.qm-app .mt-sms-btn-primary,',
	'.qm-app .cbi-button-apply,.qm-app .cbi-button-action{background:var(--qm-accent-gradient);border-color:transparent;color:var(--qm-on-accent)}',
	'.qm-app .qm-appearance-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin:14px 0}',
	'.qm-app .qm-palette-option{display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:0;padding:12px;',
	'border:1px solid var(--qm-border);border-radius:12px;background:var(--qm-surface);color:var(--qm-text);text-align:left;cursor:pointer}',
	'.qm-app .qm-palette-option.is-selected{border-color:var(--qm-accent);box-shadow:0 0 0 2px var(--qm-accent-soft);background:var(--qm-surface-2)}',
	'.qm-app .qm-palette-swatch{display:block;height:38px;border-radius:8px;margin-bottom:3px;background:var(--qm-preview-gradient)}',
	'.qm-app .qm-palette-option strong{font-size:13px;line-height:1.5;white-space:normal}',
	'.qm-app .qm-palette-option small{font-size:11.5px;color:var(--qm-text-muted);line-height:1.5}',
	'.qm-app .qm-custom-colors{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0 14px}',
	'.qm-app .qm-custom-colors label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--qm-text-soft)}',
	'.qm-app .qm-custom-colors input[type="color"]{width:52px;height:38px;border:1px solid var(--qm-border);border-radius:8px;padding:3px;background:var(--qm-surface);cursor:pointer}',
	'.qm-app .qm-appearance-status{font-size:12px;color:var(--qm-text-muted);line-height:1.6;margin-top:10px}',
	'.qm-app .qm-topology{display:grid;grid-template-columns:minmax(0,1fr) 54px minmax(0,1fr) 54px minmax(0,1fr);align-items:center;padding:18px 0 6px;width:100%;min-width:0}',
	'.qm-app .qm-topology-node{display:flex;align-items:center;gap:13px;min-width:0;min-height:92px;padding:16px;',
	'border:1px solid var(--qm-border);border-radius:14px;background:var(--qm-surface-2)}',
	'.qm-app .qm-topology-number{display:flex;align-items:center;justify-content:center;flex:0 0 34px;height:34px;border-radius:11px;',
	'background:var(--qm-accent-gradient);color:#fff;font-size:12px;font-weight:750}',
	'.qm-app .qm-topology-copy{display:flex;flex-direction:column;gap:5px;min-width:0}',
	'.qm-app .qm-topology-title{font-size:14px;line-height:1.5;white-space:normal;overflow-wrap:anywhere}',
	'.qm-app .qm-topology-sub{font-size:12px;line-height:1.6;color:var(--qm-text-muted);white-space:normal;overflow-wrap:anywhere}',
	'.qm-app .qm-topology-node.is-ok{border-color:var(--qm-ok-border)}',
	'.qm-app .qm-topology-node.is-ok .qm-topology-sub{color:var(--qm-ok)}',
	'.qm-app .qm-topology-link{position:relative;min-width:0;height:24px;color:var(--qm-accent)}',
	'.qm-app .qm-topology-link::before{content:"";position:absolute;top:11px;left:0;width:100%;height:2px;',
	'background:repeating-linear-gradient(90deg,currentColor 0 6px,transparent 6px 11px);background-size:22px 2px;animation:qmTopologyDash 1.3s linear infinite}',
	'.qm-app .qm-topology-link::after{content:"";position:absolute;left:0;top:8px;width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 9px var(--qm-accent-soft);animation:qmTopologyFlow 1.8s ease-in-out infinite}',
	'.qm-app .qm-topology-link.is-idle{color:var(--qm-text-muted);opacity:.55}',
	'.qm-app .qm-topology-link.is-idle::before{animation:none}',
	'.qm-app .qm-topology-link.is-idle::after{display:none}',
	'@keyframes qmTopologyDash{to{background-position:22px 0}}',
	'@keyframes qmTopologyFlow{0%{left:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:calc(100% - 8px);opacity:0}}',
	'@keyframes qmTopologyDashDown{to{background-position:0 22px}}',
	'@keyframes qmTopologyFlowDown{0%{top:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{top:calc(100% - 8px);opacity:0}}',
	'@media(max-width:680px){.qm-app .qm-topology{grid-template-columns:minmax(0,1fr);padding-top:10px}',
	'.qm-app .qm-topology-node{min-height:78px;padding:14px}',
	'.qm-app .qm-topology-link{height:30px;width:24px;justify-self:center}',
	'.qm-app .qm-topology-link::before{left:11px;top:0;height:100%;width:2px;background:repeating-linear-gradient(180deg,currentColor 0 6px,transparent 6px 11px);background-size:2px 22px;animation-name:qmTopologyDashDown}',
	'.qm-app .qm-topology-link::after{left:8px;top:0;animation-name:qmTopologyFlowDown}}'
].join('');

/* ------------------------------------------------------------------ */
/* 3) 新组件类（QM UI v2 标准件，新代码优先使用）                        */
/* ------------------------------------------------------------------ */

var CSS_COMPONENTS = [
	'.qm-shell{display:flex;flex-direction:column;gap:var(--qm-gap);padding:2px 0 26px}',
	'.qm-grid{display:grid;gap:var(--qm-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}',
	'.qm-grid-2{display:grid;gap:var(--qm-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}',
	'.qm-grid-3{display:grid;gap:var(--qm-gap);grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}',
	'.qm-span-all{grid-column:1/-1}',

	'.qm-card{position:relative;padding:16px 18px;border:1px solid var(--qm-border);border-radius:var(--qm-radius);',
	'background:var(--qm-surface);box-shadow:var(--qm-shadow);transition:box-shadow .18s ease,border-color .18s ease}',
	'.qm-card:hover{box-shadow:var(--qm-shadow-md);border-color:var(--qm-border-strong)}',
	'.qm-card.is-flat{box-shadow:none}',
	'.qm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}',
	'.qm-card-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:700;color:var(--qm-text)}',
	'.qm-card-title svg{width:18px;height:18px;flex:0 0 auto;stroke:var(--qm-accent)}',
	'.qm-card-sub{margin-top:3px;font-size:11.5px;line-height:1.45;color:var(--qm-text-muted)}',
	'.qm-card-foot{margin-top:12px;padding-top:10px;border-top:1px solid var(--qm-border-soft)}',

	'.qm-kv{display:flex;flex-direction:column}',
	'.qm-kv-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:7px 0;',
	'border-bottom:1px solid var(--qm-border-soft);font-size:12.5px;line-height:1.5}',
	'.qm-kv-row:last-child{border-bottom:0}',
	'.qm-kv-key{flex:0 0 auto;color:var(--qm-text-muted)}',
	'.qm-kv-val{min-width:0;text-align:right;font-weight:600;word-break:break-word;font-variant-numeric:tabular-nums}',

	'.qm-stat{display:flex;flex-direction:column;gap:4px;padding:14px 16px;border:1px solid var(--qm-border);',
	'border-radius:var(--qm-radius-sm);background:var(--qm-surface-2)}',
	'.qm-stat-label{font-size:11.5px;color:var(--qm-text-muted)}',
	'.qm-stat-val{font-size:20px;font-weight:750;line-height:1.2;font-variant-numeric:tabular-nums;',
	'color:var(--qm-text);text-align:left}',
	'.qm-stat-sub{font-size:11px;color:var(--qm-text-muted)}',

	'.qm-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;',
	'border:1px solid var(--qm-border);background:var(--qm-surface-2);color:var(--qm-text-soft);',
	'font-size:11px;font-weight:650;line-height:1.5;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}',
	'.qm-badge.is-ok{background:var(--qm-ok-soft);border-color:var(--qm-ok-border);color:var(--qm-ok)}',
	'.qm-badge.is-warn{background:var(--qm-warn-soft);border-color:var(--qm-warn-border);color:var(--qm-warn)}',
	'.qm-badge.is-danger{background:var(--qm-danger-soft);border-color:var(--qm-danger-border);color:var(--qm-danger)}',
	'.qm-badge.is-accent{background:var(--qm-accent-soft);border-color:var(--qm-accent-border);color:var(--qm-accent)}',
	'.qm-dot{width:8px;height:8px;border-radius:50%;background:var(--qm-text-muted);flex:0 0 auto;display:inline-block}',
	'.qm-dot.is-ok{background:var(--qm-ok)}.qm-dot.is-warn{background:var(--qm-warn)}',
	'.qm-dot.is-danger{background:var(--qm-danger)}.qm-dot.is-accent{background:var(--qm-accent)}',

	'.qm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:7px 14px;',
	'border:1px solid var(--qm-border);border-radius:var(--qm-radius-sm);background:var(--qm-surface);',
	'color:var(--qm-text);font-size:12.5px;font-weight:650;cursor:pointer;transition:background-color .16s ease,border-color .16s ease}',
	'.qm-btn:hover{background:var(--qm-surface-2);border-color:var(--qm-border-strong)}',
	'.qm-btn-primary{background:var(--qm-accent);border-color:var(--qm-accent);color:var(--qm-on-accent)}',
	'.qm-btn-primary:hover{background:var(--qm-accent);filter:brightness(1.06)}',
	'.qm-btn-danger{background:var(--qm-danger);border-color:var(--qm-danger);color:#fff}',
	'.qm-btn[disabled]{opacity:.55;cursor:not-allowed}',

	'.qm-alert{display:flex;gap:8px;padding:10px 12px;border-radius:var(--qm-radius-sm);border:1px solid var(--qm-border);',
	'background:var(--qm-surface-2);color:var(--qm-text-soft);font-size:12px;line-height:1.55}',
	'.qm-alert.is-ok{background:var(--qm-ok-soft);border-color:var(--qm-ok-border);color:var(--qm-ok)}',
	'.qm-alert.is-warn{background:var(--qm-warn-soft);border-color:var(--qm-warn-border);color:var(--qm-warn)}',
	'.qm-alert.is-danger{background:var(--qm-danger-soft);border-color:var(--qm-danger-border);color:var(--qm-danger)}',

	'.qm-empty{padding:26px 14px;text-align:center;color:var(--qm-text-muted);font-size:12px}',
	'.qm-mono{font-family:var(--qm-font-mono);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all}',
	'.qm-scroll{max-height:340px;overflow:auto;-webkit-overflow-scrolling:touch}',
	'.qm-table-wrap{width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}',
	'.qm-progress{height:6px;border-radius:999px;background:var(--qm-surface-3);overflow:hidden}',
	'.qm-progress>i{display:block;height:100%;border-radius:999px;background:var(--qm-accent);transition:width .4s ease}',
	'.qm-hide-sm{display:initial}.qm-only-sm{display:none}',
	/* 终端/日志等深色块：跟随主题，不做硬编码黑底 */
	'.qm-terminal{background:var(--qm-surface-3);color:var(--qm-text);border:1px solid var(--qm-border);',
	'border-radius:var(--qm-radius-sm);padding:12px 14px;font-family:var(--qm-font-mono);font-size:12px;overflow:auto}'
].join('');

/* ------------------------------------------------------------------ */
/* 4) 旧类适配层（历史视图的私有类名统一换肤）                            */
/* ------------------------------------------------------------------ */
/* 类名来源：全量扫描 controls.js + 8 个视图的 'class' 属性，按语义分组。 */

var CARD_CLASSES = [
	'mt-adv-card', 'mt-adv-topo-card', 'mt-control-card', 'mt-control-state-current', 'mt-diag-card',
	'mt-diag-topo-card', 'mt-info-card', 'mt-lock-cell-card', 'mt-locksum', 'mt-net-card',
	'mt-net-metric-card', 'mt-hardware-band', 'mt-hardware-head', 'mt-hardware-tools', 'mt-scan-panel',
	'mt-sys-topo-card', 'mt-system-card', 'mt-system-maint-tools', 'mt-system-maintenance',
	'mt-system-temp-box', 'mt-terminal-card', 'mt-ui-card', 'mtconn-card', 'mtconn-config-card',
	'mtconn-fact-card', 'mtconn-topo-card', 'qm-glass-card', 'qm-stat-card', 'qm-cc-card',
	'qm-address-card', 'qm-ip-box', 'qm-carrier-topo-box', 'qm-signal-dial-box', 'qm-traffic-chart-box',
	'qm-mini-item', 'qm-cc-metrics', 'mt-band-option', 'mt-diag-card-head'
];
/* Hero 容器类（带背景渐变的整块区域）与其内部元素类分开：
 * 背景/圆角只给容器，文字反色给容器的后代。 */
var HERO_CLASSES = [
	'qm-hero', 'mt-ui-hero', 'mt-system-hero', 'mtconn-hero', 'mt-diag-hero', 'mt-net-hero',
	'mt-sms-hero', 'mt-terminal-hero', 'mt-hardware-head'
];
var HERO_INNER_CLASSES = [
	'qm-hero-title', 'qm-hero-sub', 'qm-hero-meta', 'qm-hero-actions', 'mt-sms-hero-actions'
];
var TITLE_CLASSES = [
	'mt-card-title', 'mt-diag-title', 'mt-net-title', 'mt-ssb-serving-title', 'mt-system-title',
	'mtconn-sec-title', 'mtconn-title', 'mtconn-topo-title', 'qm-card-title', 'qm-hero-title'
];
var SUB_CLASSES = [
	'mt-diag-sub', 'mt-net-sub', 'mt-system-sub', 'mtconn-sec-sub', 'mtconn-sub', 'mtconn-topo-sub',
	'qm-card-sub', 'qm-hero-sub', 'qm-stat-sub', 'mt-control-desc', 'mt-net-kicker', 'mt-system-kicker'
];
var BADGE_CLASSES = [
	'mt-diag-badge', 'mt-net-badge', 'mt-sms-count-badge', 'mtconn-badge', 'qm-badge', 'qm-cc-badge',
	'qm-pill-tag', 'qm-status-badge', 'mt-cell-role', 'mt-locksum-chip'
];
var GRID_CLASSES = [
	'mt-control-grid', 'mt-info-grid-all', 'mt-lock-cell-grid', 'mt-net-grid', 'mt-system-grid',
	'mtconn-address-grid', 'mtconn-session-grid', 'qm-mini-grid',
	/* 视图内原本写死的 4 列 / 3 列栅格，统一交给自适应网格 */
	'mt-net-metrics', 'mtconn-facts', 'qm-grid-2', 'qm-grid-3', 'qm-shortcuts', 'qm-traffic-layout',
	'mt-hardware-bands', 'mt-system-thermal-form'
];
var ROW_CLASSES = [
	'mt-info-row', 'mt-net-row', 'mt-system-row', 'mtconn-kv-row', 'qm-ip-row', 'qm-list-row',
	'mt-control-state', 'mtconn-dial-item', 'mt-sms-contact'
];
var KEY_CLASSES = [
	'mt-info-key', 'mt-modem-bar-label', 'mt-net-metric-label', 'mt-sbar-label', 'mtconn-dial-key',
	'mtconn-fact-label', 'mtconn-kv-label', 'qm-mini-label', 'qm-stat-label', 'mt-locksum-label'
];
/* 仅"旧视图里本就右对齐的数值"参与统一右对齐；
 * 新组件的数值（qm-stat-val / qm-mini-val）与仪表数值保持各自视图的对齐方式。 */
var VAL_CLASSES = [
	'mt-info-val', 'mt-system-temp-val', 'mtconn-dial-val', 'mtconn-fact-val', 'mtconn-kv-val',
	'qm-ip-val', 'mt-sbar-value'
];
var BTN_CLASSES = [
	'mt-diag-back-btn', 'mt-diag-save-btn', 'mt-sms-btn', 'mt-sys-btn', 'mtconn-btn', 'qm-refresh-btn'
];
var MONO_CLASSES = [ 'mt-hardware-raw', 'mt-scan-raw', 'mt-system-raw', 'mtconn-term-log' ];

function sel(list) {
	return list.map(function(c) { return '.qm-app .' + c; }).join(',');
}

/* 带后缀（伪类 / 后代）的选择器必须逐类展开：
 * 若写成 sel(list) + ' svg{…}'，逗号列表里只有最后一项会带上 svg，
 * 前面几项会变成裸选择器直接命中元素自身（历史上曾把标题压成 18px 宽）。 */
function selDesc(list, suffix) {
	return list.map(function(c) { return '.qm-app .' + c + suffix; }).join(',');
}

var CSS_LEGACY = [
	/* 卡片容器 */
	sel(CARD_CLASSES) + '{background:var(--qm-surface);border:1px solid var(--qm-border);',
	'border-radius:var(--qm-radius);box-shadow:var(--qm-shadow);color:var(--qm-text);',
	'transition:box-shadow .18s ease,border-color .18s ease}',
	selDesc(CARD_CLASSES, ':hover') + '{box-shadow:var(--qm-shadow-md)}',

	/* 标题 / 副标题：nowrap 防止 flex 收缩把中文标题压成竖排 */
	sel(TITLE_CLASSES) + '{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;',
	'font-weight:700;color:var(--qm-text);line-height:1.35;white-space:nowrap;',
	'overflow:hidden;text-overflow:ellipsis;background-image:none!important;',
	'-webkit-text-fill-color:currentColor!important}',
	selDesc(TITLE_CLASSES, ' svg') + '{width:18px;height:18px;flex:0 0 auto;stroke:var(--qm-accent)}',
	sel(SUB_CLASSES) + '{color:var(--qm-text-muted);font-size:11.5px;line-height:1.5}',

	/* 卡片头：左侧文案区可伸缩，右侧徽章不被压缩 */
	'.qm-app .qm-card-head,.qm-app [class*="-card-head"],.qm-app [class*="-head"]>*{min-width:0}',
	'.qm-app .qm-card-head>*:first-child,.qm-app [class*="-card-head"]>*:first-child{flex:1 1 auto}',

	/* 历史视图用 background-clip:text 做的"渐变文字"，在任意主题下都可能
	 * 变成透明字（渐变令牌随主题变化）。统一还原为纯色文字。 */
	'.qm-app [class*="-val"],.qm-app [class*="-value"],.qm-app [class*="-label"],',
	'.qm-app [class*="-kicker"]{background-image:none!important;-webkit-text-fill-color:currentColor!important}',

	/* 徽章 */
	sel(BADGE_CLASSES) + '{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:3px 9px;',
	'border:1px solid var(--qm-border);border-radius:999px;background:var(--qm-surface-2);',
	'color:var(--qm-text-soft);font-size:11px;font-weight:650;line-height:1.5;',
	'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',

	/* 栅格：统一为自适应网格（原固定 2 列在窄屏会挤） */
	sel(GRID_CLASSES) + '{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}',
	'.qm-app .mt-hardware-caps{display:flex;flex-wrap:wrap}',
	'.qm-app .mt-net-row.mt-net-row-block{display:block}',
	'.qm-app .mt-net-row-block>span:first-child{display:block;margin-bottom:8px}',
	'.qm-app .mt-locksum{min-width:0;width:100%;padding:10px;box-sizing:border-box}',
	'.qm-app .mt-locksum-group{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:6px 0}',
	'.qm-app .mt-locksum-chips{display:flex;flex-wrap:wrap;gap:5px;min-width:0;max-width:100%}',
	'.qm-app .mt-locksum-chip{flex:0 0 auto;padding:2px 7px;min-width:26px;box-shadow:none}',

	/* 键值行 */
	sel(ROW_CLASSES) + '{display:flex;align-items:baseline;justify-content:space-between;gap:12px;',
	'border-bottom:1px solid var(--qm-border-soft);font-size:12.5px}',
	selDesc(ROW_CLASSES, ':last-child') + '{border-bottom:0}',
	sel(KEY_CLASSES) + '{color:var(--qm-text-muted);font-size:11.5px}',
	sel(VAL_CLASSES) + '{font-weight:650;text-align:right;word-break:break-word;font-variant-numeric:tabular-nums}',

	/* 按钮：统一触摸目标与圆角 */
	sel(BTN_CLASSES) + '{display:inline-flex;align-items:center;justify-content:center;gap:6px;',
	'min-height:36px;padding:7px 14px;border:1px solid var(--qm-border);border-radius:var(--qm-radius-sm);',
	'background:var(--qm-surface);color:var(--qm-text);font-size:12.5px;font-weight:650;cursor:pointer;',
	'transition:background-color .16s ease,border-color .16s ease,filter .16s ease}',
	selDesc(BTN_CLASSES, ':hover') + '{background:var(--qm-surface-2);border-color:var(--qm-border-strong)}',
	'.qm-app .mtconn-btn-primary,.qm-app .mt-sys-btn-primary,.qm-app .mt-sms-btn-primary',
	'{background:var(--qm-accent);border-color:var(--qm-accent);color:var(--qm-on-accent)}',
	'.qm-app .mtconn-btn-danger,.qm-app .mt-sys-btn-danger',
	'{background:var(--qm-danger-soft);border-color:var(--qm-danger-border);color:var(--qm-danger)}',
	sel(BTN_CLASSES.filter(function(c) { return /primary|save/.test(c); })) +
		'{background:var(--qm-accent);border-color:var(--qm-accent);color:var(--qm-on-accent)}',
	/* 等宽输出块 */
	sel(MONO_CLASSES) + '{font-family:var(--qm-font-mono);font-size:12px;line-height:1.55;',
	'white-space:pre-wrap;word-break:break-all;background:var(--qm-surface-2);color:var(--qm-text);',
	'border:1px solid var(--qm-border-soft);border-radius:var(--qm-radius-sm);padding:10px 12px}',

	/* Hero：统一渐变（跟随主题主色），文字强制反色，保证任何主题下可读。
	 * 渐变文字（-webkit-background-clip:text）一并还原为纯色，避免暗底暗字。 */
	sel(HERO_CLASSES) + '{background:var(--qm-hero-gradient)!important;color:var(--qm-on-hero)!important;',
	'border:0;border-radius:18px;box-shadow:var(--qm-shadow-md)}',
	selDesc(HERO_CLASSES, ' *') + '{color:var(--qm-on-hero)!important;',
	'border-color:rgba(255,255,255,.28)!important;-webkit-text-fill-color:var(--qm-on-hero)!important}',
	selDesc(HERO_CLASSES.concat(HERO_INNER_CLASSES), ' svg') + '{stroke:var(--qm-on-hero)!important}',
	selDesc(HERO_CLASSES, ' [class*="badge"]') + ',' + selDesc(HERO_CLASSES, ' [class*="-dot"]') +
		'{background:rgba(255,255,255,.18)!important}',
	/* Hero 内的白底按钮/温度卡必须使用深色字，不能继承白色强制规则。 */
	selDesc(HERO_CLASSES, ' button') + ',' + selDesc(HERO_CLASSES, ' a.btn') +
		'{background:var(--qm-surface)!important;color:var(--qm-text)!important;-webkit-text-fill-color:var(--qm-text)!important}',
	selDesc(HERO_CLASSES, ' button *') + ',' + selDesc(HERO_CLASSES, ' a.btn *') +
		'{color:var(--qm-text)!important;-webkit-text-fill-color:var(--qm-text)!important}',
	selDesc(HERO_CLASSES, ' button svg') + ',' + selDesc(HERO_CLASSES, ' a.btn svg') +
		'{stroke:var(--qm-text)!important}',
	'.qm-app .mt-system-hero .mt-system-temp-box{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.28);box-shadow:none}',
	'.qm-app .qm-hero-op,.qm-app .qm-hero .qm-pill-tag,.qm-app .mtconn-hero .mtconn-state',
	'{background:rgba(255,255,255,.16)!important;border-color:rgba(255,255,255,.28)!important}',

	/* 进度条 / 条形图轨道 */
	'.qm-app .qm-mini-bar,.qm-app .mt-sbar-track,.qm-app .mt-sbar{background:var(--qm-surface-3);border-radius:999px;overflow:hidden}',
	'.qm-app .mt-sbar-fill{background:var(--qm-accent)}',
	'.qm-app .qm-mini-item{display:flex;flex-direction:column;gap:4px}',

	/* 表单（LuCI cbi）：输入控件跟随主题，宽屏保持 LuCI 默认布局 */
	'.qm-app .cbi-input-text,.qm-app .cbi-input-select,.qm-app .cbi-input-textarea,',
	'.qm-app input[type="text"],.qm-app input[type="password"],.qm-app select,.qm-app textarea',
	'{background:var(--qm-surface);color:var(--qm-text);border:1px solid var(--qm-border);',
	'border-radius:var(--qm-radius-xs);padding:6px 9px;max-width:100%;min-width:0;box-sizing:border-box}',
	'.qm-app .mt-control-row{grid-template-columns:minmax(0,120px) minmax(0,1fr)}',
	'.qm-app .mt-control-row>*,.qm-app .cbi-value>*,.qm-app .cbi-value-field>*,.qm-app .mt-sms-compose-row>*{min-width:0;max-width:100%}',
	'.qm-app .mtconn-config-card .cbi-value,.qm-app .mt-diag-card .cbi-value{grid-template-columns:minmax(0,160px) minmax(0,1fr);gap:12px}',
	'.qm-app .mtconn-config-card .cbi-value-title,.qm-app .mt-diag-card .cbi-value-title{float:none;width:auto;padding:0;text-align:left}',
	'.qm-app .mtconn-config-card .cbi-value-field,.qm-app .mt-diag-card .cbi-value-field{margin:0;padding:0;min-width:0;width:100%}',
	'.qm-app .mtconn-address-grid{grid-template-columns:1fr}',
	'.qm-app .mtconn-inbound-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px;padding-top:14px}',
	'.qm-app .qm-ip-val,.qm-app .mtconn-kv-val,.qm-app .mt-system-row strong,.qm-app .mt-net-row strong,.qm-app .qm-list-row strong',
	'{min-width:0;overflow-wrap:anywhere;word-break:normal}',
	'.qm-app .qm-list-row>span:first-child,.qm-app .mt-net-row>span:first-child,.qm-app .mt-system-row>span:first-child{flex:0 1 45%;min-width:0}',
	'.qm-app .mt-hardware-head h2{background:none;-webkit-text-fill-color:currentColor;color:var(--qm-text)}',
	'.qm-app .cbi-button:focus,.qm-app .btn:focus{outline:2px solid var(--qm-accent);outline-offset:2px}',
	/* 分区标题（设置/高级/网络等表单页） */
	'.qm-app .mt-control-section{margin-top:18px}',
	'.qm-app .mt-control-section-head h3{font-size:16px;font-weight:750}',
	'.qm-app .mt-control-note{background:var(--qm-warn-soft);border:1px solid var(--qm-warn-border);',
	'color:var(--qm-warn);border-radius:var(--qm-radius-xs);padding:10px 12px;font-size:11.5px;line-height:1.5}',
	'.qm-app .mt-modem-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
	'background:var(--qm-surface);border:1px solid var(--qm-border);border-radius:var(--qm-radius-sm);padding:10px 14px}',

	/* SVG 内联颜色统一令牌化：CSS 属性选择器按原色值命中，
	 * presentation attribute 优先级低于 CSS，因此可直接覆盖（无需改 JS 里的 SVG 字符串） */
	'.qm-app [stroke="#0072f5"],.qm-app [stroke="#2563eb"],.qm-app [stroke="#1264d8"],',
	'.qm-app [stroke="#176bc1"],.qm-app [stroke="#1a85ff"],.qm-app [stroke="#1d4ed8"],',
	'.qm-app [stroke="#087eae"],.qm-app [stroke="#07988e"]{stroke:var(--qm-accent)}',
	'.qm-app [fill="#0072f5"],.qm-app [fill="#2563eb"],.qm-app [fill="#1264d8"],',
	'.qm-app [fill="#1d4ed8"],.qm-app [fill="#07988e"]{fill:var(--qm-accent)}',
	'.qm-app [stop-color="#0072f5"],.qm-app [stop-color="#2563eb"]{stop-color:var(--qm-accent)}',
	'.qm-app [stroke="#60a5fa"],.qm-app [stroke="#38bdf8"],.qm-app [stroke="#bfdbfe"]{stroke:var(--qm-accent-2)}',
	'.qm-app [fill="#60a5fa"],.qm-app [fill="#38bdf8"]{fill:var(--qm-accent-2)}',
	'.qm-app [stroke="#10b981"],.qm-app [stroke="#059669"]{stroke:var(--qm-ok)}',
	'.qm-app [fill="#10b981"],.qm-app [fill="#059669"]{fill:var(--qm-ok)}',
	'.qm-app [stop-color="#10b981"]{stop-color:var(--qm-ok)}',
	'.qm-app [stop-color="#f59e0b"]{stop-color:var(--qm-warn)}',
	'.qm-app [stop-color="#ef4444"]{stop-color:var(--qm-danger)}',
	'.qm-app [stop-color="#94a3b8"],.qm-app [stop-color="#64748b"]{stop-color:var(--qm-text-muted)}',
	'.qm-app [stop-color="#0ea5e9"]{stop-color:var(--qm-accent-2)}',
	'.qm-app [stroke="#f59e0b"]{stroke:var(--qm-warn)}.qm-app [fill="#f59e0b"]{fill:var(--qm-warn)}',
	'.qm-app [stroke="#ef4444"],.qm-app [stroke="#dc2626"],.qm-app [stroke="#b91c1c"]{stroke:var(--qm-danger)}',
	'.qm-app [fill="#ef4444"],.qm-app [fill="#dc2626"],.qm-app [fill="#b91c1c"]{fill:var(--qm-danger)}',
	'.qm-app [stroke="#0f172a"],.qm-app [stroke="#1e293b"],.qm-app [stroke="#334155"]{stroke:var(--qm-text)}',
	'.qm-app [fill="#0f172a"],.qm-app [fill="#1e293b"],.qm-app [fill="#334155"],',
	'.qm-app [fill="#475569"]{fill:var(--qm-text)}',
	'.qm-app [stroke="#64748b"],.qm-app [stroke="#94a3b8"],.qm-app [stroke="#cbd5e1"]{stroke:var(--qm-text-muted)}',
	'.qm-app [fill="#64748b"],.qm-app [fill="#94a3b8"]{fill:var(--qm-text-muted)}',
	'.qm-app [stroke="#e2e8f0"],.qm-app [stroke="#cbd5e1"],.qm-app [stroke="#226"],',
	'.qm-app [stroke="rgba(226,232,240,0.8)"]{stroke:var(--qm-border)}',
	'.qm-app [fill="#f1f5f9"],.qm-app [fill="#f8fafc"],.qm-app [fill="#e2e8f0"]{fill:var(--qm-surface-2)}',
	'.qm-app [fill="#fff"],.qm-app [fill="#ffffff"]{fill:var(--qm-surface)}'
].join('');

/* ------------------------------------------------------------------ */
/* 5) 响应式                                                            */
/* ------------------------------------------------------------------ */

var CSS_RESPONSIVE = [
	/* ≥1280：宽屏给更密的栅格 */
	'@media (min-width:1280px){.qm-app{--qm-gap:18px}}',

	/* ≤1024：卡片最小宽度下调，Hero 收紧 */
	'@media (max-width:1024px){',
	'.qm-app{--qm-gap:14px}',
	sel(GRID_CLASSES) + '{grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}',
	sel(HERO_CLASSES) + '{padding:18px 20px;border-radius:16px}',
	'.qm-app .qm-shell,' + sel(['mt-ui-page', 'mtconn-page', 'mt-diag-page']) + '{padding-bottom:18px}',
	'}',

	/* ≤820：平板/竖屏 —— 卡片单列或双列、表单堆叠、表格可横滑 */
	'@media (max-width:820px){',
	'.qm-app{--qm-gap:12px;--qm-radius:12px}',
	'.qm-app .qm-grid,.qm-app .qm-grid-2,.qm-app .qm-grid-3,' + sel(GRID_CLASSES) +
		'{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}',
	sel(HERO_CLASSES) + '{flex-direction:column;align-items:flex-start;gap:14px;padding:18px}',
	selDesc(HERO_CLASSES, ' [class*="actions"]') + '{width:100%;flex-wrap:wrap}',
	sel(CARD_CLASSES) + '{padding:14px 15px}',
	'.qm-app .mt-control-grid,.qm-app .mt-system-grid,.qm-app .mt-net-grid,',
	'.qm-app .mt-hardware-bands,.qm-app .mt-system-thermal-form{grid-template-columns:1fr}',
	/* 4 列指标条 → 2 列 */
	'.qm-app .mt-net-metrics,.qm-app .mtconn-facts{grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}',
	/* SMS 双栏（联系人 + 会话）改为单栏堆叠 */
	'.qm-app .mt-sms-shell{grid-template-columns:1fr;min-height:0}',
	'.qm-app .mt-sms-sidebar{max-height:240px;overflow:auto}',
	/* 表单行：标题与控件上下堆叠（含视图内自定义的两列表单行） */
	'.qm-app .mt-control-row,.qm-app .mt-sms-settings-row{grid-template-columns:1fr;gap:6px}',
	'.qm-app .mtconn-config-card .cbi-value,.qm-app .mt-diag-card .cbi-value{grid-template-columns:1fr;gap:6px}',
	'.qm-app .mtconn-config-card .cbi-input-text,.qm-app .mtconn-config-card select,',
	'.qm-app .mt-diag-card .cbi-input-text,.qm-app .mt-diag-card select{max-width:100%}',
	/* LuCI cbi 表单：标题与控件由左右分栏改为上下堆叠 */
	'.qm-app .cbi-value{display:block;width:100%}',
	'.qm-app .cbi-value-title,.qm-app .cbi-value-field{display:block;width:100%;float:none;padding:0 0 6px}',
	'.qm-app .cbi-section-table-row,.qm-app .cbi-section-table-cell{display:block}',
	'.qm-app .cbi-input-text,.qm-app .cbi-input-select,.qm-app select,.qm-app textarea,',
	'.qm-app input[type="text"],.qm-app input[type="password"]{width:100%;min-height:38px}',
	'.qm-app .btn,.qm-app .cbi-button{min-height:38px}',
	'.qm-app table{display:block;width:100%;overflow-x:auto}',
	'.qm-hide-sm{display:none}.qm-only-sm{display:initial}',
	'}',

	/* ≤560：手机 —— 全部单列，触摸优先 */
	'@media (max-width:560px){',
	'.qm-app{--qm-gap:10px;--qm-radius:12px;--qm-maxw:100%}',
	'.qm-app .qm-grid,.qm-app .qm-grid-2,.qm-app .qm-grid-3,' + sel(GRID_CLASSES) + '{grid-template-columns:1fr}',
	sel(CARD_CLASSES) + '{padding:13px 14px;border-radius:12px}',
	'.qm-app .qm-card-head,' + sel(ROW_CLASSES) + '{gap:8px}',
	sel(HERO_CLASSES) + '{padding:16px;border-radius:14px}',
	'.qm-app .qm-stat-val{font-size:18px}',
	'.qm-app .qm-btn,' + sel(BTN_CLASSES) + '{width:100%;min-height:42px}',
	'.qm-app .qm-scroll{max-height:280px}',
	'.qm-app .mt-sms-shell{grid-template-columns:1fr!important}',
	'.qm-app .mt-sms-sidebar,.qm-app .mt-sms-contacts-scroll{max-height:220px}',
	'.qm-app [class*="-hero"] [class*="-title"]{font-size:18px}',
	'.qm-app .qm-kv-val,' + sel(VAL_CLASSES) + '{text-align:right}',
	'}',

	/* 无障碍：尊重"减少动态效果" */
	'@media (prefers-reduced-motion:reduce){.qm-app *{animation-duration:.001ms!important;',
	'animation-iteration-count:1!important;transition-duration:.001ms!important}',
	'.qm-app .qm-topology-link::before,.qm-app .qm-topology-link::after{animation:none!important}}'
].join('');

var QM_CSS = [ CSS_TOKENS, CSS_PALETTES, CSS_BASE, CSS_COMPONENTS, CSS_LEGACY, CSS_APPEARANCE, CSS_RESPONSIVE ].join('\n');

/* ------------------------------------------------------------------ */
/* 6) 运行时：注入 + 明暗探测                                            */
/* ------------------------------------------------------------------ */

var STYLE_ID = 'qm-ui-theme';
var APPEARANCE_KEY = 'qmodem-generic-appearance';
var appearanceCache = null;

function normalizeAppearance(value) {
	value = value && typeof value === 'object' ? value : {};
	function hex(v, fallback) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback; }
	return {
		palette: PALETTES.some(function(p) { return p.id === value.palette; }) ? value.palette : 'ocean',
		tone: [ 'auto', 'light', 'dark' ].indexOf(value.tone) !== -1 ? value.tone : 'auto',
		customStart: hex(value.customStart, '#0755a8'),
		customEnd: hex(value.customEnd, '#087f70')
	};
}

function getAppearance() {
	if (!appearanceCache) {
		var saved;
		try { saved = JSON.parse(window.localStorage.getItem(APPEARANCE_KEY)); } catch (e) { /* 浏览器禁用存储时使用默认配色 */ }
		appearanceCache = normalizeAppearance(saved);
	}
	return Object.assign({}, appearanceCache);
}

function setAppearance(value) {
	appearanceCache = normalizeAppearance(value);
	var persisted = false;
	try {
		window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearanceCache));
		persisted = true;
	} catch (e) { /* 当前页面仍可立即应用 */ }
	apply();
	return persisted;
}

function injectOnce() {
	if (typeof document === 'undefined' || !document.createElement)
		return;
	if (document.getElementById(STYLE_ID))
		return;
	var style = document.createElement('style');
	style.id = STYLE_ID;
	style.type = 'text/css';
	style.appendChild(document.createTextNode(QM_CSS));
	(document.head || document.documentElement).appendChild(style);
}

/* 解析 rgb()/rgba()/#hex 为亮度（0-1） */
function luminance(value) {
	if (!value)
		return null;
	var str = String(value).trim();
	var m = str.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
	if (m)
		return (0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3]) / 255;
	m = str.match(/^#([0-9a-f]{3})$/i);
	if (m) {
		var h = m[1];
		return (0.299 * parseInt(h[0] + h[0], 16) + 0.587 * parseInt(h[1] + h[1], 16) +
			0.114 * parseInt(h[2] + h[2], 16)) / 255;
	}
	m = str.match(/^#([0-9a-f]{6})$/i);
	if (m) {
		var n = parseInt(m[1], 16);
		return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
	}
	return null;
}

/* 明暗探测：① 主题变量 → ② body 背景计算色 → ③ 系统偏好。
 * 主题自带变量始终优先，探测结果只决定内置 fallback 调色板。 */
function detectTone() {
	var dark = false, decided = false;
	try {
		var root = window.getComputedStyle(document.documentElement);
		var themeVar = (root.getPropertyValue('--background-color-normal') || '') ||
			(root.getPropertyValue('--background-color-high') || '') ||
			(root.getPropertyValue('--background-color') || '');
		var lum = luminance(themeVar);
		if (lum === null) {
			var bodyBg = window.getComputedStyle(document.body).backgroundColor || '';
			lum = luminance(bodyBg);
		}
		if (lum !== null) {
			dark = lum < 0.5;
			decided = true;
		}
	} catch (e) { /* 忽略：取不到就走系统偏好 */ }

	if (!decided && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
		dark = true;

	return dark ? 'dark' : 'light';
}

/* 整体的 try/catch 兜底：极简 DOM 替身（单元测试）或异常环境下一律静默跳过，
 * 绝不让"注入皮肤"这件事本身把页面/测试搞崩。 */
function apply() {
	try {
		if (typeof document === 'undefined' || !document.createElement)
			return null;
		injectOnce();
		var body = document.body || document.documentElement;
		if (body && body.classList) {
			var appearance = getAppearance();
			var tone = appearance.tone === 'auto' ? detectTone() : appearance.tone;
			body.classList.add('qm-app');
			body.classList.remove('qm-light');
			body.classList.remove('qm-dark');
			body.classList.add('qm-' + tone);
			body.setAttribute('data-qm-palette', appearance.palette);
			body.setAttribute('data-qm-tone', appearance.tone);
			if (body.style && body.style.setProperty) {
				body.style.setProperty('--qm-custom-start', appearance.customStart);
				body.style.setProperty('--qm-custom-end', appearance.customEnd);
			}
		}
	} catch (e) { /* 忽略 */ }
	return null;
}

/* 视图内使用：注入样式表（幂等）并返回一个可直接放入节点数组的占位节点 */
function stylesheet() {
	apply();
	return document.createElement('div');
}

/* ------------------------------------------------------------------ */
/* 7) 组件构造helper（新代码可直接用，旧代码不受影响）                    */
/* ------------------------------------------------------------------ */

function el(tag, cls, data, attrs) {
	var node = document.createElement(tag);
	if (cls)
		node.className = cls;
	if (attrs)
		for (var k in attrs)
			node.setAttribute(k, attrs[k]);
	if (data != null) {
		if (data instanceof Array)
			data.forEach(function(x) {
				if (x == null) return;
				node.appendChild(x instanceof Node ? x : document.createTextNode(String(x)));
			});
		else if (data instanceof Node)
			node.appendChild(data);
		else
			node.innerHTML = String(data);
	}
	return node;
}

function card(opts) {
	opts = opts || {};
	var body = [];
	if (opts.title) {
		body.push(el('div', 'qm-card-head', [
			el('div', '', [
				el('div', 'qm-card-title', opts.icon ? [ opts.icon, opts.title ] : opts.title),
				opts.sub ? el('div', 'qm-card-sub', opts.sub) : null
			].filter(Boolean)),
			opts.badge || null
		].filter(Boolean)));
	}
	if (opts.body)
		body = body.concat(opts.body instanceof Array ? opts.body : [ opts.body ]);
	if (opts.foot)
		body.push(el('div', 'qm-card-foot', opts.foot));
	apply();
	return el('section', 'qm-card' + (opts.flat ? ' is-flat' : ''), body);
}

function kv(pairs) {
	return el('div', 'qm-kv', (pairs || []).map(function(p) {
		return el('div', 'qm-kv-row', [
			el('span', 'qm-kv-key', p[0]),
			el('span', 'qm-kv-val', (p[1] == null || p[1] === '') ? '--' : String(p[1]))
		]);
	}));
}

function stat(label, value, sub) {
	return el('div', 'qm-stat', [
		el('span', 'qm-stat-label', label),
		el('strong', 'qm-stat-val', (value == null || value === '') ? '--' : String(value)),
		sub ? el('span', 'qm-stat-sub', sub) : null
	].filter(Boolean));
}

function badge(text, tone) {
	return el('span', 'qm-badge' + (tone ? ' is-' + tone : ''), text);
}

function alertBox(text, tone) {
	return el('div', 'qm-alert' + (tone ? ' is-' + tone : ''), text);
}

function empty(text) {
	return el('div', 'qm-empty', text);
}

function progress(pct, tone) {
	var bar = el('div', 'qm-progress', el('i'));
	bar.firstChild.style.width = Math.max(0, Math.min(100, Number(pct) || 0)) + '%';
	if (tone)
		bar.firstChild.style.background = 'var(--qm-' + tone + ')';
	return bar;
}

/* 文案使用普通文本节点，型号和卡槽值不会拼入 SVG/HTML。 */
function topology(nodes, links) {
	var children = [];
	(nodes || []).forEach(function(node, i) {
		if (i) children.push(el('div', 'qm-topology-link' + (links && links[i - 1] === false ? ' is-idle' : ''), null, { 'aria-hidden': 'true' }));
		children.push(el('div', 'qm-topology-node' + (node.ok ? ' is-ok' : ''), [
			el('span', 'qm-topology-number', [ String(i + 1).padStart(2, '0') ], { 'aria-hidden': 'true' }),
			el('div', 'qm-topology-copy', [
				el('strong', 'qm-topology-title', [ node.title ]),
				el('span', 'qm-topology-sub', [ node.sub ])
			])
		]));
	});
	return el('div', 'qm-topology', children, { 'role': 'group' });
}

/* 模块被 require 时立即注入一次：任何视图只要依赖 controls（本包所有视图都依赖），
 * 皮肤就会先于内容渲染生效，无需逐个视图改写。 */
try {
	if (typeof document !== 'undefined' && document.body)
		apply();
} catch (e) { /* 忽略：非浏览器环境（如 Node 单元测试）不注入 */ }

var API = {
	css: function() { return QM_CSS; },
	apply: apply,
	stylesheet: stylesheet,
	getAppearance: getAppearance,
	setAppearance: setAppearance,
	palettes: function() { return PALETTES.map(function(p) { return Object.assign({}, p); }); },
	topology: topology,
	detectTone: detectTone,
	card: card,
	kv: kv,
	stat: stat,
	badge: badge,
	alert: alertBox,
	empty: empty,
	progress: progress,
	el: el
};

/* 供预览页 / 单元测试直接取 CSS 与 helper：
 * Node 下可 require（本模块自带 baseclass 缺失兜底）；LuCI 内没有 module，不会生效。 */
if (typeof module !== 'undefined' && module.exports)
	module.exports = {
		css: QM_CSS, tokens: CSS_TOKENS, base: CSS_BASE, components: CSS_COMPONENTS,
		legacy: CSS_LEGACY, responsive: CSS_RESPONSIVE, api: API
	};

return (typeof baseclass !== 'undefined' && baseclass && baseclass.extend) ? baseclass.extend(API) : API;
