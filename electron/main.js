const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const DdddOcr = require('ddddocr').default;
const { PNG } = require('pngjs');
const { NativeSession, sleep } = require('./native-session');

const SITE_CATALOG = {
  'W-001': {
    name: '信用中国',
    queries: [
      { name: '严重失信主体名单', url: 'https://www.creditchina.gov.cn/xinxigongshi/shixinheimingdan/' },
      { name: '重大税收违法失信主体名单', url: 'https://www.creditchina.gov.cn/zhuanxiangchaxun/zhongdashuishouweifaanjian/' }
    ]
  }
};
const CREDIT_CHINA_SELECTORS = {
  search: '.searchBox input', submit: '.infoCheckBtn', captchaPopup: '.vcodepop',
  captchaImage: '#vcodeimg', captchaInput: '#vcode', captchaConfirm: '.vcodepop .confirm',
  captchaRefresh: '.vcodepop .vcodeimgbox span', captchaCancel: '.vcodepop .cancel'
};
const STATE_FILE = 'task_state.json';
const REPORT_FILE = '执行明细报告.csv';

app.setPath('userData', path.join(__dirname, '.runtime'));
app.setPath('sessionData', path.join(__dirname, '.runtime', 'session'));
let mainWindow;
let task = null;
let taskPaused = false;
let taskStopped = false;
let ocrPromise = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 780, minWidth: 860, minHeight: 640, backgroundColor: '#f2f5f3',
    title: '企业信用截图工具',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function sendUpdate(update) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task:update', update);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getOcr() { if (!ocrPromise) ocrPromise = DdddOcr.create(); return ocrPromise; }
function safeName(value) { return String(value).replace(/[\\/:*?"<>|]/g, '_').trim(); }
function itemKey(company, siteCode, query) { return `${company}|${siteCode}|${query}`; }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

function makeCaptchaVariant(raw, mode) {
  const source = PNG.sync.read(raw);
  const scale = 3;
  const output = new PNG({ width: source.width * scale, height: source.height * scale });
  const grayAt = (x, y) => {
    const index = (y * source.width + x) * 4;
    return Math.round(source.data[index] * 0.299 + source.data[index + 1] * 0.587 + source.data[index + 2] * 0.114);
  };
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const gray = grayAt(x, y);
      let threshold = mode === 'threshold-100' ? 100 : 120;
      if (mode === 'adaptive') {
        let sum = 0;
        let count = 0;
        for (let sampleY = Math.max(0, y - 2); sampleY <= Math.min(source.height - 1, y + 2); sampleY += 1) {
          for (let sampleX = Math.max(0, x - 2); sampleX <= Math.min(source.width - 1, x + 2); sampleX += 1) {
            sum += grayAt(sampleX, sampleY);
            count += 1;
          }
        }
        threshold = sum / count - 4;
      }
      const color = gray > threshold ? 255 : 0;
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          const index = ((y * scale + offsetY) * output.width + x * scale + offsetX) * 4;
          output.data[index] = color;
          output.data[index + 1] = color;
          output.data[index + 2] = color;
          output.data[index + 3] = 255;
        }
      }
    }
  }
  return PNG.sync.write(output);
}

