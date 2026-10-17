# Scrappa MCP 数据接入

## 当前分工

- `src/scrappa.ts` 使用官方 TypeScript MCP SDK v1 的 Streamable HTTP 客户端连接 `https://scrappa.co/mcp`，初始化后调用 `call-endpoint`；`params` 是 JSON 字符串。
- 设置 `X_TIMELINE_PROVIDER=scrappa` 时，`sources.xNew()`：通过 `x-twitter-user-tweets` 读取账号正文、点赞和 UTC 发布时间，最多每账号 3 页，覆盖 30 小时。游标重复、分页卡住或达到预算仍未覆盖窗口时显式报错，不覆盖词表。`count` 只是建议页大小，实测请求 2 条仍返回 22 条。
- `review.review()` 使用 `google-trends-interest` 单词序列；`usecases.fetchSeries()` 每批参考词加最多四词，从共同尺度提取形状与规模。
- 关键词取证通过同一密钥调用 REST `GET /api/search`：通用关键词流程为精确短语搜索，根词 Rising 流程先普通搜索，无原词匹配证据时仅补一次带引号精确搜索，`hl=en/gl=us`，只用首页最多八条标题/摘要/链接，不抓正文、不翻页。调用记录端点为 `/api/search`，按 Starter 303 micro-USD 估算；Google Search 不经 MCP，Trends 等端点继续使用 MCP。
- X 账号采集默认使用 Twitter AIO；AIsa 高赞搜索作为 `X_SEARCH_PROVIDER=aisa` 备选，负责 WHOIS 综合筛选和模型调用；关键词量级使用 Trends 固定参考词推算，不请求 Google Ads。见 [twitter-aio.md](twitter-aio.md)。
- GoAnyAPI 负责带 `top/rising` 分类的相关查询和单国日序列。Scrappa 相关查询没有作为生产替代来源。

本机当前未设置 `GOANYAPI_API_KEY`，项目 `.env` 也未声明该变量。因此上述 GoAnyAPI 能力仅是可选代码，本机并未启用：不请求相关查询和单国日序列，也没有 rising 相关词产生的 `cosearch` 线索。`usecases.related: true` 不能代替密钥。保留可选代码不代表已保留运行中的 rising 能力。

## 密钥和依赖

安装 `pnpm install --frozen-lockfile`；`@modelcontextprotocol/sdk` v1 是运行依赖。

密钥依次读取：`SCRAPPA_API_KEY` → `~/.scrappa/key` → `~/.config/opencode/opencode.json` 中 `mcp.scrappa.headers` 的 `X-API-KEY`（大小写不敏感）。不读取项目 `.env`，不复制或打印已有密钥。`SCRAPPA_MCP_URL` 可覆盖默认服务地址。

本机 cron 的 `HOME=/home/ubuntu` 能直接复用现有 OpenCode 配置；GitHub Actions 需要配置 `SCRAPPA_API_KEY` secret，工作流已传入该变量。

## Trends 数据契约

- 时间点使用 Unix 时间戳转 UTC 日期；单词值读取 `value`，比较词读取 `values[].query/value` 并核对词序，不能混用独立请求的尺度。
- 90 天序列裁剪到业务要求的日期；单词裁剪后重新归一化到窗口最大值 100，保留 `RISE_MIN` 的语义。比较序列保持共同尺度，不分别归一化。
- 拒绝周粒度、断续日期、缺失基线、错误词序和无效数值；不把接口错误当作零热度。复盘仍剔除最后两天未结算数据。
- 请求起点早于当前 UTC 日期前 90 天时显式报错；积压过久的复盘不会被错误写成 miss/no_data。Scrappa 仅有预设窗口，不能假定支持任意历史区间。
- 数据提供商不同，迁移不能保证逐日数值或历史判定完全一致；测试验证数据结构、日粒度、共同尺度与判定保护。

## top 与 rising

通用关键词研究的可选相关查询使用 GoAnyAPI，`splitRelated()` 优先 rising 再补 top；`otherNames()` 仅允许 rising 中的新产品名产生 `cosearch` 线索。独立根词来源默认直连 DataForSEO Standard，AIsa Live 保留备选，只接受显式 rising，见 [trends.md](trends.md)。

