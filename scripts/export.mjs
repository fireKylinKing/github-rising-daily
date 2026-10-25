import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { zipSync, strToU8 } from 'fflate';
import { createSlides, renderSlide } from '../lib/render.mjs';

export function makeCaption(report) {
  return [
    `GitHub 飙升日报｜${report.editorial.headline}`, '', report.editorial.gainIntro, '',
    '今日涨星榜：', ...report.gain.map(r => `${r.rank}. ${r.fullName}  +${r.dailyGain}/日\n${report.editorial.projects[r.repoId].tagline}`), '',
    '新锐榜（排除涨星榜后，按估算相对涨幅）：',
    ...report.rising.map(r => `${r.rank}. ${r.fullName}  +${(r.growthRate * 100).toFixed(2)}%（+${r.dailyGain}/日）`), '',
    '今天的观察：', ...report.editorial.trends.map((t, i) => `${i + 1}. ${t.title}\n${t.body}`), '',
    `采集日期：${report.date}，时区 Asia/Shanghai。候选 ${report.candidateCount} 个，来自 GitHub 全站与配置语言 Trending 日榜。`,
    '新增数为 GitHub 日榜展示口径；新锐涨幅分母为累计 Star 减去当日新增的估算值。',
    `本工具历史始于 ${report.historyStart}，首次收录不等于项目历史首次登榜。AI 解读为基于公开资料的编辑观察。`, '',
    '#GitHub #开源项目 #AI工具 #开发者 #开源升温', '',
  ].join('\n');
}

export async function exportCards(report, outDir) {
  const slides = createSlides(report);
  await fs.mkdir(path.join(outDir, 'images'), { recursive: true });
  const tempDir = path.resolve('.cache', 'slides', report.date);
  await fs.mkdir(tempDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const archive = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1440 }, deviceScaleFactor: 1 });
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const htmlPath = path.join(tempDir, `${slide.id}.html`);
      await fs.writeFile(htmlPath, renderSlide(slide, report, i, slides.length));
      await page.goto(pathToFileURL(htmlPath).href);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => [...document.querySelectorAll('.export-slide,.s-row,.s-project,.s-trend')]
        .filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
        .map(el => ({ class: el.className, height: el.clientHeight, content: el.scrollHeight })));
      if (overflow.length) throw new Error(`图片 ${slide.id} 内容溢出：${JSON.stringify(overflow)}`);
      const collapsedText = await page.evaluate(() => [...document.querySelectorAll('.s-project h2,.s-project h3,.s-project-meta,.s-repo')]
        .filter(el => el.clientHeight < parseFloat(getComputedStyle(el).fontSize) * 0.95)
        .map(el => ({ class: el.className, tag: el.tagName, height: el.clientHeight })));
      if (collapsedText.length) throw new Error(`图片 ${slide.id} 文字高度塌缩：${JSON.stringify(collapsedText)}`);
      const buffer = await page.locator('[data-export-slide]').screenshot({ path: path.join(outDir, 'images', `${slide.id}.png`), animations: 'disabled' });
      if (buffer.readUInt32BE(16) !== 1080 || buffer.readUInt32BE(20) !== 1440) throw new Error(`图片 ${slide.id} 尺寸错误`);
      archive[`${slide.id}.png`] = new Uint8Array(buffer);
    }
  } finally { await browser.close(); }
  const caption = makeCaption(report);
  await fs.writeFile(path.join(outDir, 'caption.txt'), caption);
  archive['caption.txt'] = strToU8(caption);
  archive['report.json'] = strToU8(JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(outDir, 'cards.zip'), zipSync(archive, { level: 1 }));
  console.log(`[export] ${slides.length} 张 1080×1440 PNG 已生成，溢出检查通过。`);
  return slides;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('用法：npm run export -- <report.json> [输出目录]');
  const report = JSON.parse(await fs.readFile(file, 'utf8'));
  await exportCards(report, process.argv[3] ?? path.dirname(file));
}
