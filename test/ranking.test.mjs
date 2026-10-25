import test from 'node:test';
import assert from 'node:assert/strict';
import { rankDaily, dateKey, ageDays } from '../lib/ranking.mjs';
import { parseTrending } from '../lib/github.mjs';

const candidate = (repoId, stars, dailyGain, extra = {}) => ({
  repoId, fullName: `owner/repo-${repoId}`, stars, dailyGain,
  createdAt: '2025-11-16T01:52:04Z', ...extra,
});
const rank = (candidates, extra = {}) => rankDaily({
  date: '2026-10-25', collectedAt: '2026-10-25T00:00:00Z',
  candidates, minStars: 100, minDailyGain: 1, ...extra,
});
const prior = (date, gain, candidates = gain, collectedAt = `${date}T00:00:00Z`) => ({ date, collectedAt, gain, rising: [], candidates });

test('absolute board and disjoint relative board use explicit different metrics', () => {
  const result = rank([candidate(1, 300000, 5500), candidate(2, 22000, 723), candidate(3, 71000, 687), candidate(4, 19000, 545)], { limit: 1 });
  assert.equal(result.gain[0].repoId, 1);
  assert.equal(result.rising[0].repoId, 2);
  assert.equal(result.rising[0].growthRate, 723 / (22000 - 723));
  assert.ok(!result.gain.some(a => result.rising.some(b => a.repoId === b.repoId)));
});

test('first collection never fabricates yesterday, milestones, or a 24h delta', () => {
  const row = rank([candidate(1, 45000, 1000)]).gain[0];
  assert.equal(row.history.status, 'bootstrap');
  assert.equal(row.history.previousGain, null);
  assert.equal(row.history.previousRank, null);
  assert.equal(row.net24h, null);
  assert.deepEqual(row.milestones, []);
  assert.equal(row.history.streakIsLowerBound, true);
});

test('rename is tracked by stable repository ID and yields real rank changes', () => {
  const old = candidate(1, 29000, 800, { rank: 3, fullName: 'old/name' });
  const row = rank([candidate(1, 31000, 900, { fullName: 'new/name' })], {
    history: [prior('2026-10-24', [old])],
  }).gain[0];
  assert.equal(row.history.status, 'continuing');
  assert.equal(row.history.rankChange, 2);
  assert.equal(row.history.gainChange, 100);
  assert.equal(row.history.streakDays, 2);
  assert.deepEqual(row.milestones, [30000]);
  assert.equal(row.net24h.value, 2000);
});

test('observed absence distinguishes return, new entry, and missing collection', () => {
  const seen = { ...candidate(1, 1000, 20), rank: 1 };
  const history = [prior('2026-10-23', [seen]), prior('2026-10-24', [])];
  assert.equal(rank([candidate(1, 1200, 40)], { history }).gain[0].history.status, 'returning');
  assert.equal(rank([candidate(2, 1200, 40)], { history }).gain[0].history.status, 'new');
  const gap = rank([candidate(1, 1200, 40)], { history: [history[0]] }).gain[0];
  assert.equal(gap.history.status, 'gap');
  assert.equal(gap.history.previousGain, null);
  assert.equal(gap.history.streakDays, 1);
});

test('unmatched observation times cannot be called a 24-hour measured delta', () => {
  const row = candidate(1, 1000, 50);
  const history = [prior('2026-10-24', [{ ...row, rank: 1 }], [row], '2026-10-24T23:00:00Z')];
  assert.equal(rank([candidate(1, 1200, 80)], { history }).gain[0].net24h, null);
});

test('invalid/missing daily values, archived projects, forks, and IDs are rejected', () => {
  const result = rank([
    candidate(1, 1000, null), candidate(2, 1000, -1), candidate(3, 1000, 1001),
    candidate(4, 1000, 5, { archived: true }), candidate(5, 1000, 5, { fork: true }),
    candidate(6, 1000, 50), candidate(6, 1000, 50, { fullName: 'alias/name' }),
  ]);
  assert.deepEqual(result.gain.map(r => r.repoId), [6]);
  assert.equal(result.eligibleCount, 1);
});

test('zero estimated base is excluded from relative ranking without Infinity', () => {
  const result = rank([candidate(1, 1000, 1000), candidate(2, 5000, 2000), candidate(3, 2000, 100)], { limit: 1 });
  assert.equal(result.gain[0].repoId, 2);
  assert.deepEqual(result.rising.map(r => r.repoId), [3]);
});

test('China calendar date and project age agree across UTC date boundaries', () => {
  assert.equal(dateKey('2026-10-24T16:00:00Z'), '2026-10-25');
  assert.equal(ageDays('2025-11-16T01:52:04Z', '2026-10-25'), 343);
  assert.equal(ageDays('invalid', '2026-10-25'), null);
});

test('Trending parser requires a real daily growth value and extracts canonical repo', () => {
  const html = `<article class="Box-row"><h2><a href="/owner/project">owner / project</a></h2>
    <p>Useful &amp; safe</p><div class="f6"><span itemprop="programmingLanguage">Rust</span>
    <a href="/owner/project/stargazers">12,345</a><span>1,234 stars today</span></div></article>
    <article class="Box-row"><h2><a href="/owner/missing">missing</a></h2><a href="/owner/missing/stargazers">500</a></article>`;
  const rows = parseTrending(html, 'https://github.com/trending?since=daily');
  assert.deepEqual(rows[0], { fullName: 'owner/project', stars: 12345, dailyGain: 1234, description: 'Useful & safe', language: 'Rust', sourceUrl: 'https://github.com/trending?since=daily' });
  assert.equal(rows[1].dailyGain, null);
});
