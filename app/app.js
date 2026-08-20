const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'capture-tool-settings-v1';
const state = { running: false, paused: false, outputFolder: '', reportPath: '', rows: [] };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function showView(view) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  document.querySelectorAll('.view').forEach((section) => section.classList.toggle('active', section.id === `${view}-view`));
}

function companies() {
  return [...new Set($('companies').value.split(/\r?\n|,|，/).map((name) => name.trim()).filter(Boolean))];
}

function updateCompanyCount() { $('company-count').textContent = `共 ${companies().length} 家`; }

function settings() {
  return {
    outputBase: $('setting-output-path').value.trim(),
    siteRetry: Math.max(1, Math.min(10, Number($('site-retry').value) || 5)),
    captchaRetry: Math.max(1, Math.min(10, Number($('captcha-retry').value) || 5)),
    randomDelay: $('random-delay').checked
  };
}

function saveSettings(silent = false) {
  const current = settings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  $('output-path').value = current.outputBase;
  if (!silent) toast('设置已保存');
}

function applySettings(values) {
  $('setting-output-path').value = values.outputBase || '';
  $('output-path').value = values.outputBase || '';
  $('site-retry').value = values.siteRetry || 5;
  $('captcha-retry').value = values.captchaRetry || 5;
  $('random-delay').checked = values.randomDelay !== false;
}

function clearResultRows() {
  state.rows = [];
  $('result-rows').innerHTML = '<tr class="empty"><td colspan="6">暂无执行记录</td></tr>';
}

function appendResultRow(row) {
  state.rows.push(row);
  const body = $('result-rows');
  if (body.querySelector('.empty')) body.innerHTML = '';
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${escapeHtml(row.company)}</td><td>${escapeHtml(row.site)}</td><td>${escapeHtml(row.query)}</td><td><span class="status ${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td><td>${escapeHtml(row.reason || '')}</td><td>${escapeHtml(row.screenshot || '')}</td>`;
  body.append(tr);
}

