const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const XLSX = require('xlsx');
const DdddOcr = require('ddddocr').default;
const { PNG } = require('pngjs');
const { NativeSession, sleep } = require('./native-session');
const { createLicenseStore, LICENSE_EXTENSION } = require('./license');
const {
  humanClick,
  humanType,
  randomDelay,
  waitForElementReady,
  waitForPageLoad,
  randomScroll,
  randomMouseMove,
  naturalPageDwell,
  detectAnomalies,
  checkPageHealth,
  retryWithBackoff
} = require('./human-behavior');
const {
  injectAntiDetectionScript,
  robustNavigate,
  prepareForInteraction,
  waitForQueryResult,
  handlePageAnomalies
} = require('./query-helpers');

const SITE_CATALOG = {
  'W-001': {
    name: '信用中国',
    queries: [
      { name: '严重失信主体名单', url: 'https://www.creditchina.gov.cn/xinxigongshi/shixinheimingdan/', adapter: 'credit-china' },
      { name: '重大税收违法失信主体名单', url: 'https://www.creditchina.gov.cn/zhuanxiangchaxun/zhongdashuishouweifaanjian/', adapter: 'credit-china' }
    ]
  },
  'W-002': {
    name: '中国执行信息公开网',
    allowUntitledPage: true,
    queries: [
      { name: '失信被执行人', url: 'https://zxgk.court.gov.cn/shixin/', adapter: 'court-shixin' }
    ]
  },
  'W-003': {
    name: '中国政府采购网',
    queries: [
      { name: '政府采购严重违法失信行为记录名单', url: 'https://www.ccgp.gov.cn/search/cr/', adapter: 'ccgp-cr' }
    ]
  },
  'W-004': {
    name: '军队采购网',
    queries: [
      { name: '军队采购暂停名单', url: 'https://www.plap.mil.cn/freecms-glht/site/juncai/jdjc/index.html?channel=ad1a7596-65eb-48b4-909f-11679731ae94', adapter: 'plap-punish', listCode: 'suspend' },
      { name: '军队采购失信名单', url: 'https://www.plap.mil.cn/freecms-glht/site/juncai/jdjc/index.html?channel=ad1a7596-65eb-48b4-909f-11679731ae94', adapter: 'plap-punish', listCode: 'breakFaith' }
    ]
  },
  'W-005': {
    name: '全国企业破产重整案件信息网',
    queries: [
      { name: '企业破产重整案件信息', url: 'https://pccz.court.gov.cn/pcajxxw/index/xxwsy', adapter: 'pccz-search' }
    ]
  }
};
const CREDIT_CHINA_SELECTORS = {
  search: '.searchBox input', submit: '.infoCheckBtn', captchaPopup: '.vcodepop',
  captchaImage: '#vcodeimg', captchaInput: '#vcode', captchaConfirm: '.vcodepop .confirm',
  captchaRefresh: '.vcodepop .vcodeimgbox span', captchaCancel: '.vcodepop .cancel'
};
const COURT_SHIXIN_SELECTORS = {
  search: '#pName', captchaImage: '#captchaImg', captchaInput: '#yzm', captchaId: '#captchaId',
  submit: 'button.btn-zxgk', resultBlock: '#result-block', resultBody: '#tbody-result', resultHead: '#result-thead'
};
const CCGP_CR_SELECTORS = {
  frame: 'iframe[src*="/cr/list"]', search: '#orgName', form: '#ggForm', submit: '#searchForm',
  resultTable: '#tableInfo', resultRows: '#tableInfo tr.trShow'
};
const PLAP_PUNISH_SELECTORS = {
  listCard: '.sonChannelDiv', search: '#handleSearchParam', submit: '#Inquire',
  resultList: '.noticeShowList', loading: '#loadingMask'
};
const PCCZ_SELECTORS = {
  form: '#qzss', search: '#search', submit: '#qzss_search', resultList: '#gjsslb'
};
const STATE_FILE = 'task_state.json';
const REPORT_FILE = '执行明细报告.csv';

if (!app.isPackaged) {
  app.setPath('userData', path.join(__dirname, '.runtime'));
  app.setPath('sessionData', path.join(__dirname, '.runtime', 'session'));
}
const licenseStore = createLicenseStore(app.getPath('userData'));
let mainWindow;
let task = null;
let taskPaused = false;
let taskStopped = false;
let ocrPromise = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

