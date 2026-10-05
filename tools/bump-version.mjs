import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CODE = process.argv[2] || '6';
const NAME = process.argv[3] || '1.3.0';
const PREV = process.argv[4] || '1.2.2';

function patch(rel, pairs) {
  const file = path.join(ROOT, rel);
  let t = fs.readFileSync(file, 'utf8');
  for (const pair of pairs) {
    if (t.indexOf(pair[0]) < 0) throw new Error('未找到: ' + pair[0] + ' @ ' + rel);
    t = t.split(pair[0]).join(pair[1]);
  }
  fs.writeFileSync(file, t, 'utf8');
  console.log('已更新 ' + rel);
}

const prevCode = String(Number(CODE) - 1);
patch('app/android/AndroidManifest.xml', [
  ['android:versionCode="' + prevCode + '"', 'android:versionCode="' + CODE + '"'],
  ['android:versionName="' + PREV + '"', 'android:versionName="' + NAME + '"']
]);
patch('tools/build-apk.ps1', [
  ["$VERSION_CODE = '" + prevCode + "'", "$VERSION_CODE = '" + CODE + "'"],
  ["$VERSION_NAME = '" + PREV + "'", "$VERSION_NAME = '" + NAME + "'"]
]);
patch('tools/verify-apk.mjs', [
  ['DeepSleep-' + PREV + '.apk', 'DeepSleep-' + NAME + '.apk']
]);
console.log('版本号 -> ' + NAME + ' / versionCode ' + CODE);
