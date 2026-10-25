# 开源升温 · GitHub 每日涨星与新锐榜

每天生成两套榜单、项目中文解读、历史状态和 1080×1440 的图文卡片。

- **涨星榜**：合并 GitHub 全站和 Python / TypeScript / JavaScript / Rust / Go / Java / C++ Trending 日榜，按页面当日新增 Star 排序。
- **新锐榜**：排除涨星榜 Top 10 后，按 `当日新增 / (页面累计 Star - 当日新增)` 的估算相对涨幅排序。
- **历史**：按稳定仓库 ID 跟踪首次采集、首次入选、回榜、连续收录和排名变化；断档标记为未知。首次采集不会伪造昨日数据。
- **图片**：两张榜单、双项目介绍卡和趋势总结。20 个项目时通常输出 13 张 PNG；可单张下载或 ZIP 下载，含配套文案。
- **解读**：DeepSeek 根据简介、README 摘录与观测数据生成中文介绍和三个趋势观察；无法证明涨星的因果。

## 统计范围与边界

候选只覆盖配置的 GitHub Trending 日榜，不保证覆盖 GitHub 全站全部项目。日增沿用 GitHub 的 `stars today`，不是自行测量的严格滚动 24 小时净增。相对涨幅为估算口径。历史状态只表示本工具的收录记录，不代表项目在 GitHub 历史上首次登榜。

存在 23.5–24.5 小时前的观测时，额外显示实测净增及真实间隔；它不参与日榜排序。创建天数不等同于正式产品上线日期。突破里程碑必须有较早的总 Star 观测支持。

所有榜单、来源链接和失败来源会写入 `report.json`，页面提供统计说明。图片保留最近 14 天，历史快照保留 365 天。`config.json` 控制语言、最低 Star / 日增和保留期。

## 部署

1. Fork 仓库，添加 Repository secret `DEEPSEEK_API_KEY`。
2. Pages 发布源选择 **GitHub Actions**。
3. 启用 **GitHub Rising Daily**，手动运行一次。

计划每天北京时间 **08:17** 启动，GitHub 排队可能延迟。当天已有日报时定时触发会跳过；手动运行可以刷新当天内容。当前日期始终按 `Asia/Shanghai` 计算。

`GITHUB_TOKEN` 由 Actions 自动提供，不需要新增个人令牌。`DEEPSEEK_MODEL` 可选，默认 `deepseek-v4-flash`。模型调用按服务商计费。

## 本地

需要 Node.js 22+。

```sh
npm ci
npx playwright install chromium
npm test
# 在 shell 中设置 GITHUB_TOKEN 和 DEEPSEEK_API_KEY，再运行：
npm run daily
npm run preview
```

仅生成基础数据、原始简介和卡片：`npm run daily -- --data-only`。未配置模型时会明确显示基础数据版。GitHub Actions 要求 AI 解读通过后才发布，模型异常时保留已有站点。

生成过程会检查所有 PNG 尺寸和布局溢出。全部数据源失败时拒绝发布空榜；部分数据源失败时在页面明确标记范围变化。

## 目录

`lib/github.mjs` 采集与解析；`lib/ranking.mjs` 排名和历史；`lib/editor.mjs` 中文解读；`lib/render.mjs` 网页和卡片；`scripts/daily.mjs` 编排；`scripts/export.mjs` 浏览器截图与 ZIP。

静态站点及历史存储在 `gh-pages` 分支，源代码在 `main`。API 密钥只通过环境变量传入，不进入页面、图片、历史 JSON 或仓库。
