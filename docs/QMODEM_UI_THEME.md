# QM UI v2 —— 统一视觉层设计与落地说明

本文件说明 `luci-app-qmodem-generic` 的前端视觉重构（QM UI v2）：一套**只改前端**
（不触碰任何 ubus / rpcd / UCI 数据链路）的视觉层，目标是

1. **兼容任意 LuCI 主题**：bootstrap / argon / material / openwrt-2020 及各类暗色 fork；
2. **自适应明暗**：主题换肤、系统深色模式、老主题（无 CSS 变量）都能正确显示；
3. **响应式**：桌面 / 平板 / 手机三档可用，触摸目标 ≥ 38px，表单与表格不溢出；
4. **一套皮肤接管全部历史页面**：8 个视图的旧私有类名（`mt-*` / `qm-*` / `mtconn-*` …）
   由统一层换肤，不需要逐个页面重写结构。

---

## 1. 架构：三层样式

```
┌──────────────────────────────────────────────────────────────┐
│ 视图内联样式（status.js / network.js / sms.js … 各自的 styleNode）│
│   · 保留私有布局（拓扑图尺寸、会话双栏、图表轨道 …）             │
│   · 颜色已全部令牌化：#0072f5 → var(--qm-accent)               │
├──────────────────────────────────────────────────────────────┤
│ 旧类适配层（theme.js · CSS_LEGACY）                            │
│   · 按语义分组的 250 个历史类名 → 统一卡片/标题/行/按钮皮肤      │
│   · SVG presentation attribute 按颜色值属性选择器覆盖           │
├──────────────────────────────────────────────────────────────┤
│ 设计令牌 + 组件 + 响应式（theme.js · TOKENS/COMPONENTS/…）      │
│   · --qm-* 令牌：优先取主题变量，取不到用内置调色板              │
│   · .qm-card / .qm-stat / .qm-badge / .qm-kv … 标准件          │
│   · 断点 1280 / 1024 / 820 / 560 + reduced-motion              │
└──────────────────────────────────────────────────────────────┘
```

作用域：所有规则挂在 `body.qm-app`（由 `theme.apply()` 在运行时添加）之下，
**不会污染 LuCI 自身的菜单、表头或其它插件**。

---

## 2. 设计令牌（Design Tokens）

每个令牌都写成 `var(<主题变量>, <内置 fallback>)`：主题提供了变量就跟随主题，
没有变量的老主题则使用内置调色板，再由明暗探测在亮/暗两套 fallback 间切换。

| 令牌 | 用途 | 优先取用的主题变量 | 内置 fallback（亮 / 暗） |
| --- | --- | --- | --- |
| `--qm-surface` | 卡片/面板底色 | `--background-color-high` | `#ffffff` / `#161b22` |
| `--qm-surface-2` | 次级底、条纹底 | `--background-color-low` | `#f4f6f9` / `#1d232c` |
| `--qm-surface-3` | 轨道、代码块底 | `--background-color-normal` | `#eaeef3` / `#232a34` |
| `--qm-glass` | 半透明玻璃底 | `color-mix(surface, 90%)` | 半透明 surface |
| `--qm-border` / `-soft` / `-strong` | 描边三级 | `--border-color-medium/low/high` | `#d7dde5` / `#e7ecf2` … |
| `--qm-text` / `-soft` / `-muted` | 正文三级 | `--text-color-high/medium/low` | `#16202c` / `#3d4756` / `#6b7684` |
| `--qm-accent` | 强调、链接、主按钮 | `--primary-color` → `--link-color` | `#0072f5` |
| `--qm-ok` / `--qm-warn` / `--qm-danger` | 状态三色 | `--success/warning/error-color` | `#10b981` / `#f59e0b` / `#ef4444` |
| `--qm-*-soft` / `-border` | 状态底色与描边 | `color-mix` 派生 | 低饱和半透明 |
| `--qm-accent-gradient` / `--qm-hero-gradient` | 主按钮渐变 / Hero 渐变 | `color-mix` 派生 | 蓝→深蓝、深蓝→主色 |
| `--qm-shadow` / `-md` / `-lg` | 三级投影 | — | 基于 `--qm-shadow-color` |
| `--qm-on-hero` / `--qm-on-accent` | Hero/主按钮上的文字 | — | `#ffffff` |

**color-mix 增强**：浏览器支持 `color-mix()` 时，所有半透明底色、描边、渐变都从主题的
`--primary-color` 实时派生——用户把 argon 主色改成 `#5e72e4`，本插件的强调色同步变化。

---

## 3. 明暗自适应

`theme.detectTone()` 按以下顺序判定（结果只影响内置 fallback，主题变量始终优先）：

1. 读取主题的 `--background-color-normal` / `-high` / `--background-color`，计算亮度；
2. 主题没有变量 → 读 `body` 的计算背景色亮度；
3. 仍取不到 → 回退 `prefers-color-scheme`。

