const DAY = 86_400_000;
export const MILESTONES = [1000, 5000, 10000, 20000, 30000, 50000, 100000, 200000, 500000, 1000000];

export function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

export function shiftDate(date, amount) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
}

export function ageDays(createdAt, date) {
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
  return Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${dateKey(createdAt)}T00:00:00Z`)) / DAY));
}

const sameRepo = (a, b) => String(a.repoId) === String(b.repoId);
const entries = (report, board) => report?.[board] ?? [];
const find = (report, board, repo) => entries(report, board).find(row => sameRepo(row, repo));

function historyFor(repo, board, date, history) {
  const before = history.filter(h => h.date < date).sort((a, b) => a.date.localeCompare(b.date));
  const yesterday = before.find(h => h.date === shiftDate(date, -1));
  const occurrences = before.filter(h => find(h, board, repo));
  const previous = yesterday && find(yesterday, board, repo);
  let status = before.length === 0 ? 'bootstrap' : !yesterday ? 'gap'
    : previous ? 'continuing' : occurrences.length ? 'returning' : 'new';
  let streakDays = 1;
  let streakIsLowerBound = true;
  for (let back = 1; back <= before.length + 1; back++) {
    const report = before.find(h => h.date === shiftDate(date, -back));
    if (!report) break;
    if (!find(report, board, repo)) { streakIsLowerBound = false; break; }
    streakDays++;
  }
  return {
    status, streakDays, streakIsLowerBound,
    observedDays: occurrences.length + 1,
    firstSeenDate: occurrences[0]?.date ?? date,
    previousRank: previous?.rank ?? null,
    rankChange: previous ? previous.rank - repo.rank : null,
    previousGain: previous?.dailyGain ?? null,
    gainChange: previous ? repo.dailyGain - previous.dailyGain : null,
  };
}

function measuredChange(repo, collectedAt, history) {
  const currentTime = Date.parse(collectedAt);
  const baselines = history.map(h => ({
    hours: (currentTime - Date.parse(h.collectedAt)) / 3_600_000,
    row: h.candidates?.find(r => sameRepo(r, repo)),
  })).filter(h => h.row && h.hours >= 23.5 && h.hours <= 24.5)
    .sort((a, b) => Math.abs(a.hours - 24) - Math.abs(b.hours - 24));
  if (!baselines.length) return null;
  return { value: repo.stars - baselines[0].row.stars, hours: Number(baselines[0].hours.toFixed(2)) };
}

export function rankDaily({ date, collectedAt, candidates, history = [], limit = 10, minStars = 200, minDailyGain = 20 }) {
  const prior = history.filter(h => h.date < date);
  const previousReport = [...prior].sort((a, b) => b.date.localeCompare(a.date))[0];
  const unique = new Map();
  for (const row of candidates) {
    if (!Number.isInteger(row.stars) || !Number.isInteger(row.dailyGain) || row.stars < minStars
      || row.dailyGain < minDailyGain || row.dailyGain > row.stars || !row.repoId || row.archived || row.fork) continue;
    if (!unique.has(String(row.repoId))) unique.set(String(row.repoId), { ...row });
  }
  const eligible = [...unique.values()].map(row => {
    const previousSnapshot = previousReport?.candidates?.find(r => sameRepo(r, row));
    const estimatedBase = row.stars - row.dailyGain;
    return {
      ...row,
      ageDays: ageDays(row.createdAt, date),
      growthRate: estimatedBase > 0 ? row.dailyGain / estimatedBase : null,
      net24h: measuredChange(row, collectedAt, prior),
      milestones: previousSnapshot ? MILESTONES.filter(n => previousSnapshot.stars < n && row.stars >= n) : [],
      milestoneSince: previousSnapshot ? previousReport.date : null,
    };
  });
  const absolute = (a, b) => b.dailyGain - a.dailyGain || b.stars - a.stars || a.fullName.localeCompare(b.fullName);
  const gain = [...eligible].sort(absolute).slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }));
  const taken = new Set(gain.map(r => String(r.repoId)));
  const rising = eligible.filter(r => !taken.has(String(r.repoId)) && r.growthRate !== null)
    .sort((a, b) => b.growthRate - a.growthRate || absolute(a, b)).slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  for (const [board, rows] of [['gain', gain], ['rising', rising]]) {
    for (const row of rows) row.history = historyFor(row, board, date, prior);
  }
  return {
    schemaVersion: 1, date, collectedAt,
    historyStart: [...prior.map(h => h.date), date].sort()[0],
    candidateCount: candidates.length, eligibleCount: eligible.length,
    metric: 'github-trending-daily', minStars, minDailyGain,
    gain, rising,
    candidates: candidates.map(r => ({ repoId: r.repoId, fullName: r.fullName, stars: r.stars, dailyGain: r.dailyGain })),
  };
}
