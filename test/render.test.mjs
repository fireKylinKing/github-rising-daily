import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEditorial } from '../lib/editor.mjs';
import { createSlides, renderWeb, renderSlide } from '../lib/render.mjs';
import { fixtureReport } from './fixtures.mjs';

test('twenty projects produce two boards, ten paired cards, and a summary', () => {
  const report = fixtureReport();
  assert.equal(createSlides(report).length, 13);
  for (const slide of createSlides(report)) assert.ok(renderSlide(slide, report, 0, 13).includes('data-export-slide'));
});

test('untrusted repository and model text is HTML-escaped in both webpage and slides', () => {
  const report = fixtureReport();
  const attack = '<img src=x onerror="alert(1)">';
  report.editorial.headline = attack;
  report.editorial.projects[report.gain[0].repoId].summary = attack;
  const html = renderWeb(report, [report.date], { prefix: './', home: './' });
  assert.ok(!html.includes(attack));
  assert.ok(html.includes('&lt;img'));
  const slide = renderSlide(createSlides(report)[2], report, 2, 13);
  assert.ok(!slide.includes(attack));
});

test('editorial rejects incomplete projects and filters invented project references', () => {
  const report = fixtureReport();
  assert.throws(() => validateEditorial({ projects: [], trends: [] }, report));
  const data = {
    projects: [...report.gain, ...report.rising].map(r => ({ repoId: r.repoId, summary: '项目介绍', observation: '公开资料观察' })),
    trends: Array.from({ length: 3 }, () => ({ title: '方向', body: '分析', repoIds: [report.gain[0].repoId, 99999] })),
  };
  assert.deepEqual(validateEditorial(data, report).trends[0].repoIds, [String(report.gain[0].repoId)]);
});
