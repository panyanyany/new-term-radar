# 费用统计与参考单价

## 当前统计口径

报告合计包含数据接口费用与模型估算，美元显示四位小数。内部采用 micro-USD（1 美元 = 1,000,000 micro-USD），模型累计允许小数；不按每次调用提前取整。日报告 JSON 顶层 `cost_micros` 和 Markdown 使用同一合计，包含 X、名称评分、关键词研究、复盘及启用的 new-sites。MCP `keyword_table.cost_usd` 和通知摘要也使用该口径。

每个模块的 `cost_micros` 已含其模型费用，`model_cost_micros` 是其中的分项，不能再次相加。缺少 token 用量或模型价格会增加 `model_unpriced_calls`，报告和通知明确提示估算不完整。CLI 与 MCP 的报告合计以本次 SQLite 请求明细为准；模块合计用于直接函数调用的兼容输出，不再作为账本内的另一笔费用。

## SQLite 请求明细与查询

现有 `state/radar.db` 自动增加 `api_usage` 表；`daily`、`sources`、`keywords` 及相应 MCP 入口通过 AsyncLocalStorage 共享一次运行 ID，按采集、评分、关键词研究、复盘等模块归属记录。并行运行各有自己的运行 ID。直接调用供应商函数时需显式包裹 `withUsageRun(state, command, fn)` 才会持久化；测试未开启范围时不会污染真实账本。免费 HF/GitHub/sitemap 抓取不计入付费请求表。

每条明细记录 UTC 开始时间、运行 ID、命令、模块、供应商、接口、模型、上游请求 ID、状态、token 用量、micro-USD 费用、计价来源及单价快照。不保存密钥、查询词/账号、提示词、请求参数、响应正文或错误消息。AIsa 批量 HTTP 请求按各工具执行分别记一条，避免再计一条批量费用；GoAnyAPI 重试每次单独记录。模型的供应商仍标为 `aisa`，OpenRouter 仅为计价来源。

请求开始先写 `pending`，结束更新为 `success` 或 `failed`；进程被中断时保留 `pending`。未知费用为 SQL NULL、`pricing_status=unknown`，不可当作零费用。Scrappa 成功解码后按 Starter 单价估算，错误/超时未知；AIsa 工具即使失败也保留响应已给出的费用，缺失结果未知；模型缺少 usage 或价格时费用未知，合法 token 用量仍可保留。后续步骤失败不影响已经落盘的记录。SQLite 写入失败会作为错误暴露，不会主动重试供应商请求。 HTTP/端点成功与业务校验通过分开：AIO 账号身份不匹配或 Trends 曲线校验失败会降级报告，但此前已成功的请求费用仍会计入本轮。模型价格匹配兼容 `claude-sonnet-4-6` 与 `claude-sonnet-4.6` 两种写法；已有 token 的未计价记录可按同一价格快照回算，无需重新调用模型。

```bash
pnpm costs                              # 最近 30 天，按供应商分布
pnpm costs --days 7 --by module          # 按模块
pnpm costs --days 30 --by model          # 按模型；无模型的行归入 —
pnpm costs --days 30 --by endpoint       # 按接口
pnpm costs --days 30 --by day --json     # UTC 日期分组 JSON
```

统计命令不加载配置、不请求外部接口；首次执行会创建本地表。输出请求数、失败数、未计价数、输入/输出/缓存 token、已计价费用与占比；JSON 另含 pending 数。百分比分母仅包含已计价费用，不代表完整供应商账单。金额显示四位小数，数据库保留原始精度。需要逐请求分析时可直接查询 `api_usage`（`rates` 为 JSON）；`usageSummary` 支持运行 ID 过滤。

日报与关键词报告追加本次供应商费用表，日报 JSON 顶层包含 `run_id`、`unpriced_calls`、`usage` 分布；MCP 关键词输出也带这些摘要。新账本从实际启用后开始记录，不将旧合计伪造成逐请求明细。

## Twitter AIO

用户确认单价为 **$0.0004 / 请求**，即 **400 micro-USD / 请求、$0.40 / 千次**，代码常量为 `twitter-aio.REQUEST_COST_MICROS`。

- 一个账号查询身份一次、随后每页推文一次；一页账号采集为两次请求，费用 $0.0008，三页为四次请求，费用 $0.0016。
- 搜索每页一次，不按推文条数计费；一页 $0.0004，五页 $0.002，累计取得十二条证据可以提前结束。
- 35 个账号、一轮各一页：70 次请求，$0.028；五个名字各一页搜索额外 $0.002。
- 默认 Twitter AIO 不再以零费用占位；显式切换备选后按备选计价。每次实际请求尝试均按 $0.0004 估算，包括失败/超时；其最终是否扣费仍以供应商账单为准。

