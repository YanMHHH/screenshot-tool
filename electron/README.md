# 镜核 Electron MVP

## 首次安装

在 PowerShell 中执行：

```powershell
cd "D:\Working Projects\Screenshot tool\electron"
npm install
```

如果 Electron 运行时因网络原因未下载，可使用镜像重新执行安装脚本：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

## 启动桌面应用

```powershell
cd "D:\Working Projects\Screenshot tool\electron"
npm run dev
```

应用会打开真正的 Windows 桌面窗口，不需要浏览器访问 `index.html`。

## 首个真实查询流程

1. 点击“新建核查任务”。
2. 输入一家企业名称，例如：`中招工业发展（北京）有限公司`。
3. 选择“信用中国 · 严重失信主体名单”。
4. 选择“可视化执行”，点击“开始执行”。
5. Electron 会打开信用中国页面，填写名称并提交查询。
6. 程序以系统 Edge/Chrome 的原生会话加载目标站，通过安全检查后再自动查询；页面结果准备完成后生成全页面截图。
7. 截图和 `任务汇总报告.xlsx` 会写入：

```text
文档\\镜核任务\\任务_时间戳\\企业名称\\信用中国_严重失信主体名单_时间戳.png
```

8. 任务完成后，在任务卡片点击“打开截图目录”。

## 验证码与反爬处理

- 任务使用独立的系统 Edge/Chrome 会话，先以原生方式加载页面并等待网站的 JS 安全检查完成，再连接 DevTools 协议执行查询和截图；浏览器窗口位于屏幕外，不抢占鼠标或键盘焦点。
- 信用中国的 4 位图形验证码由 `ddddocr` 在本机离线识别。验证码图片必须连续两次取样一致才会送入 OCR，识别或提交失败会刷新验证码并最多重试 5 次。
- 超过重试次数或安全检查无法通过时，该“企业 × 网站”条目会记录为“跳过”，备注失败原因，然后继续后续条目；任务不会等待人工处理。

## 当前 MVP 边界

- 当前真实适配站点为信用中国“严重失信主体名单”页面。
- Excel 报告真实生成；Electron 模式支持读取 `.xlsx/.xls` 第一张表的第一列作为企业名单，手动输入和 CSV/TXT 也可用。
- 全页面截图使用 Chromium DevTools Protocol 的 `Page.captureScreenshot` 一次性捕获页面内容，最大高度限制为 50000 像素，避免滚动分段接缝。
- 其他政府网站仍使用界面占位和站点清单，尚未接入执行适配器。
