# 镜核 MVP

这是一个零依赖的桌面应用界面原型，使用纯 HTML、CSS 和 JavaScript 实现，先验证需求中的核心交互：

- 电脑管家式桌面布局。
- 企业名单手动输入和文本型文件导入。
- 核查项选择。
- 可视化浏览器预览 / 隐藏后台运行切换。
- 任务进度、暂停/继续。
- 任务记录、站点适配和设置页面。
- 模拟任务执行完成提示。

## 运行

在项目根目录执行：

```powershell
cd "D:\Working Projects\Screenshot tool\app"
python -m http.server 5173
```

然后打开：<http://localhost:5173>

也可以直接双击 `index.html`，但使用本地 HTTP 服务更接近后续桌面应用的运行方式。

## 当前边界

浏览器直接打开时这是 UI/交互演示，任务执行使用模拟数据。真实网站查询、全页面截图和 Excel 读写已接入 `electron/` 桌面版本；请按 `electron/README.md` 启动 Electron，而不是把 `index.html` 当作真实执行入口。