async function recognizeCaptcha(ocr, image) {
  const variants = [{ name: 'original', image, weight: 3 }];
  try {
    variants.push({ name: 'adaptive', image: makeCaptchaVariant(image, 'adaptive'), weight: 3 });
    variants.push({ name: 'threshold-100', image: makeCaptchaVariant(image, 'threshold-100'), weight: 2 });
    variants.push({ name: 'threshold-120', image: makeCaptchaVariant(image, 'threshold-120'), weight: 2 });
  } catch (error) {
    variants.push({ name: 'preprocess-error', image: null, weight: 0, error: error.message });
  }
  const scores = new Map();
  const candidates = [];
  for (const variant of variants) {
    let raw = '';
    try { raw = variant.image ? String(await ocr.classification(variant.image)) : ''; } catch (error) { variant.error = error.message; }
    const code = raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const valid = /^[A-Z0-9]{4}$/.test(code);
    candidates.push({ variant: variant.name, raw, code, valid, weight: variant.weight, error: variant.error || '' });
    if (valid) scores.set(code, (scores.get(code) || 0) + variant.weight);
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (!ranked.length) return { code: '', candidates, reason: 'OCR 未得到 4 位字母数字结果' };
  const [code, score] = ranked[0];
  const runnerUp = ranked[1]?.[1] || 0;
  if (score < 5) return { code: '', candidates, reason: `OCR 置信不足（候选 ${code}，分数 ${score}）` };
  if (runnerUp >= score - 2) return { code: '', candidates, reason: `OCR 存在竞争候选（${code} / ${ranked[1][0]}）` };
  return { code, candidates, reason: '' };
}

async function waitUntilRunnable() {
  while (taskPaused && !taskStopped) await wait(250);
  if (taskStopped) throw new Error('任务已取消');
}

async function loadState(folder) {
  try { return JSON.parse(await fs.readFile(path.join(folder, STATE_FILE), 'utf8')); } catch (_) { return null; }
}

async function saveState(folder, state) {
  const temp = path.join(folder, `${STATE_FILE}.tmp`);
  await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temp, path.join(folder, STATE_FILE));
}

async function prepareReport(folder) {
  const reportPath = path.join(folder, REPORT_FILE);
  try { await fs.access(reportPath); } catch (_) {
    await fs.writeFile(reportPath, '\uFEFF序号,公司名称,网站,查询项,状态,失败原因,截图文件名,时间\r\n', 'utf8');
  }
  return reportPath;
}

async function appendReport(reportPath, row) {
  const values = [row.index, row.company, row.site, row.query, row.status, row.reason, row.screenshot, row.time];
  await fs.appendFile(reportPath, `${values.map(csvCell).join(',')}\r\n`, 'utf8');
}

async function zipFolder(folder, project) {
  const zipPath = path.join(path.dirname(folder), `${safeName(project)}_${timestamp().slice(0, 19)}.zip`);
  await new Promise((resolve, reject) => {
    const source = folder.replace(/'/g, "''");
    const destination = zipPath.replace(/'/g, "''");
    const command = `Get-ChildItem -LiteralPath '${source}' | Where-Object { $_.Name -ne '${STATE_FILE}' -and $_.Extension -ne '.tmp' } | Compress-Archive -DestinationPath '${destination}' -Force`;
    const child = childProcess.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`压缩归档失败（退出码 ${code}）`)));
  });
  return zipPath;
}

async function nativeFillAndSubmit(session, company) {
  return session.evaluate(({ company: name, selectors }) => {
    const field = document.querySelector(selectors.search);
    const submit = document.querySelector(selectors.submit);
    if (!field || !submit) return { ok: false, reason: '未找到查询控件，页面结构可能已变更' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(field, name) : (field.value = name);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    submit.click();
    return { ok: true };
  }, { company, selectors: CREDIT_CHINA_SELECTORS });
}

async function nativeCaptchaState(session) {
  return session.evaluate((selectors) => {
    const popup = document.querySelector(selectors.captchaPopup);
    const visible = Boolean(popup && getComputedStyle(popup).display !== 'none' && getComputedStyle(popup).visibility !== 'hidden');
    const image = document.querySelector(selectors.captchaImage);
    const input = document.querySelector(selectors.captchaInput);
    const confirm = document.querySelector(selectors.captchaConfirm);
    return {
      visible,
      imageReady: Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && (image.currentSrc || image.src)),
      imageComplete: Boolean(image?.complete), imageWidth: image?.naturalWidth || 0, imageHeight: image?.naturalHeight || 0,
      imageSrc: image?.currentSrc || image?.src || '',
      inputReady: Boolean(input && getComputedStyle(input).display !== 'none'),
      confirmReady: Boolean(confirm && getComputedStyle(confirm).display !== 'none'),
      error: popup?.querySelector('.errortip')?.innerText?.trim() || '',
      challenge: /安全验证|访问过于频繁|人机验证|请完成验证/.test(document.body?.innerText || '')
    };
  }, CREDIT_CHINA_SELECTORS);
}

async function waitForCaptcha(session, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let latest = await nativeCaptchaState(session);
  while (Date.now() < deadline) {
    if (latest.visible || latest.challenge) return latest;
    await sleep(250);
    latest = await nativeCaptchaState(session);
  }
  return latest;
}

