# 已知问题

## new-sites 信号（信号③b）必报错

- 现象：`post_dataforseo_domains_whois_overview_live` 调用被 AIsa 的参数校验拒绝，报告里该节显示错误，其余部分不受影响
- 原因：AIsa 的校验目前不接受 DataForSEO 要求的 filters 格式，而代码构造的正是该格式，见 `src/new-sites.ts:newSites()`
- 边界：2026-10-06 前可用；之后失效
- 处置：`--skip newsites` 静默它，避免每周浪费约 $0.26；上游修复后去掉 `--skip`

## 搜索量边界

发现线索本身不附搜索量；关键词表里的月搜索量来自 Google Ads，日搜索量由 Trends 校准估算，不是实时精确统计。无数据保留为空，不以热度或广告投放数代替月搜索量。

## Twitter AIO 复用边界

相邻 `/var/www/pyys/twibot.org` 的 `src/features/x-tweets/api/providers/twitter-aio/` 提供账号查询、账号时间线和 Top/Latest 搜索适配器。本项目默认使用 Twitter AIO，保留 Scrappa 账号采集与 AIsa 高赞搜索作为显式备选；运行契约见 [twitter-aio.md](twitter-aio.md)。

2026-10-16 使用相邻项目已有凭据做有限只读验证：`/user/by/username/OpenAI`、`/user/4398626122/tweets`、`/search/{query}` 均返回 HTTP 200。时间线实际路径是 `data.user.result.timeline.timeline.instructions`，而相邻项目 schema 要求 `data.data.user.result.timeline.timeline.instructions`；不能直接复制解析器，需明确兼容两种外壳并校验必需字段。

以 `"Claude Code" min_faves:50 -filter:replies since:2026-10-02`、`category=Top` 实测一页，按顶层推文去重得到 20 条，其中 14 条正文匹配短语且满足日期、点赞、非回复条件，另 6 条正文不匹配。响应有 Bottom 游标；单页样本不证明分页覆盖或搜索完整性。搜索必须本地核验正文（优先 note_tweet 长文）、点赞、日期和回复标记，不能用引用推文的正文冒充顶层结果。

凭据采用相邻项目的正式 `X_TWEETS_TWITTER_AIO_*` 或兼容 `TWITTER_AIO_RAPIDAPI_*` 配置，API key 可回退 `RAPIDAPI_KEY`；通用 RapidAPI host/base URL 可能指向其他服务，不能直接复用。验证未复制密钥、未写生产 state、未发送通知；HTTP 200 不代表免费，本次未核实订阅额度与单价。

### AIsa 与 Twitter AIO 搜索对照

2026-10-16 05:12–05:13 UTC，同一轮比较三个词。双方使用相同原生查询 `"关键词" min_faves:50 -filter:replies since:2026-10-02`、Top，各取首页，不重试、不追加分页；双方实际每词均返回 20 条无重复的顶层推文。AIsa 使用项目现有 `get_twitter_tweet_advanced_search`，AIO 使用 `/search/{query}`。

本地统一检查顶层正文（AIO 优先 note_tweet 长文）、不区分大小写、词边界与连续短语（空白可变），并要求点赞至少 50、日期在 UTC 起点至请求时刻内、非回复、必要字段完整；不以引用推文的正文代替顶层正文。

| 关键词 | AIsa 合格/返回 | AIO 合格/返回 | 双方合格推文 ID 交集 |
|---|---|---|---|
| Claude Code | 16/20 | 13/20 | 8 |
| Codex | 19/20 | 18/20 | 11 |
| Gemini | 18/20 | 19/20 | 8 |
| 合计 | 53/60（88.3%） | 50/60（83.3%） | 27 |

本轮不合格项全部为顶层正文未匹配关键词，点赞、时间和非回复检查均通过；不能据此断言提供商违反 X 搜索语义，因为引用内容、实体等也可能参与原生搜索。这里的合格率只衡量本项目要求的正文匹配，不是人工判定的产品语义相关性（例如 Gemini 同名歧义）、事实准确率或搜索召回率。双方均返回下一页标识；首页交集较小，也不证明任一方漏搜。单轮三词不足以证明整体优劣或长期稳定性。

AIsa 先查询完整工具 schema 并报价，三个请求估算合计 $0.009；实际返回计费每次 3000 micro-USD，合计 $0.009。AIO 本轮调用 3 次，未核实套餐账单，不能标为免费。原始响应和统计临时保存在 `/tmp/radar-x-comparison-*.json`，不包含请求密钥，不作为持久依赖；未修改生产入口、词表或发送通知。

### 五页游标对照

同日沿上述首页的各自游标继续至第 5 页，保持同一查询与本地校验规则；每个提供商、每个词均得到 5 页，每页 20 条，共各 300 条。所有请求成功，各词内部没有跨页重复；未自动重试或切换提供商。

| 关键词 | AIsa 第 1–5 页合格条数 | AIO 第 1–5 页合格条数 | AIsa 累计 | AIO 累计 | 合格 ID 交集 |
|---|---|---|---|---|---|
| Claude Code | 16 / 13 / 11 / 15 / 16 | 13 / 13 / 16 / 14 / 12 | 71/100 | 68/100 | 57 |
| Codex | 19 / 9 / 16 / 17 / 17 | 18 / 14 / 18 / 17 / 17 | 78/100 | 84/100 | 63 |
| Gemini | 18 / 16 / 13 / 19 / 20 | 19 / 17 / 18 / 17 / 20 | 86/100 | 91/100 | 63 |
| 合计 | — | — | 235/300（78.3%） | 243/300（81.0%） | 183 |

五页样本中 AIO 的累计正文匹配率略高，不能以首页样本断言 AIsa 更准确。双方所有点赞、时间、非回复检查均通过，不合格项仍全部为顶层正文不匹配；仍未进行语义消歧、人工相关性判定或完整召回评估。

