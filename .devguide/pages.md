# 网页新增页面与候选词

`config.json` 的 `pages` 按站点配置 `{url, include?, exclude?}`，`include` 是匹配 URL pathname 的正则，`exclude` 为排除路径正则。仓库默认及示例配置的 `pages` 均为空；实际监控站点、地址和路径过滤规则只配置在已被 Git 忽略的本机 `config.json`，不写入源码、示例或开发文档。

`src/pages.ts` 使用 Cheerio 读取页面所有 `<a href>`，同域链接按 URL 合并，统一 www、尾斜杠、片段和常见跟踪参数，保留业务查询参数。过滤资源、登录、法律、分类等页面。同一 URL 汇总所有非空锚文本，忽略通用 CTA，选择较短的有效描述性文本；全部无效时使用最后一段 slug，随机十六进制或纯数字 ID 留待确认。原始可见锚文本列表保留在快照及新增候选 JSON 中。

首次运行仅建立基线；`state/pages/*.json.gz` 保存曾出现的全部 URL 及最新锚文本。链接消失后再次出现不算新增，旧页面锚文本可以更新。HTTP 错误、非 HTML 或没有合格链接时保留原快照并在报告显示错误。非空的反爬挑战页面仍可能被当作正常内容，应根据报告的链接数量人工检查；不会自动启动浏览器。

`src/sitemaps.ts` 在原有 daily/sitemaps 步骤中直接调用网页监控，`--skip sitemaps` 同时跳过两者；sources 命令不运行。日报单独列出新增页面候选及依据，不经过激增频次或产品名称评分，新增链接使用当前 `usecases.model` 批量提取核心词组和一句话解释，然后由 `src/page-research.ts` 按归一化词键去重研究：带参考词查询七天曲线，再调用 `src/candidate-research.ts` 共用 Google 搜索取证与 AI 分类。网页标题、锚文本、提取解释及原链接作为 source=page 证据参与分类，避免把猜球员游戏误当真实比赛。这里的“新增”表示列表中首次发现的链接，不代表页面首次发布，也不递归爬整站。

验证：`pnpm test -- tests/pages.test.ts`。实站基线可直接调用 `pageDiff(loadConfig("config.json"), "state")`，会写入本机快照；不要删除生产快照后期望保留历史去重。

示例配置的 `sitemaps` 为空；本机网页监控列表仅从本地 `config.json` 的 `pages` 读取。sitemap 解析模块和旧快照保留，历史记录保留用于去重和时间判断，但本次未抓取或研究产生的词不会出现在报告。

## 大模型核心词组提取

`src/page-keywords.ts` 使用当前 DeepSeek 模型理解标题，提取原文中的核心词组，而非通过正则裁剪教程前缀。例如 `How To Make A Roadster Ramp Car AI Video` 提取为 `Roadster Ramp Car AI Video`。原始锚文本仍保留在 `anchors`，不是直接把整篇标题作为搜索词；没有锚文本时输入 URL 推断文字。输出要求逐项索引、连续原文片段与一句中文词义解释，拒绝虚构词组、缺失或重复索引。无有效词组允许返回空值，正式词表不展示。

`page_keyword_cache` 在同一 SQLite 保存模型、提示词版本、原始标题、URL 对应的提词与解释结果，同一输入重跑不再付费。每批最多 25 个，首次运行建立网页基线时不调用；模型错误不推进该站快照，下一次重试。模型请求通过现有 AIsa chat 自动记账，正常新增网页调用归入 sitemaps 模块，历史修正归入 report 模块。

`brief-report.ts` 对本轮候选中再次出现的旧网页标题通过同一缓存修正，合并相同词组时保留最早首次发现与最近出现时间，并更新解释。原始上下文仍保留，旧报告再次导入也不会恢复完整教程标题。已生成或已发出的历史报告文件不自动重写。

当前 DeepSeek 的推理也占用输出 token，小批次输出上限至少 6000；额度过小时会返回不完整 JSON，须通过索引数量和原文校验后才写缓存，不能将缺失结果当成无有效词组。

## 网页词曲线与 AI 分类

`pageDiff` 抓取/提词、归档本轮原始候选后推进快照，`sitemaps.diff` 随后调用 `researchPages` 研究本轮新增词；首次基线或无新增不请求趋势、搜索、分类。不同页面提取出同一词时仅研究一次，再将结果关联回页面。网页词的原始发现时间在研究前写入现有 term_discoveries。

曲线复用 filterRootTrends 的小时点、参考词、趋势分类与有限超大曲线重查，并作为硬性门槛：只有 status=passed 进入搜索和 AI 分类；全零、非上涨、参考词无效、缺点或请求失败均移入 pages.curve_filtered，不进入后续解释、日报和网页。AI 明确 is_offline_sports_event=true 再移入 pages.classification_filtered；曲线已通过而 AI 失败/证据不足时保留分类待确认。网页来源保留 page_evidence、search_response、exact_search_response、classification、trend_filter、context，网站只读公开分类与曲线白名单。

快照与后续研究不是同一事务；`pageDiff` 在推进有新增链接的站点快照之前，先将本轮已提取的原始候选原子归档到 `state/page-batches/<UUID>.json.gz`。同轮多站点累计写入同一批次，文件包含 created_at、来源页、全部锚文本及提词结果；正常返回的 research_batch 对应此 UUID。后续研究抛错也能从批次文件恢复，不依赖上一份报告。首次基线和无新增不产生批次，研究失败不回滚 URL 去重快照。

显式补查命令：

```sh
pnpm radar replay-pages --batch <UUID> --config config.json --state state --out state/page-replay.json
```

批次 ID 可从正常报告的 sitemap.pages.research_batch 或本地 page-batches 文件名获取。补查复用相同曲线、搜索和分类流程，输出独立 JSON，保留归档时间作为原始发现时间，不抓网页、不推进快照、不自动并入每日候选、不发布或通知。原始归档不被补查覆盖；跨轮补查可能重新付费。所有实际收费请求沿用 SQLite 账本，正常 daily 与补查均归入 sitemaps 模块。

错误示范：先更新 seen、只把候选放在内存中，再调用付费接口，抛错后下一次抓取不再返回这些链接；删除整站快照补救会破坏永久去重。`tests/page-recovery.test.ts` 使用临时状态目录验证失败留档、CLI 显式补查和去重不回退，同时验证网页研究的程序错误上抛及预期上游错误局部降级。
