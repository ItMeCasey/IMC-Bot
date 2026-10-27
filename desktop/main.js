'use strict';
/** IMC-Bot: the desktop app. Runs the Discord bot in the background, shows the dashboard in a window, lives in the tray. */
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

app.enableSandbox();   // every window runs in Chromium's sandbox
const ROOT = path.join(__dirname, '..');   // the app folder (src/, public/, node_modules/)
const BUILD = path.join(__dirname, 'build');
app.setPath('userData', path.join(app.getPath('appData'), 'IMC-Bot'));
// only one copy at a time: a second launch just brings the first window forward
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const userData = app.getPath('userData'), DATA = process.env.IMC_BOT_DATA || path.join(userData, 'data'), SETTINGS_FILE = path.join(userData, 'app-settings.json');
let win = null, tray = null, child = null, quitting = false, light = 'grey', port = 8440, settings = null, restarts = [], poll = null;

const loadSettings = () => { const d = { startWithWindows: false, closeToTray: true, startHidden: false }; try { return Object.assign(d, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))); } catch (e) { return d; } };
const saveSettings = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { /* a read-only profile is ignored */ } };
const log = (...a) => { const line = new Date().toISOString() + ' ' + a.join(' ') + '\n'; try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(path.join(DATA, 'app.log'), line); } catch (e) { /* ignore */ } };
for (const st of [process.stdout, process.stderr]) if (st && st.on) st.on('error', () => { /* a closed terminal must never crash the app */ });
const url = (p) => 'http://localhost:' + port + (p || '/');
const icon = (name) => nativeImage.createFromPath(path.join(BUILD, name));

/** the dashboard port from config.json in the data folder (8440 by default) */
function readPort() { try { const p = Number(JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).port); if (p > 0 && p < 65536) return p; } catch (e) { /* default */ } return 8440; }

// ---------------------------------------------------------------- the bot process
/** the bot runs as a plain Node process (the app's own runtime in "node mode"), so a crash never takes the window down */
function startBot() {
  if (child || quitting) return;
  port = readPort(); fs.mkdirSync(DATA, { recursive: true });
  for (const f of ['bot.log', 'app.log']) { try { const file = path.join(DATA, f); if (fs.statSync(file).size > 5e6) fs.renameSync(file, file + '.1'); } catch (e) { /* no log yet */ } }   // one old copy is kept
  const out = fs.createWriteStream(path.join(DATA, 'bot.log'), { flags: 'a' });
  child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', IMC_BOT_DATA: DATA }) });
  child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
  child.on('exit', (code) => {
    child = null; out.end(); light = 'red'; refreshTray(); log('bot exited with code', code);
    if (quitting) return;
    const t = Date.now(); restarts = restarts.filter((x) => t - x < 60000); restarts.push(t);
    if (restarts.length > 5) { notify('IMC-Bot keeps stopping', 'It stopped 5 times in a minute, so it will not be restarted again. Open the data folder and look at bot.log.'); return; }
    setTimeout(startBot, 2000);
  });
  refreshTray();
}
function stopBot() { if (child) { try { child.kill(); } catch (e) { /* already gone */ } } }
function restartBot() { restarts = []; if (child) { child.once('exit', () => setTimeout(startBot, 500)); stopBot(); } else startBot(); }
let lastNote = 0;
function notify(title, body) { if (Date.now() - lastNote < 60000 || !Notification.isSupported()) return; lastNote = Date.now(); try { new Notification({ title, body, icon: icon('icon.png') }).show(); } catch (e) { /* ignore */ } }

/** every few seconds: is the bot up, and is it connected to Discord? (the tray colour) */
async function checkHealth() {
  if (!child) { light = 'red'; return refreshTray(); }
  try {
    const r = await fetch(url('/api/status'), { signal: AbortSignal.timeout(3000) }), j = await r.json(), s = j.bot && j.bot.state;
    light = s === 'online' ? 'green' : s === 'error' ? 'red' : 'amber';
  } catch (e) { light = 'amber'; }   // still starting
  refreshTray();
}

// ---------------------------------------------------------------- window
const SPLASH = 'data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#222A2A;color:#E2DAC2;font-family:Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="letter-spacing:6px;color:#F39120">IMC-BOT</h2><p>Starting...</p></div>');
async function waitForBot() { for (let i = 0; i < 120; i++) { try { const r = await fetch(url('/api/status')); if (r.ok) return; } catch (e) { /* not yet */ } await new Promise((x) => setTimeout(x, 500)); } }
function openWindow() {
  if (!win) {
    // the window shows only the local dashboard: no Node in the page, an isolated context, the sandbox on, no remote code, no web views
    win = new BrowserWindow({ width: 1100, height: 900, minWidth: 700, minHeight: 600, show: false, backgroundColor: '#222A2A', icon: icon('window.png'), autoHideMenuBar: true, title: 'IMC-Bot',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, spellcheck: false } });
    win.once('ready-to-show', () => win.show());
    win.on('close', (e) => { if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); } });
    win.on('closed', () => { win = null; });
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
    win.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https:\/\//i.test(u) && !local.test(u)) shell.openExternal(u); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, u) => { if (!local.test(u)) { e.preventDefault(); if (/^https:\/\//i.test(u)) shell.openExternal(u); } });
    win.loadURL(SPLASH).then(() => waitForBot().then(() => win && win.loadURL(url()))).catch(() => {});
  } else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

// ---------------------------------------------------------------- tray
const LABEL = { green: 'Connected to Discord', amber: 'Starting or not connected to Discord', red: 'Stopped or has a problem', grey: 'Starting' };
function refreshTray() {
  if (!tray) return;
  tray.setImage(icon('tray-' + light + '.png')); tray.setToolTip('IMC-Bot: ' + LABEL[light]);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open IMC-Bot', click: openWindow }, { label: LABEL[light], enabled: false }, { type: 'separator' },
    { label: 'Restart the bot', click: restartBot },
    { label: 'Start with Windows', type: 'checkbox', checked: !!settings.startWithWindows, click: (m) => { settings.startWithWindows = m.checked; app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }); saveSettings(); } },
    { label: 'Keep running in the tray when closed', type: 'checkbox', checked: !!settings.closeToTray, click: (m) => { settings.closeToTray = m.checked; saveSettings(); } },
    { label: 'Open the data folder', click: () => shell.openPath(DATA) }, { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

// The dashboard needs no browser permissions (camera, microphone, location, notifications...), so every request is refused, and no page can add a web view.
app.whenReady().then(() => session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(false)));
app.on('web-contents-created', (e, wc) => wc.on('will-attach-webview', (ev) => ev.preventDefault()));
app.on('second-instance', () => openWindow());
app.on('before-quit', () => { quitting = true; clearInterval(poll); stopBot(); });
app.on('window-all-closed', () => { /* the tray keeps the app alive */ });
app.whenReady().then(() => {
  settings = loadSettings();
  tray = new Tray(icon('tray-grey.png')); tray.on('click', openWindow); refreshTray();
  startBot(); poll = setInterval(checkHealth, 5000); setTimeout(checkHealth, 2000);
  if (!(settings.startHidden || process.argv.includes('--hidden'))) openWindow();
});