async function waitForStableCaptchaImage(session, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let latest = {};
  while (Date.now() < deadline) {
    const state = await nativeCaptchaState(session);
    latest = { ...state };
    if (!state.visible) return { ok: false, reason: '验证码弹窗在图片就绪前关闭', diagnostic: latest };
    if (!state.imageReady) {
      await sleep(400);
      continue;
    }
    try {
      const first = await session.screenshotElement(CREDIT_CHINA_SELECTORS.captchaImage);
      await sleep(500);
      const second = await session.screenshotElement(CREDIT_CHINA_SELECTORS.captchaImage);
      const digest = crypto.createHash('sha256').update(second).digest('hex');
      if (first.equals(second)) return { ok: true, image: second, diagnostic: { ...latest, imageSha256: digest } };
      latest.imageChangedWhileReading = true;
    } catch (error) {
      latest.imageCaptureError = error.message;
    }
    await sleep(400);
  }
  if (latest.imageCaptureError) return { ok: false, reason: `验证码像素截取失败：${latest.imageCaptureError}`, diagnostic: latest };
  if (latest.imageChangedWhileReading) return { ok: false, reason: '验证码图片在连续两帧之间发生变化', diagnostic: latest };
  return { ok: false, reason: '验证码图片在 12 秒内未完成稳定加载', diagnostic: latest };
}

async function waitForCaptchaOutcome(session) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const state = await nativeCaptchaState(session);
    if (!state.visible) return { passed: true, reason: '验证码弹窗已关闭' };
    if (state.error) return { passed: false, reason: state.error, kind: 'server_rejected' };
    if (state.challenge) return { passed: false, reason: '页面进入浏览器安全检查', kind: 'security_challenge' };
    await sleep(400);
  }
  return { passed: false, reason: '验证码提交后 8 秒内弹窗未关闭且未显示错误', kind: 'outcome_timeout' };
}

async function saveCaptchaDiagnostic(folder, company, query, attempt, diagnostic, image, notify) {
  try {
    const debugDir = path.join(folder, 'captcha-debug');
    await fs.mkdir(debugDir, { recursive: true });
    const stem = `${safeName(company)}_${safeName(query.name)}_${timestamp()}_${attempt}`;
    const payload = { timestamp: new Date().toISOString(), company, query: query.name, ...diagnostic };
    if (image?.length) {
      const imageName = `${stem}.png`;
      await fs.writeFile(path.join(debugDir, imageName), image);
      payload.imageFile = imageName;
      payload.imageBytes = image.length;
    }
    await fs.writeFile(path.join(debugDir, `${stem}.json`), JSON.stringify(payload, null, 2), 'utf8');
    notify(`验证码诊断已保存：captcha-debug\\${stem}.json`);
  } catch (error) {
    notify(`保存验证码诊断失败：${error.message}`);
  }
}

async function requestFreshCaptcha(session, company, query) {
  await session.evaluate((selectors) => document.querySelector(selectors.captchaCancel)?.click(), CREDIT_CHINA_SELECTORS);
  await sleep(700);
  await session.navigate(query.url);
  const filled = await nativeFillAndSubmit(session, company);
  if (!filled.ok) return { ok: false, reason: filled.reason };
  const state = await waitForCaptcha(session);
  if (!state.visible) return { ok: false, reason: state.challenge ? '重新查询后页面进入安全检查' : '重新查询后未出现验证码弹窗' };
  return { ok: true };
}

