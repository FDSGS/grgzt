const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isMac = process.platform === 'darwin';

let mainWin = null;
let widgetWin = null;

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
  const x = Number.isFinite(cfg.x) ? cfg.x : wa.x + wa.width - width - 24;
  const y = Number.isFinite(cfg.y) ? cfg.y : wa.y + 24;

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
    alwaysOnTop: true,
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

  widgetWin.setAlwaysOnTop(true, 'floating');
  if (isMac) widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  widgetWin.loadFile(path.join(__dirname, '..', 'widget.html'));

  widgetWin.once('ready-to-show', () => widgetWin.showInactive());

  let posTimer = null;
  widgetWin.on('moved', () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      const [wx, wy] = widgetWin.getPosition();
      saveWidgetConfig({ x: wx, y: wy, visible: true });
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
  const opts = {
    type: 'info',
    title: '关于个人工作台',
    message: '个人工作台',
    detail:
      '作者：李德胜 · 方城县破默网络科技工作室\n' +
      '微信：18625698675\n' +
      '邮箱：1316737309@qq.com\n\n' +
      '版本 ' + app.getVersion() + '\n' +
      'Electron ' + process.versions.electron + ' · Chromium ' + process.versions.chrome + '\n\n' +
      '数据保存在本机，不会上传到任何服务器。',
    buttons: ['好']
  };
  if (win) dialog.showMessageBox(win, opts);
  else dialog.showMessageBox(opts);
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 760,
    backgroundColor: '#DDE5E2',
    show: false,
    title: '个人工作台',
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

  win.once('ready-to-show', () => win.show());

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

ipcMain.handle('win:state', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return {
    maximized: !!win && win.isMaximized(),
    fullscreen: !!win && win.isFullScreen()
  };
});

app.whenReady().then(() => {
  if (isMac) buildMacMenu();
  else Menu.setApplicationMenu(null);

  createWindow();

  if (loadWidgetConfig().visible !== false) createWidget();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
