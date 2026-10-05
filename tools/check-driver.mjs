/* 检查预览服务器的注入驱动脚本能不能通过语法解析。
 *
 * 为什么需要这个：DRIVER 是用模板字符串（反引号）拼出来的，
 * 里面任何未转义的 \n 都会被模板字符串先「转义一次」，
 * 生成出含真实换行的 JS 字面量 —— 浏览器解析整个驱动脚本时直接抛错，
 * 结果是所有 demo 模式静默失效，页面看起来却完全正常（因为种子数据还在）。
 * 这个坑我踩过一次，所以加个闸门。
 *
 * 用法： node tools/check-driver.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'tools', 'preview.mjs'), 'utf8');

const start = src.indexOf('const DRIVER = `');
if (start < 0) {
  console.log('x 找不到 DRIVER 定义');
  process.exit(1);
}
const bodyStart = start + 'const DRIVER = `'.length;
const bodyEnd = src.indexOf('`;', bodyStart);
if (bodyEnd < 0) {
  console.log('x DRIVER 模板字符串没有正常结束');
  process.exit(1);
}

let body = src.slice(bodyStart, bodyEnd);
body = body.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');

try {
  // 只做语法解析，不执行
  new Function(body);
} catch (e) {
  console.log('x 驱动脚本语法错误: ' + e.message);
  const lines = body.split('\n');
  const suspect = lines.findIndex((l) => /^\s*(var|let|const)\s/.test(l) && l.split("'").length % 2 === 0);
  if (suspect > -1) {
    console.log('  可疑行 ' + (suspect + 1) + ': ' + lines[suspect].trim().slice(0, 70));
    console.log('  （常见原因：模板字符串里的 \\n 忘了写成 \\\\n）');
  }
  process.exit(1);
}

console.log('OK 驱动脚本语法正常（' + body.split('\n').length + ' 行）');