async function solveCaptchaIfNeeded(session, company, query, captchaRetry, folder, notify) {
  const initial = await waitForCaptcha(session);
  if (!initial.visible) return initial.challenge ? { ok: false, reason: '浏览器安全检查未通过' } : { ok: true };
  const ocr = await getOcr();
  let ocrAttempt = 0;
  let imageRecovery = 0;
  let lastReason = '验证码未通过';
  while (ocrAttempt < captchaRetry) {
    await waitUntilRunnable();
    const imageResult = await waitForStableCaptchaImage(session);
    if (!imageResult.ok) {
      imageRecovery += 1;
      const isCaptureFailure = Boolean(imageResult.diagnostic.imageCaptureError);
      lastReason = imageResult.reason;
      await saveCaptchaDiagnostic(folder, company, query, `image-${imageRecovery}`, { phase: isCaptureFailure ? 'image_capture' : 'image_load', reason: lastReason, ...imageResult.diagnostic }, null, notify);
      if (imageRecovery >= Math.max(3, captchaRetry)) return { ok: false, reason: `${isCaptureFailure ? '验证码像素截取连续失败' : '验证码图片连续未加载'}（${imageRecovery} 次）：${imageResult.reason}` };
      notify(`${isCaptureFailure ? '验证码像素截取失败' : '验证码图片未就绪'}，关闭弹窗并重新发起查询`);
      const fresh = await requestFreshCaptcha(session, company, query);
      if (!fresh.ok) return { ok: false, reason: `验证码图片恢复失败：${fresh.reason}` };
      continue;
    }
    imageRecovery = 0;
    ocrAttempt += 1;
    const diagnostic = { phase: 'ocr', attempt: ocrAttempt, ...imageResult.diagnostic };
    notify(`检测到图形验证码，正在本地识别（第 ${ocrAttempt}/${captchaRetry} 次）`);
    try {
      const recognition = await recognizeCaptcha(ocr, imageResult.image);
      const code = recognition.code;
      diagnostic.ocrCode = code;
      diagnostic.ocrCandidates = recognition.candidates;
      if (!code) {
        lastReason = recognition.reason;
        diagnostic.reason = lastReason;
        await saveCaptchaDiagnostic(folder, company, query, ocrAttempt, diagnostic, imageResult.image, notify);
      } else {
        notify(`验证码 OCR 识别成功：${code}（多版本投票一致）`);
        const submitted = await session.evaluate(({ value, selectors }) => {
        const field = document.querySelector(selectors.captchaInput);
        const confirm = document.querySelector(selectors.captchaConfirm);
        if (!field || !confirm) return { ok: false, reason: '未找到验证码输入或确认控件' };
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter ? setter.call(field, value) : (field.value = value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        confirm.click();
        return { ok: true };
        }, { value: code, selectors: CREDIT_CHINA_SELECTORS });
        diagnostic.submitted = submitted.ok;
        if (!submitted.ok) {
          lastReason = `验证码未提交：${submitted.reason}`;
          diagnostic.reason = lastReason;
        } else {
          const outcome = await waitForCaptchaOutcome(session);
          diagnostic.outcome = outcome.kind || (outcome.passed ? 'passed' : 'unknown');
          diagnostic.outcomeReason = outcome.reason;
          if (outcome.passed) return { ok: true };
          lastReason = outcome.kind === 'server_rejected' ? `服务端拒绝验证码：${outcome.reason}` : outcome.reason;
        }
        await saveCaptchaDiagnostic(folder, company, query, ocrAttempt, diagnostic, imageResult.image, notify);
      }
    } catch (error) {
      lastReason = `验证码处理异常：${error.message}`;
      diagnostic.reason = lastReason;
      await saveCaptchaDiagnostic(folder, company, query, ocrAttempt, diagnostic, imageResult.image, notify);
    }
    if (ocrAttempt < captchaRetry) {
      notify(`验证码本次未通过：${lastReason}；正在重新发起查询`);
      const fresh = await requestFreshCaptcha(session, company, query);
      if (!fresh.ok) return { ok: false, reason: `验证码重试准备失败：${fresh.reason}` };
    }
  }
  return { ok: false, reason: `${lastReason}；已完成 ${ocrAttempt} 次 OCR 尝试` };
}

async function nativeWaitForResult(session, company) {
  const deadline = Date.now() + 30000;
  let stableReadyCount = 0;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    const safety = await nativeCaptchaState(session);
    if (safety.visible || safety.challenge) return { status: '验证码未通过', reason: '查询后出现验证码或浏览器安全检查' };
    const text = await session.evaluate(() => document.body?.innerText || '');
    const noRecord = /很抱歉[，,]?\s*没有找到您搜索的数据|没有找到您搜索的数据|暂无相关数据/.test(text);
    if (noRecord || text.includes(company)) {
      stableReadyCount += 1;
      if (stableReadyCount >= 2) return { status: noRecord ? '无记录' : '成功' };
    } else stableReadyCount = 0;
    await sleep(800);
  }
  return { status: '失败', reason: `等待查询结果超时：${company}` };
}

