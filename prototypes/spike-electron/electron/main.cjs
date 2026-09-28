// Electron main process for the ENG-184 spike. Plain CommonJS: no build step for main.
const MAIN_START = Date.now();
const { app, BrowserWindow, protocol, net, Menu, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const env = process.env;
const argIdx = process.argv.indexOf('--bench');
const BENCH = argIdx >= 0 ? process.argv[argIdx + 1] : env.SPIKE_BENCH || null;
const T0 = Number(env.BENCH_T0) || MAIN_START;
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURES = env.SPIKE_FIXTURES || path.resolve(ROOT, '../../../spike-fixtures');
const RESULTS = env.SPIKE_RESULTS || path.join(ROOT, 'results');

const flags = {
  workers: env.SPIKE_WORKERS !== '0',
  poolSize: Number(env.SPIKE_POOL_SIZE || 1),
  sharePool: env.SPIKE_SHARE_POOL !== '0',
  popout: env.SPIKE_POPOUT || 'shared', // 'shared' = window.open in the same renderer; 'separate' = new BrowserWindow
  backgroundThrottling: env.SPIKE_BG_THROTTLE !== '0',
  trimChromium: env.SPIKE_TRIM !== '0',
  jsFlags: env.SPIKE_JS_FLAGS ?? '',
  switchMode: env.SPIKE_SWITCH_MODE || 'full',
  highlighter: env.SPIKE_HIGHLIGHTER || 'shiki-wasm',
  astCache: Number(env.SPIKE_AST_CACHE || 100),
  variant: env.SPIKE_VARIANT || 'default',
};

// ---- Chromium / V8 switches (must be set before 'ready') ----
if (flags.trimChromium) {
  app.commandLine.appendSwitch(
    'disable-features',
    [
      'SpareRendererForSitePerProcess', // no pre-spawned idle renderer
      'MediaRouter',
      'DialMediaRouteProvider',
      'HardwareMediaKeyHandling',
      'Translate',
      'AutofillServerCommunication',
      'OptimizationHints',
      'CertificateTransparencyComponentUpdater',
      'BackForwardCache',
    ].join(','),
  );
  app.commandLine.appendSwitch('disable-component-update');
}
if (flags.jsFlags) app.commandLine.appendSwitch('js-flags', flags.jsFlags);
if (env.SPIKE_EXTRA_SWITCHES) for (const s of env.SPIKE_EXTRA_SWITCHES.split(' ')) {
  const [k, v] = s.replace(/^--/, '').split('=');
  app.commandLine.appendSwitch(k, v);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true } },
]);

function webPreferences() {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: false,
    backgroundThrottling: flags.backgroundThrottling,
    v8CacheOptions: 'bypassHeatCheck',
  };
}

function pageUrl(extra = {}) {
  const q = new URLSearchParams({
    workers: flags.workers ? '1' : '0',
    poolSize: String(flags.poolSize),
    sharePool: flags.sharePool ? '1' : '0',
    switchMode: flags.switchMode,
    highlighter: flags.highlighter,
    astCache: String(flags.astCache),
    bench: BENCH || '',
    ...extra,
  });
  return `app://spike/index.html?${q}`;
}

let mainWin = null;
let popoutWin = null;
let popoutReady = null;

function popoutOptions() {
  return {
    width: 1100,
    height: 860,
    x: 380,
    y: 60,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: webPreferences(),
  };
}

function trackPopout(win) {
  popoutWin = win;
  popoutReady = new Promise((r) => win.webContents.once('did-finish-load', r));
  win.on('closed', () => (popoutWin = null));
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    x: 40,
    y: 40,
    show: true,
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: webPreferences(),
  });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('app://spike/')) return { action: 'deny' };
    if (flags.popout === 'separate') {
      // Comparison mode: an unrelated BrowserWindow gets its own renderer process.
      const w = new BrowserWindow(popoutOptions());
      trackPopout(w);
      w.loadURL(url);
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: popoutOptions() };
  });
  mainWin.webContents.on('did-create-window', (w) => trackPopout(w));
  mainWin.loadURL(pageUrl());
}

