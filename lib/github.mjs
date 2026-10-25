import * as cheerio from 'cheerio';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const integer = value => {
  const plain = String(value).replace(/,/g, '').trim();
  return /^\d+$/.test(plain) ? Number(plain) : null;
};

export function parseTrending(html, sourceUrl) {
  const $ = cheerio.load(html);
  const rows = [];
  $('article.Box-row').each((_, element) => {
    const el = $(element);
    const fullName = (el.find('h2 a').attr('href') ?? '').replace(/^\//, '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return;
    const stars = integer(el.find('a[href$="/stargazers"]').first().text());
    const dailyMatch = el.find('span').filter((_, span) => /^\s*[\d,]+\s+stars?\s+today\s*$/i.test($(span).text())).first().text().match(/([\d,]+)\s+stars?\s+today/i);
    const dailyGain = dailyMatch ? integer(dailyMatch[1]) : null;
    rows.push({
      fullName, stars, dailyGain,
      description: el.find('p').first().text().replace(/\s+/g, ' ').trim(),
      language: el.find('[itemprop="programmingLanguage"]').text().trim() || null,
      sourceUrl,
    });
  });
  return rows;
}

async function request(url, { token, accept = 'application/vnd.github+json', timeout = 30_000 } = {}) {
  const headers = { 'User-Agent': 'github-rising-daily/1.0', Accept: accept };
  if (token && new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await pause(Math.min(30, Number(response.headers.get('retry-after')) || (attempt + 1) * 3) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }
}

export async function mapLimit(values, concurrency, fn) {
  const result = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) { const i = next++; result[i] = await fn(values[i], i); }
  }));
  return result;
}

export async function collectCandidates(languages, { token } = {}) {
  const sources = [];
  const discovered = new Map();
  // Board requests are sequential to keep the public HTML endpoint's load low.
  for (const language of languages) {
    const url = `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}?since=daily`;
    try {
      const html = await (await request(url, { accept: 'text/html' })).text();
      const rows = parseTrending(html, url);
      if (!rows.length) throw new Error('页面没有可识别的项目，可能是页面结构变化或访问限制');
      sources.push({ language: language || 'all', url, ok: true, count: rows.length });
      for (const row of rows) if (!discovered.has(row.fullName.toLowerCase())) discovered.set(row.fullName.toLowerCase(), row);
    } catch (error) {
      sources.push({ language: language || 'all', url, ok: false, error: error.message });
    }
    await pause(350);
  }
  if (!sources.some(s => s.ok)) throw new Error('所有 GitHub 日榜采集失败，保留已有日报，不发布空榜。');
  const errors = [];
  const fetched = await mapLimit([...discovered.values()], 4, async row => {
    try {
      const data = await (await request(`https://api.github.com/repos/${row.fullName}`, { token })).json();
      return {
        ...row,
        repoId: data.id,
        fullName: data.full_name,
        url: data.html_url,
        // Keep stars and dailyGain from the SAME HTML observation for the estimated ratio.
        stars: row.stars ?? data.stargazers_count,
        currentStars: data.stargazers_count,
        description: data.description || row.description,
        createdAt: data.created_at,
        language: data.language || row.language,
        license: data.license?.spdx_id === 'NOASSERTION' ? null : data.license?.spdx_id ?? null,
        ownerType: data.owner?.type ?? null,
        archived: data.archived,
        fork: data.fork,
      };
    } catch (error) {
      errors.push({ repository: row.fullName, error: error.message });
      return null;
    }
  });
  const candidates = fetched.filter(Boolean);
  if (!candidates.length) throw new Error('GitHub 仓库元数据全部采集失败，拒绝发布不完整空榜。');
  return { candidates, sources, errors };
}

export async function fetchReadme(fullName, token) {
  try {
    const text = await (await request(`https://api.github.com/repos/${fullName}/readme`, {
      token, accept: 'application/vnd.github.raw+json',
    })).text();
    return text.replace(/<!--[\s\S]*?-->/g, '').slice(0, 4500);
  } catch { return ''; }
}