## 模型 token 单价

模型仍通过 AIsa 调用，不要求 OpenRouter key、不改变调用渠道。`model-costs.ts` 保存 2026-10-16 从 [OpenRouter models API](https://openrouter.ai/api/v1/models) 核对的价格快照，不在每次运行额外查询价格。

| 模型 | 输入 / 百万 token | 输出 / 百万 token | 缓存读取输入 / 百万 token |
|---|---:|---:|---:|
| `deepseek-v4.1-flash` / `deepseek/deepseek-v4.1-flash` | $0.283 | $1.131 | $0.283（未提供优惠价，按普通输入估算） |
| `gpt-4.1-mini` / `openai/gpt-4.1-mini` | $0.40 | $1.60 | $0.10 |
| `claude-sonnet-4.6` / `claude-sonnet-4-6` / `anthropic/claude-sonnet-4.6` | $3.00 | $15.00 | $0.30 |

按响应 `usage.prompt_tokens`、`usage.completion_tokens` 计算；若有 `prompt_tokens_details.cached_tokens`，从总输入中扣除缓存 token 后分别计价。未返回缓存明细时全部输入按普通输入计价；不推测缓存写入等额外收费。价格仅为对标估算，不代表 AIsa 实际扣费，价格变动或换模型需更新价格表。

名称评分与关键词提词/筛选分别在独立的 AsyncLocalStorage 范围内累计，避免并行 MCP 请求相互串账；已得到 usage 的模型费用在后续步骤抛错时仍随错误返回。

## 历史费用可还原范围

本地旧日报日志 `state/cron.log` 保留两轮数据费用合计 $0.219、$0.208（仅三位小数，约合 $0.427），没有逐接口费用、模型 token 或完整请求次数。`report.json` 与 `report.md` 为覆盖写入，不是运行历史；这些旧运行的 SQLite 与压缩缓存仅保存业务状态，没有请求明细。旧失败报告显示 $0.000 不能解释为未发生付费调用，不能据此补算模型成本或完整供应商占比。

X 对照测试原始文件 `/tmp/radar-x-pagination-results.json` 含 AIsa 与 AIO 各 15 次成功搜索，已包含 `/tmp/radar-x-comparison-*` 的首页，不可重复累计。AIsa 响应费用合计 $0.045；AIO 按用户确认价格回算 $0.006，两者合计 $0.051，样本内费用占比为 88.24% 与 11.76%，同请求量 AIO 节省 86.67%。这些文件是临时测试材料，不能视为整个项目的完整账单。

上述两轮日报与独立 X 对照样本可定位的费用约 $0.478，仍不包含无法还原的模型与其他测试/失败请求费用。新的 `model_cost_micros` 只能用于启用统计后的结果，不能反推旧模型用量。

## 其他数据接口参考价

| 来源 | 项目参考单价与状态 |
|---|---|
| Scrappa Google 搜索取证 | 每名字一次首页，303 micro-USD / 成功请求估算；与 Trends 共享额度，不含模型费用，不抓网页全文 |
| Scrappa 全球 Trends | Starter 按 303 micro-USD / 成功请求估算，未扣共享免费额度；关键词研究每批 hex picker + 最多 4 个词，共用形状与规模序列 |
| AIsa Google Ads 搜索量 | 关键词研究不再调用；量级改用 Trends 对比固定参考词推算，旧账单保留 |
| AIsa X 搜索备选 | 当前参考约 $0.003 / 请求；分页另算，实际以接口返回费用汇总 |
| Scrappa X 采集备选 | 每成功页 303 micro-USD 估算；与 Trends 共享额度 |
| GoAnyAPI | 可选相关查询、单国序列；当前无 key，不产生调用费用 |
| new-sites | 当前 cron 跳过，上游参数契约问题见 known-issues.md |
| HF、GitHub、sitemap | 接口免费 |

[Scrappa 价格](https://scrappa.co/pricing)已有核查记录为 $10 / 33,000 credits、每月 500 免费 credits、购买额度有效期 12 个月；不能把按量消耗等同于最低充值现金支出。[GoAnyAPI](https://goanyapi.com/pricing)已有核查记录为小包每关键词每次 Trends 消耗 $0.006，双词比较为 $0.012；只取 rising 不会降低接口扣点数。相关查询因 rising 分类边界保持可选来源，见 [scrappa.md](scrappa.md)。

## Trends 固定参考词估量

关键词研究不调用 Google Ads 月搜索量接口。`usecases.benchmark` 默认 `hex picker`，`benchmark_daily` 默认 2500（用户提供的每日搜索量假设）；本机与公开示例配置均采用这组值。每批第一词固定为参考词，随后最多四个去重后的待测词；同一请求的共同刻度拆成各词曲线与“目标词/参考词”对照，不额外发单词请求。

剔除最近两个未稳定日期后，以最近七个稳定日期的目标词平均热度 / 参考词平均热度 × 2500 估算日搜；估算月量为未舍入日搜 × 30。`volume_source=trends_estimate` 明确来源，报告不得称为 Google Ads 月搜索量。参考词均值为零、序列缺失或目标词整段无信号时留空，不伪造零搜索量。低热度日上游明确返回 `value=0, has_data=false` 时保留零刻度，它表示低/不足热度，不证明实际无人搜索；false 搭配非零值仍拒绝。

所有相关性通过的候选先批量比较、再按估算月量 `min_volume` 筛选和 `trends_max` 限制展示；无量级候选保留为空供观察。单国可选数据只影响走势，不替代全球参考词量级。参考词的 2500 假设误差会按比例传递到所有估量。

五词真实响应可映射为 91 个裁剪日点；接口验证请求单独使用 `trends-validation` 运行范围记账，不并入日报。

提词与筛选的默认模型为 `deepseek-v4.1-flash`，本机与公开示例配置一致；输入 $0.283、输出 $1.131 / 百万 token 为用户指定，账本标记 `User supplied` 来源。名称评分仍为 GPT-4.1 mini；Sonnet 的价格保留用于历史计价和显式模型选择。DeepSeek 未提供缓存折扣，缓存输入暂按普通输入单价估算，不改写已发生的历史账单。

## 根词 Rising 对照计价

AIsa → DataForSEO Google Trends Explore Live 用 `game` 的全球 1d/7d Related queries 对照，实际扣费每次 $0.011，共 $0.022；只请求 `google_trends_queries_list` 不会自动降低到搜索目录展示价。Scrappa 相同两窗口合计 $0.000606，但响应不具备 Rising 契约，不可按低价直接替代。单根词每天两窗口、30 天：AIsa 约 $0.66；GoAnyAPI 小包标价约 $0.36；SerpApi 共需 60 次，处于每月 250 次免费额度内，均不含后续 Google 搜索与模型解释。GoAnyAPI、SerpApi 的比较为文档核查，非本机真实账单。

AIsa 备选中，根词的 1/3/7 天共三次 Live Explore，按实测单价 $0.011/请求，基础费用约 $0.033/轮（默认 Standard 为 $0.0081/轮）；另计去重候选逐词 Google 搜索（$0.000303/次）与解释模型 token 费用，均通过现有请求账本按模块统计。

根词 Rising 的七天曲线筛选先于 Google 搜索：参考词加最多四个候选，一批一次 Scrappa 请求，按现有 303 micro-USD/次记账；只有通过者产生后续 Google 搜索和解释费用。失败或解析不通过的请求费用同样保留，不能因候选被过滤而丢失。

根词候选通过七天曲线后，普通 Google 搜索每词一次；有证据的结果再按最多八词一批进行线上游戏/在线工具 AI 分类，按配置模型 token 单价入账到 trends 模块。分类不通过不产生后续解释费用，无证据不调用分类模型。

超大曲线移除后的有限重查最多增加一次 Scrappa 曲线请求/批（约 $0.000303）。首批及重查的请求明细都保留；这不是网络失败自动重试。Trends 解释仅在可靠状态、证据哈希、模型及提示词版本一致时复用，其他查询不新增 TTL 缓存。

## 完整费用与模块小计

完整费用以当前运行的 SQLite 请求账本为准，包含搜索、分类及解释。`trends.cost_micros` 仅表示 Rising 和曲线请求的小计，并通过 `cost_complete=false` 明确标记；不得将它单独解释为整个 Trends 流程的总额。`costSummary` 优先使用账本，有未计价请求或无账本且模块明确不完整时返回 `cost_complete=false`；Markdown 显示“已知费用小计”，不宣称完整总额。其他既有模块的费用字段及接口保持兼容。

## DataForSEO Standard Rising

默认 Rising 直连 Standard，每任务官方价 $0.0027，AIsa Live 备选实测 $0.011；曲线与搜索仍用较便宜的 Scrappa。根词三窗口约 $0.0081/轮；二级扩展另按合格父词 × 窗口付费，十词研究上限不限制这部分查询数。账本按 HTTP 顶层 response.cost 实际记费，提交、ready、get 分开记录；排队未完成不算故障，GET 内原任务 cost 不重复计费。任务表保存提交费用，恢复只计本次 HTTP 费用。实测一个 Standard 任务提交 $0.0027、取回 $0。批量、OAuth、本地归档及显式恢复见 [dataforseo.md](dataforseo.md)。
