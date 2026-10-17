# 网页新增页面与候选词

`config.json` 的 `pages` 按站点配置 `{url, include?, exclude?}`，`include` 是匹配 URL pathname 的正则，`exclude` 为排除路径正则。默认监控 media.io 首页、LightX 博客列表、renderpop 首页；LightX 仅保留 `/blog/单段文章路径`，排除分类与分页。

`src/pages.ts` 使用 Cheerio 读取页面所有 `<a href>`，同域链接按 URL 合并，统一 www、尾斜杠、片段和常见跟踪参数，保留业务查询参数。过滤资源、登录、法律、分类等页面。同一 URL 汇总所有非空锚文本，忽略通用 CTA，选择较短的有效描述性文本；全部无效时使用最后一段 slug，随机十六进制或纯数字 ID 留待确认。原始可见锚文本列表保留在快照及新增候选 JSON 中。

首次运行仅建立基线；`state/pages/*.json.gz` 保存曾出现的全部 URL 及最新锚文本。链接消失后再次出现不算新增，旧页面锚文本可以更新。HTTP 错误、非 HTML 或没有合格链接时保留原快照并在报告显示错误。非空的反爬挑战页面仍可能被当作正常内容，应根据报告的链接数量人工检查；不会自动启动浏览器。

`src/sitemaps.ts` 在原有 daily/sitemaps 步骤中直接调用网页监控，`--skip sitemaps` 同时跳过两者；sources 命令不运行。日报单独列出新增页面候选及依据，不经过激增频次或产品名称评分，新增链接会使用当前 `usecases.model` 批量提取核心词组和一句话解释，不额外调用搜索或 Trends。这里的“新增”表示列表中首次发现的链接，不代表页面首次发布，也不递归爬整站。

验证：`pnpm test -- tests/pages.test.ts`。实站基线可直接调用 `pageDiff(loadConfig("config.json"), "state")`，会写入本机快照；不要删除生产快照后期望保留历史去重。

当前本机与示例配置的 `sitemaps` 均为空；每日只运行 `pages` 中的 Media.io、LightX、Renderpop 网页监控。sitemap 解析模块和旧快照保留，历史记录保留用于去重和时间判断，但本次未抓取或研究产生的词不会出现在报告。

## 大模型核心词组提取

`src/page-keywords.ts` 使用当前 DeepSeek 模型理解标题，提取原文中的核心词组，而非通过正则裁剪教程前缀。例如 `How To Make A Roadster Ramp Car AI Video` 提取为 `Roadster Ramp Car AI Video`。原始锚文本仍保留在 `anchors`，不是直接把整篇标题作为搜索词；没有锚文本时输入 URL 推断文字。输出要求逐项索引、连续原文片段与一句中文词义解释，拒绝虚构词组、缺失或重复索引。无有效词组允许返回空值，正式词表不展示。

`page_keyword_cache` 在同一 SQLite 保存模型、提示词版本、原始标题、URL 对应的提词与解释结果，同一输入重跑不再付费。每批最多 25 个，首次运行建立网页基线时不调用；模型错误不推进该站快照，下一次重试。模型请求通过现有 AIsa chat 自动记账，正常新增网页调用归入 sitemaps 模块，历史修正归入 report 模块。

`brief-report.ts` 对本轮候选中再次出现的旧网页标题通过同一缓存修正，合并相同词组时保留最早首次发现与最近出现时间，并更新解释。原始上下文仍保留，旧报告再次导入也不会恢复完整教程标题。已生成或已发出的历史报告文件不自动重写。

当前 DeepSeek 的推理也占用输出 token，小批次输出上限至少 6000；额度过小时会返回不完整 JSON，须通过索引数量和原文校验后才写缓存，不能将缺失结果当成无有效词组。
