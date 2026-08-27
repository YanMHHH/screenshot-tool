/**
 * 人类行为模拟工具
 * 用于让自动化操作更接近真实用户行为，提高稳定性
 */

/**
 * 生成指定范围内的随机数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 随机数
 */
function random(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * 生成正态分布的随机数（使用 Box-Muller 变换）
 * @param {number} mean - 均值
 * @param {number} stdDev - 标准差
 * @returns {number} 正态分布随机数
 */
function randomNormal(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * 随机延迟（模拟人类反应时间）
 * @param {number} minMs - 最小延迟（毫秒）
 * @param {number} maxMs - 最大延迟（毫秒）
 * @returns {Promise<void>}
 */
async function randomDelay(minMs = 100, maxMs = 500) {
  const delay = random(minMs, maxMs);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 在元素范围内生成随机点击坐标
 * @param {Object} rect - 元素的 DOMRect 对象 {x, y, width, height}
 * @param {Object} options - 配置选项
 * @param {number} options.marginRatio - 边缘留白比例（0-0.5），默认 0.1
 * @param {string} options.bias - 偏向位置：'center' | 'random'，默认 'center'
 * @returns {Object} {x, y} 相对于视口的坐标
 */
function getRandomClickPoint(rect, options = {}) {
  const { marginRatio = 0.1, bias = 'center' } = options;

  // 计算有效点击区域（去除边缘）
  const marginX = rect.width * marginRatio;
  const marginY = rect.height * marginRatio;
  const effectiveWidth = rect.width - 2 * marginX;
  const effectiveHeight = rect.height - 2 * marginY;

  let offsetX, offsetY;

  if (bias === 'center') {
    // 偏向中心的正态分布
    offsetX = randomNormal(effectiveWidth / 2, effectiveWidth / 6);
    offsetY = randomNormal(effectiveHeight / 2, effectiveHeight / 6);

    // 限制在有效范围内
    offsetX = Math.max(0, Math.min(effectiveWidth, offsetX));
    offsetY = Math.max(0, Math.min(effectiveHeight, offsetY));
  } else {
    // 完全随机
    offsetX = random(0, effectiveWidth);
    offsetY = random(0, effectiveHeight);
  }

  return {
    x: rect.x + marginX + offsetX,
    y: rect.y + marginY + offsetY
  };
}

/**
 * 生成贝塞尔曲线鼠标移动路径
 * @param {Object} start - 起始点 {x, y}
 * @param {Object} end - 结束点 {x, y}
 * @param {number} steps - 路径点数量
 * @returns {Array<Object>} 路径点数组 [{x, y}, ...]
 */
function generateMousePath(start, end, steps = 20) {
  const path = [];

  // 生成两个控制点，创建贝塞尔曲线
  const cp1 = {
    x: start.x + (end.x - start.x) * random(0.2, 0.4) + random(-50, 50),
    y: start.y + (end.y - start.y) * random(0.2, 0.4) + random(-50, 50)
  };

  const cp2 = {
    x: start.x + (end.x - start.x) * random(0.6, 0.8) + random(-50, 50),
    y: start.y + (end.y - start.y) * random(0.6, 0.8) + random(-50, 50)
  };

  // 三次贝塞尔曲线插值
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    const x = mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x;
    const y = mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y;

    path.push({ x: Math.round(x), y: Math.round(y) });
  }

  return path;
}

/**
 * 模拟人类点击（带随机位置和延迟）
 * 在浏览器上下文中执行
 * @param {string} selector - CSS 选择器
 * @param {Object} options - 配置选项
 * @returns {Object} {ok: boolean, reason?: string}
 */
const humanClickScript = `
function(selector, options = {}) {
  const element = document.querySelector(selector);
  if (!element) return { ok: false, reason: '元素不存在' };

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { ok: false, reason: '元素不可见' };
  }

  const { marginRatio = 0.1, bias = 'center' } = options;

  // 生成随机点击坐标
  function randomNormal(mean, stdDev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  const marginX = rect.width * marginRatio;
  const marginY = rect.height * marginRatio;
  const effectiveWidth = rect.width - 2 * marginX;
  const effectiveHeight = rect.height - 2 * marginY;

  let offsetX, offsetY;

  if (bias === 'center') {
    offsetX = randomNormal(effectiveWidth / 2, effectiveWidth / 6);
    offsetY = randomNormal(effectiveHeight / 2, effectiveHeight / 6);
    offsetX = Math.max(0, Math.min(effectiveWidth, offsetX));
    offsetY = Math.max(0, Math.min(effectiveHeight, offsetY));
  } else {
    offsetX = random(0, effectiveWidth);
    offsetY = random(0, effectiveHeight);
  }

  const clickX = rect.x + marginX + offsetX;
  const clickY = rect.y + marginY + offsetY;

  // 触发完整的鼠标事件序列
  const events = ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'];

  events.forEach(eventType => {
    const event = new MouseEvent(eventType, {
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: clickX,
      clientY: clickY,
      button: 0
    });
    element.dispatchEvent(event);
  });

  return { ok: true, x: clickX, y: clickY };
}
`;

/**
 * 模拟人类输入（带随机速度）
 * 在浏览器上下文中执行
 * @param {string} selector - CSS 选择器
 * @param {string} text - 要输入的文本
 * @param {Object} options - 配置选项
 * @returns {Object} {ok: boolean, reason?: string}
 */
const humanTypeScript = `
async function(selector, text, options = {}) {
  const element = document.querySelector(selector);
  if (!element) return { ok: false, reason: '元素不存在' };

  const { minDelay = 50, maxDelay = 150, mistakes = true } = options;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  // 清空现有内容
  element.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  if (setter) {
    setter.call(element, '');
  } else {
    element.value = '';
  }

  let currentValue = '';

  // 逐字符输入
  for (let i = 0; i < text.length; i++) {
    // 随机延迟
    const delay = random(minDelay, maxDelay);
    await sleep(delay);

    // 偶尔模拟输入错误（10%概率）
    if (mistakes && Math.random() < 0.1 && i < text.length - 1) {
      const wrongChar = String.fromCharCode(text.charCodeAt(i) + Math.floor(random(-2, 3)));
      currentValue += wrongChar;

      if (setter) {
        setter.call(element, currentValue);
      } else {
        element.value = currentValue;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));

      // 短暂延迟后删除
      await sleep(random(100, 200));
      currentValue = currentValue.slice(0, -1);
    }

    currentValue += text[i];

    if (setter) {
      setter.call(element, currentValue);
    } else {
      element.value = currentValue;
    }

    // 触发输入事件
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: text[i] }));
    element.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: text[i] }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text[i] }));
  }

  // 触发 change 事件
  element.dispatchEvent(new Event('change', { bubbles: true }));

  return { ok: true };
}
`;

/**
 * 在会话中执行人类化点击
 * @param {NativeSession} session - 会话对象
 * @param {string} selector - CSS 选择器
 * @param {Object} options - 配置选项
 * @param {number} options.delayBefore - 点击前延迟（毫秒）
 * @param {number} options.delayAfter - 点击后延迟（毫秒）
 * @param {number} options.marginRatio - 边缘留白比例
 * @param {string} options.bias - 偏向位置
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function humanClick(session, selector, options = {}) {
  const {
    delayBefore = [100, 300],
    delayAfter = [200, 500],
    marginRatio = 0.1,
    bias = 'center'
  } = options;

  // 点击前随机延迟
  const [minBefore, maxBefore] = Array.isArray(delayBefore) ? delayBefore : [delayBefore, delayBefore];
  await randomDelay(minBefore, maxBefore);

  // 执行点击
  const result = await session.evaluate(
    new Function('return ' + humanClickScript)(),
    selector,
    { marginRatio, bias }
  );

  if (!result.ok) return result;

  // 点击后随机延迟
  const [minAfter, maxAfter] = Array.isArray(delayAfter) ? delayAfter : [delayAfter, delayAfter];
  await randomDelay(minAfter, maxAfter);

  return result;
}

/**
 * 在会话中执行人类化输入
 * @param {NativeSession} session - 会话对象
 * @param {string} selector - CSS 选择器
 * @param {string} text - 要输入的文本
 * @param {Object} options - 配置选项
 * @param {number} options.minDelay - 最小按键延迟（毫秒）
 * @param {number} options.maxDelay - 最大按键延迟（毫秒）
 * @param {boolean} options.mistakes - 是否模拟输入错误
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function humanType(session, selector, text, options = {}) {
  const {
    minDelay = 50,
    maxDelay = 150,
    mistakes = false // 默认关闭，避免在关键输入中出错
  } = options;

  return session.evaluate(
    new Function('return ' + humanTypeScript)(),
    selector,
    text,
    { minDelay, maxDelay, mistakes }
  );
}

/**
 * 等待元素出现并可交互
 * @param {NativeSession} session - 会话对象
 * @param {string} selector - CSS 选择器
 * @param {Object} options - 配置选项
 * @param {number} options.timeout - 超时时间（毫秒）
 * @param {number} options.checkInterval - 检查间隔（毫秒）
 * @param {boolean} options.checkVisible - 是否检查可见性
 * @param {boolean} options.checkEnabled - 是否检查启用状态
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function waitForElementReady(session, selector, options = {}) {
  const {
    timeout = 30000,
    checkInterval = 500,
    checkVisible = true,
    checkEnabled = true
  } = options;

  const deadline = Date.now() + timeout;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  while (Date.now() < deadline) {
    const result = await session.evaluate((sel, opts) => {
      const element = document.querySelector(sel);
      if (!element) return { ready: false, reason: '元素不存在' };

      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      // 检查可见性
      if (opts.checkVisible) {
        if (rect.width === 0 || rect.height === 0) {
          return { ready: false, reason: '元素尺寸为0' };
        }
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return { ready: false, reason: '元素被隐藏' };
        }
      }

      // 检查是否启用
      if (opts.checkEnabled && element.disabled) {
        return { ready: false, reason: '元素被禁用' };
      }

      return { ready: true };
    }, selector, { checkVisible, checkEnabled });

    if (result.ready) return { ok: true };

    await sleep(checkInterval);
  }

  return { ok: false, reason: '等待元素就绪超时' };
}

/**
 * 等待页面加载完成
 * @param {NativeSession} session - 会话对象
 * @param {Object} options - 配置选项
 * @param {number} options.timeout - 超时时间（毫秒）
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function waitForPageLoad(session, options = {}) {
  const { timeout = 30000 } = options;
  const deadline = Date.now() + timeout;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  while (Date.now() < deadline) {
    const state = await session.evaluate(() => {
      return {
        readyState: document.readyState,
        // 检查是否有加载中的资源
        hasLoadingResources: !!document.querySelector('[loading], .loading, .spinner'),
        // 检查 body 是否存在且有内容
        hasContent: document.body && document.body.children.length > 0
      };
    });

    if (state.readyState === 'complete' && !state.hasLoadingResources && state.hasContent) {
      return { ok: true };
    }

    await sleep(500);
  }

  return { ok: false, reason: '页面加载超时' };
}

/**
 * 随机滚动页面（模拟浏览行为）
 * @param {NativeSession} session - 会话对象
 * @param {Object} options - 配置选项
 * @param {number} options.minScrolls - 最小滚动次数
 * @param {number} options.maxScrolls - 最大滚动次数
 * @param {number} options.maxDistance - 最大滚动距离
 * @returns {Promise<void>}
 */
async function randomScroll(session, options = {}) {
  const {
    minScrolls = 1,
    maxScrolls = 3,
    maxDistance = 500
  } = options;

  const scrollCount = Math.floor(random(minScrolls, maxScrolls + 1));

  for (let i = 0; i < scrollCount; i++) {
    await session.evaluate((distance) => {
      window.scrollBy({
        top: distance,
        behavior: 'smooth'
      });
    }, Math.floor(random(-maxDistance, maxDistance)));

    await randomDelay(500, 1500);
  }
}

/**
 * 随机鼠标移动（模拟浏览行为）
 * @param {NativeSession} session - 会话对象
 * @param {Object} options - 配置选项
 * @param {number} options.moves - 移动次数
 * @returns {Promise<void>}
 */
async function randomMouseMove(session, options = {}) {
  const { moves = 3 } = options;

  for (let i = 0; i < moves; i++) {
    await session.evaluate(() => {
      const x = Math.random() * window.innerWidth;
      const y = Math.random() * window.innerHeight;

      const event = new MouseEvent('mousemove', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y
      });

      document.dispatchEvent(event);
    });

    await randomDelay(100, 300);
  }
}

/**
 * 模拟自然的页面停留行为
 * @param {NativeSession} session - 会话对象
 * @returns {Promise<void>}
 */
async function naturalPageDwell(session) {
  // 模拟真实用户浏览页面的时间
  await randomDelay(1500, 3000);
  await randomMouseMove(session, { moves: 2 });
  await randomDelay(800, 1500);
  await randomScroll(session, { minScrolls: 1, maxScrolls: 2, maxDistance: 300 });
  await randomDelay(500, 1000);
}

/**
 * 检测页面异常情况（反爬虫页面、错误页面等）
 * @param {NativeSession} session - 会话对象
 * @returns {Promise<Object>} {hasAnomalies: boolean, detected: Array<string>, text: string}
 */
async function detectAnomalies(session) {
  return session.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || '';
    const title = document.title.toLowerCase();

    const anomalies = {
      captchaChallenge: /验证码|captcha|robot|人机验证/.test(text),
      accessDenied: /access denied|拒绝访问|403|forbidden/.test(text),
      rateLimited: /too many requests|请求过于频繁|稍后再试/.test(text),
      serverError: /500|服务器错误|server error|内部错误/.test(text),
      networkError: /网络错误|network error|连接失败/.test(text),
      sessionExpired: /会话过期|session expired|重新登录/.test(text),
      maintenance: /维护中|maintenance|系统升级/.test(text)
    };

    const detected = Object.entries(anomalies)
      .filter(([_, value]) => value)
      .map(([key]) => key);

    return {
      hasAnomalies: detected.length > 0,
      detected,
      text: text.substring(0, 200)
    };
  });
}

