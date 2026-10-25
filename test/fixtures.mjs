import { rankDaily } from '../lib/ranking.mjs';
import { fallbackEditorial } from '../lib/editor.mjs';

export function fixtureReport() {
  const candidates = Array.from({ length: 24 }, (_, i) => ({
    repoId: i + 1, fullName: `owner/project-${i + 1}`, stars: (i + 1) * 2000,
    dailyGain: 900 - i * 25, createdAt: '2025-11-16T00:00:00Z',
    description: '这是用于验证布局和数据完整性的测试项目，不会发布为真实榜单。',
    language: 'TypeScript', license: 'MIT', ownerType: 'User',
  }));
  const report = rankDaily({ date: '2026-10-25', collectedAt: '2026-10-25T00:00:00Z', candidates });
  report.editorial = fallbackEditorial(report);
  return report;
}
