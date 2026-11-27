const { app, BrowserWindow, Menu, ipcMain, clipboard, shell, screen, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isMac = process.platform === 'darwin';
const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
const THEME_BACKGROUNDS = { light: '#F7F8F7', mist: '#DDE5E2', dark: '#161A18' };

if (process.platform === 'win32') app.setAppUserModelId('com.pomo.workbench');

let mainWin = null;
let widgetWin = null;
let configuredCacheDir = null;

function readInstallerStorage() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;

  try {
    const buffer = fs.readFileSync(path.join(path.dirname(process.execPath), 'storage.ini'));
    let text;
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      text = buffer.subarray(2).toString('utf16le');
    } else {
      text = buffer.toString('utf8').replace(/^\uFEFF/, '');
      if (text.includes('\0')) text = buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }

    const config = {};
    let section = '';
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;
      const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1].toLowerCase();
        continue;
      }
      const separator = line.indexOf('=');
      if (section === 'storage' && separator > 0) {
        config[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
    }
    return config;
  } catch (error) {
    return null;
  }
}

function normalizeConfiguredPath(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!path.win32.isAbsolute(trimmed)) return null;
  const normalized = path.win32.normalize(trimmed);
  return path.win32.dirname(normalized) === normalized ? null : normalized;
}

function directoryHasEntries(directory) {
  try {
    return fs.readdirSync(directory).length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function prepareDataDirectory(target, previous) {
  if (target.toLowerCase() === previous.toLowerCase()) {
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  const parent = path.dirname(target);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  if (directoryHasEntries(target) || !directoryHasEntries(previous)) {
    fs.mkdirSync(target, { recursive: true });
    return target;
  }

  const staging = `${target}.migrating-${process.pid}`;
  fs.mkdirSync(staging, { recursive: true });
  try {
    for (const name of ['Local Storage', 'widget.json']) {
      const source = path.join(previous, name);
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(staging, name), {
          recursive: true,
          force: false,
          errorOnExist: true
        });
      }
    }
    if (fs.existsSync(target)) {
      if (directoryHasEntries(target)) throw new Error('目标数据目录不为空');
      fs.rmdirSync(target);
    }
    fs.renameSync(staging, target);
    return target;
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function redirectCacheDirectory(dataDir, cacheDir, name) {
  const target = path.join(cacheDir, name);
  const link = path.join(dataDir, name);
  fs.mkdirSync(target, { recursive: true });

  try {
    const stat = fs.lstatSync(link);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(link).replace(/^\\\\\?\\/, '');
      const normalizeLink = value => path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
      if (normalizeLink(current) === normalizeLink(target)) return;
      fs.rmdirSync(link);
    } else {
      // 这里只会清理可再生的缓存，不会触碰 Local Storage 或 widget.json。
      fs.rmSync(link, { recursive: true, force: true });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.symlinkSync(target, link, 'junction');
}

function configureInstalledStorage() {
  const config = readInstallerStorage();
  if (!config) return;

  const previousUserData = app.getPath('userData');
  const previousSessionData = app.getPath('sessionData');
  const dataDir = normalizeConfiguredPath(config.DataDir);
  const cacheDir = normalizeConfiguredPath(config.CacheDir);
  let activeDataDir = previousUserData;

  if (dataDir) {
    try {
      const preparedDataDir = prepareDataDirectory(dataDir, previousUserData);
      app.setPath('userData', preparedDataDir);
      app.setPath('sessionData', preparedDataDir);
      activeDataDir = preparedDataDir;
    } catch (error) {
      try {
        app.setPath('userData', previousUserData);
        app.setPath('sessionData', previousSessionData);
      } catch (restoreError) {}
      console.warn('无法使用自定义数据目录，已保留原目录：', error.message);
    }
  }

  if (cacheDir) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      // Electron 将 HTTP 缓存固定在 sessionData 下，用目录联接分离缓存实体和任务数据。
      for (const name of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache']) {
        try {
          redirectCacheDirectory(activeDataDir, cacheDir, name);
        } catch (error) {
          console.warn(`无法重定向 ${name}：`, error.message);
        }
      }
      configuredCacheDir = cacheDir;
    } catch (error) {
      console.warn('无法使用自定义缓存目录，已保留原目录：', error.message);
    }
  }
}

configureInstalledStorage();

function getWin() {
  if (mainWin && !mainWin.isDestroyed()) return mainWin;
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

function widgetConfigPath() {
  return path.join(app.getPath('userData'), 'widget.json');
}

function loadWidgetConfig() {
  try {
    return JSON.parse(fs.readFileSync(widgetConfigPath(), 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function saveWidgetConfig(patch) {
  const next = Object.assign(loadWidgetConfig(), patch);
  try {
    fs.writeFileSync(widgetConfigPath(), JSON.stringify(next));
  } catch (e) {}
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {};
  } catch (error) {
    return {};
  }
}

function writeSettingsFile(patch) {
  const next = Object.assign(readSettingsFile(), patch);
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next));
  } catch (error) {
    console.warn('无法保存设置：', error.message);
  }
  return next;
}

function getAutoLaunch() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (error) {
    return false;
  }
}

function isSilentLaunch() {
  if (!app.isPackaged) return false;
  return process.argv.includes('--silent') || process.argv.includes('--hidden');
}

function setAutoLaunch(enabled) {
  const openAtLogin = !!enabled;
  if (app.isPackaged) {
    const options = { openAtLogin };
    if (process.platform === 'win32') {
      options.path = process.execPath;
      options.args = ['--silent'];
    }
    app.setLoginItemSettings(options);
  }
  writeSettingsFile({ autoLaunch: openAtLogin });
  return getAutoLaunch();
}

function currentSettings() {
  return { theme: readSettingsFile().theme || null, autoLaunch: getAutoLaunch() };
}

function dailyStorePath() {
  return path.join(app.getPath('userData'), 'daily.json');
}

function readDailyStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(dailyStorePath(), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    // 兼容旧格式：去掉 date 字段，保留所有任务
    const out = {};
    const COLS = ['todo', 'doing', 'done'];
    for (const c of COLS) {
      out[c] = Array.isArray(raw[c]) ? raw[c].filter(t => t && typeof t.id === 'string' && typeof t.title === 'string') : [];
    }
    return out;
  } catch (error) {
    return null;
  }
}

function writeDailyStore(payload) {
  if (!payload || typeof payload !== 'object') return false;
  try {
    const target = dailyStorePath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // 写入前备份旧文件，防止意外覆盖丢失
    if (fs.existsSync(target)) {
      try { fs.copyFileSync(target, `${target}.bak`); } catch (e) {}
    }
    const temp = `${target}.tmp`;
    const sanitized = {};
    const COLS = ['todo', 'doing', 'done'];
    for (const c of COLS) {
      sanitized[c] = Array.isArray(payload[c]) ? payload[c].filter(t => t && typeof t.id === 'string' && typeof t.title === 'string') : [];
    }
    fs.writeFileSync(temp, JSON.stringify(sanitized));
    fs.renameSync(temp, target);
  } catch (error) {
    return false;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('store:changed', payload);
  }
  return true;
}

function openMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.showInactive();
    return;
  }

  const cfg = loadWidgetConfig();
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 300;
  const height = 340;
  // 初始位置也要 clamp 到可用区域内，防止换显示器/分辨率后落屏外
  let x, y;
  if (Number.isFinite(cfg.x)) {
    x = Math.max(wa.x, Math.min(cfg.x, wa.x + wa.width - width));
  } else {
    x = wa.x + wa.width - width - 24;
  }
  if (Number.isFinite(cfg.y)) {
    y = Math.max(wa.y, Math.min(cfg.y, wa.y + wa.height - height));
  } else {
    y = wa.y + 24;
  }

  widgetWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    hasShadow: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  if (isMac) widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  widgetWin.loadFile(path.join(__dirname, '..', 'widget.html'));

  widgetWin.once('ready-to-show', () => widgetWin.showInactive());

  const SNAP_THRESHOLD = 30;

  let posTimer = null;
  widgetWin.on('moved', () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      const bounds = widgetWin.getBounds();
      const wa = screen.getPrimaryDisplay().workArea;

      // 1. 先强制边界限制，确保不超出可用屏幕区域
      let x = Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - bounds.width));
      let y = Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - bounds.height));

      // 2. 边缘吸附：距边缘 SNAP_THRESHOLD 内就吸上去
      const snapEdges = [];
      if (x - wa.x <= SNAP_THRESHOLD) snapEdges.push('left');
      if ((wa.x + wa.width) - (x + bounds.width) <= SNAP_THRESHOLD) snapEdges.push('right');
      if (y - wa.y <= SNAP_THRESHOLD) snapEdges.push('top');
      if ((wa.y + wa.height) - (y + bounds.height) <= SNAP_THRESHOLD) snapEdges.push('bottom');

      if (snapEdges.includes('left')) x = wa.x;
      if (snapEdges.includes('right')) x = wa.x + wa.width - bounds.width;
      if (snapEdges.includes('top')) y = wa.y;
      if (snapEdges.includes('bottom')) y = wa.y + wa.height - bounds.height;

      // 真的需要调整才 setPosition，避免递归触发 moved
      if (x !== bounds.x || y !== bounds.y) {
        widgetWin.setPosition(x, y);
      }

      saveWidgetConfig({ x, y, visible: true });
    }, 400);
  });

  widgetWin.on('closed', () => {
    widgetWin = null;
  });

  saveWidgetConfig({ visible: true });
}