function appendLog(message, level = '') {
  const log = $('run-log');
  if (log.textContent === '等待任务开始。') log.textContent = '';
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${now}] ${level === 'error' ? '错误：' : ''}${message}`;
  log.append(entry);
  log.scrollTop = log.scrollHeight;
}

function setRunState(text, kind = '') {
  const element = $('run-state');
  element.textContent = text;
  element.className = `task-state ${kind}`;
}

function setControls() {
  $('pause-task').disabled = !state.running;
  $('stop-task').disabled = !state.running;
  $('pause-task').textContent = state.paused ? '继续' : '暂停';
}

function resetProgress() {
  $('progress-fill').style.width = '0%';
  $('progress-title').textContent = '尚未开始';
  $('progress-status').textContent = '等待创建任务';
  setRunState('准备执行', 'running');
}

async function chooseFolder(target) {
  const folder = await window.electronAPI?.chooseFolder();
  if (!folder) return;
  $(target).value = folder;
  if (target === 'setting-output-path') {
    $('output-path').value = folder;
    saveSettings(true);
  }
  inspectResume();
}

let inspectTimer;
function inspectResume() {
  clearTimeout(inspectTimer);
  inspectTimer = setTimeout(async () => {
    const project = $('project-name').value.trim();
    const outputBase = $('output-path').value.trim();
    if (!project || !outputBase || !window.electronAPI) return;
    const inspection = await window.electronAPI.inspectTask(outputBase, project);
    if (!inspection.resumable) {
      $('resume-notice').classList.add('hidden');
      return;
    }
    const done = inspection.state.completed.length;
    const total = inspection.state.companies.length * 2;
    $('resume-copy').textContent = `“${inspection.state.project}”已完成 ${done}/${total} 项。`;
    $('resume-notice').classList.remove('hidden');
  }, 250);
}

async function startTask(mode = {}) {
  const project = $('project-name').value.trim();
  const list = companies();
  const outputBase = $('output-path').value.trim();
  if (!project) return toast('请填写项目名称');
  if (!list.length) return toast('请至少输入一家企业');
  if (list.length > 500) return toast('单批公司数量上限为 500 家');
  if (!outputBase) return toast('请选择保存路径');
  saveSettings(true);
  state.running = true;
  state.paused = false;
  state.outputFolder = '';
  state.reportPath = '';
  clearResultRows();
  $('result-summary').textContent = '任务正在执行，明细将实时写入。';
  $('result-summary').classList.remove('done');
  $('open-output').disabled = true;
  $('open-report').disabled = true;
  $('resume-notice').classList.add('hidden');
  resetProgress();
  $('run-log').textContent = '';
  setControls();
  showView('progress');
  let result;
  try {
    result = await window.electronAPI.startTask({ project, companies: list, outputBase, settings: settings(), ...mode });
  } catch (error) {
    state.running = false;
    setControls();
    toast(`任务启动失败：${error.message}`);
    return;
  }
  if (!result?.ok) {
    state.running = false;
    setControls();
    if (result?.resumeAvailable) {
      inspectResume();
      toast('发现未完成任务，请选择继续或重新开始');
    } else toast(result?.message || '任务启动失败');
  }
}

async function importCompanies(file) {
  if (!file) return;
  try {
    let names = [];
    if (/\.xlsx?$|\.xls$/i.test(file.name)) names = await window.electronAPI.parseExcel(await file.arrayBuffer());
    else names = (await file.text()).replace(/\r/g, '').split(/\n|,/).map((name) => name.trim()).filter(Boolean);
    $('companies').value = [...new Set(names)].join('\n');
    $('file-note').textContent = `${file.name} 已读取 ${names.length} 家`;
    updateCompanyCount();
  } catch (error) { toast(`导入失败：${error.message}`); }
}

function handleTaskUpdate(update) {
  if (update.type === 'started') { state.outputFolder = update.folder; appendLog(update.message); return; }
  if (update.type === 'log') { appendLog(update.message, update.level); return; }
  if (update.type === 'paused') { state.paused = true; setRunState('已暂停', 'paused'); appendLog(update.message); setControls(); return; }
  if (update.type === 'resumed') { state.paused = false; setRunState('运行中', 'running'); appendLog(update.message); setControls(); return; }
  if (update.type === 'stopping') { appendLog(update.message); return; }
  if (update.type === 'item') { appendResultRow(update); return; }
  if (update.type === 'progress') {
    const percent = Math.round((update.done / Math.max(update.total, 1)) * 100);
    $('progress-fill').style.width = `${percent}%`;
    $('progress-title').textContent = `第 ${update.companyIndex}/${update.companyTotal} 家公司，完成 ${update.done}/${update.total} 项`;
    $('progress-status').textContent = `${update.company} -> ${update.siteName}（${update.query}）：${update.status}`;
    return;
  }
  if (update.type === 'completed') {
    state.running = false;
    state.paused = false;
    state.outputFolder = update.folder;
    state.reportPath = update.reportPath;
    setControls();
    setRunState(update.summary.cancelled ? '任务已取消' : '任务完成');
    $('result-state').textContent = update.summary.cancelled ? '任务已取消' : '任务完成';
    $('result-summary').classList.add('done');
    $('result-summary').textContent = `${update.summary.cancelled ? '任务已取消' : '任务完成'}：成功 ${update.summary.success} 项，无记录 ${update.summary.noRecord} 项，失败 ${update.summary.failed} 项，验证码未通过 ${update.summary.captcha} 项。`;
    clearResultRows();
    update.rows.forEach(appendResultRow);
    $('open-output').disabled = !update.folder;
    $('open-report').disabled = !update.reportPath;
    appendLog(update.message);
    showView('result');
  }
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
$('companies').addEventListener('input', updateCompanyCount);
$('clear-companies').addEventListener('click', () => { $('companies').value = ''; updateCompanyCount(); });
$('company-file').addEventListener('change', (event) => importCompanies(event.target.files[0]));
$('choose-path').addEventListener('click', () => chooseFolder('output-path'));
$('choose-setting-path').addEventListener('click', () => chooseFolder('setting-output-path'));
$('project-name').addEventListener('input', inspectResume);
$('output-path').addEventListener('change', inspectResume);
$('start-task').addEventListener('click', () => startTask());
$('resume-task').addEventListener('click', () => startTask({ resume: true }));
$('restart-task').addEventListener('click', () => startTask({ restart: true }));
$('pause-task').addEventListener('click', async () => {
  if (!state.running) return;
  state.paused = !state.paused;
  await (state.paused ? window.electronAPI.pauseTask() : window.electronAPI.resumeTask());
  setControls();
});
$('stop-task').addEventListener('click', async () => { if (state.running) await window.electronAPI.stopTask(); });
$('open-output').addEventListener('click', () => window.electronAPI.openFolder(state.outputFolder));
$('open-report').addEventListener('click', () => window.electronAPI.openReport(state.reportPath));
$('save-settings').addEventListener('click', () => saveSettings());
window.electronAPI?.onTaskUpdate(handleTaskUpdate);

(async function initialize() {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  const defaults = await window.electronAPI?.defaults();
  applySettings({ outputBase: defaults?.outputBase || '', siteRetry: 5, captchaRetry: 5, randomDelay: true, ...stored });
  updateCompanyCount();
  inspectResume();
}());
