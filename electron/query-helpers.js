/**
 * 查询流程辅助函数
 * 提供鲁棒的查询流程封装和异常处理
 */

const {
  randomDelay,
  waitForElementReady,
  waitForPageLoad,
  naturalPageDwell,
  detectAnomalies,
  checkPageHealth,
  retryWithBackoff
} = require('./human-behavior');

/**
 * 注入反自动化检测脚本
 * @param {NativeSession} session - 会话对象
 */
async function injectAntiDetectionScript(session) {
  try {
    await session.evaluate(() => {
      // 隐藏 webdriver 属性
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // 伪装 Chrome 对象
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
      }

      // 修改 permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );

      // 伪装插件数量
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin' },
          { name: 'Chrome PDF Viewer' },
          { name: 'Native Client' }
        ],
      });

      // 伪装语言
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      });

      // 伪装 platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
      });

      // 伪装 hardwareConcurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });

      // 伪装 deviceMemory
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    });
  } catch (error) {
    // 静默失败，不影响主流程
    console.log('反检测脚本注入失败:', error.message);
  }
}

/**
 * 鲁棒的页面导航
 * @param {NativeSession} session - 会话对象
 * @param {string} url - 目标 URL
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function robustNavigate(session, url, options = {}) {
  const {
    timeout = 30000,
    waitForLoad = true,
    injectAntiDetection = true
  } = options;

  return retryWithBackoff(
    async (attempt) => {
      // 导航到页面
      await session.navigate(url);

      // 等待页面加载
      if (waitForLoad) {
        const loadResult = await waitForPageLoad(session, { timeout });
        if (!loadResult.ok) {
          throw new Error(`页面加载失败: ${loadResult.reason}`);
        }
      }

      // 注入反检测脚本
      if (injectAntiDetection) {
        await injectAntiDetectionScript(session);
      }

      // 检查页面健康状态
      const health = await checkPageHealth(session);
      if (!health.healthy) {
        throw new Error(`页面状态异常: ${Object.entries(health.checks).filter(([k, v]) => !v).map(([k]) => k).join(', ')}`);
      }

      // 检测异常情况
      const anomalies = await detectAnomalies(session);
      if (anomalies.hasAnomalies) {
        const criticalAnomalies = ['accessDenied', 'maintenance'];
        const hasCritical = anomalies.detected.some(a => criticalAnomalies.includes(a));

        if (hasCritical) {
          throw new Error(`页面异常: ${anomalies.detected.join(', ')}`);
        }

        // 非关键异常，记录但继续
        console.log(`检测到非关键异常: ${anomalies.detected.join(', ')}`);
      }

      return { ok: true };
    },
    {
      maxRetries: 2,
      baseDelay: 2000,
      shouldRetry: (error) => {
        // 可重试的错误
        const retryableErrors = [
          '页面加载失败',
          '页面状态异常',
          'rateLimited',
          'serverError',
          'networkError'
        ];
        return retryableErrors.some(msg => error.message.includes(msg));
      },
      onRetry: (error, attempt, delay) => {
        console.log(`页面导航失败，${delay}ms 后重试 (${attempt}): ${error.message}`);
      }
    }
  );
}

/**
 * 鲁棒的元素等待和交互准备
 * @param {NativeSession} session - 会话对象
 * @param {string} selector - CSS 选择器
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} {ok: boolean, reason?: string}
 */
async function prepareForInteraction(session, selector, options = {}) {
  const {
    timeout = 15000,
    scrollIntoView = true,
    addNaturalDelay = true
  } = options;

  // 等待元素就绪
  const readyResult = await waitForElementReady(session, selector, {
    timeout,
    checkVisible: true,
    checkEnabled: true
  });

  if (!readyResult.ok) {
    return readyResult;
  }

  // 滚动到元素可见区域
  if (scrollIntoView) {
    await session.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, selector);

    await randomDelay(300, 600);
  }

  // 添加自然延迟
  if (addNaturalDelay) {
    await randomDelay(200, 500);
  }

  return { ok: true };
}

/**
 * 智能等待查询结果
 * @param {NativeSession} session - 会话对象
 * @param {Function} checkResultFn - 检查结果的函数，返回 {ready: boolean, result?: any}
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 检查函数返回的结果
 */
