/* 最小化 Electron 冒烟测试：定位之前崩溃发生在哪一步。
   用法： "<electron.exe>" --no-sandbox tools/smokeapp
*/
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, 'smoke.log');
try { fs.unlinkSync(LOG); } catch (e) { /* first run */ }

function log(m) {
  try { fs.appendFileSync(LOG, m + '\r\n'); } catch (e) { /* ignore */ }
}

process.on('uncaughtException', (e) => { log('UNCAUGHT ' + (e && e.stack ? e.stack : e)); app.exit(1); });

log('module loaded');
log('electron=' + process.versions.electron + ' chrome=' + process.versions.chrome);
log('argv=' + JSON.stringify(process.argv));

app.whenReady().then(async () => {
  log('app ready');
  try {
    const win = new BrowserWindow({ width: 390, height: 844, show: false });
    log('window created');

    win.webContents.on('did-finish-load', () => log('event: did-finish-load'));
    win.webContents.on('render-process-gone', (e, d) => log('event: render-process-gone ' + JSON.stringify(d)));
    win.webContents.on('console-message', (e, level, msg) => log('console: ' + msg));

    await win.loadURL('about:blank');
    log('about:blank loaded');

    await win.loadURL('http://127.0.0.1:8787/?demo=home&scheme=blue&theme=light');
    log('page loaded');

    await new Promise((r) => setTimeout(r, 1500));
    log('waited');

    const title = await win.webContents.executeJavaScript('document.title');
    log('title=' + title);
    const heroVisible = await win.webContents.executeJavaScript(
      '!document.getElementById("hero").classList.contains("hidden")');
    log('heroVisible=' + heroVisible);
    const msgCount = await win.webContents.executeJavaScript(
      'document.querySelectorAll("#messages .msg").length');
    log('msgCount=' + msgCount);

    const img = await win.webContents.capturePage();
    if (img && !img.isEmpty()) {
      const size = img.getSize();
      fs.writeFileSync(path.join(__dirname, 'smoke.png'), img.toPNG());
      log('captured ' + size.width + 'x' + size.height);
    } else {
      log('capture empty');
    }
  } catch (e) {
    log('ERROR ' + (e && e.stack ? e.stack : e));
  }
  log('done');
  app.exit(0);
});