async function runOne(session, company, query, settings, notify, folder) {
  let lastError = '';
  for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
    await waitUntilRunnable();
    try {
      notify(`正在查询${query.name}${attempt > 1 ? `（第 ${attempt}/${settings.siteRetry} 次）` : ''}`);
      await session.navigate(query.url);
      const filled = await nativeFillAndSubmit(session, company);
      if (!filled.ok) return { status: '页面结构异常', reason: filled.reason };
      const captcha = await solveCaptchaIfNeeded(session, company, query, settings.captchaRetry, folder, notify);
      if (!captcha.ok) return { status: '验证码未通过', reason: captcha.reason };
      const outcome = await nativeWaitForResult(session, company);
      if (outcome.status === '失败') throw new Error(outcome.reason);
      const companyDir = path.join(folder, safeName(company));
      await fs.mkdir(companyDir, { recursive: true });
      const screenshot = `${safeName(SITE_CATALOG['W-001'].name)}_${safeName(query.name)}_${timestamp()}.png`;
      const capture = await session.captureFullPage(path.join(companyDir, screenshot));
      notify(`截图已保存：${path.join(safeName(company), screenshot)}`, 'success');
      return {
        status: outcome.status,
        screenshot: path.join(safeName(company), screenshot),
        reason: capture?.truncated ? `页面高度 ${capture.originalHeight}px，截图已按 20000px 上限截断` : ''
      };
    } catch (error) {
      if (taskStopped) throw error;
      lastError = error.message;
      notify(`查询异常：${lastError}${attempt < settings.siteRetry ? '，正在重试' : ''}`);
    }
  }
  return { status: '失败', reason: lastError || '查询失败' };
}

async function runTask(input) {
  taskStopped = false;
  const folder = input.folder;
  const settings = { siteRetry: Math.max(1, input.settings.siteRetry || 5), captchaRetry: Math.max(1, input.settings.captchaRetry || 5), randomDelay: input.settings.randomDelay !== false };
  let state = input.resume ? await loadState(folder) : null;
  if (!state) state = { project: input.project, companies: input.companies, siteCodes: ['W-001'], outputDir: folder, completed: [], results: {}, createdAt: new Date().toISOString() };
  const companies = state.companies;
  const queries = SITE_CATALOG['W-001'].queries;
  const total = companies.length * queries.length;
  let done = state.completed.length;
  let reportIndex = Object.keys(state.results).length;
  const reportPath = await prepareReport(folder);
  const summary = { total, success: 0, failed: 0, noRecord: 0, captcha: 0, skipped: 0, cancelled: false };
  Object.values(state.results).forEach((row) => { if (row.status === '成功') summary.success += 1; else if (row.status === '无记录') summary.noRecord += 1; else if (row.status === '验证码未通过') summary.captcha += 1; else if (row.status === '跳过') summary.skipped += 1; else summary.failed += 1; });
  const session = new NativeSession({ profileDir: path.join(app.getPath('userData'), 'native-chrome-profile'), log: (message) => sendUpdate({ type: 'log', message }) });
  try {
    sendUpdate({ type: 'started', total, done, folder, project: state.project, message: '正在启动原生浏览器并通过网站安全检查' });
    await session.start(queries[0].url);
    for (let companyIndex = 0; companyIndex < companies.length; companyIndex += 1) {
      const company = companies[companyIndex];
      for (const query of queries) {
        await waitUntilRunnable();
        const key = itemKey(company, 'W-001', query.name);
        if (state.completed.includes(key)) {
          sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName: '信用中国', query: query.name, status: state.results[key]?.status || '已完成', message: '已从断点跳过完成项' });
          continue;
        }
        const notify = (message, level = '') => sendUpdate({ type: 'log', message, level });
        sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName: '信用中国', query: query.name, status: '进行中', message: `正在处理：${company}` });
        const result = await runOne(session, company, query, settings, notify, folder);
        done += 1;
        reportIndex += 1;
        const row = { index: reportIndex, company, site: '信用中国', query: query.name, status: result.status, reason: result.reason || '', screenshot: result.screenshot || '', time: new Date().toLocaleString('zh-CN') };
        state.completed.push(key);
        state.results[key] = row;
        await appendReport(reportPath, row);
        await saveState(folder, state);
        if (result.status === '成功') summary.success += 1; else if (result.status === '无记录') summary.noRecord += 1; else if (result.status === '验证码未通过') summary.captcha += 1; else summary.failed += 1;
        sendUpdate({ type: 'item', ...row });
        sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName: '信用中国', query: query.name, status: result.status, message: result.reason || '截图已保存' });
        if (settings.randomDelay && done < total) await wait(1000 + Math.floor(Math.random() * 2000));
      }
    }
  } catch (error) {
    if (taskStopped) summary.cancelled = true;
    else { summary.failed += 1; sendUpdate({ type: 'log', level: 'error', message: `任务异常：${error.message}` }); }
  } finally { session.stop(); }
  let zipPath = '';
  try { zipPath = await zipFolder(folder, state.project); } catch (error) { sendUpdate({ type: 'log', level: 'error', message: error.message }); }
  sendUpdate({ type: 'completed', folder, reportPath, zipPath, summary, rows: Object.values(state.results), message: summary.cancelled ? '任务已取消，已保留当前结果' : '任务完成，已生成执行明细与归档文件' });
}

