const { app, BrowserWindow, BrowserView, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { PNG } = require('pngjs');
const XLSX = require('xlsx');

const CREDIT_CHINA_URL = 'https://www.creditchina.gov.cn/xinxigongshi/shixinheimingdan/';
app.setPath('userData', path.join(__dirname, '.runtime'));
app.setPath('sessionData', path.join(__dirname, '.runtime', 'session'));
let mainWindow;
let browserView;
let task = null;
let taskPaused = false;
let taskStopped = false;
let manualPending = false;
let browserVisible = true;
let browserBounds = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f3f8fb',
    title: '镜核 · 企业资质核查',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWindow.on('resize', positionBrowserView);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function ensureBrowserView() {
  if (browserView) return browserView;
  browserView = new BrowserView({
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  mainWindow.setBrowserView(browserView);
  positionBrowserView();
  browserView.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => sendUpdate({ status: 'failed', message: `浏览器加载失败：${errorDescription || errorCode}` }));
  browserView.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      setBrowserVisible(false);
    }
  });
  return browserView;
}

function positionBrowserView() {
  if (!mainWindow || !browserView || !browserVisible || !browserBounds) return;
  browserView.setBounds({
    x: Math.max(0, Math.round(browserBounds.x)),
    y: Math.max(0, Math.round(browserBounds.y)),
    width: Math.max(100, Math.round(browserBounds.width)),
    height: Math.max(100, Math.round(browserBounds.height))
  });
  browserView.setAutoResize({ width: true, height: true });
}

function setBrowserVisible(visible) {
  browserVisible = visible;
  if (!mainWindow || !browserView) return;
  if (visible) { mainWindow.setBrowserView(browserView); positionBrowserView(); }
  else mainWindow.setBrowserView(null);
  sendUpdate({ browserVisible: visible });
}

function sendUpdate(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:update', update);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitUntilRunnable() {
  while (taskPaused && !taskStopped) await wait(250);
  if (taskStopped) throw new Error('任务已终止');
}

async function waitForManualResume() {
  taskPaused = true;
  manualPending = true;
  while (manualPending && !taskStopped) await wait(300);
  if (taskStopped) throw new Error('任务已终止');
  taskPaused = false;
}

async function executeInPage(script, ...args) {
  return browserView.webContents.executeJavaScript(`(${script})(${JSON.stringify(args)})`, true);
}

async function inspectPage() {
  return executeInPage(() => {
    const text = document.body?.innerText || '';
    const inputs = [...document.querySelectorAll('input')].map((input) => ({ type: input.type, name: input.name, id: input.id, placeholder: input.placeholder, value: input.value }));
    return { title: document.title, url: location.href, text: text.slice(0, 5000), inputs };
  });
}

async function detectManualIntervention() {
  const info = await inspectPage();
  const text = `${info.title} ${info.text}`;
  return /验证码|安全验证|滑块|请完成验证|登录后查询|访问过于频繁|人机验证/i.test(text);
}

async function fillAndSubmit(company) {
  return executeInPage((name) => {
    const fields = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')];
    const field = fields.find((input) => /主体|企业|名称|统一社会信用代码|请输入|搜索|查询/i.test(`${input.placeholder} ${input.name} ${input.id}`)) || fields[0];
    if (!field) return { ok: false, reason: '未找到查询输入框' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(field, name) : (field.value = name);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const controls = [...document.querySelectorAll('button, input[type="submit"], a')];
    const submit = controls.find((control) => /查询|搜索|检索/i.test((control.innerText || control.value || '').trim()));
    if (submit) { submit.click(); return { ok: true, clicked: true }; }
    field.form?.submit();
    return { ok: true, clicked: false };
  }, company);
}

async function waitForResult(company) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    if (await detectManualIntervention()) return { status: 'manual', reason: '检测到验证码或访问拦截' };
    const info = await inspectPage();
    // The page contains the headings "查询结果" and "严重失信主体名单"
    // before submission, so those headings cannot be used as completion signals.
    // A completed query must either show the explicit empty-result message or
    // render the submitted company name in the result area.
    const emptyResult = /很抱歉[，,]?\s*没有找到您搜索的数据|没有找到您搜索的数据|暂无相关数据/.test(info.text);
    const resultHasCompany = info.text.includes(company);
    if (emptyResult) return { status: 'ready', outcome: '无记录' };
    if (resultHasCompany) return { status: 'ready', outcome: '成功' };
    await wait(800);
  }
  return { status: 'failed', reason: `等待查询结果超时：${company}` };
}

async function captureFullPage(filePath) {
  await waitUntilRunnable();
  const metrics = await executeInPage(() => ({ width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0), height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), viewportHeight: window.innerHeight }));
  const width = Math.min(Math.max(metrics.width || 1280, 800), 2400);
  const viewportHeight = Math.max(metrics.viewportHeight || 700, 500);
  const totalHeight = Math.min(Math.max(metrics.height || viewportHeight, viewportHeight), 30000);
  const positions = [];
  for (let y = 0; y < totalHeight; y += viewportHeight) positions.push(Math.min(y, Math.max(0, totalHeight - viewportHeight)));
  const uniquePositions = [...new Set(positions)];
  const stitched = new PNG({ width, height: totalHeight });
  for (const y of uniquePositions) {
    await executeInPage((scrollY) => window.scrollTo(0, scrollY), y);
    await wait(220);
    const image = PNG.sync.read((await browserView.webContents.capturePage()).toPNG());
    const copyHeight = Math.min(viewportHeight, totalHeight - y, image.height);
    PNG.bitblt(image, stitched, 0, 0, Math.min(width, image.width), copyHeight, 0, y);
  }
  await executeInPage(() => window.scrollTo(0, 0));
  await fs.writeFile(filePath, PNG.sync.write(stitched));
}

