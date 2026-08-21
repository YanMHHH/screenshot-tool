const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { issueLicense } = require('./signer');

let mainWindow;
let privateKey = null;

function defaultKeyPath() {
  if (app.isPackaged) return path.join(path.dirname(process.execPath), 'private-key.pem');
  return path.join(__dirname, 'private-key.pem');
}

async function tryLoadKeyFromPath(keyPath) {
  try {
    const pem = await fs.readFile(keyPath, 'utf8');
    if (!pem.includes('PRIVATE KEY')) throw new Error('不是有效的 PEM 私钥文件');
    return pem;
  } catch (_) {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 640, height: 600, minWidth: 500, minHeight: 500,
    backgroundColor: '#f2f5f3',
    title: '镜核授权签发工具',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  ipcMain.handle('key:load', async () => {
    const defaultPath = defaultKeyPath();
    const loaded = await tryLoadKeyFromPath(defaultPath);
    if (loaded) { privateKey = loaded; return { ok: true, path: defaultPath }; }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择私钥文件', properties: ['openFile'],
      filters: [{ name: '私钥文件', extensions: ['pem'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, message: '未选择私钥文件' };
    const pem = await tryLoadKeyFromPath(result.filePaths[0]);
    if (!pem) return { ok: false, message: '无法读取私钥文件，请确认文件格式正确' };
    privateKey = pem;
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('license:issue', async (_event, params) => {
    if (!privateKey) return { ok: false, message: '尚未加载私钥，请先点击"加载私钥"' };
    try {
      const license = issueLicense({ privateKey, ...params });
      return { ok: true, license };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });

  ipcMain.handle('file:save', async (_event, filename, content) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存授权文件', defaultPath: filename,
      filters: [{ name: '镜核授权文件', extensions: ['jinghe-license'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    await fs.writeFile(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
