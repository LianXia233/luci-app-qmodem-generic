'use strict';
'require baseclass';
'require qmodem-generic/theme as theme';
/* global L, AtTheme */
/**
 * at-webserver/tabmenu.js —— LuCI Tab 菜单增强（SVG 图标 + 滚动位置保持）
 *
 * 背景：
 *   LuCI 的 Tab 菜单（admin/modem/5g 下 12 个兄弟页面）由主题的 menu-*.js
 *   在页面加载后异步渲染：主题头部模板只放一个空的 #tabmenu 容器，
 *   ui.menu.load() 解析完菜单树后才生成 ul.tabs > li.tabmenu-item-<name>。
 *   原生渲染有两个体验问题：
 *     1) 横向可滚动的主题（如 argon 的 .tabs overflow-x:auto）在每次整页
 *        跳转后 scrollLeft 归零，选中项（如「运行日志」「服务配置」）被滚出
 *        可视区，用户要重新滑到底部找当前页；返回 / 刷新同样重置到首项。
 *     2) Tab 项只有文字没有图标，12 个页面扫读成本高。
 *
 * 做法（不改 LuCI 与主题本身，仅在本插件页面加载后增强 DOM）：
 *   - 等 #tabmenu 渲染完成（轮询 + MutationObserver，主题无关）；
 *   - 按 li.tabmenu-item-<name> 匹配统一风格的 24×24 线性 SVG 图标
 *     （stroke=currentColor，自动继承主题 tab 文字配色，桌面/移动端自适应）；
 *   - 把当前选中项水平滚入可视区：仅操作 Tab 条自身的 scrollLeft，
 *     不动窗口滚动，避免刷新时页面被顶回顶部；
 *   - 用 sessionStorage 记住每个路径下用户手动滚动的位置：返回 / 刷新时
 *     若选中项仍完整可见则恢复该偏移，否则回退为「选中项居中」。
 *
 * 兼容性：
 *   - 只识别 li[class*="tabmenu-item-"]（bootstrap / material / argon /
 *     openwrt-2020 一致）；footstrap 等无 Tab 栏的主题自动跳过；
 *   - 仅当路径含 /admin/modem/ 时启用，不影响其他 LuCI 页面；
 *   - 纯增强：不拦截点击、不改 href、不删节点，原有路由与功能零改动。
 */

