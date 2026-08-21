const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scalePngToWidth(source, width) {
  if (source.width === width) return source;
  const height = Math.max(1, Math.round(source.height * width / source.width));
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / width));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      output.data[targetIndex] = source.data[sourceIndex];
      output.data[targetIndex + 1] = source.data[sourceIndex + 1];
      output.data[targetIndex + 2] = source.data[sourceIndex + 2];
      output.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return output;
}

function appendWindowsTaskbar(pageImage, taskbarImage) {
  const page = PNG.sync.read(pageImage);
  const taskbar = scalePngToWidth(PNG.sync.read(taskbarImage), page.width);
  const output = new PNG({ width: page.width, height: page.height + taskbar.height });

  // Preserve the entire Windows taskbar so the system clock remains in its native position.
  PNG.bitblt(page, output, 0, 0, page.width, page.height, 0, 0);
  PNG.bitblt(taskbar, output, 0, 0, taskbar.width, taskbar.height, 0, page.height);
  return PNG.sync.write(output);
}

async function captureWindowsTaskbar() {
  const imagePath = path.join(os.tmpdir(), `jinghe-taskbar-${process.pid}-${Date.now()}.png`);
  const powerShellPath = imagePath.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea',
    '$width = $bounds.Width',
    '$height = $bounds.Bottom - $workingArea.Bottom',
    "if ($height -lt 24) { throw '未检测到可见的底部 Windows 任务栏，请先关闭任务栏自动隐藏后重试' }",
    '$bitmap = New-Object System.Drawing.Bitmap $width, $height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    'try {',
    '  $graphics.CopyFromScreen($bounds.Left, $bounds.Bottom - $height, 0, 0, $bitmap.Size)',
    `  $bitmap.Save('${powerShellPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '} finally {',
    '  $graphics.Dispose()',
    '  $bitmap.Dispose()',
    '}'
  ].join('\n');

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `退出码 ${code}`)));
    });
    return await fs.promises.readFile(imagePath);
  } catch (error) {
    throw new Error(`无法截取完整 Windows 任务栏和系统时间：${error.message}`);
  } finally {
    await fs.promises.unlink(imagePath).catch(() => {});
  }
}

function findBrowser() {
  const candidates = [
    process.env.EDGE_EXE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function runHidden(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} 退出码 ${code}`)));
  });
}

async function terminateProcessTree(processId) {
  try { await runHidden('taskkill.exe', ['/PID', String(processId), '/T', '/F']); } catch (_) { /* The process may already be gone. */ }
}