AIO 的后续页游标存在 `entries[].entry.content` 外壳，与首页直接 `entries[].content` 的形态不同；解析需同时遍历分组 `entries`、单条 `entry` 和直接 `content`，并识别 Bottom 游标。不能把解析器漏读游标当作上游已无下一页。测试确认并兼容该形态后继续已有游标，没有重新收费获取已成功的页。

AIsa 新增 12 次请求先逐批报价、再按游标调用，新增实际费用 $0.036，含首页 15 次共 $0.045；AIO 含首页共 15 次请求，套餐账单未核实。分页原始响应和逐页统计临时位于 `/tmp/radar-x-pagination-results.json` 与 `/tmp/radar-x-pagination-summary.json`；生产入口、状态与通知均未改动。

## Scrappa MCP 替代能力边界

账号推文默认 Twitter AIO（Scrappa 为备选），全球 Trends 通过 Scrappa MCP，相关查询仍用 GoAnyAPI，其他付费接口仍调用 AIsa HTTP tool-router 与 chat。客户端与凭据规则见 [scrappa.md](scrappa.md)。

按 2026-10-16 的 Scrappa MCP `search_endpoints` 发现结果：

| 本项目依赖 | Scrappa 对应能力 | 边界 |
|---|---|---|
| `review.ts`、`usecases.ts` 的 Trends 序列 | `google-trends-interest` | 已接入 90 天世界范围日序列，裁剪窗口并保留比较尺度；早于 90 天的复盘显式报错 |
| `goanyapi.ts` 的相关查询 | `google-trends-related` | 实测仅扁平数组、无 rising 标识，不等价；生产保留 GoAnyAPI |
| `sources.ts` 的账号最近推文 | `x-twitter-user-tweets` | 接受 handle、cursor、count、with_replies、groupthreads、since；已适配正文、点赞、时间和游标分页，采集预算每账号最多 3 页 |
| `usecases.ts` 的 X 高赞推文搜索 | 未发现 `x-twitter-search` | Google `site:x.com` 检索不能保持点赞过滤、完整性和时效语义 |
| `usecases.ts` 的 Google Ads 月搜索量 | 未发现等价端点 | Trends 相对热度与热门事件搜索量不能当作任意关键词的 Google Ads 月搜索量 |
| `new-sites.ts` 的 WHOIS + 首次收录 + ETV/排名词筛选 | 未发现 WHOIS 等价端点 | 域名可注册性查询不具备这些指标 |
| `judge.ts`、`usecases.ts` 的模型生成与筛选 | 未发现 chat completions 服务 | 需独立模型服务 |

因此不能在保留全部功能的前提下，把 AIsa URL/工具名直接换成 Scrappa。已确认的对应能力包括账号推文采集与 Trends；其他项需要保留原服务、接入独立来源或明确降级。账号推文、相关查询与日序列已做真实请求验证，详见 [scrappa.md](scrappa.md)。

接口发现注意：宽泛查询 `twitter` 的结果未包含全部 Twitter 端点，直接查询完整端点名也可能返回空；应结合自然语言 `user tweets`、`twitter tweets` 和[官方 Twitter 目录](https://scrappa.co/apis/x-twitter-api)核验，不能据单次搜索为空断定缺少能力。账号推文见[官方接口文档](https://scrappa.co/docs/x-twitter/x_twitter_user_tweets)。

X 全站搜索的搜索引擎缓存与当前官网不一致：缓存曾列 20 个端点及 `/api/x-twitter/search/tweets`；直接打开的当前页面列 18 个端点，已无 Search Tweets，MCP 用多种自然语言查询也未发现推文搜索。`x-twitter-typeahead` 仅提供输入联想，不能代替 `usecases.evidence()` 的关键词全站检索、`min_faves:50`、14 天窗口和 Top 排序，因此 Scrappa 不作为该调用的替代；高赞搜索默认 Twitter AIO、AIsa 为备选。

官方资料：[MCP 接入](https://scrappa.co/docs/mcp-integration)、[Trends 序列](https://scrappa.co/docs/google-trends-api/google_trends_interest)、[相关查询](https://scrappa.co/docs/google-trends-api/google_trends_related)。MCP 地址为 `https://scrappa.co/mcp`，鉴权使用 `X-API-KEY`。

### Google Ads Transparency 不提供关键词月搜索量

[Scrappa Google Ads Transparency](https://scrappa.co/apis/google-ads-transparency-api) 的三个端点分别查询广告主、广告列表、单条广告素材及投放地区/起止日期。它不提供 `search_volume` 或 `monthly_searches`，不能替代 `usecases.volumes()` 所需的关键词需求数据。广告数量、投放时长与关键词月搜索量不是同一指标；关键词月搜索量需要 Keyword Planner / Google Ads 关键词历史指标一类数据源。

## 停用词与 HF 名称清洗按 AI 领域调

内置 `src/terms.ts` 的 STOP 表与 Hugging Face 名称清洗面向 AI 模型与 agent 工具。换领域要在 `config.json` 的 `stop_words` 里补词。

## 邮件 HTML 渲染

`--mail` 使用运行依赖 `marked`，与其他 Node 依赖一起由 pnpm 安装。

## 大型 sitemap 的本地处理

`sitemaps.diff()` 使用 Set 判断旧 URL，差分查询不再逐项扫描旧数组；统计数据逐条追加，避免大数组展开为函数参数触发 RangeError。回归样本使用 200,000 条旧 URL，验证新增 URL、词频和快照。XML 与 URL 仍在内存中完整处理，内存需求随站点大小增长；这不是流式采集器，也不能据此保证任意上游大站都成功。