Google 的 [Top/Rising 定义](https://support.google.com/trends/answer/4355000?hl=en)：top 是相关查询的相对热门程度；rising 是相对前一时段增长最快的查询，带增长百分比或 Breakout。热门不等于上涨，上涨也不保证是刚诞生的新词。

Scrappa 的 MCP 与 REST 相关查询都未提供可验证的 Rising 分类。REST `/api/google-trends/related` 对根词 `game`、全球、`time_range=1d/7d` 均返回 HTTP 200 和各 25 个扁平 `related_queries`；字段只有 `query/value/formatted_value`，没有 `rising`、增长百分比或 Breakout。两个窗口首项均为 `the game`、100，后续值不同，但响应参数没有回显时间窗口，因此不能仅凭数值差异严格验证实际窗口。只能确认收到未分类相关词，不能证明是 Rising，也不能只凭 0–100 数值严格断定是 Top。要求 Rising 的新候选来源不能采用该响应。

原始契约样本在忽略目录 `state/trends-related-game-1d.json`、`state/trends-related-game-7d.json`，测试不写入生产候选、不推送通知。两次成功请求各按 303 micro-USD 入账，合计 $0.000606，命令标签 `scrappa-related-rising-validation`。官网概览的 top/rising 宣称不能替代实际分类字段；不得把该扁平列表映射为 Rising。

## 验证与费用

运行 `pnpm check`。测试隔离本机密钥和 Scrappa 网络，真实样本保存在 `tests/fixtures/scrappa.json`，推文仅保留必要字段。

Scrappa 以 Starter 单价 303 micro-USD/成功请求估算成本，未扣免费额度，报告已注明估算。失败不自动重试、不隐式切回收费来源；CLI/MCP 的 SQLite 明细会保留批次中已成功的请求，失败请求费用记为未知；估算仍以服务商使用记录为准。详见 [costs.md](costs.md)。

关键词研究每批最多五词，首词为 `hex picker`（每天约 2500 次的假设），其余最多四词；共同尺度用于曲线形状与比值估量，详见 costs.md。比较序列允许 `has_data=false` 且 `value=0` 的低热度日；缺失/不一致值仍拒绝。

`KEYWORD_EVIDENCE_PROVIDER=google` 为默认取证来源；设为 `x` 后才会进入既有高赞搜索路由（再由 `X_SEARCH_PROVIDER` 选 AIO/AIsa）。Google 失败不自动请求 X，保留 README 与错误提示。通用关键词精确搜索只保留标题/摘要含完整名称边界的 HTTP(S) 链接、按链接去重；模型根据外部资料判断用途，不把摘要当指令，也不把产品宣传等同真实使用证据。JSON `evidence_provider/evidence_sources` 与报告来源链接用于追溯；`posts_error` 兼容字段也承载 Google 取证错误。

## Rising 跨接口对照

相同根词 `game`、全球、英语、Web Search 下，AIsa 目录的 DataForSEO Google Trends Explore Live（`any_dataforseo_apis_v1_dataforseo_keywords_data_g_f56cfb`）可执行；参数为 `body:[{keywords:["game"], time_range:"past_day"|"past_7_days", item_types:["google_trends_queries_list"], type:"web",language_code:"en"}]`。结果 `tasks[].result[].items[].data` 明确区分 `top` 与 `rising`，两窗口各 25 个 Rising。`check_url` 分别回显 `date=now%201-d`、`date=now%207-d`，地区代码为 0（全球）。

Scrappa 的 1d/7d 各 25 词与该接口 Top 精确匹配 17/19 词，与 Rising 只匹配 1/3 词，支持其更接近 Top 的判断，但不同采样时刻不能保证词序或数值完全相同。Rising 示例：1d 的 `city-building game` 增长值 2700，7d 的 `outward game alternative to skyrim` 增长值 3300。分类必须读取 `data.rising`，不能仅按值大于 100 判定。

AIsa Search 的工具展示价不是最终报价；相同参数 Batch Quote 为每窗口 $0.011，Batch Use 实际也各 $0.011，共 $0.022，已入本机费用账本（命令 `aisa-related-rising-validation`）。原始发现、报价及响应保存在 `state/aisa-trends-*.json`，测试未写生产候选或发送通知。

其他供应商仅核查公开文档，尚无本机独立密钥实测：GoAnyAPI 明确支持 `relatedQueries.rising` 与 `now 1-d/now 7-d`，小包每次 6 credits × $0.001=$0.006；SerpApi 明确支持 `related_queries.rising` 与这两个窗口，免费每月 250 次、Starter $25/1000 次；DataForSEO 直连 Live 标价 $0.011，Standard $0.0027 但为异步任务且最长 45 分钟。接口文档：<https://goanyapi.com/docs/google-trends-api>、<https://serpapi.com/google-trends-related-queries>、<https://docs.dataforseo.com/v3/keywords_data-google-trends-explore-live/>；价格：各官网 pricing 页面。生产根词来源默认直连 DataForSEO Standard，实测提交单任务 $0.0027、取回 $0；AIsa 转接 Live 保留备选，详见 [dataforseo.md](dataforseo.md)。

## 根词来源

根词 Rising 默认使用 DataForSEO Standard，AIsa 转接 Live 为备选，曲线与搜索使用 Scrappa。流程、游戏类目、有限超大曲线重查、首次发现记录、AI 分类及解释缓存见 [trends.md](trends.md)。