async function terminateStaleBrowserSessions(profileDir) {
  const profilePath = path.resolve(profileDir).replace(/'/g, "''");
  const script = [
    `$profilePath = '${profilePath}'`,
    "Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -in @('msedge.exe', 'chrome.exe') -and",
    "  $_.CommandLine -and $_.CommandLine.Contains($profilePath) -and",
    "  $_.CommandLine -match '--remote-debugging-port=' -and",
    "  $_.CommandLine -notmatch '--type='",
    "} | Select-Object -ExpandProperty ProcessId"
  ].join('\n');
  let output = '';
  try { output = await runHidden('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]); } catch (_) { return 0; }
  const processIds = [...new Set(output.split(/\s+/).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  await Promise.all(processIds.map(terminateProcessTree));
  return processIds.length;
}

class NativeSession {
  constructor({ profileDir, log = () => {} }) {
    this.profileDir = profileDir;
    this.log = log;
    this.browserPath = findBrowser();
    this.port = null;
    this.proc = null;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.recentResponses = [];
  }

  async start(url, { allowUntitledPage = false } = {}) {
    if (!this.browserPath) throw new Error('未找到 Microsoft Edge 或 Google Chrome，无法启动原生浏览器会话');
    const staleCount = await terminateStaleBrowserSessions(this.profileDir);
    if (staleCount) this.log(`已回收 ${staleCount} 个遗留的项目专用浏览器会话`);
    this.port = await freePort();
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.proc = spawn(this.browserPath, [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
      '--window-position=-32000,-32000',
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
      url
    ], { windowsHide: true });
    this.proc.once('error', (error) => this.log(`原生浏览器启动失败：${error.message}`));

    // Do not attach automation while the anti-bot page is solving its JS challenge.
    const target = await this.waitForPage(url, 90_000, allowUntitledPage);
    await this.connect(target.webSocketDebuggerUrl);
    await this.command('Page.enable');
    await this.command('Runtime.enable');
    await this.command('Network.enable');
    this.log('原生浏览器会话已就绪');
  }

  async waitForPage(url, timeoutMs, allowUntitledPage = false) {
    const deadline = Date.now() + timeoutMs;
    const hostname = new URL(url).hostname;
    const securityTitle = /安全验证|访问验证|人机验证|just a moment|checking your browser|verify you are human/i;
    let announced = false;
    let lastPage = '';
    let consecutiveTargetCount = 0;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const pages = await response.json();
        const target = pages.find((item) => item.type === 'page' && item.url.includes(hostname));
        if (target) {
          lastPage = target.title || target.url || '';
          consecutiveTargetCount += 1;
          const titleReady = target.title && !securityTitle.test(target.title);
          // A requested URL can be reported before Chrome commits its navigation. For titleless sites,
          // wait for a second identical polling cycle so we do not attach to that transient page.
          if (titleReady || (allowUntitledPage && consecutiveTargetCount >= 2)) return target;
        } else consecutiveTargetCount = 0;
      } catch (_) {
        // Browser remote debugging endpoint is not ready yet.
      }
      if (!announced) {
        this.log('正在等待原生浏览器通过网站安全检查');
        announced = true;
      }
      await sleep(1000);
    }
    const pageState = lastPage ? `（当前页面：${lastPage}）` : '';
    throw new Error(`浏览器安全检查未在 ${Math.round(timeoutMs / 1000)} 秒内完成${pageState}`);
  }

  async connect(endpoint) {
    this.ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接浏览器调试通道超时')), 10_000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('连接浏览器调试通道失败')); }, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Network.responseReceived') {
        const response = message.params?.response;
        if (response?.url) {
          this.recentResponses.push({
            url: response.url,
            status: response.status,
            mimeType: response.mimeType || '',
            type: message.params?.type || '',
            timestamp: Date.now()
          });
          if (this.recentResponses.length > 100) this.recentResponses.splice(0, this.recentResponses.length - 100);
        }
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('浏览器调试通道已关闭'));
      this.pending.clear();
    });
  }

  command(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('浏览器调试通道不可用'));
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(fn, arg) {
    const expression = `(${fn.toString()})(${JSON.stringify(arg)})`;
    const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(detail || '页面脚本执行失败');
    }
    return result.result?.value;
  }

  async getDiagnostics() {
    const page = await this.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 1200)
    }));
    return { page, responses: this.recentResponses.slice(-30) };
  }

  async navigate(url) {
    await this.command('Page.navigate', { url });
    await sleep(1200);
  }

  async screenshotElement(selector) {
    const box = await this.evaluate((value) => {
      const element = document.querySelector(value);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width < 1 || rect.height < 1 || style.visibility === 'hidden' || style.display === 'none') return null;
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }, selector);
    if (!box) throw new Error('验证码图片未就绪');
    const clip = { ...box, scale: 1 };
    const result = await this.command('Page.captureScreenshot', { format: 'png', fromSurface: true, clip });
    return Buffer.from(result.data, 'base64');
  }

  async captureFullPage(filePath) {
    const metrics = await this.command('Page.getLayoutMetrics');
    const content = metrics.cssContentSize || metrics.contentSize;
    if (!content?.width || !content?.height) throw new Error('无法读取页面完整尺寸');
    const width = Math.min(Math.max(Math.ceil(content.width), 800), 2400);
    const originalHeight = Math.ceil(content.height);
    const height = Math.min(Math.max(originalHeight, 600), 20000);
    try {
      await this.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, scale: 1 });
      await sleep(350);
      const screenshot = await this.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
      const taskbar = await captureWindowsTaskbar();
      const pageImage = Buffer.from(screenshot.data, 'base64');
      await fs.promises.writeFile(filePath, appendWindowsTaskbar(pageImage, taskbar));
      return { truncated: originalHeight > 20000, originalHeight };
    } finally {
      try { await this.command('Emulation.clearDeviceMetricsOverride'); } catch (_) { /* Browser may already have closed. */ }
    }
  }

  async printPageToPdf(filePath, printedAt) {
    const printTime = String(printedAt || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    const pdf = await this.command('Page.printToPDF', {
      landscape: true,
      displayHeaderFooter: true,
      printBackground: true,
      preferCSSPageSize: false,
      paperWidth: 11.69,
      paperHeight: 8.27,
      marginTop: 0.45,
      marginBottom: 0.4,
      marginLeft: 0.25,
      marginRight: 0.25,
      scale: 0.9,
      headerTemplate: `<div style="width:100%; padding:0 0.25in; color:#1f2933; font:9px 'Microsoft YaHei UI', sans-serif;"><span>${printTime}</span></div>`,
      footerTemplate: '<div style="width:100%; padding:0 0.25in; color:#5f6b72; font:8px Arial, sans-serif; text-align:right;"><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
    });
    if (!pdf.data) throw new Error('浏览器未返回可保存的 PDF 数据');
    await fs.promises.writeFile(filePath, Buffer.from(pdf.data, 'base64'));
    return { format: 'pdf' };
  }

  async stop() {
    try { this.ws?.close(); } catch (_) { /* Ignore a closed socket. */ }
    const processId = this.proc?.pid;
    if (!processId) return;
    await terminateProcessTree(processId);
    this.proc = null;
  }
}

module.exports = { NativeSession, sleep };