var AtTabmenu = (function () {
	var api = {};

	/* ================= 图标库（统一 24×24 线性风格） =================
	 * 每个条目是一组 SVG 图元描述；buildIconEl() 统一附加
	 * stroke=currentColor / stroke-width=1.8 / round 线帽线角，
	 * 颜色随主题 tab 文字色变化，激活态由 CSS 提亮。
	 * 键名与 menu.d 中 admin/modem/5g 下的页签名一一对应。
	 * ================================================================= */

	var TAB_ICONS = {
		/* QModem Generic Tab mappings */
		connection: [
			{ tag: 'path', d: 'M9 2v6M15 2v6' },
			{ tag: 'path', d: 'M6 8h12v3a6 6 0 0 1-12 0V8Z' },
			{ tag: 'path', d: 'M12 17v5' }
		],
		network: [
			{ tag: 'path', d: 'M19.07 4.93a10 10 0 1 0-14.14 14.14' },
			{ tag: 'path', d: 'M16.24 7.76a6 6 0 1 0-8.48 8.48' },
			{ tag: 'path', d: 'M12 12 18.5 7.5' },
			{ tag: 'circle', cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }
		],
		system: [
			{ tag: 'rect', x: 5, y: 5, width: 14, height: 14, rx: 2 },
			{ tag: 'rect', x: 9, y: 9, width: 6, height: 6, rx: 1 },
			{ tag: 'path', d: 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3' }
		],
		advanced: [
			{ tag: 'circle', cx: 12, cy: 12, r: 9 },
			{ tag: 'path', d: 'M12 16V8' },
			{ tag: 'path', d: 'm8 12 4-4 4 4' }
		],

		/* 网络状态：实时脉冲 */
		status: [
			{ tag: 'path', d: 'M22 12h-4l-3 8-4-16-3 8H2' }
		],
		/* 网络设置：滑杆 */
		settings: [
			{ tag: 'path', d: 'M3 4h4M11 4h10' },
			{ tag: 'path', d: 'M3 12h10M17 12h4' },
			{ tag: 'path', d: 'M3 20h8M15 20h6' },
			{ tag: 'circle', cx: 9, cy: 4, r: 2 },
			{ tag: 'circle', cx: 15, cy: 12, r: 2 },
			{ tag: 'circle', cx: 13, cy: 20, r: 2 }
		],
		/* 拨号设置：插头（建立数据链路） */
		dial: [
			{ tag: 'path', d: 'M9 2v6M15 2v6' },
			{ tag: 'path', d: 'M6 8h12v3a6 6 0 0 1-12 0V8Z' },
			{ tag: 'path', d: 'M12 17v5' }
		],
		/* 全网扫频：雷达 */
		scan: [
			{ tag: 'path', d: 'M19.07 4.93a10 10 0 1 0-14.14 14.14' },
			{ tag: 'path', d: 'M16.24 7.76a6 6 0 1 0-8.48 8.48' },
			{ tag: 'path', d: 'M12 12 18.5 7.5' },
			{ tag: 'circle', cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }
		],
		/* 定时锁频：时钟 */
		schedule: [
			{ tag: 'circle', cx: 12, cy: 12, r: 9 },
			{ tag: 'path', d: 'M12 7v5l3 2' }
		],
		/* 模组设置：芯片 */
		'modem-settings': [
			{ tag: 'rect', x: 5, y: 5, width: 14, height: 14, rx: 2 },
			{ tag: 'rect', x: 9, y: 9, width: 6, height: 6, rx: 1 },
			{ tag: 'path', d: 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3' }
		],
		/* 模组升级：圆内向上箭头 */
		upgrade: [
			{ tag: 'circle', cx: 12, cy: 12, r: 9 },
			{ tag: 'path', d: 'M12 16V8' },
			{ tag: 'path', d: 'm8 12 4-4 4 4' }
		],
		/* 短信中心：消息气泡 */
		sms: [
			{ tag: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }
		],
		/* 短信设置：消息气泡 + 省略号 */
		'sms-settings': [
			{ tag: 'path', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
			{ tag: 'circle', cx: 8.5, cy: 10, r: 1, fill: 'currentColor', stroke: 'none' },
			{ tag: 'circle', cx: 12, cy: 10, r: 1, fill: 'currentColor', stroke: 'none' },
			{ tag: 'circle', cx: 15.5, cy: 10, r: 1, fill: 'currentColor', stroke: 'none' }
		],
		/* AT 调试终端：命令行提示符 */
		terminal: [
			{ tag: 'path', d: 'm4 17 6-6-6-6' },
			{ tag: 'path', d: 'M12 19h8' }
		],
		/* 运行日志：文件文本 */
		logs: [
			{ tag: 'path', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' },
			{ tag: 'path', d: 'M14 2v6h6' },
			{ tag: 'path', d: 'M8 13h8M8 17h5' }
		],
		/* 服务配置：齿轮 */
		config: [
			{ tag: 'path', d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
			{ tag: 'circle', cx: 12, cy: 12, r: 3 }
		],
		/* 未知页签兜底：同心圆 + 中心点 */
		_fallback: [
			{ tag: 'circle', cx: 12, cy: 12, r: 8.5 },
			{ tag: 'circle', cx: 12, cy: 12, r: 2, fill: 'currentColor', stroke: 'none' }
		]
	};

	api.icons = TAB_ICONS;

	/* ================= 纯函数（可单测） ================= */

	// 从 li 的 class 提取页签名：'tabmenu-item-modem-settings active' → 'modem-settings'
	function tabKeyFromClass(cls) {
		var m = /(?:^|\s)tabmenu-item-([A-Za-z0-9_-]+)/.exec(String(cls || ''));
		return m ? m[1] : null;
	}
	api.tabKeyFromClass = tabKeyFromClass;

	// 按位移增量夹取到合法滚动范围 [0, max]（max 已保证非负）
	function clampScrollLeft(base, delta, max) {
		var m = Math.max(0, max || 0);
		return Math.round(Math.max(0, Math.min(base + delta, m)));
	}
	api.clampScrollLeft = clampScrollLeft;

	/* ================= 小工具 ================= */

	function debounce(fn, ms) {
		var t = null;
		return function () {
			if (t) clearTimeout(t);
			t = setTimeout(fn, ms);
		};
	}

	function svgEl(tag, attrs) {
		var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
		for (var k in attrs) el.setAttribute(k, String(attrs[k]));
		return el;
	}

	// 生成图标包裹层：span.at-tabmenu-icon > svg
	function buildIconEl(key) {
		var parts = TAB_ICONS[key] || TAB_ICONS._fallback;
		var svg = svgEl('svg', {
			viewBox: '0 0 24 24',
			width: 16,
			height: 16,
			fill: 'none',
			stroke: 'currentColor',
			'stroke-width': 1.8,
			'stroke-linecap': 'round',
			'stroke-linejoin': 'round',
			'aria-hidden': 'true',
			focusable: 'false'
		});
		for (var i = 0; i < parts.length; i++) {
			var p = parts[i];
			var el = svgEl(p.tag, {});
			for (var k in p) {
				if (k !== 'tag') el.setAttribute(k, String(p[k]));
			}
			svg.appendChild(el);
		}
		var wrap = document.createElement('span');
		wrap.className = 'at-tabmenu-icon';
		wrap.setAttribute('aria-hidden', 'true');
		wrap.appendChild(svg);
		return wrap;
	}
	api.buildIconEl = buildIconEl;

	/* ================= 菜单定位（主题无关） ================= */

	// bootstrap / material / argon / openwrt-2020 均为 #tabmenu > ul.(tabs|cbi-tabmenu)；
	// 直接认容器，可同时覆盖主题递归渲染的多级页签。
	function findTabContainer() {
		var container = document.getElementById('tabmenu');
		if (!container) return null;
		return container.querySelector('li[class*="tabmenu-item-"]') ? container : null;
	}

	// 选中项识别：类名（active / cbi-tab）优先，href 与当前路径一致兜底
	function isActiveLi(li, a) {
		var cls = ' ' + (li.className || '') + ' ';
		if (/(^|\s)active(\s|$)/.test(cls) || /(^|\s)cbi-tab(\s|$)/.test(cls)) return true;
		try {
			var href = a.getAttribute('href') || '';
			if (href && href.charAt(0) !== '#') {
				var probe = document.createElement('a');
				probe.href = href;
				return probe.pathname === location.pathname;
			}
		} catch (e) { /* 跨环境降级：仅类名判定 */ }
		return false;
	}

	/* ================= 滚动位置保持 ================= */

	// 从 item 向上找可横向滚动的祖先（只认 auto/scroll，即主题声明的可滚动条）
	function scrollAncestors(item) {
		var out = [];
		var node = item.parentNode;
		while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
			var cs = (typeof window.getComputedStyle === 'function') ? window.getComputedStyle(node) : null;
			if (cs) {
				var ox = cs.overflowX;
				if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 1) {
					out.push(node);
				}
			}
			node = node.parentNode;
		}
		return out; // 由内向外
	}

	function isFullyVisible(item, sc) {
		var ir = item.getBoundingClientRect();
		var sr = sc.getBoundingClientRect();
		return ir.left >= sr.left - 1 && ir.right <= sr.right + 1;
	}

	// 让 item 水平居中于 sc 可视区（仅改 scrollLeft，不碰窗口滚动）
	function centerHorizontally(item, sc) {
		var ir = item.getBoundingClientRect();
		var sr = sc.getBoundingClientRect();
		var delta = (ir.left + ir.width / 2) - (sr.left + sr.width / 2);
		var max = Math.max(0, sc.scrollWidth - sc.clientWidth);
		sc.scrollLeft = clampScrollLeft(sc.scrollLeft, delta, max);
	}

	function centerInView(item) {
		var scrollers = scrollAncestors(item);
		for (var i = 0; i < scrollers.length; i++) {
			centerHorizontally(item, scrollers[i]);
		}
	}

	var STORAGE_PREFIX = 'at-tabmenu-scroll:';

	function storageKey() {
		return STORAGE_PREFIX + location.pathname;
	}

	function readSavedOffset() {
		try {
			var v = window.sessionStorage.getItem(storageKey());
			if (v == null || v === '') return null;
			var n = parseInt(v, 10);
			return (isNaN(n) || n < 0) ? null : n;
		} catch (e) { return null; }
	}

	function saveCurrentOffset() {
		if (!currentItem) return;
		var scrollers = scrollAncestors(currentItem);
		if (!scrollers.length) return;
		try {
			window.sessionStorage.setItem(storageKey(), String(Math.round(scrollers[0].scrollLeft)));
		} catch (e) { /* 隐私模式等场景下静默失败 */ }
	}

	// 恢复策略：优先上次手动滚动偏移（选中项仍完整可见时），否则选中项居中
	function applyScroll(item) {
		var scrollers = scrollAncestors(item);
		if (!scrollers.length) return; // 换行布局（bootstrap/material）无需滚动
		var sc = scrollers[0];
		var saved = readSavedOffset();
		var restored = false;
		if (saved != null) {
			var prev = sc.scrollLeft;
			sc.scrollLeft = saved;
			restored = isFullyVisible(item, sc);
			if (!restored) sc.scrollLeft = prev;
		}
		if (!restored) centerInView(item);
	}

	/* ================= 主题 Tab 栏可读性兜底（issue #26） =================
	 * 部分主题（如 Argon 2.x）暗色模式下未选中 Tab 文字仍是写死的深灰，
	 * 叠在暗色页面上对比度极低，顶部选择栏几乎不可见。
	 * 这里实测首个未选中 Tab 文字与所在背景的对比度，不足时给 #tabmenu
	 * 容器加 .at-tabmenu-fix（样式见 mt5700.css 末尾），把文字提亮；
	 * 主题自身明暗适配正常时对比度达标，零改动。图标用 currentColor 自动跟随。
	 */

	// 从 el 向上找第一个不透明背景（含全透明层穿透），全透明时回落白色
	function effectiveBackColor(el, win, themeUtil) {
		var node = el;
		while (node && node.nodeType === 1 && node !== document.documentElement) {
			try {
				var bg = themeUtil.parseColor(win.getComputedStyle(node).backgroundColor);
				if (bg && bg.a > 0) return bg;
			} catch (e) { break; }
			node = node.parentNode;
		}
		return { r: 255, g: 255, b: 255, a: 1 };
	}

	// 首个未选中 Tab 的 <a>（与 isActiveLi 同一判定口径）
	function firstInactiveLink(container) {
		var items = container.querySelectorAll('li[class*="tabmenu-item-"]');
		for (var i = 0; i < items.length; i++) {
			var a = items[i].querySelector('a');
			if (a && !isActiveLi(items[i], a)) return a;
		}
		return null;
	}

	// 对比度不足（< 3:1，WCAG 大字号下限）→ 需要 Tab 文字提亮
	function tabNeedsFix(link, win, themeUtil) {
		if (!link || !win || typeof win.getComputedStyle !== 'function') return false;
		try {
			var fg = themeUtil.parseColor(win.getComputedStyle(link).color);
			if (!fg) return false;
			return themeUtil.contrastRatio(fg, effectiveBackColor(link, win, themeUtil)) < 3;
		} catch (e) { return false; }
	}
	api.effectiveBackColor = effectiveBackColor;
	api.firstInactiveLink = firstInactiveLink;
	api.tabNeedsFix = tabNeedsFix;

	var contrastFixBound = false;

	function checkTabContrast() {
		var container = document.getElementById('tabmenu');
		if (!container) return;
		// 先摘掉兜底类再测量：修复本身会提亮文字，带着类复测会把「已修复」
		// 误判成「主题本来就好」，导致类被反复摘除（反馈回路）。
		var hadFix = false;
		try { hadFix = container.classList.contains('at-tabmenu-fix'); } catch (e) { }
		if (hadFix) {
			try { container.classList.remove('at-tabmenu-fix'); } catch (e) { }
		}
		var link = firstInactiveLink(container);
		var themeUtil = (typeof window !== 'undefined' && window.AtTheme) ? window.AtTheme : null;
		if (!themeUtil) return;
		var fix = tabNeedsFix(link, window, themeUtil);
		try { container.classList.toggle('at-tabmenu-fix', fix); } catch (e) { /* ignore */ }
	}

	function bindContrastWatch() {
		if (contrastFixBound) return;
		contrastFixBound = true;
		// 首检放在布局稳定后（菜单由主题异步渲染，样式计算需等一帧）
		setTimeout(checkTabContrast, 0);
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(checkTabContrast);
		}
		// 主题运行时切换（Aurora 顶部按钮等）后复查
		if (typeof window !== 'undefined' && window.AtTheme && window.AtTheme.onChange) {
			window.AtTheme.onChange(function () { setTimeout(checkTabContrast, 60); });
		}
	}
	api.checkTabContrast = checkTabContrast;

	/* ================= 增强主流程 ================= */

	var currentItem = null;
	var pollStarted = false;
	var eventsBound = false;

	function enhance() {
		var container = findTabContainer();
		if (!container) return false;

		var items = container.querySelectorAll('li[class*="tabmenu-item-"]');
		if (!items.length) return false;

		var activeLi = null;
		for (var i = 0; i < items.length; i++) {
			var li = items[i];
			var a = li.querySelector('a');
			if (!a) continue;
			if (!a.querySelector('.at-tabmenu-icon')) {
				a.insertBefore(buildIconEl(tabKeyFromClass(li.className)), a.firstChild);
			}
			if (!activeLi && isActiveLi(li, a)) activeLi = li;
		}

		currentItem = activeLi;
		if (activeLi) applyScroll(activeLi);
		return true;
	}
	api.enhance = enhance;

	function bindEvents() {
		if (eventsBound) return;
		eventsBound = true;

		// 主题 Tab 栏对比度兜底检测（暗色主题下未选中项可能深底深字）
		bindContrastWatch();

		// 视口变化 / 字体加载后 tab 宽度可能变化，重新校正选中项位置
		var reapply = debounce(function () {
			if (currentItem) applyScroll(currentItem);
		}, 150);

		window.addEventListener('resize', reapply);
		window.addEventListener('orientationchange', reapply);

		if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
			document.fonts.ready.then(reapply)['catch'](function () {});
		}

		// 记住手动滚动的位置：点击 Tab / 离开页面前保存当前偏移
		document.addEventListener('click', function (ev) {
			var t = ev.target;
			if (!t || typeof t.closest !== 'function') return;
			if (t.closest('#tabmenu a')) saveCurrentOffset();
		}, true);

		window.addEventListener('pagehide', saveCurrentOffset);
		document.addEventListener('visibilitychange', function () {
			if (document.visibilityState === 'hidden') saveCurrentOffset();
		});
	}

	function isModemPage() {
		try {
			return /(^|\/)admin\/modem(\/|$)/.test(location.pathname);
		} catch (e) { return false; }
	}

	function startWatch() {
		if (pollStarted) return;
		pollStarted = true;

		if (enhance()) { bindEvents(); return; }

		// 菜单异步渲染：轮询等待（主题的 menu-*.js 在 ui.menu.load() 后才建 DOM）
		var deadline = Date.now() + 10000;
		(function poll() {
			if (enhance()) { bindEvents(); return; }
			if (Date.now() >= deadline) return;
			setTimeout(poll, 50);
		})();

		// MutationObserver 兜底：菜单渲染瞬间即增强，不等下一轮轮询
		if (typeof MutationObserver === 'function' && document.body) {
			try {
				var mo = new MutationObserver(function () {
					if (enhance()) { mo.disconnect(); bindEvents(); }
				});
				mo.observe(document.body, { childList: true, subtree: true });
			} catch (e) { /* 老引擎降级为纯轮询 */ }
		}
	}

	api.refresh = function () {
		if (currentItem) applyScroll(currentItem);
	};

	api.init = function () {
		if (!isModemPage()) return; // 仅增强本插件页面
		startWatch();
	};

	// 模块求值即启动：此时 DOM 已 ready（LuCI 在 domReady 后 require 视图依赖），
	// 菜单尚未渲染，由轮询 / observer 等待 #tabmenu 出现。
	if (typeof document !== 'undefined') {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', api.init);
		} else {
			api.init();
		}
	}

	return api;
})();

// 导出（遵循本仓库模块约定：L.Class 子类 + window 挂载）
var AtTabmenuClass = L.Class.extend(AtTabmenu);
if (typeof window !== 'undefined') {
	window.AtTabmenu = new AtTabmenuClass();
}
return AtTabmenuClass;