async function waitForQueryResult(session, checkResultFn, options = {}) {
  const {
    timeout = 30000,
    checkInterval = 800,
    stableCount = 2
  } = options;

  const deadline = Date.now() + timeout;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let consecutiveReadyCount = 0;
  let lastResult = null;

  while (Date.now() < deadline) {
    const result = await checkResultFn(session);

    if (result.ready) {
      consecutiveReadyCount += 1;
      lastResult = result.result;

      if (consecutiveReadyCount >= stableCount) {
        return lastResult;
      }
    } else {
      consecutiveReadyCount = 0;
    }

    await sleep(checkInterval);
  }

  throw new Error('等待查询结果超时');
}

/**
 * 处理页面异常情况
 * @param {NativeSession} session - 会话对象
 * @param {Object} anomalies - 异常检测结果
 * @param {string} url - 当前 URL
 * @returns {Promise<Object>} {handled: boolean, shouldRetry: boolean}
 */
async function handlePageAnomalies(session, anomalies, url) {
  if (!anomalies.hasAnomalies) {
    return { handled: false, shouldRetry: false };
  }

  for (const anomaly of anomalies.detected) {
    switch (anomaly) {
      case 'rateLimited':
        console.log('检测到访问频率限制，等待 30 秒...');
        await randomDelay(30000, 40000);
        return { handled: true, shouldRetry: true };

      case 'sessionExpired':
        console.log('会话过期，清除缓存并重试...');
        try {
          await session.command('Network.clearBrowserCookies');
          await session.command('Network.clearBrowserCache');
        } catch (e) {
          console.log('清除缓存失败:', e.message);
        }
        await randomDelay(5000, 8000);
        return { handled: true, shouldRetry: true };

      case 'accessDenied':
      case 'serverError':
        console.log(`检测到 ${anomaly}，等待后重试...`);
        await randomDelay(10000, 15000);
        return { handled: true, shouldRetry: true };

      case 'maintenance':
        throw new Error('网站正在维护中');

      case 'networkError':
        console.log('检测到网络错误，短暂等待后重试...');
        await randomDelay(5000, 8000);
        return { handled: true, shouldRetry: true };

      default:
        console.log(`检测到异常情况: ${anomaly}`);
    }
  }

  return { handled: true, shouldRetry: false };
}

/**
 * 增强的查询流程包装器
 * @param {Function} queryFn - 实际执行查询的函数
 * @param {Object} context - 查询上下文 {session, company, query, ...}
 * @param {Object} options - 配置选项
 * @returns {Promise<any>} 查询结果
 */
async function enhancedQueryFlow(queryFn, context, options = {}) {
  const {
    maxRetries = 3,
    addNaturalBehavior = true,
    checkAnomalies = true
  } = options;

  const { session, query } = context;

  return retryWithBackoff(
    async (attempt) => {
      // 1. 鲁棒的页面导航
      const navResult = await robustNavigate(session, query.url, {
        timeout: 30000,
        waitForLoad: true,
        injectAntiDetection: true
      });

      if (!navResult.ok) {
        throw new Error(`页面导航失败: ${navResult.reason}`);
      }

      // 2. 模拟自然浏览行为
      if (addNaturalBehavior) {
        await naturalPageDwell(session);
      }

      // 3. 执行实际查询
      const result = await queryFn(context, attempt);

      return result;
    },
    {
      maxRetries,
      baseDelay: 2000,
      maxDelay: 15000,
      shouldRetry: (error, attempt) => {
        // 可重试的错误类型
        const retryableErrors = [
          '页面加载',
          '元素不存在',
          '验证码',
          '网络',
          '超时',
          '页面结构'
        ];
        return retryableErrors.some(msg => error.message.includes(msg));
      },
      onRetry: (error, attempt, delay) => {
        console.log(`查询失败，${delay}ms 后进行第 ${attempt} 次重试: ${error.message}`);
      }
    }
  );
}

module.exports = {
  injectAntiDetectionScript,
  robustNavigate,
  prepareForInteraction,
  waitForQueryResult,
  handlePageAnomalies,
  enhancedQueryFlow
};