亮度 < 0.5 判定为暗色，给 `body` 加 `qm-dark`，令牌整体切换到暗色调色板。

---

## 4. 组件标准件（新代码优先使用）

| 类 | 说明 |
| --- | --- |
| `.qm-shell` | 页面容器（最大宽度 + 纵向节奏） |
| `.qm-grid` / `.qm-grid-2` / `.qm-grid-3` | 自适应栅格（`auto-fit` + `minmax`） |
| `.qm-card` / `.qm-card-head` / `-title` / `-sub` / `-foot` | 卡片与卡片头 |
| `.qm-kv` / `.qm-kv-row` / `-key` / `-val` | 键值表（等宽数字、末行去分隔线） |
| `.qm-stat` / `-label` / `-val` / `-sub` | 指标磁贴 |
| `.qm-badge` + `.is-ok/.is-warn/.is-danger/.is-accent` | 状态徽章 |
| `.qm-dot` + `.is-*` | 状态圆点 |
| `.qm-btn` / `-primary` / `-danger` | 按钮（最小高度 36px） |
| `.qm-alert` + `.is-*` | 提示条 |
| `.qm-terminal` / `.qm-mono` / `.qm-scroll` | 终端输出、等宽、滚动区 |
| `.qm-progress` / `.qm-table-wrap` / `.qm-empty` | 进度条、表格横滑、空态 |
| `.qm-hide-sm` / `.qm-only-sm` | 窄屏显隐 |

JS helper（theme 模块导出）：`card()` / `kv()` / `stat()` / `badge()` / `alert()` /
`empty()` / `progress()` / `el()`。

---

## 5. 旧类适配机制

历史视图的类名按语义分组后统一换肤（卡片 / 标题 / 副标题 / 徽章 / 栅格 / 键值行 /
按钮 / 等宽块 / Hero），例如：

```css
.qm-app .qm-glass-card, .qm-app .mt-net-card, .qm-app .mtconn-card, … {
  background: var(--qm-surface);
  border: 1px solid var(--qm-border);
  border-radius: var(--qm-radius);
  box-shadow: var(--qm-shadow);
}
```

**SVG 图标的颜色**：JS 里的 SVG 仍是 `stroke="#0072f5"` 这类硬编码
presentation attribute。CSS 用属性选择器按颜色值覆盖（presentation attribute 优先级
低于任何 CSS 规则），因此无需改动 SVG 字符串：

```css
.qm-app [stroke="#0072f5"] { stroke: var(--qm-accent); }
.qm-app [fill="#10b981"]   { fill: var(--qm-ok); }
```

**Hero 区**：历史 Hero 有的是深色渐变、有的是白色玻璃，文字颜色写死。
统一层把 Hero 背景设为 `var(--qm-hero-gradient)`，并用 `!important` 强制区内文字反色、
还原 `-webkit-background-clip:text` 的渐变标题，保证任何主题下都可读。

---

## 6. 响应式断点

| 断点 | 主要变化 |
| --- | --- |
| ≥ 1280 | 栅格间距放大到 18px，容器最大 1360px |
| ≤ 1024 | 卡片最小宽 260px，Hero 收紧 |
| ≤ 820 | 卡片单/双列；Hero 纵向；cbi 表单标题与控件上下堆叠；按钮/输入 ≥ 38px；表格横滑；SMS 双栏改单栏 |
| ≤ 560 | 全部单列；按钮全宽 42px；SMS 侧栏限高；卡片内边距收紧 |
| `prefers-reduced-motion` | 关闭动画与过渡 |

---

## 7. 使用与验证

**接入**：视图只要 `require qmodem-generic.controls`（本包所有视图都已依赖），
皮肤即在模块加载时注入一次；新视图可用 `theme.stylesheet()` 显式占位。

**验证**：

- `docs` 同级提供预览页 `qmodem-ui-preview.html`（仓库根目录，非安装包内容）：
  在 iframe 内**真实执行 theme.js**，可切换 5 种主题 × 3 种视口，并可开关
  「叠加旧视图内联样式」以验证兼容层。
- 单元测试：`sh tests/run-frontend-tests.sh`（108 项，含 theme 模块注入）。
- 语法校验：`node --check` 覆盖 `theme.js` + `controls.js` + 8 个视图。

---

## 8. 已知限制

- 视图内联样式仍保留各自的布局类（拓扑图、会话双栏、图表轨道），统一层只接管
  皮肤与栅格；后续新页面建议直接改用 §4 的标准件。
- `color-mix()` 派生依赖较新浏览器（Chrome 111+ / Safari 16.4+ / Firefox 113+）；
  更老的浏览器自动回退到内置半透明调色板，视觉略有差异但可用。
- Hero 区为保证可读性使用了 `!important`（覆盖历史 inline style），新增 Hero 时
  建议直接用 `.qm-hero` + 主题令牌，避免再写死颜色。