ipcMain.handle('task:start', async (_event, payload) => {
  if (task?.running) return { ok: false, message: '已有任务正在运行' };
  const project = safeName(payload.project || '未命名任务');
  const companies = [...new Set((payload.companies || []).map((name) => String(name).trim()).filter(Boolean))].slice(0, 500);
  if (!companies.length) return { ok: false, message: '请至少输入一家企业' };
  const outputBase = payload.outputBase || app.getPath('desktop');
  const folder = path.join(outputBase, project);
  await fs.mkdir(folder, { recursive: true });
  const existing = await loadState(folder);
  if (existing && existing.completed.length < existing.companies.length * SITE_CATALOG['W-001'].queries.length && !payload.resume) return { ok: false, resumeAvailable: true, message: '发现未完成任务，请选择从断点继续或重新开始' };
  if ((payload.restart || existing) && !payload.resume) {
    await fs.rm(folder, { recursive: true, force: true });
    await fs.mkdir(folder, { recursive: true });
  }
  task = { running: true, folder };
  taskPaused = false;
  runTask({ project, companies, folder, settings: payload.settings || {}, resume: Boolean(payload.resume) }).catch((error) => sendUpdate({ type: 'log', level: 'error', message: error.message })).finally(() => { if (task) task.running = false; });
  return { ok: true, folder };
});
ipcMain.handle('task:pause', () => { taskPaused = true; sendUpdate({ type: 'paused', message: '任务已暂停' }); return { ok: true }; });
ipcMain.handle('task:resume', () => { taskPaused = false; sendUpdate({ type: 'resumed', message: '任务继续执行' }); return { ok: true }; });
ipcMain.handle('task:stop', () => { taskStopped = true; taskPaused = false; sendUpdate({ type: 'stopping', message: '正在停止任务' }); return { ok: true }; });
ipcMain.handle('task:inspect', async (_event, outputBase, project) => {
  const folder = path.join(outputBase || app.getPath('desktop'), safeName(project || ''));
  const state = await loadState(folder);
  return { folder, state, resumable: Boolean(state && state.completed.length < state.companies.length * SITE_CATALOG['W-001'].queries.length) };
});
ipcMain.handle('task:open-folder', async (_event, folder) => { const target = folder || task?.folder; if (target) await shell.openPath(target); return { ok: true }; });
ipcMain.handle('task:open-report', async (_event, reportPath) => { if (reportPath) await shell.openPath(reportPath); return { ok: true }; });
ipcMain.handle('dialog:choose-folder', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('app:defaults', () => ({ outputBase: app.getPath('desktop') }));
ipcMain.handle('file:parse-excel', (_event, arrayBuffer) => {
  const workbook = XLSX.read(Buffer.from(arrayBuffer));
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }).map((row) => String(row[0] || '').trim()).filter(Boolean).slice(0, 500);
});

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