async function importLicenseFile(filePath) {
  const result = await licenseStore.importFile(filePath);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license:update', result);
  return result;
}

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
function retryDelay(attempt) {
  const base = Math.min(15_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
  return base + Math.floor(Math.random() * 500);
}
async function waitBeforeRetry(notify, attempt, label) {
  const delay = retryDelay(attempt);
  notify(`${label}，${Math.ceil(delay / 1000)} 秒后重试`);
  await wait(delay);
}
async function waitForInteractiveControls(session, selectors, keys, siteName, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let stableCount = 0;
  let unavailable = [];
  while (Date.now() < deadline) {
    const state = await session.evaluate(({ selectors: selectorMap, keys: required }) => {
      const controls = required.map((key) => {
        const element = document.querySelector(selectorMap[key]);
        const style = element ? getComputedStyle(element) : null;
        const rect = element?.getBoundingClientRect();
        const ready = Boolean(element && rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden' && !element.matches(':disabled'));
        return { key, ready };
      });
      return { ready: controls.every((control) => control.ready), unavailable: controls.filter((control) => !control.ready).map((control) => control.key) };
    }, { selectors, keys });
    unavailable = state.unavailable;
    if (state.ready) {
      stableCount += 1;
      if (stableCount >= 2) return { ok: true };
    } else stableCount = 0;
    await sleep(350);
  }
  return { ok: false, reason: `${siteName}查询控件在 ${Math.round(timeoutMs / 1000)} 秒内未就绪：${unavailable.join('、') || '未知控件'}` };
}
function getOcr() { if (!ocrPromise) ocrPromise = DdddOcr.create(); return ocrPromise; }
function safeName(value) { return String(value).replace(/[\\/:*?"<>|]/g, '_').trim(); }
function itemKey(company, siteCode, query) { return `${company}|${siteCode}|${query}`; }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function printTimestamp() { return new Date().toLocaleString('zh-CN', { hour12: false }); }
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function normalizeCaptureMode(value) { return value === 'pdf' ? 'pdf' : 'png'; }
function captureModeLabel(value) { return normalizeCaptureMode(value) === 'pdf' ? '网页 PDF' : 'PNG 截图'; }
function exceptionStatus(executionStatus) {
  if (executionStatus === '成功') return '异常';
  if (executionStatus === '无记录') return '无异常';
  return '查询异常';
}
function normalizeSiteCodes(codes) { return [...new Set((codes || []).filter((code) => SITE_CATALOG[code]))]; }
function queriesForSites(siteCodes) { return normalizeSiteCodes(siteCodes).flatMap((siteCode) => SITE_CATALOG[siteCode].queries.map((query) => ({ ...query, siteCode }))); }
function taskTotal(state) { return state.companies.length * queriesForSites(state.siteCodes || ['W-001']).length; }

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
    await fs.writeFile(reportPath, '\uFEFF序号,公司名称,网站,查询项,异常状态,留存方式,失败原因,留存文件名,时间\r\n', 'utf8');
  }
  return reportPath;
}

async function appendReport(reportPath, row) {
  const values = [row.index, row.company, row.site, row.query, row.exceptionStatus, row.captureMode, row.reason, row.screenshot, row.time];
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
  // 等待搜索框就绪
  const searchReady = await prepareForInteraction(session, CREDIT_CHINA_SELECTORS.search, {
    timeout: 15000,
    scrollIntoView: true,
    addNaturalDelay: true
  });

  if (!searchReady.ok) {
    return { ok: false, reason: `搜索框未就绪: ${searchReady.reason}` };
  }

  // 使用人类化输入
  const typeResult = await humanType(session, CREDIT_CHINA_SELECTORS.search, company, {
    minDelay: 80,
    maxDelay: 200,
    mistakes: false
  });

  if (!typeResult.ok) return typeResult;

  // 输入后的思考时间
  await randomDelay(300, 600);

  // 等待提交按钮就绪
  const submitReady = await prepareForInteraction(session, CREDIT_CHINA_SELECTORS.submit, {
    timeout: 10000,
    scrollIntoView: false,
    addNaturalDelay: false
  });

  if (!submitReady.ok) {
    return { ok: false, reason: `提交按钮未就绪: ${submitReady.reason}` };
  }

  // 使用人类化点击提交
  return humanClick(session, CREDIT_CHINA_SELECTORS.submit, {
    delayBefore: [200, 400],
    delayAfter: [300, 600]
  });
}

async function nativeCaptchaState(session) {
  return session.evaluate((selectors) => {
    const popup = document.querySelector(selectors.captchaPopup);
    const visible = Boolean(popup && getComputedStyle(popup).display !== 'none' && getComputedStyle(popup).visibility !== 'hidden');
    const image = document.querySelector(selectors.captchaImage);
    const imageStyle = image ? getComputedStyle(image) : null;
    const imageRect = image?.getBoundingClientRect();
    const imageVisible = Boolean(imageRect && imageRect.width > 0 && imageRect.height > 0 && imageStyle?.display !== 'none' && imageStyle?.visibility !== 'hidden');
    const input = document.querySelector(selectors.captchaInput);
    const confirm = document.querySelector(selectors.captchaConfirm);
    const refresh = document.querySelector(selectors.captchaRefresh);
    return {
      visible,
      imagePresent: Boolean(image), imageVisible,
      imageReady: Boolean(imageVisible && image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0 && (image.currentSrc || image.src)),
      imageComplete: Boolean(image?.complete), imageWidth: image?.naturalWidth || 0, imageHeight: image?.naturalHeight || 0,
      imageSrc: image?.currentSrc || image?.src || '',
      inputReady: Boolean(input && getComputedStyle(input).display !== 'none'),
      confirmReady: Boolean(confirm && getComputedStyle(confirm).display !== 'none'),
      refreshReady: Boolean(refresh && getComputedStyle(refresh).display !== 'none' && getComputedStyle(refresh).visibility !== 'hidden'),
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

async function waitForStableCaptchaImage(session, timeoutMs = 20000) {
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
  return { ok: false, reason: `验证码图片在 ${Math.round(timeoutMs / 1000)} 秒内未完成稳定加载`, diagnostic: latest };
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

async function captureCaptchaPopup(session) {
  try { return await session.screenshotElement(CREDIT_CHINA_SELECTORS.captchaPopup); } catch (_) { return null; }
}

async function refreshCaptchaInPlace(session) {
  // 检查验证码弹窗状态
  const checkResult = await session.evaluate((selectors) => {
    const popup = document.querySelector(selectors.captchaPopup);
    const refresh = document.querySelector(selectors.captchaRefresh);
    const visible = popup && getComputedStyle(popup).display !== 'none' && getComputedStyle(popup).visibility !== 'hidden';
    if (!visible) return { ok: false, reason: '验证码弹窗已关闭' };
    if (!refresh || getComputedStyle(refresh).display === 'none' || getComputedStyle(refresh).visibility === 'hidden') return { ok: false, reason: '未找到可用的验证码刷新控件' };
    return { ok: true };
  }, CREDIT_CHINA_SELECTORS);

  if (!checkResult.ok) return checkResult;

  // 使用人类化点击刷新按钮
  const clickResult = await humanClick(session, CREDIT_CHINA_SELECTORS.captchaRefresh, {
    delayBefore: [200, 500],
    delayAfter: [400, 800]
  });

  if (!clickResult.ok) return clickResult;

  await sleep(900);
  const state = await waitForCaptcha(session, 8000);
  return state.visible ? { ok: true, method: 'refresh' } : { ok: false, reason: state.challenge ? '刷新验证码后页面进入安全检查' : '刷新验证码后弹窗已关闭' };
}

async function requestFreshCaptcha(session, company, query) {
  const refreshed = await refreshCaptchaInPlace(session);
  if (refreshed.ok) return refreshed;
  // 使用人类化点击取消按钮
  await humanClick(session, CREDIT_CHINA_SELECTORS.captchaCancel, {
    delayBefore: [150, 300],
    delayAfter: [400, 700]
  });
  await sleep(700);
  await session.navigate(query.url);
  const filled = await nativeFillAndSubmit(session, company);
  if (!filled.ok) return { ok: false, reason: filled.reason };
  const state = await waitForCaptcha(session);
  if (!state.visible) return { ok: false, reason: state.challenge ? '重新查询后页面进入安全检查' : '重新查询后未出现验证码弹窗' };
  return { ok: true, method: 'navigate' };
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
      const popupImage = await captureCaptchaPopup(session);
      await saveCaptchaDiagnostic(folder, company, query, `image-${imageRecovery}`, { phase: isCaptureFailure ? 'image_capture' : 'image_load', reason: lastReason, diagnosticImage: popupImage ? 'captcha_popup' : '', ...imageResult.diagnostic }, popupImage, notify);
      if (imageRecovery >= Math.max(3, captchaRetry)) return { ok: false, reason: `${isCaptureFailure ? '验证码像素截取连续失败' : '验证码图片连续未加载'}（${imageRecovery} 次）：${imageResult.reason}` };
      notify(`${isCaptureFailure ? '验证码像素截取失败' : '验证码图片未就绪'}，正在尝试刷新验证码图片`);
      const fresh = await requestFreshCaptcha(session, company, query);
      if (!fresh.ok) return { ok: false, reason: `验证码图片恢复失败：${fresh.reason}` };
      notify(fresh.method === 'refresh' ? '验证码图片已原地刷新，等待加载' : '验证码刷新控件不可用，已重新发起查询');
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
        // 使用人类化输入验证码
        const typeResult = await humanType(session, CREDIT_CHINA_SELECTORS.captchaInput, code, {
          minDelay: 100,
          maxDelay: 250,
          mistakes: false
        });

        if (!typeResult.ok) {
          lastReason = `验证码输入失败：${typeResult.reason}`;
          diagnostic.reason = lastReason;
          diagnostic.submitted = false;
          await saveCaptchaDiagnostic(folder, company, query, ocrAttempt, diagnostic, imageResult.image, notify);
          continue;
        }

        // 输入后随机思考时间
        await randomDelay(400, 800);

        // 使用人类化点击确认按钮
        const submitted = await humanClick(session, CREDIT_CHINA_SELECTORS.captchaConfirm, {
          delayBefore: [200, 500],
          delayAfter: [300, 600]
        });

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

async function saveResultArtifact(session, companyDir, siteName, queryName, captureMode, company, notify) {
  const isPdf = captureMode === 'pdf';
  const screenshot = `${safeName(siteName)}_${safeName(queryName)}_${timestamp()}.${isPdf ? 'pdf' : 'png'}`;
  const capture = isPdf
    ? await session.printPageToPdf(path.join(companyDir, screenshot), printTimestamp())
    : await session.captureFullPage(path.join(companyDir, screenshot));
  notify(`${isPdf ? '网页 PDF' : '截图'}已保存：${path.join(safeName(company), screenshot)}`, 'success');
  return { screenshot: path.join(safeName(company), screenshot), artifactLabel: isPdf ? '网页 PDF 已保存' : '截图已保存', capture };
}

async function saveSiteDiagnostic(session, folder, company, query, reason, notify) {
  try {
    const diagnostic = await session.getDiagnostics();
    const debugDir = path.join(folder, 'site-debug');
    await fs.mkdir(debugDir, { recursive: true });
    const stem = `${safeName(company)}_${safeName(query.name)}_${timestamp()}`;
    await fs.writeFile(path.join(debugDir, `${stem}.json`), JSON.stringify({
      timestamp: new Date().toISOString(), company, site: query.name, reason, ...diagnostic
    }, null, 2), 'utf8');
    const failures = diagnostic.responses
      .filter((response) => Number(response.status) >= 400)
      .map((response) => `${response.status} ${response.url}`)
      .slice(-3);
    notify(`站点诊断已保存：site-debug\\${stem}.json${failures.length ? `；最近错误：${failures.join(' | ')}` : ''}`);
  } catch (error) {
    notify(`保存站点诊断失败：${error.message}`);
  }
}

async function runCreditChinaOne(session, company, query, settings, captureMode, notify, folder) {
  let lastError = '';
  for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
    await waitUntilRunnable();
    try {
      notify(`正在查询${query.name}${attempt > 1 ? `（第 ${attempt}/${settings.siteRetry} 次）` : ''}`);
      await session.navigate(query.url);
      const ready = await waitForInteractiveControls(session, CREDIT_CHINA_SELECTORS, ['search', 'submit'], '信用中国');
      if (!ready.ok) throw new Error(ready.reason);
      const filled = await nativeFillAndSubmit(session, company);
      if (!filled.ok) return { status: '页面结构异常', reason: filled.reason };
      const captcha = await solveCaptchaIfNeeded(session, company, query, settings.captchaRetry, folder, notify);
      if (!captcha.ok) return { status: '验证码未通过', reason: captcha.reason };
      const outcome = await nativeWaitForResult(session, company);
      if (outcome.status === '失败') throw new Error(outcome.reason);
      const companyDir = path.join(folder, safeName(company));
      await fs.mkdir(companyDir, { recursive: true });
      const artifact = await saveResultArtifact(session, companyDir, SITE_CATALOG[query.siteCode].name, query.name, captureMode, company, notify);
      return {
        status: outcome.status,
        screenshot: artifact.screenshot,
        artifactLabel: artifact.artifactLabel,
        reason: artifact.capture?.truncated ? `页面高度 ${artifact.capture.originalHeight}px，截图已按 20000px 上限截断` : ''
      };
    } catch (error) {
      if (taskStopped) throw error;
      lastError = error.message;
      await saveSiteDiagnostic(session, folder, company, query, lastError, notify);
      if (attempt < settings.siteRetry) await waitBeforeRetry(notify, attempt, `查询异常：${lastError}`);
    }
  }
  return { status: '失败', reason: lastError || '查询失败' };
}

async function courtCaptchaState(session) {
  return session.evaluate((selectors) => {
    const image = document.querySelector(selectors.captchaImage);
    const style = image ? getComputedStyle(image) : null;
    const rect = image?.getBoundingClientRect();
    const imageVisible = Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden');
    return {
      nameReady: Boolean(document.querySelector(selectors.search)),
      inputReady: Boolean(document.querySelector(selectors.captchaInput)),
      submitReady: Boolean(document.querySelector(selectors.submit)),
      imageReady: Boolean(imageVisible && image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0),
      imageWidth: image?.naturalWidth || 0,
      imageHeight: image?.naturalHeight || 0,
      captchaId: document.querySelector(selectors.captchaId)?.value || ''
    };
  }, COURT_SHIXIN_SELECTORS);
}

async function waitForCourtCaptchaImage(session, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let latest = {};
  while (Date.now() < deadline) {
    const state = await courtCaptchaState(session);
    latest = { ...state };
    if (!state.imageReady) {
      await sleep(400);
      continue;
    }
    try {
      const first = await session.screenshotElement(COURT_SHIXIN_SELECTORS.captchaImage);
      await sleep(500);
      const second = await session.screenshotElement(COURT_SHIXIN_SELECTORS.captchaImage);
      if (first.equals(second)) return { ok: true, image: second, diagnostic: { ...latest, imageSha256: crypto.createHash('sha256').update(second).digest('hex') } };
      latest.imageChangedWhileReading = true;
    } catch (error) {
      latest.imageCaptureError = error.message;
    }
    await sleep(400);
  }
  return { ok: false, reason: latest.imageCaptureError ? `验证码像素截取失败：${latest.imageCaptureError}` : '验证码图片在 20 秒内未完成稳定加载', diagnostic: latest };
}

async function fillCourtCompany(session, company) {
  return session.evaluate(({ value, selectors }) => {
    const field = document.querySelector(selectors.search);
    const code = document.querySelector(selectors.captchaInput);
    if (!field || !code) return { ok: false, reason: '未找到被执行人名称或验证码输入框，页面结构可能已变更' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(field, value) : (field.value = value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    setter ? setter.call(code, '') : (code.value = '');
    return { ok: true };
  }, { value: company, selectors: COURT_SHIXIN_SELECTORS });
}

async function submitCourtQuery(session, code) {
  // 使用人类化输入验证码
  const typeResult = await humanType(session, COURT_SHIXIN_SELECTORS.captchaInput, code, {
    minDelay: 100,
    maxDelay: 250,
    mistakes: false
  });

  if (!typeResult.ok) return typeResult;

  // 输入后随机思考时间
  await randomDelay(300, 600);

  // 使用人类化点击提交按钮
  return humanClick(session, COURT_SHIXIN_SELECTORS.submit, {
    delayBefore: [200, 400],
    delayAfter: [300, 600]
  });
}

async function refreshCourtCaptcha(session) {
  // 检查验证码图片是否存在
  const checkResult = await session.evaluate((selectors) => {
    const image = document.querySelector(selectors.captchaImage);
    return image ? { ok: true } : { ok: false };
  }, COURT_SHIXIN_SELECTORS);

  if (!checkResult.ok) return false;

  // 使用人类化点击刷新验证码图片
  const clickResult = await humanClick(session, COURT_SHIXIN_SELECTORS.captchaImage, {
    delayBefore: [200, 500],
    delayAfter: [400, 900]
  });

  if (clickResult.ok) await sleep(900);
  return clickResult.ok;
}

async function waitForCourtResult(session, company, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    const state = await session.evaluate(({ value, selectors }) => {
      const block = document.querySelector(selectors.resultBlock);
      const visible = Boolean(block && getComputedStyle(block).display !== 'none' && !block.classList.contains('hide'));
      const text = document.querySelector(selectors.resultBody)?.innerText?.trim() || '';
      const headVisible = Boolean(document.querySelector(selectors.resultHead) && !document.querySelector(selectors.resultHead).classList.contains('hide'));
      const records = [...document.querySelectorAll(`${selectors.resultBody} tr`)].filter((row) => row.innerText.trim()).length;
      return {
        visible,
        text,
        hasRecords: headVisible && records > 0,
        noRecord: /没有找到|相关的结果/.test(text),
        captchaFailure: /验证码错误|验证码已过期/.test(text),
        companyPresent: text.includes(value)
      };
    }, { value: company, selectors: COURT_SHIXIN_SELECTORS });
    if (!state.visible) { await sleep(400); continue; }
    if (state.captchaFailure) return { status: '验证码未通过', reason: '中国执行信息公开网提示验证码错误或已过期', retryCaptcha: true };
    if (state.noRecord) return { status: '无记录' };
    if (state.hasRecords || state.companyPresent) return { status: '成功' };
    await sleep(400);
  }
  return { status: '失败', reason: '等待中国执行信息公开网查询结果超时' };
}

async function runCourtShixinOne(session, company, query, settings, captureMode, notify, folder) {
  await session.navigate(query.url);
  const ready = await waitForInteractiveControls(session, COURT_SHIXIN_SELECTORS, ['search'], '中国执行信息公开网');
  if (!ready.ok) return { status: '页面结构异常', reason: ready.reason };
  const filled = await fillCourtCompany(session, company);
  if (!filled.ok) return { status: '页面结构异常', reason: filled.reason };
  let lastReason = '验证码未通过';
  for (let attempt = 1; attempt <= settings.captchaRetry; attempt += 1) {
    await waitUntilRunnable();
    const imageResult = await waitForCourtCaptchaImage(session);
    if (!imageResult.ok) {
      lastReason = imageResult.reason;
      await saveCaptchaDiagnostic(folder, company, query, `court-image-${attempt}`, { phase: 'court_image_load', reason: lastReason, ...imageResult.diagnostic }, null, notify);
    } else {
      const recognition = await recognizeCaptcha(await getOcr(), imageResult.image);
      if (!recognition.code) {
        lastReason = recognition.reason;
        await saveCaptchaDiagnostic(folder, company, query, `court-ocr-${attempt}`, { phase: 'court_ocr', reason: lastReason, ...imageResult.diagnostic, ocrCandidates: recognition.candidates }, imageResult.image, notify);
      } else {
        notify(`中国执行信息公开网验证码 OCR 识别成功：${recognition.code}（第 ${attempt}/${settings.captchaRetry} 次）`);
        const submitted = await submitCourtQuery(session, recognition.code);
        if (!submitted.ok) return { status: '页面结构异常', reason: submitted.reason };
        const outcome = await waitForCourtResult(session, company);
        if (!outcome.retryCaptcha) {
          if (outcome.status === '失败') return outcome;
          const companyDir = path.join(folder, safeName(company));
          await fs.mkdir(companyDir, { recursive: true });
          const artifact = await saveResultArtifact(session, companyDir, SITE_CATALOG[query.siteCode].name, query.name, captureMode, company, notify);
          return { status: outcome.status, screenshot: artifact.screenshot, artifactLabel: artifact.artifactLabel, reason: '' };
        }
        lastReason = outcome.reason;
      }
    }
    if (attempt < settings.captchaRetry) {
      const refreshed = await refreshCourtCaptcha(session);
      if (!refreshed) return { status: '页面结构异常', reason: '未找到中国执行信息公开网验证码刷新控件' };
      notify(`中国执行信息公开网验证码未通过：${lastReason}，已刷新后重试`);
    }
  }
  return { status: '验证码未通过', reason: `${lastReason}；已完成 ${settings.captchaRetry} 次 OCR 尝试` };
}

async function waitForCcgpgPage(session, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let stableCount = 0;
  let unavailable = [];
  while (Date.now() < deadline) {
    const state = await session.evaluate((selectors) => {
      const frame = document.querySelector(selectors.frame);
      const doc = frame?.contentDocument;
      const visible = (element) => {
        const style = element ? getComputedStyle(element) : null;
        const rect = element?.getBoundingClientRect();
        return Boolean(element && rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden' && !element.matches(':disabled'));
      };
      return {
        frameReady: visible(frame) && Boolean(doc?.body),
        inputReady: visible(doc?.querySelector(selectors.search)),
        formReady: visible(doc?.querySelector(selectors.form)),
        submitReady: visible(doc?.querySelector(selectors.submit)),
        tableReady: visible(doc?.querySelector(selectors.resultTable)),
        documentReady: doc?.readyState === 'complete'
      };
    }, CCGP_CR_SELECTORS);
    unavailable = Object.entries(state).filter(([, ready]) => !ready).map(([name]) => name);
    if (!unavailable.length) {
      stableCount += 1;
      if (stableCount >= 2) return { ok: true };
    } else stableCount = 0;
    await sleep(350);
  }
  return { ok: false, reason: `中国政府采购网查询 iframe 在 30 秒内未完成加载：${unavailable.join('、') || '未知状态'}` };
}

async function fillAndSubmitCcgpg(session, company) {
  return session.evaluate(({ value, selectors }) => {
    const frame = document.querySelector(selectors.frame);
    const doc = frame?.contentDocument;
    const field = doc?.querySelector(selectors.search);
    const form = doc?.querySelector(selectors.form);
    if (!field || !form) return { ok: false, reason: '未找到企业名称输入框或查询表单，页面结构可能已变更' };
    const initialRows = [...doc.querySelectorAll(selectors.resultRows)].filter((row) => row.innerText.trim()).length;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(field, value) : (field.value = value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    // The site binds its "查找" action to this form. Native submission avoids an unreliable iframe click dispatch.
    form.submit();
    return { ok: true, initialRows };
  }, { value: company, selectors: CCGP_CR_SELECTORS });
}

async function waitForCcgpgResult(session, company, initialRows, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    const state = await session.evaluate(({ value, initialRows: expectedInitialRows, selectors }) => {
      const doc = document.querySelector(selectors.frame)?.contentDocument;
      const text = doc?.body?.innerText || '';
      const rows = doc ? [...doc.querySelectorAll(selectors.resultRows)].filter((row) => row.innerText.trim()).length : 0;
      const inputMatches = doc?.querySelector(selectors.search)?.value === value;
      const queryFinished = inputMatches && (/查询结果：|查询内容：/.test(text) || rows !== expectedInitialRows);
      return {
        queryFinished,
        rows,
        noRecord: /没有该企业的相关记录|没有.*相关记录/.test(text),
        text: text.slice(0, 500)
      };
    }, { value: company, initialRows, selectors: CCGP_CR_SELECTORS });
    if (!state.queryFinished) { await sleep(500); continue; }
    if (state.noRecord) return { status: '无记录' };
    if (state.rows > 0) return { status: '成功' };
    return { status: '失败', reason: `中国政府采购网未返回可识别的查询结果：${state.text.replace(/\s+/g, ' ').slice(0, 120)}` };
  }
  return { status: '失败', reason: '等待中国政府采购网查询结果超时' };
}

async function expandCcgpgFrame(session) {
  return session.evaluate((selectors) => {
    const frame = document.querySelector(selectors.frame);
    const doc = frame?.contentDocument;
    if (!frame || !doc) return { expanded: false };
    const height = Math.max(950, doc.documentElement.scrollHeight, doc.body.scrollHeight);
    frame.style.height = `${height}px`;
    return { expanded: true, height };
  }, CCGP_CR_SELECTORS);
}

async function runCcgpgOne(session, company, query, settings, captureMode, notify, folder) {
  let lastError = '';
  for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
    await waitUntilRunnable();
    try {
      notify(`正在查询中国政府采购网：${query.name}${attempt > 1 ? `（第 ${attempt}/${settings.siteRetry} 次）` : ''}`);
      await session.navigate(query.url);
      const ready = await waitForCcgpgPage(session);
      if (!ready.ok) throw new Error(ready.reason);
      const submitted = await fillAndSubmitCcgpg(session, company);
      if (!submitted.ok) return { status: '页面结构异常', reason: submitted.reason };
      const outcome = await waitForCcgpgResult(session, company, submitted.initialRows);
      if (outcome.status === '失败') throw new Error(outcome.reason);
      await expandCcgpgFrame(session);
      const companyDir = path.join(folder, safeName(company));
      await fs.mkdir(companyDir, { recursive: true });
      const artifact = await saveResultArtifact(session, companyDir, SITE_CATALOG[query.siteCode].name, query.name, captureMode, company, notify);
      return {
        status: outcome.status,
        screenshot: artifact.screenshot,
        artifactLabel: artifact.artifactLabel,
        reason: artifact.capture?.truncated ? `页面高度 ${artifact.capture.originalHeight}px，截图已按 20000px 上限截断` : ''
      };
    } catch (error) {
      if (taskStopped) throw error;
      lastError = error.message;
      await saveSiteDiagnostic(session, folder, company, query, lastError, notify);
      if (attempt < settings.siteRetry) await waitBeforeRetry(notify, attempt, `中国政府采购网查询异常：${lastError}`);
    }
  }
  return { status: '失败', reason: lastError || '中国政府采购网查询失败' };
}

async function waitForPlapPage(session, timeoutMs = 30000) {
  return waitForInteractiveControls(session, {
    ...PLAP_PUNISH_SELECTORS,
    suspendCard: `${PLAP_PUNISH_SELECTORS.listCard}[codes="suspend"]`,
    breakFaithCard: `${PLAP_PUNISH_SELECTORS.listCard}[codes="breakFaith"]`
  }, ['search', 'submit', 'resultList', 'suspendCard', 'breakFaithCard'], '军队采购网', timeoutMs);
}

async function selectPlapList(session, listCode, timeoutMs = 70000) {
  // 检查名单卡片是否存在
  const checkResult = await session.evaluate(({ code, selectors }) => {
    const card = document.querySelector(`${selectors.listCard}[codes="${code}"]`);
    if (!card) return { ok: false, reason: `未找到军队采购${code === 'suspend' ? '暂停' : '失信'}名单入口` };
    return { ok: true };
  }, { code: listCode, selectors: PLAP_PUNISH_SELECTORS });

  if (!checkResult.ok) return checkResult;

  // 使用人类化点击选择名单
  const clickResult = await humanClick(session, `${PLAP_PUNISH_SELECTORS.listCard}[codes="${listCode}"]`, {
    delayBefore: [200, 500],
    delayAfter: [300, 700]
  });

  if (!clickResult.ok) return clickResult;

  const deadline = Date.now() + timeoutMs;
  let latest = {};
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    latest = await session.evaluate(({ code, selectors }) => {
      const card = document.querySelector(`${selectors.listCard}[codes="${code}"]`);
      const loading = document.querySelector(selectors.loading);
      const list = document.querySelector(selectors.resultList);
      const text = list?.innerText.trim() || '';
      return {
        selected: Boolean(card?.classList.contains('actived')),
        loading: Boolean(loading && getComputedStyle(loading).display !== 'none'),
        rows: [...(list?.querySelectorAll('li') || [])].filter((row) => row.innerText.trim()).length,
        noRecord: /没有查询到相关记录|没有找到相关结果|暂无数据/.test(text),
        failed: /加载失败|查询接口超时/.test(text),
        text: text.slice(0, 300)
      };
    }, { code: listCode, selectors: PLAP_PUNISH_SELECTORS });
    if (latest.failed) return { ok: false, kind: 'site_error', reason: `军队采购${listCode === 'suspend' ? '暂停' : '失信'}名单加载失败：${latest.text.replace(/\s+/g, ' ').slice(0, 120)}` };
    if (latest.selected && !latest.loading && (latest.rows > 0 || latest.noRecord)) return { ok: true };
    await sleep(500);
  }
  return { ok: false, reason: `军队采购${listCode === 'suspend' ? '暂停' : '失信'}名单默认列表加载超时` };
}

async function fillAndSubmitPlap(session, company) {
  // 使用人类化输入企业名称
  const typeResult = await humanType(session, PLAP_PUNISH_SELECTORS.search, company, {
    minDelay: 80,
    maxDelay: 200,
    mistakes: false
  });

  if (!typeResult.ok) return typeResult;

  // 输入后随机思考时间
  await randomDelay(300, 600);

  // 使用人类化点击提交按钮
  return humanClick(session, PLAP_PUNISH_SELECTORS.submit, {
    delayBefore: [200, 400],
    delayAfter: [300, 600]
  });
}

async function waitForPlapResult(session, company, timeoutMs = 70000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    const state = await session.evaluate(({ value, selectors }) => {
      const field = document.querySelector(selectors.search);
      const loading = document.querySelector(selectors.loading);
      const list = document.querySelector(selectors.resultList);
      const text = list?.innerText.trim() || '';
      const rows = [...(list?.querySelectorAll('li') || [])].filter((row) => row.innerText.trim()).length;
      return {
        inputMatches: field?.value === value,
        loading: Boolean(loading && getComputedStyle(loading).display !== 'none'),
        rows,
        noRecord: /没有查询到相关记录|没有找到相关结果|暂无数据/.test(text),
        failed: /加载失败|查询接口超时/.test(text),
        companyPresent: text.includes(value),
        text: text.slice(0, 400)
      };
    }, { value: company, selectors: PLAP_PUNISH_SELECTORS });
    if (!state.inputMatches || state.loading) { await sleep(500); continue; }
    if (state.failed) return { status: '失败', reason: `军队采购网查询失败：${state.text.replace(/\s+/g, ' ').slice(0, 160)}` };
    if (state.noRecord) return { status: '无记录' };
    if (state.rows > 0 && state.companyPresent) return { status: '成功' };
    await sleep(500);
  }
  return { status: '失败', reason: '等待军队采购网查询结果超时' };
}

async function runPlapPunishOne(session, company, query, settings, captureMode, notify, folder) {
  let lastError = '';
  const listName = query.listCode === 'suspend' ? '暂停名单' : '失信名单';
  for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
    await waitUntilRunnable();
    try {
      notify(`正在查询军队采购网：${query.name}${attempt > 1 ? `（第 ${attempt}/${settings.siteRetry} 次）` : ''}`);
      await session.navigate(query.url);
      const ready = await waitForPlapPage(session);
      if (!ready.ok) throw new Error(ready.reason);
      const listReady = await selectPlapList(session, query.listCode);
      if (!listReady.ok) throw new Error(listReady.reason);
      const submitted = await fillAndSubmitPlap(session, company);
      if (!submitted.ok) return { status: '页面结构异常', reason: submitted.reason };
      const outcome = await waitForPlapResult(session, company);
      if (outcome.status === '失败') throw new Error(outcome.reason);
      const companyDir = path.join(folder, safeName(company));
      await fs.mkdir(companyDir, { recursive: true });
      const artifact = await saveResultArtifact(session, companyDir, SITE_CATALOG[query.siteCode].name, query.name, captureMode, company, notify);
      return {
        status: outcome.status,
        screenshot: artifact.screenshot,
        artifactLabel: artifact.artifactLabel,
        reason: artifact.capture?.truncated ? `页面高度 ${artifact.capture.originalHeight}px，截图已按 20000px 上限截断` : ''
      };
    } catch (error) {
      if (taskStopped) throw error;
      lastError = error.message;
      await saveSiteDiagnostic(session, folder, company, query, lastError, notify);
      if (attempt < settings.siteRetry) await waitBeforeRetry(notify, attempt, `军队采购网${listName}查询异常：${lastError}`);
    }
  }
  return { status: '失败', reason: lastError || `军队采购网${listName}查询失败` };
}

async function waitForPcczPage(session, timeoutMs = 30000) {
  return waitForInteractiveControls(session, PCCZ_SELECTORS, ['form', 'search', 'submit'], '全国企业破产重整案件信息网', timeoutMs);
}

async function fillAndSubmitPccz(session, company) {
  return session.evaluate(({ value, selectors }) => {
    const form = document.querySelector(selectors.form);
    const field = document.querySelector(selectors.search);
    if (!form || !field) return { ok: false, reason: '未找到全国企业破产重整案件信息网搜索框或查询表单，页面结构可能已变更' };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter ? setter.call(field, value) : (field.value = value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    // The source form opens a new tab by default. Keep the result in this CDP-controlled page.
    form.target = '_self';
    form.requestSubmit();
    return { ok: true };
  }, { value: company, selectors: PCCZ_SELECTORS });
}

async function waitForPcczResult(session, company, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitUntilRunnable();
    const state = await session.evaluate(({ value, selectors }) => {
      const text = document.body?.innerText || '';
      const list = document.querySelector(selectors.resultList);
      const listText = list?.innerText.trim() || '';
      const rows = [...(list?.querySelectorAll('li') || [])].filter((row) => row.innerText.trim()).length;
      const queryMatches = /关键字\s*[：:]/.test(text) && text.includes(value);
      return {
        queryMatches,
        noRecord: /很抱歉[，,]?\s*没有找到.*相关结果|没有找到.*相关结果/.test(text),
        recordsReady: /共搜索出\s*\d+\s*条记录/.test(listText),
        rows,
        text: listText.slice(0, 500)
      };
    }, { value: company, selectors: PCCZ_SELECTORS });
    if (!state.queryMatches) { await sleep(400); continue; }
    if (state.noRecord) return { status: '无记录' };
    if (state.recordsReady && state.rows > 0) return { status: '成功' };
    await sleep(400);
  }
  return { status: '失败', reason: '等待全国企业破产重整案件信息网查询结果超时' };
}

async function runPcczOne(session, company, query, settings, captureMode, notify, folder) {
  let lastError = '';
  for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
    await waitUntilRunnable();
    try {
      notify(`正在查询全国企业破产重整案件信息网：${query.name}${attempt > 1 ? `（第 ${attempt}/${settings.siteRetry} 次）` : ''}`);
      await session.navigate(query.url);
      const ready = await waitForPcczPage(session);
      if (!ready.ok) throw new Error(ready.reason);
      const submitted = await fillAndSubmitPccz(session, company);
      if (!submitted.ok) return { status: '页面结构异常', reason: submitted.reason };
      const outcome = await waitForPcczResult(session, company);
      if (outcome.status === '失败') throw new Error(outcome.reason);
      const companyDir = path.join(folder, safeName(company));
      await fs.mkdir(companyDir, { recursive: true });
      const artifact = await saveResultArtifact(session, companyDir, SITE_CATALOG[query.siteCode].name, query.name, captureMode, company, notify);
      return {
        status: outcome.status,
        screenshot: artifact.screenshot,
        artifactLabel: artifact.artifactLabel,
        reason: artifact.capture?.truncated ? `页面高度 ${artifact.capture.originalHeight}px，截图已按 20000px 上限截断` : ''
      };
    } catch (error) {
      if (taskStopped) throw error;
      lastError = error.message;
      await saveSiteDiagnostic(session, folder, company, query, lastError, notify);
      if (attempt < settings.siteRetry) await waitBeforeRetry(notify, attempt, `全国企业破产重整案件信息网查询异常：${lastError}`);
    }
  }
  return { status: '失败', reason: lastError || '全国企业破产重整案件信息网查询失败' };
}

async function runOne(session, company, query, settings, captureMode, notify, folder) {
  if (query.adapter === 'pccz-search') return runPcczOne(session, company, query, settings, captureMode, notify, folder);
  if (query.adapter === 'plap-punish') return runPlapPunishOne(session, company, query, settings, captureMode, notify, folder);
  if (query.adapter === 'ccgp-cr') return runCcgpgOne(session, company, query, settings, captureMode, notify, folder);
  if (query.adapter === 'court-shixin') {
    let lastResult = null;
    for (let attempt = 1; attempt <= settings.siteRetry; attempt += 1) {
      try {
        const result = await runCourtShixinOne(session, company, query, settings, captureMode, notify, folder);
        if (result.status === '成功' || result.status === '无记录') return result;
        lastResult = result;
      } catch (error) {
        if (taskStopped) throw error;
        lastResult = { status: '失败', reason: error.message };
      }
      if (attempt < settings.siteRetry) await waitBeforeRetry(notify, attempt, `中国执行信息公开网查询异常：${lastResult.reason || lastResult.status}`);
    }
    return lastResult || { status: '失败', reason: '中国执行信息公开网查询失败' };
  }
  return runCreditChinaOne(session, company, query, settings, captureMode, notify, folder);
}

async function runTask(input) {
  taskStopped = false;
  const folder = input.folder;
  const settings = { siteRetry: Math.max(1, input.settings.siteRetry || 5), captchaRetry: Math.max(1, input.settings.captchaRetry || 5), randomDelay: input.settings.randomDelay !== false };
  let state = input.resume ? await loadState(folder) : null;
  if (!state) state = { project: input.project, companies: input.companies, siteCodes: normalizeSiteCodes(input.siteCodes), outputDir: folder, captureMode: normalizeCaptureMode(input.settings.captureMode), completed: [], results: {}, createdAt: new Date().toISOString() };
  state.siteCodes = normalizeSiteCodes(state.siteCodes || ['W-001']);
  const captureMode = normalizeCaptureMode(state.captureMode || input.settings.captureMode);
  const companies = state.companies;
  const queries = queriesForSites(state.siteCodes);
  if (!queries.length) throw new Error('未选择可执行的网站');
  const total = companies.length * queries.length;
  let done = state.completed.length;
  let reportIndex = Object.keys(state.results).length;
  const reportPath = await prepareReport(folder);
  const summary = { total, success: 0, failed: 0, noRecord: 0, captcha: 0, skipped: 0, cancelled: false };
  Object.values(state.results).forEach((row) => { if (row.status === '成功') summary.success += 1; else if (row.status === '无记录') summary.noRecord += 1; else if (row.status === '验证码未通过') summary.captcha += 1; else if (row.status === '跳过') summary.skipped += 1; else summary.failed += 1; });
  const session = new NativeSession({ profileDir: path.join(app.getPath('userData'), 'native-chrome-profile'), log: (message) => sendUpdate({ type: 'log', message }) });
  try {
    sendUpdate({ type: 'started', total, done, folder, project: state.project, message: `正在启动原生浏览器并通过网站安全检查，留存方式：${captureModeLabel(captureMode)}` });
    const firstQuery = queries[0];
    await session.start(firstQuery.url, { allowUntitledPage: Boolean(SITE_CATALOG[firstQuery.siteCode].allowUntitledPage) });
    for (let companyIndex = 0; companyIndex < companies.length; companyIndex += 1) {
      const company = companies[companyIndex];
      for (const query of queries) {
        await waitUntilRunnable();
        const key = itemKey(company, query.siteCode, query.name);
        const siteName = SITE_CATALOG[query.siteCode].name;
        if (state.completed.includes(key)) {
          sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName, query: query.name, status: state.results[key]?.status || '已完成', message: '已从断点跳过完成项' });
          continue;
        }
        const notify = (message, level = '') => sendUpdate({ type: 'log', message, level });
        sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName, query: query.name, status: '进行中', message: `正在处理：${company}` });
        const result = await runOne(session, company, query, settings, captureMode, notify, folder);
        done += 1;
        reportIndex += 1;
        const row = { index: reportIndex, company, site: siteName, query: query.name, status: result.status, exceptionStatus: exceptionStatus(result.status), captureMode: captureModeLabel(captureMode), reason: result.reason || '', screenshot: result.screenshot || '', time: new Date().toLocaleString('zh-CN') };
        state.completed.push(key);
        state.results[key] = row;
        await appendReport(reportPath, row);
        await saveState(folder, state);
        if (result.status === '成功') summary.success += 1; else if (result.status === '无记录') summary.noRecord += 1; else if (result.status === '验证码未通过') summary.captcha += 1; else summary.failed += 1;
        sendUpdate({ type: 'item', ...row });
        sendUpdate({ type: 'progress', done, total, company, companyIndex: companyIndex + 1, companyTotal: companies.length, siteName, query: query.name, status: result.status, message: result.reason || result.artifactLabel || '处理完成' });
        if (settings.randomDelay && done < total) await wait(1000 + Math.floor(Math.random() * 2000));
      }
    }
  } catch (error) {
    if (taskStopped) summary.cancelled = true;
    else { summary.failed += 1; sendUpdate({ type: 'log', level: 'error', message: `任务异常：${error.message}` }); }
  } finally { await session.stop(); }
  let zipPath = '';
  try { zipPath = await zipFolder(folder, state.project); } catch (error) { sendUpdate({ type: 'log', level: 'error', message: error.message }); }
  sendUpdate({ type: 'completed', folder, reportPath, zipPath, summary, rows: Object.values(state.results), message: summary.cancelled ? '任务已取消，已保留当前结果' : '任务完成，已生成执行明细与归档文件' });
}

ipcMain.handle('task:start', async (_event, payload) => {
  if (task?.running) return { ok: false, message: '已有任务正在运行' };
  const license = await licenseStore.status();
  if (!license.active) return { ok: false, licenseRequired: true, message: license.message };
  const project = safeName(payload.project || '未命名任务');
  const companies = [...new Set((payload.companies || []).map((name) => String(name).trim()).filter(Boolean))].slice(0, 500);
  const siteCodes = normalizeSiteCodes(payload.siteCodes);
  if (!companies.length) return { ok: false, message: '请至少输入一家企业' };
  if (!siteCodes.length) return { ok: false, message: '请至少选择一个网站' };
  const outputBase = payload.outputBase || app.getPath('desktop');
  const folder = path.join(outputBase, project);
  await fs.mkdir(folder, { recursive: true });
  const existing = await loadState(folder);
  if (existing && existing.completed.length < taskTotal(existing) && !payload.resume) return { ok: false, resumeAvailable: true, message: '发现未完成任务，请选择从断点继续或重新开始' };
  if ((payload.restart || existing) && !payload.resume) {
    await fs.rm(folder, { recursive: true, force: true });
    await fs.mkdir(folder, { recursive: true });
  }
  task = { running: true, folder };
  taskPaused = false;
  runTask({ project, companies, siteCodes, folder, settings: payload.settings || {}, resume: Boolean(payload.resume) }).catch((error) => sendUpdate({ type: 'log', level: 'error', message: error.message })).finally(() => { if (task) task.running = false; });
  return { ok: true, folder };
});
ipcMain.handle('task:pause', () => { taskPaused = true; sendUpdate({ type: 'paused', message: '任务已暂停' }); return { ok: true }; });
ipcMain.handle('task:resume', () => { taskPaused = false; sendUpdate({ type: 'resumed', message: '任务继续执行' }); return { ok: true }; });
ipcMain.handle('task:stop', () => { taskStopped = true; taskPaused = false; sendUpdate({ type: 'stopping', message: '正在停止任务' }); return { ok: true }; });
ipcMain.handle('task:inspect', async (_event, outputBase, project) => {
  const folder = path.join(outputBase || app.getPath('desktop'), safeName(project || ''));
  const state = await loadState(folder);
  return { folder, state, total: state ? taskTotal(state) : 0, resumable: Boolean(state && state.completed.length < taskTotal(state)) };
});
ipcMain.handle('task:open-folder', async (_event, folder) => { const target = folder || task?.folder; if (target) await shell.openPath(target); return { ok: true }; });
ipcMain.handle('task:open-report', async (_event, reportPath) => { if (reportPath) await shell.openPath(reportPath); return { ok: true }; });
ipcMain.handle('dialog:choose-folder', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
ipcMain.handle('app:defaults', () => ({ outputBase: app.getPath('desktop') }));
ipcMain.handle('license:status', () => licenseStore.status());
ipcMain.handle('license:get-authorization', async () => ({ machineCode: await licenseStore.getMachineCode() }));
ipcMain.handle('license:copy-authorization', async () => {
  const machineCode = await licenseStore.getMachineCode();
  clipboard.writeText(machineCode);
  return { machineCode };
});
ipcMain.handle('license:import', async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: '选择授权文件',
    properties: ['openFile'],
    filters: [{ name: '镜核授权文件', extensions: [LICENSE_EXTENSION.slice(1)] }]
  });
  if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
  return importLicenseFile(selected.filePaths[0]);
});
ipcMain.handle('file:parse-excel', (_event, arrayBuffer) => {
  const workbook = XLSX.read(Buffer.from(arrayBuffer));
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }).map((row) => String(row[0] || '').trim()).filter(Boolean).slice(0, 500);
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

