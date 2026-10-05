/* Screenshot harness that reuses the Electron/Chromium runtime bundled with DSH Desktop.
 *
 * Why not Chrome/Edge --headless --screenshot:
 *   Chrome's crashpad handler is denied OpenProcess in this environment and it
 *   self-terminates before parsing any flag. Electron does not start the crash
 *   reporter, so it renders fine.
 *
 * IMPORTANT: create exactly ONE BrowserWindow and navigate it repeatedly.
 * Creating a second offscreen window after destroying the first makes the
 * renderer crash (ERR_FAILED -2, then STATUS_BREAKPOINT).
 *
 * Usage:
 *   "<electron.exe>" --no-sandbox --disable-gpu <this dir> <job.json>
 * job.json:
 *   { "userData": "...", "log": "...", "scale": 2,
 *     "shots": [ { "url": "...", "out": "...", "width": 390, "height": 844, "delay": 2000 } ] }
 *
 * Electron on Windows is a GUI-subsystem binary, so console output never reaches
 * the parent console -- everything is logged to a file instead.
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const jobPath = process.argv[process.argv.length - 1];
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

const LOG = job.log || path.join(path.dirname(jobPath), 'shot.log');
try { fs.unlinkSync(LOG); } catch (e) { /* first run */ }

function log(msg) {
  try { fs.appendFileSync(LOG, msg + '\r\n'); } catch (e) { /* ignore */ }
}

process.on('uncaughtException', (e) => {
  log('UNCAUGHT ' + (e && e.stack ? e.stack : e));
  app.exit(1);
});
process.on('unhandledRejection', (e) => {
  log('UNHANDLED ' + (e && e.stack ? e.stack : e));
});

log('boot electron=' + process.versions.electron + ' chrome=' + process.versions.chrome);

app.setPath('userData', job.userData);
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('force-device-scale-factor', String(job.scale || 2));
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.disableHardwareAcceleration();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  log('ready');
  const first = job.shots[0];
  const W = first.width || 390;
  const H = first.height || 844;

  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: false
    }
  });

  let painted = null;
  let paintCount = 0;
  win.webContents.setFrameRate(30);
  win.webContents.on('paint', (event, dirty, image) => {
    painted = image;
    paintCount++;
  });
  win.webContents.on('render-process-gone', (e, d) => log('render-process-gone ' + JSON.stringify(d)));
  // Electron 33 推荐用事件对象取信息，旧的位置参数仍可用但拿不到列号
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const msg = (event && event.message !== undefined) ? event.message : message;
    const src = (event && event.sourceId !== undefined) ? event.sourceId : sourceId;
    const ln = (event && event.lineNumber !== undefined) ? event.lineNumber : line;
    log('console: ' + msg + '   @ ' + src + ':' + ln);
  });

  let ok = 0;
  for (let i = 0; i < job.shots.length; i++) {
    const shot = job.shots[i];
    try {
      painted = null;
      const before = paintCount;
      await win.loadURL(shot.url);
      // 等到确实产生了新的一帧再截图
      const deadline = Date.now() + (shot.delay || 2000);
      while (Date.now() < deadline || paintCount === before) {
        if (Date.now() > deadline + 4000) break;
        await sleep(80);
      }
      await sleep(200);

      let img = painted;
      if (!img || img.isEmpty()) {
        log('[' + i + '] no fresh paint, capturePage() fallback');
        img = await win.webContents.capturePage();
      }
      // 记录页面实际生效的主题与 Markdown 渲染情况
      try {
        const state = await win.webContents.executeJavaScript(
          'JSON.stringify({scheme:document.documentElement.getAttribute("data-scheme"),' +
          'theme:document.documentElement.getAttribute("data-theme"),' +
          'bg:getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),' +
          'brand:getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),' +
          'msgs:document.querySelectorAll("#messages .msg").length,' +
          'h2:document.querySelectorAll("#messages .md h2").length,' +
          'code:document.querySelectorAll("#messages .code-block").length,' +
          'hljs:document.querySelectorAll("#messages .code-block .hljs-keyword").length,' +
          'katex:document.querySelectorAll("#messages .katex").length,' +
          'table:document.querySelectorAll("#messages .md table").length,' +
          'strong:document.querySelectorAll("#messages .md strong").length,' +
          'rawStars:(function(){var t="";document.querySelectorAll("#messages .md").forEach(function(e){t+=e.textContent});return (t.match(/\\*\\*/g)||[]).length})(),' +
          'picker:(function(){var b=document.querySelectorAll("#seg-scheme button");if(!b.length)return null;var r=[];for(var i=0;i<b.length;i++){var q=b[i].getBoundingClientRect();r.push([Math.round(q.left),Math.round(q.top),Math.round(q.width),Math.round(q.height)])}return {vw:document.documentElement.clientWidth,rows:r}})()})');
        log('     state=' + state);
      } catch (e) {
        log('     state read failed: ' + e.message);
      }
      if (!img || img.isEmpty()) {
        log('FAIL ' + shot.out + ' (empty image)');
        continue;
      }
      const buf = img.toPNG();
      fs.mkdirSync(path.dirname(shot.out), { recursive: true });
      fs.writeFileSync(shot.out, buf);
      log('OK   ' + path.basename(shot.out) + '  ' + buf.length + ' bytes');
      ok++;
    } catch (e) {
      log('ERROR ' + shot.out + ': ' + (e && e.message ? e.message : e));
    }
  }

  log('DONE ' + ok + '/' + job.shots.length);
  app.exit(0);
});