function buildMenu() {
  const popout = () => mainWin?.webContents.executeJavaScript('window.__app.popout()');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Pop Out Diff', accelerator: 'CmdOrCtrl+Shift+O', click: popout },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'toggleDevTools' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

// ---- memory accounting ----
function processTree() {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm=']).toString().trim().split('\n');
  const byPid = new Map();
  for (const row of rows) {
    const m = row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (m) byPid.set(+m[1], { pid: +m[1], ppid: +m[2], rssKB: +m[3], comm: m[4] });
  }
  const out = [];
  const queue = [process.pid];
  while (queue.length) {
    const pid = queue.shift();
    const p = byPid.get(pid);
    if (!p) continue;
    out.push(p);
    for (const c of byPid.values()) if (c.ppid === pid) queue.push(c.pid);
  }
  return out;
}

function footprintMB(pid) {
  try {
    const s = execFileSync('footprint', ['-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = s.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/i) || s.match(/phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/i);
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Math.round((m[2].toUpperCase() === 'GB' ? v * 1024 : m[2].toUpperCase() === 'KB' ? v / 1024 : v) * 10) / 10;
  } catch {
    return null;
  }
}

function memorySnapshot() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map((m) => [m.pid, m]));
  const rendererPids = new Map();
  if (mainWin) rendererPids.set(mainWin.webContents.getOSProcessId(), 'main-window');
  if (popoutWin) rendererPids.set(popoutWin.webContents.getOSProcessId(), (rendererPids.get(popoutWin.webContents.getOSProcessId()) ? rendererPids.get(popoutWin.webContents.getOSProcessId()) + '+' : '') + 'popout');
  const procs = processTree().filter((p) => !/(^|\/)(ps|footprint)$/.test(p.comm)).map((p) => {
    const m = byPid.get(p.pid);
    return {
      pid: p.pid,
      type: p.pid === process.pid ? 'Browser' : m ? m.type + (m.serviceName ? `:${m.serviceName}` : '') : 'unknown',
      windows: rendererPids.get(p.pid) || undefined,
      rssMB: Math.round(p.rssKB / 102.4) / 10,
      footprintMB: footprintMB(p.pid),
      appMetricsWorkingSetMB: m ? Math.round(m.memory.workingSetSize / 102.4) / 10 : null,
      comm: path.basename(p.comm),
    };
  });
  const sum = (k) => Math.round(procs.reduce((a, p) => a + (p[k] || 0), 0) * 10) / 10;
  let swap = null;
  try { swap = execFileSync('sysctl', ['-n', 'vm.swapusage']).toString().trim(); } catch {}
  return {
    totalRssMB: sum('rssMB'),
    totalFootprintMB: sum('footprintMB'),
    totalAppMetricsWorkingSetMB: sum('appMetricsWorkingSetMB'),
    processCount: procs.length,
    rendererProcessCount: procs.filter((p) => p.type === 'Tab').length,
    popoutSharesRenderer: popoutWin ? popoutWin.webContents.getOSProcessId() === mainWin.webContents.getOSProcessId() : null,
    processes: procs,
    system: { freeMemMB: Math.round(require('node:os').freemem() / 1048576), swap },
  };
}

// ---- bench driver ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBench() {
  const wc = mainWin.webContents;
  const ev = (js, target = wc) => target.executeJavaScript(js, true);
  await new Promise((r) => (wc.isLoading() ? wc.once('did-finish-load', r) : r()));
  const ready = await ev('window.__bench.ready');
  const display = screen.getDisplayMatching(mainWin.getBounds());
  const meta = {
    spike: 'electron',
    scenario: BENCH,
    date: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
    displayFrequencyHz: display.displayFrequency,
    flags,
  };
  let result;
  switch (BENCH) {
    case 'cold-start':
      result = {
        launchToFirstDiffFrameMs: Math.round(ready.firstLinesFrameWall - T0),
        launchToHighlightedFrameMs: ready.firstHighlightedWall ? Math.round(ready.firstHighlightedWall - T0) : null,
        breakdown: {
          launchToMainScriptMs: MAIN_START - T0,
          launchToAppReadyMs: APP_READY - T0,
          launchToRendererNavStartMs: Math.round(ready.navStartWall - T0),
          loadTiming: ready.loadTiming,
        },
        note: 'T0 is taken by the bench runner immediately before spawning Electron. First diff frame = rAF after the one in which code lines were first found in the viewport.',
      };
      break;
    case 'open-diff':
      result = await ev('window.__bench.openDiff()');
      break;
    case 'scroll-10k':
    case 'scroll-40k':
    case 'scroll-290k': {
      const fx = BENCH.slice(7);
      const refresh = await ev('window.__bench.measureRefreshHz()');
      const load = fx === '10k' ? ready.loadTiming : await ev(`window.__bench.load(${JSON.stringify(fx)})`);
      await sleep(1500);
      const steady = await ev('window.__bench.scrollSteady(4000, 10000)');
      result = { rendererRefresh: refresh, load, steady };
      if (fx === '290k') result.randomJumps = await ev('window.__bench.randomJumps(20)');
      break;
    }
    case 'switch':
      await sleep(1000);
      result = await ev('window.__bench.switchBench(50, 10)');
      result.switchMode = flags.switchMode;
      break;
    case 'memory-idle':
      await sleep(10000);
      result = { ...memorySnapshot(), jsHeap: await ev('window.__bench.heap()') };
      break;
    case 'memory-heavy': {
      await ev(`window.__bench.load('40k')`);
      await ev('window.__bench.scrollThrough()');
      await ev(`window.__app.popout('290k')`);
      while (!popoutWin) await sleep(20);
      await popoutReady;
      const pwc = popoutWin.webContents;
      const popLoad = await ev('window.__bench.ready', pwc);
      await ev('window.__bench.scrollThrough()', pwc);
      await ev('window.__bench.scrollThrough()');
      await sleep(5000);
      result = {
        ...memorySnapshot(),
        jsHeap: { main: await ev('window.__bench.heap()'), popout: await ev('window.__bench.heap()', pwc) },
        // Sanity check that highlighting actually ran (a failed worker pool would under-report memory).
        viewportCoverage: { main: await ev('window.__bench.coverage()'), popout: await ev('window.__bench.coverage()', pwc) },
        popoutLoad: popLoad.loadTiming,
      };
      if (env.SPIKE_VMMAP) {
        const pid = mainWin.webContents.getOSProcessId();
        try { fs.writeFileSync(path.join(RESULTS, `vmmap-renderer-${flags.variant}.txt`), execFileSync('vmmap', ['-summary', String(pid)], { maxBuffer: 64 << 20 }).toString()); } catch (e) { console.error('vmmap failed', e.message); }
      }
      break;
    }
    case 'screenshot': {
      await sleep(1500);
      const img = await mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(ROOT, 'screenshot.png'), img.toPNG());
      return;
    }
    case 'eval':
      await sleep(Number(env.SPIKE_EVAL_WAIT || 1000));
      console.log(JSON.stringify(await ev(env.SPIKE_EVAL), null, 1));
      return;
    default:
      throw new Error(`unknown scenario ${BENCH}`);
  }
  fs.mkdirSync(RESULTS, { recursive: true });
  const suffix = flags.variant !== 'default' ? `.${flags.variant}` : '';
  const file = path.join(RESULTS, `electron-${BENCH}${suffix}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...meta, result }, null, 2));
  console.log(`[bench] wrote ${file}`);
}

let APP_READY = 0;
app.whenReady().then(() => {
  APP_READY = Date.now();
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = pathname.startsWith('/fixtures/')
      ? path.join(FIXTURES, pathname.slice('/fixtures/'.length))
      : path.join(DIST, pathname === '/' ? 'index.html' : pathname);
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu();
  createMainWindow();
  if (BENCH) {
    runBench()
      .catch((e) => {
        console.error('[bench] failed', e);
        process.exitCode = 1;
      })
      .finally(() => app.exit(process.exitCode || 0));
  }
});

app.on('window-all-closed', () => app.quit());
