const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findBrowser() {
  const candidates = [
    process.env.EDGE_EXE,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
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
  }

  async start(url) {
    if (!this.browserPath) throw new Error('未找到 Microsoft Edge 或 Google Chrome，无法启动原生浏览器会话');
    this.port = await freePort();
    fs.mkdirSync(this.profileDir, { recursive: true });
    this.proc = spawn(this.browserPath, [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-position=-32000,-32000',
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
      url
    ], { windowsHide: true });
    this.proc.once('error', (error) => this.log(`原生浏览器启动失败：${error.message}`));

    // Do not attach automation while the anti-bot page is solving its JS challenge.
    const target = await this.waitForPage(url, 45_000);
    await this.connect(target.webSocketDebuggerUrl);
    await this.command('Page.enable');
    await this.command('Runtime.enable');
    this.log('原生浏览器会话已就绪');
  }

  async waitForPage(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let announced = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/json/list`);
        const pages = await response.json();
        const target = pages.find((item) => item.type === 'page' && item.url.includes(new URL(url).hostname));
        if (target?.title && !/安全验证|访问验证|人机验证|just a moment/i.test(target.title)) return target;
      } catch (_) {
        // Browser remote debugging endpoint is not ready yet.
      }
      if (!announced) {
        this.log('正在等待原生浏览器通过网站安全检查');
        announced = true;
      }
      await sleep(1000);
    }
    throw new Error('浏览器安全检查未在 45 秒内完成');
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result?.value;
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
      await fs.promises.writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
      return { truncated: originalHeight > 20000, originalHeight };
    } finally {
      try { await this.command('Emulation.clearDeviceMetricsOverride'); } catch (_) { /* Browser may already have closed. */ }
    }
  }

  stop() {
    try { this.ws?.close(); } catch (_) { /* Ignore a closed socket. */ }
    if (this.proc && !this.proc.killed) this.proc.kill();
  }
}

module.exports = { NativeSession, sleep };