/**
 * 检查页面健康状态
 * @param {NativeSession} session - 会话对象
 * @returns {Promise<Object>} {healthy: boolean, checks: Object, url: string, title: string}
 */
async function checkPageHealth(session) {
  return session.evaluate(() => {
    const checks = {
      documentReady: document.readyState === 'complete',
      hasBody: !!document.body,
      hasContent: document.body && document.body.children.length > 0,
      noErrors: !document.querySelector('.error, .error-page, #error'),
      notBlank: document.body && document.body.innerText.trim().length > 10
    };

    const healthy = Object.values(checks).every(v => v);

    return {
      healthy,
      checks,
      url: window.location.href,
      title: document.title
    };
  });
}

/**
 * 智能重试包装器
 * @param {Function} fn - 要执行的函数
 * @param {Object} options - 配置选项
 * @returns {Promise<any>} 函数执行结果
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 15000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry = () => {}
  } = options;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // 检查是否应该重试
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      // 计算延迟时间（指数退避）
      const delay = Math.min(
        baseDelay * Math.pow(backoffMultiplier, attempt - 1),
        maxDelay
      );

      // 添加随机抖动（±20%）
      const jitter = delay * 0.2 * (Math.random() * 2 - 1);
      const actualDelay = Math.floor(delay + jitter);

      onRetry(error, attempt, actualDelay);
      await sleep(actualDelay);
    }
  }

  throw lastError;
}

module.exports = {
  random,
  randomNormal,
  randomDelay,
  getRandomClickPoint,
  generateMousePath,
  humanClick,
  humanType,
  waitForElementReady,
  waitForPageLoad,
  randomScroll,
  randomMouseMove,
  naturalPageDwell,
  detectAnomalies,
  checkPageHealth,
  retryWithBackoff
};