function setWidgetVisible(visible) {
  if (visible) {
    createWidget();
    saveWidgetConfig({ visible: true });
  } else if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.hide();
    saveWidgetConfig({ visible: false });
  } else {
    saveWidgetConfig({ visible: false });
  }
}

function toggleWidget() {
  const showing = widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible();
  setWidgetVisible(!showing);
}

function showAbout() {
  const win = getWin();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('about:open', { version: app.getVersion() });
}

// 渲染层菜单 / 标题栏按钮统一入口
function runAction(action) {
  if (action === 'openMain') { openMainWindow(); return; }
  if (action === 'widget') { toggleWidget(); return; }
  if (action === 'widget-hide') { setWidgetVisible(false); return; }

  const win = getWin();
  if (!win) return;
  const wc = win.webContents;

  switch (action) {
    case 'undo': wc.undo(); break;
    case 'redo': wc.redo(); break;
    case 'cut': wc.cut(); break;
    case 'copy': wc.copy(); break;
    case 'paste': wc.paste(); break;
    case 'selectAll': wc.selectAll(); break;
    case 'reload': wc.reload(); break;
    case 'devtools': wc.toggleDevTools(); break;
    case 'zoomReset': wc.setZoomLevel(0); break;
    case 'zoomIn': wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5)); break;
    case 'zoomOut': wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); break;
    case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
    case 'minimize': win.minimize(); break;
    case 'maximize':
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      break;
    case 'close': win.close(); break;
    case 'quit': app.quit(); break;
    case 'about': showAbout(); break;
    default: break;
  }
}