/**
 * 检查系统要求
 * @returns {Array} 问题列表
 */
async function checkSystemRequirements() {
  const issues = [];

  // 检查浏览器
  try {
    const { NativeSession } = require('./native-session');
    const testSession = new NativeSession(() => {});
    const browser = testSession.browserPath;

    if (!browser) {
      issues.push({
        severity: 'error',
        message: '未找到 Chrome 或 Edge 浏览器',
        solution: '请安装 Google Chrome 或 Microsoft Edge 浏览器\n下载地址:\nChrome: https://www.google.com/chrome/\nEdge: https://www.microsoft.com/edge'
      });
    }
  } catch (e) {
    issues.push({
      severity: 'error',
      message: '浏览器检测失败',
      solution: `错误详情: ${e.message}`
    });
  }

  // 检查 PowerShell
  try {
    childProcess.execSync('powershell -Command "Get-Host"', { windowsHide: true, timeout: 5000 });
  } catch (e) {
    issues.push({
      severity: 'warning',
      message: 'PowerShell 不可用或受限',
      solution: '某些功能可能受限，建议检查 PowerShell 执行策略'
    });
  }

  // 检查写入权限
  try {
    const testDir = path.join(app.getPath('userData'), '.test');
    await fs.mkdir(testDir, { recursive: true });
    await fs.rmdir(testDir);
  } catch (e) {
    issues.push({
      severity: 'error',
      message: '无法写入用户数据目录',
      solution: '请以管理员权限运行，或更改安装位置'
    });
  }

  return issues;
}

app.whenReady().then(async () => {
  // 执行系统要求检查
  const issues = await checkSystemRequirements();

  // 处理严重错误
  const errors = issues.filter(i => i.severity === 'error');
  if (errors.length > 0) {
    dialog.showErrorBox(
      '系统要求检查失败',
      '应用无法启动，请解决以下问题:\n\n' +
      errors.map(i => `• ${i.message}\n  解决方案: ${i.solution}`).join('\n\n')
    );
    app.quit();
    return;
  }

  // 显示警告
  const warnings = issues.filter(i => i.severity === 'warning');
  if (warnings.length > 0) {
    dialog.showMessageBox({
      type: 'warning',
      title: '系统检查警告',
      message: '检测到以下问题，应用可能无法正常工作:',
      detail: warnings.map(i => `• ${i.message}\n  建议: ${i.solution}`).join('\n\n'),
      buttons: ['继续使用', '退出'],
      defaultId: 0,
      cancelId: 1
    }).then(result => {
      if (result.response === 1) {
        app.quit();
        return;
      }
      createWindow();
    });
  } else {
    createWindow();
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