async function writeReport(folder, rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, '核查汇总');
  const reportPath = path.join(folder, '任务汇总报告.xlsx');
  XLSX.writeFile(workbook, reportPath);
  return reportPath;
}

async function runTask({ companies, sites, outputFolder }) {
  const view = ensureBrowserView();
  taskStopped = false;
  const safeFolder = outputFolder || path.join(app.getPath('documents'), '镜核任务');
  const taskFolder = path.join(safeFolder, `任务_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  if (task) task.folder = taskFolder;
  await fs.mkdir(taskFolder, { recursive: true });
  const rows = [];
  const total = companies.length * sites.length;
  let index = 0;
  for (const company of companies) {
    for (const site of sites) {
      await waitUntilRunnable();
      index += 1;
      sendUpdate({ status: 'running', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: '正在打开查询页面', browserVisible, folder: taskFolder });
      const companyFolder = path.join(taskFolder, company.replace(/[\\/:*?"<>|]/g, '_'));
      await fs.mkdir(companyFolder, { recursive: true });
      try {
        await view.webContents.loadURL(CREDIT_CHINA_URL);
        await wait(1600);
        if (await detectManualIntervention()) {
          setBrowserVisible(true);
          sendUpdate({ status: 'manual', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: '检测到验证码或访问拦截，请在浏览器中手动处理后继续', folder: taskFolder });
          await waitForManualResume();
        }
        sendUpdate({ status: 'running', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: '正在填写企业名称' });
        let filled = await fillAndSubmit(company);
        if (!filled.ok) {
          setBrowserVisible(true);
          sendUpdate({ status: 'manual', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: `无法自动定位查询控件：${filled.reason}。请在浏览器中完成查询后点击继续`, folder: taskFolder });
          await waitForManualResume();
          filled = await fillAndSubmit(company);
          if (!filled.ok) throw new Error(filled.reason);
        }
        const result = await waitForResult(company);
        if (result.status === 'manual') {
          setBrowserVisible(true);
          sendUpdate({ status: 'manual', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: result.reason, folder: taskFolder });
          await waitForManualResume();
          const resumed = await waitForResult(company);
          if (resumed.status === 'manual') throw new Error('人工处理后仍处于验证状态');
          if (resumed.status === 'failed') throw new Error(resumed.reason);
        }
        if (result.status === 'failed') throw new Error(result.reason);
        const imagePath = path.join(companyFolder, `信用中国_严重失信主体名单_${Date.now()}.png`);
        sendUpdate({ status: 'running', company, site, index, total, progress: Math.round(((index - 1) / total) * 100), message: '正在生成全页面截图' });
        await captureFullPage(imagePath);
        rows.push({ 企业名称: company, 网站: '信用中国', 核查项: '严重失信主体名单', 执行状态: result.outcome || '成功', 截图路径: imagePath, 执行时间: new Date().toLocaleString('zh-CN'), 备注: result.outcome === '无记录' ? '页面未查询到相关记录' : '' });
        sendUpdate({ status: 'success', company, site, index, total, progress: Math.round((index / total) * 100), message: '截图已保存', imagePath, folder: taskFolder });
      } catch (error) {
        rows.push({ 企业名称: company, 网站: '信用中国', 核查项: '严重失信主体名单', 执行状态: '失败', 截图路径: '', 执行时间: new Date().toLocaleString('zh-CN'), 备注: error.message });
        sendUpdate({ status: 'failed', company, site, index, total, progress: Math.round((index / total) * 100), message: error.message, folder: taskFolder });
      }
    }
  }
  const reportPath = await writeReport(taskFolder, rows);
  sendUpdate({ status: 'completed', index: total, total, progress: 100, message: '任务已完成，截图和 Excel 报告已生成', folder: taskFolder, reportPath });
  return { rows, taskFolder, reportPath };
}

ipcMain.handle('task:start', async (_event, payload) => {
  if (task?.running) return { ok: false, message: '已有任务正在运行' };
  task = { running: true };
  taskPaused = false;
  manualPending = false;
  runTask(payload).catch((error) => sendUpdate({ status: 'failed', message: error.message })).finally(() => { if (task) task.running = false; });
  return { ok: true };
});
ipcMain.handle('task:pause', () => { taskPaused = true; sendUpdate({ status: 'paused', message: '任务已暂停' }); return { ok: true }; });
ipcMain.handle('task:resume', () => { taskPaused = false; manualPending = false; sendUpdate({ status: 'running', message: '任务继续执行' }); return { ok: true }; });
ipcMain.handle('task:stop', () => { taskStopped = true; taskPaused = false; sendUpdate({ status: 'stopped', message: '任务已终止' }); return { ok: true }; });
ipcMain.handle('browser:toggle', (_event, visible) => { setBrowserVisible(Boolean(visible)); return { ok: true }; });
ipcMain.handle('browser:bounds', (_event, bounds) => { browserBounds = bounds; positionBrowserView(); return { ok: true }; });
ipcMain.handle('file:parse-excel', (_event, arrayBuffer) => {
  const workbook = XLSX.read(Buffer.from(arrayBuffer));
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
  return rows.map((row) => String(row[0] || '').trim()).filter(Boolean).slice(0, 5000);
});
ipcMain.handle('task:open-folder', async () => { if (task?.folder) await shell.openPath(task.folder); return { ok: true }; });

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