// macOS 保留系统菜单（系统顶部菜单栏无法随窗口配色），Windows 使用页面内自绘菜单
function buildMacMenu() {
  const template = [
    {
      label: '个人工作台',
      submenu: [
        { label: '关于个人工作台', click: showAbout },
        { type: 'separator' },
        { role: 'hide', label: '隐藏个人工作台' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出个人工作台' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '新建任务', accelerator: 'CmdOrCtrl+N', click: () => {
          const win = getWin();
          if (win) win.webContents.send('menu:new-task');
        } },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { type: 'separator' },
        { label: '桌面小组件', click: toggleWidget }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [{ label: '关于个人工作台', click: showAbout }]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(hidden) {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 760,
    backgroundColor: THEME_BACKGROUNDS[readSettingsFile().theme] || THEME_BACKGROUNDS.mist,
    show: !hidden,
    title: '个人工作台',
    icon: logoPath,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 15 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWin = win;

  win.on('closed', () => {
    if (mainWin === win) mainWin = null;
  });

  if (!hidden) win.focus();

  const pushState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('win:state', { maximized: win.isMaximized() });
    }
  };
  win.on('maximize', pushState);
  win.on('unmaximize', pushState);
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);

  // 页面内的外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 标题固定，避免被页面改写
  win.on('page-title-updated', (e) => e.preventDefault());
}

ipcMain.handle('win:action', (_e, action) => {
  runAction(action);
});

ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('win:state', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return {
    maximized: !!win && win.isMaximized(),
    fullscreen: !!win && win.isFullScreen()
  };
});

ipcMain.handle('store:read', () => readDailyStore());

ipcMain.handle('store:write', (_event, payload) => writeDailyStore(payload));

ipcMain.on('settings:sync', (event) => {
  event.returnValue = currentSettings();
});

ipcMain.handle('settings:get', () => currentSettings());

ipcMain.handle('settings:set', (_event, patch) => {
  if (patch && typeof patch.theme === 'string' && THEME_BACKGROUNDS[patch.theme]) {
    writeSettingsFile({ theme: patch.theme });
  }
  if (patch && typeof patch.autoLaunch === 'boolean') {
    setAutoLaunch(patch.autoLaunch);
  }
  const next = currentSettings();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
  }
  return next;
});

app.whenReady().then(() => {
  if (isMac) buildMacMenu();
  else Menu.setApplicationMenu(null);

  if (configuredCacheDir) {
    try {
      const codeCacheDir = path.join(configuredCacheDir, 'Code Cache');
      fs.mkdirSync(codeCacheDir, { recursive: true });
      session.defaultSession.setCodeCachePath(codeCacheDir);
    } catch (error) {
      console.warn('无法设置代码缓存目录：', error.message);
    }
  }

  const silent = isSilentLaunch();
  createWindow(silent);

  // 静默启动（开机自启）：主窗口隐藏，立即创建小组件，让用户看到唯一入口
  // 正常启动：等主窗口 show 后再启小组件，避免同时初始化拖慢
  const wantWidget = loadWidgetConfig().visible !== false;
  if (silent) {
    if (wantWidget) createWidget();
  } else if (wantWidget) {
    if (mainWin && !mainWin.isVisible()) {
      mainWin.once('show', () => setTimeout(() => createWidget(), 300));
    } else {
      setTimeout(() => createWidget(), 300);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
