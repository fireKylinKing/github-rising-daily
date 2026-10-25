import fs from 'node:fs/promises';
import path from 'node:path';
import { collectCandidates, fetchReadme, mapLimit } from '../lib/github.mjs';
import { dateKey, rankDaily, shiftDate } from '../lib/ranking.mjs';
import { writeEditorial } from '../lib/editor.mjs';
import { renderWeb } from '../lib/render.mjs';
import { exportCards } from './export.mjs';

const config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const collectedAt = new Date().toISOString();
const date = dateKey(collectedAt);
const site = path.resolve('site');
function withinSite(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(site + path.sep)) throw new Error('站点文件路径越界');
  return resolved;
}
const historyDir = path.join(site, 'data', 'history');
await fs.mkdir(historyDir, { recursive: true });
const history = [];
for (const file of await fs.readdir(historyDir)) {
  if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
  const record = JSON.parse(await fs.readFile(path.join(historyDir, file), 'utf8'));
  if (record.schemaVersion !== 1 || !Array.isArray(record.candidates)) throw new Error(`历史文件格式无效：${file}，停止运行以保护已有记录。`);
  history.push(record);
}
const inputIndex = process.argv.indexOf('--input');
const dataOnly = process.argv.includes('--data-only');
let collection;
if (inputIndex !== -1) {
  collection = JSON.parse(await fs.readFile(process.argv[inputIndex + 1], 'utf8'));
} else {
  console.log('[daily] 正在采集 GitHub 全站与语言日榜…');
  collection = await collectCandidates(config.languages, { token: process.env.GITHUB_TOKEN });
}
console.log(`[daily] 候选 ${collection.candidates.length} 个，成功来源 ${collection.sources.filter(s => s.ok).length} 个。`);
const report = rankDaily({ date, collectedAt, candidates: collection.candidates, history, ...config });
if (!report.gain.length) throw new Error('没有满足条件的涨星项目，保留已有站点，不发布空榜。');
report.sources = collection.sources;
report.errors = collection.errors ?? [];
const readmes = {};
if (process.env.DEEPSEEK_API_KEY && !dataOnly) {
  await mapLimit([...report.gain, ...report.rising], 4, async row => {
    readmes[row.repoId] = await fetchReadme(row.fullName, process.env.GITHUB_TOKEN);
  });
}
report.editorial = await writeEditorial(report, readmes, {
  key: dataOnly ? undefined : process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
});
if (process.env.REQUIRE_AI === '1' && !report.editorial.enabled) throw new Error(`AI 解读未通过：${report.editorial.reason}。保留已发布日报。`);
console.log(`[daily] 涨星榜 ${report.gain.length} 个，新锐榜 ${report.rising.length} 个，AI 解读 ${report.editorial.enabled ? '通过' : '未启用'}。`);

const stage = path.join(site, `.build-${date}`);
await fs.rm(withinSite(stage), { recursive: true, force: true });
await fs.mkdir(stage, { recursive: true });
await fs.writeFile(path.join(stage, 'report.json'), JSON.stringify(report, null, 2));
await exportCards(report, stage);
const out = path.join(site, 'reports', date);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.rm(withinSite(out), { recursive: true, force: true });
await fs.rename(withinSite(stage), withinSite(out));
await fs.writeFile(path.join(historyDir, `${date}.json`), JSON.stringify(report));

const imageCutoff = shiftDate(date, -config.keepImageDays + 1);
for (const folder of await fs.readdir(path.join(site, 'reports'))) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(folder) && folder < imageCutoff) {
    const target = path.resolve(site, 'reports', folder);
    if (!target.startsWith(path.resolve(site, 'reports') + path.sep)) throw new Error('保留期路径校验失败');
    await fs.rm(withinSite(target), { recursive: true, force: true });
  }
}
const historyCutoff = shiftDate(date, -config.keepHistoryDays + 1);
for (const file of await fs.readdir(historyDir)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file.slice(0, 10) < historyCutoff) await fs.unlink(path.join(historyDir, file));
const dates = (await fs.readdir(path.join(site, 'reports'))).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse();
const repository = process.env.GITHUB_REPOSITORY || 'fireKylinKing/github-rising-daily';
for (const archivedDate of dates) {
  const archived = JSON.parse(await fs.readFile(path.join(site, 'reports', archivedDate, 'report.json'), 'utf8'));
  await fs.writeFile(path.join(site, 'reports', archivedDate, 'index.html'), renderWeb(archived, dates, { prefix: './', home: '../../', repository }));
}
const latest = JSON.parse(await fs.readFile(path.join(site, 'reports', dates[0], 'report.json'), 'utf8'));
await fs.writeFile(path.join(site, 'index.html'), renderWeb(latest, dates, { prefix: `./reports/${dates[0]}/`, home: './', repository }));
await fs.writeFile(path.join(site, '.nojekyll'), '');
console.log(`[daily] 完成：${date}，图文 ${dates.length} 期，历史数据 ${Math.min(history.length + 1, config.keepHistoryDays)} 天。`);
