'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  ipcMain,
  nativeImage,
  dialog,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'QM Local';
const DEFAULT_URL = 'http://localhost:8291';
const POLL_INTERVAL_MS = 5000;
const CONNECT_TIMEOUT_MS = 3000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const configDir = path.join(app.getPath('appData'), 'qm-local-desktop');
const configPath = path.join(configDir, 'config.json');
const iconPath = path.join(__dirname, 'assets', 'icon.png');
const offlinePath = path.join(__dirname, 'offline.html');
const preloadPath = path.join(__dirname, 'preload.js');

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let pollTimer = null;
let updateCheckTimer = null;
let isQuitting = false;

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.url === 'string' && parsed.url.trim()) {
      return { url: parsed.url.trim() };
    }
  } catch (err) {
    // missing or invalid — fall through to default
  }
  return { url: DEFAULT_URL };
}

function saveConfig(cfg) {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
}

let currentConfig = loadConfig();

// ---------------------------------------------------------------------
// Connectivity check
// ---------------------------------------------------------------------

async function isServerUp(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      await fetch(url, { signal: controller.signal });
      return true;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return false;
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    const up = await isServerUp(currentConfig.url);
    if (up) {
      stopPolling();
      loadTargetUrl();
    }
  }, POLL_INTERVAL_MS);
}

function showOffline() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(offlinePath, {
    query: { url: currentConfig.url },
  });
  startPolling();
}

async function loadTargetUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const up = await isServerUp(currentConfig.url);
  if (up) {
    stopPolling();
    mainWindow.loadURL(currentConfig.url);
  } else {
    showOffline();
  }
}

// ---------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------

function isExternalUrl(targetUrl) {
  try {
    const target = new URL(targetUrl);
    const configured = new URL(currentConfig.url);
    return target.origin !== configured.origin;
  } catch (err) {
    return true;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#101216',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  mainWindow.setMenuBarVisibility(true);

  // External links / different-origin navigation open in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow navigating to our own offline.html (file://) freely.
    if (url.startsWith('file://')) return;
    if (isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  loadTargetUrl();
}

// ---------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: `${APP_NAME} Settings`,
    icon: iconPath,
    parent: mainWindow || undefined,
    modal: false,
    backgroundColor: '#101216',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------

ipcMain.handle('qm:get-config', () => currentConfig);

ipcMain.handle('qm:set-config', (event, newUrl) => {
  const trimmed = String(newUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'URL cannot be empty.' };
  }
  try {
    // Validate it parses as a URL.
    // eslint-disable-next-line no-new
    new URL(trimmed);
  } catch (err) {
    return { ok: false, error: 'Not a valid URL.' };
  }
  currentConfig = { url: trimmed };
  saveConfig(currentConfig);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
  loadTargetUrl();
  return { ok: true, config: currentConfig };
});

ipcMain.on('qm:retry', () => {
  loadTargetUrl();
});

ipcMain.on('qm:open-settings', () => {
  openSettingsWindow();
});

// ---------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------

function buildTrayMenu() {
  const loginSettings = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    {
      label: 'Open QM Local',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    {
      label: 'Reload',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          loadTargetUrl();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Start on login',
      type: 'checkbox',
      checked: !!loginSettings.openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      },
    },
    { type: 'separator' },
    {
      label: 'Settings...',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({
    width: 16,
    height: 16,
  });
  tray = new Tray(trayIcon);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
}

// ---------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------

function createAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Settings...', click: () => openSettingsWindow() },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => loadTargetUrl(),
        },
        { type: 'separator' },
        { label: 'Check for updates...', click: () => checkForUpdatesManually() },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------
// Auto-update
// ---------------------------------------------------------------------
//
// Ships only in the NSIS-installed build — electron-updater has no
// auto-install mechanism for the portable target (no installed location
// to update in place), so the portable .exe just stays on whatever
// version it was downloaded as. Checks are silent and non-fatal by
// design: this app's whole job is to display a web page, and a failed
// update check must never interfere with that.

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] checkForUpdates failed:', err && err.message ? err.message : err);
  });
}

function stopUpdateChecks() {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
}

function promptRestartToUpdate(info) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog
    .showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: `${APP_NAME} update ready`,
      message: `A new version (${info.version}) has been downloaded.`,
      detail:
        'Restart now to install it, or keep working — it installs automatically the next time you quit.',
    })
    .then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    })
    .catch((err) => {
      console.error('[updater] Failed to show update-ready dialog:', err);
    });
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    // No feed metadata in a dev run — electron-updater would just throw
    // looking for app-update.yml. Nothing to check.
    console.log('[updater] Skipping update checks — not a packaged build.');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[updater] Downloading update: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
    promptRestartToUpdate(info);
  });

  autoUpdater.on('error', (err) => {
    // Log and move on — never a crash, never a modal error storm.
    console.error('[updater] Update check failed:', err && err.message ? err.message : err);
  });

  checkForUpdates();
  stopUpdateChecks();
  updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);
}

function checkForUpdatesManually() {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: `${APP_NAME} update check`,
      message: 'Update checks are only available in packaged builds.',
    });
    return;
  }

  autoUpdater.once('update-not-available', () => {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: `${APP_NAME} update check`,
      message: `You're up to date (v${app.getVersion()}).`,
    });
  });

  checkForUpdates();
}

// ---------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createAppMenu();
    createMainWindow();
    createTray();
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });

  app.on('window-all-closed', () => {
    // Keep the app alive in the tray on all platforms for this app's
    // "minimize to tray" behavior; only quit explicitly via tray/menu.
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopPolling();
    stopUpdateChecks();
  });
}
