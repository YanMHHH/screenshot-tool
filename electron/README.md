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
6. 页面结果准备完成后，程序会自动进行全页面滚动拼接截图。
7. 截图和 `任务汇总报告.xlsx` 会写入：

```text
文档\\镜核任务\\任务_时间戳\\企业名称\\信用中国_严重失信主体名单_时间戳.png
```

8. 任务完成后，在任务卡片点击“打开截图目录”。

## 验证码处理

检测到验证码、登录拦截或其他需要用户确认的页面时，任务会暂停并自动显示浏览器。请在页面中手动完成处理，再点击“继续任务”。程序不自动识别或绕过验证码。

## 当前 MVP 边界

- 当前真实适配站点为信用中国“严重失信主体名单”页面。
- Excel 报告真实生成；Electron 模式支持读取 `.xlsx/.xls` 第一张表的第一列作为企业名单，手动输入和 CSV/TXT 也可用。
- 全页面截图通过滚动分段拼接生成 PNG，最大高度限制为 30000 像素。
- 其他政府网站仍使用界面占位和站点清单，尚未接入执行适配器。
