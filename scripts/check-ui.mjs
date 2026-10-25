import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { fixtureReport } from '../test/fixtures.mjs';
import { renderWeb } from '../lib/render.mjs';
import { exportCards } from './export.mjs';
import { startServer } from './serve.mjs';

const root = path.resolve('.cache', 'ui-check');
const report = fixtureReport();
report.editorial.headline = '布局与交互验证 · 测试数据';
report.editorial.enabled = true;
report.editorial.gainIntro = '这是一份仅供本地质量检查的测试榜单。使用较长的中文内容验证卡片的排版与可读性，项目数据不会进入正式发布目录。涨星榜按当日新增 Star 排序，网页可展开介绍，并提供两套排行榜和配套图文下载。';
report.editorial.risingIntro = '新锐榜先排除已经进入涨星榜的项目，再按相对增幅排序。以下测试内容用于验证文本长度、中文字体、图文下载及移动端布局，不代表任何真实仓库的热度。';
for (const row of [...report.gain, ...report.rising]) report.editorial.projects[row.repoId] = {
  tagline: '把复杂的日常工作整理成可以直接使用的工具',
  summary: '这是一个用于演示界面布局的开源工具介绍。它把分散的操作整理成清晰的工作流程，面向需要提高效率的开发者与研究人员。用户可以先阅读项目文档，再根据自己的环境选择适合的接入方式。这里的内容仅用于测试排版。',
  observation: '本次测试重点观察长段落是否保持可读，以及数字、语言和项目年龄是否清楚呈现。真实报告会根据仓库公开资料生成对应解读，不会从测试数据推断实际热度变化。',
};
report.editorial.trends = Array.from({ length: 3 }, (_, i) => ({
  title: ['从具体工具看开源项目的变化', '把日常工作里的重复步骤交给工具', '让项目信息可以核对和持续跟踪'][i],
  body: '当工具围绕真实需求展开时，项目介绍需要说清它解决什么问题、适合什么人，以及有哪些公开功能可以实际体验。榜单数字提供观察线索，README 和发布记录提供进一步判断的依据。这段文字用于验证总结卡的排版。',
  repoIds: report.gain.slice(i * 3, i * 3 + 4).map(r => String(r.repoId)),
}));
const out = path.join(root, 'reports', report.date);
await fs.mkdir(out, { recursive: true });
await exportCards(report, out);
const dates = [report.date, '2026-10-24'];
await fs.writeFile(path.join(root, 'index.html'), renderWeb(report, dates, { prefix: `./reports/${report.date}/`, home: './' }));
await fs.mkdir(path.join(root, 'reports', '2026-10-24'), { recursive: true });
await fs.writeFile(path.join(root, 'reports', '2026-10-24', 'index.html'), '<h1>Archive navigation test</h1>');
const archive = unzipSync(await fs.readFile(path.join(out, 'cards.zip')));
assert.equal(Object.keys(archive).filter(name => name.endsWith('.png')).length, 13);
assert.ok(strFromU8(archive['caption.txt']).includes('新锐榜'));
const server = await startServer(root, 0);
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('tab', { name: /新锐榜/ }).click();
  assert.equal(await page.locator('#board-rising').isVisible(), true);
  assert.equal(await page.locator('#board-gain').isVisible(), false);
  await page.getByRole('tab', { name: /涨星榜/ }).click();
  await page.locator('#board-gain summary').first().click();
  assert.ok(await page.locator('#board-gain .project[open]').count());
  await page.getByRole('button', { name: '统计说明' }).click();
  assert.equal(await page.locator('#methods').getAttribute('open'), '');
  await page.evaluate(async () => { for (const img of document.images) img.loading = 'eager'; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); });
  await page.screenshot({ path: path.join(root, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, 'mobile.png') });
  await page.locator('#archive').selectOption('2026-10-24');
  await page.waitForURL('**/reports/2026-10-24/');
  assert.ok((await page.locator('body').innerText()).includes('Archive navigation test'));
  assert.deepEqual(errors, []);
  console.log('[ui] 双榜切换、展开解读、方法说明、历史导航、移动端宽度和 13 张图片 ZIP 通过。');
  console.log(`[ui] 预览目录：${root}`);
} finally { await browser.close(); server.close(); }
