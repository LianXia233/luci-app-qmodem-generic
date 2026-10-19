# 页面检查与修复（2.5.0-3）

基于本仓库 `a5a2b41` 检查；未改动 QModem 后端、现有插件、UCI 配置和手动构建方式。

| 页面 | 本次修复 |
| --- | --- |
| 概览 | QoS、签约速率等未上报字段隐藏；保留 PCI/SINR 的 0；修正运营商数字 MNC；缺少载波时显示空态 |
| 移动数据 | 地址与 DNS 缺失行隐藏；IPv6 长地址换行；APN 表单容器收缩；拨号状态保留 false/0 |
| 无线与小区 | 频段标签横向换行；缺少信号/小区字段隐藏；只显示上报的拨号模式和网络制式，并遵守禁用特性 |
| 短信 | 修正标题区按钮文字、事件绑定；没有号码时省略号码；优先读取 AT response |
| 模组与 SIM | 读取真实 ICCID；缺失行隐藏；修正 NOT READY 被误判为 READY；MT5700 专有设置按型号展示 |
| 高级 | 修正表单溢出与标题文字；未知能力隐藏；不补造 ECM/NCM、3G/4G/5G；通用 AT 控制台保留 |
| 设备参数 | 接入统一 DOM 工厂；CBI 标题、输入控件与字段容器统一适配 |
| AT 终端 | 接入统一 DOM 工厂；优先显示实际 response，保留默认端口回退 |

共用处理：条件节点递归展开并过滤 null/undefined，使用 LuCI dom.create 绑定事件；原始数据的调试 JSON 保留。空字符串、N/A、unknown、-- 不生成数据行，0 和 false 不作为通用空值处理。温度沿用原先对未上报占位值的归一化。

“恢复出厂设置”原先只执行 AT+CFUN=1 或硬重启，无法保证恢复出厂，现改为型号手册说明和 AT 控制台入口。

验证：147 项前端回归通过；8 页 × 5 种数据场景 × 2 种宽度 × 明暗两种配色，共 160 个 DOM 场景通过；JavaScript/JSON/翻译文件检查通过。DOM 测试不验证浏览器几何布局，未连接真实模组；内嵌浏览器预览被 URL 安全策略拦截，最终布局与模组写操作仍需设备验证。

```sh
node luci-app-qmodem-generic/tests/run-frontend-tests.js
# 本地测试依赖（不属于固件运行时依赖）
npm install --no-save happy-dom
node luci-app-qmodem-generic/tests/run-browser-tests.js --dom
# 安装 Playwright 与 Chromium 后可执行实际浏览器布局检查
node luci-app-qmodem-generic/tests/run-browser-tests.js
```
