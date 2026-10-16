# X 数据源与 Twitter AIO

## 路由与备选

`src/x.ts` 按用途路由，默认均为 `twitter-aio`：

| 环境变量 | 默认 | 保留的备选 |
|---|---|---|
| `X_TIMELINE_PROVIDER` | `twitter-aio` | `scrappa` |
| `X_SEARCH_PROVIDER` | `twitter-aio` | `aisa` |

显式切回旧方案：`X_TIMELINE_PROVIDER=scrappa X_SEARCH_PROVIDER=aisa pnpm radar daily --skip newsites --out report.md`。两项可独立选择，非法值报错；没有自动跨供应商重试。账号采集失败时保留原词表；名称搜索失败时沿用 README / 可选相关查询降级，报告显示错误。Scrappa Trends、AIsa Google Ads / WHOIS / 模型和 GoAnyAPI 可选相关查询保持独立。

## 凭据与运行

`src/twitter-aio.ts` 使用 Node 原生 fetch，不引入 twibot 的 Next.js、数据库或 Axios 依赖。凭据规则沿用相邻项目：

- 优先 `X_TWEETS_TWITTER_AIO_API_KEY`，其次 `TWITTER_AIO_RAPIDAPI_KEY`、`RAPIDAPI_KEY`，最后 `~/.twitter-aio/key`。
- 正式 `X_TWEETS_TWITTER_AIO_HOST` / `_BASE_URL` 优先于兼容 `TWITTER_AIO_RAPIDAPI_HOST` / `_BASE_URL`；默认 `twitter-aio.p.rapidapi.com` 和 `https://twitter-aio.p.rapidapi.com`。不使用通用 `RAPIDAPI_HOST` / `RAPIDAPI_BASE_URL`，避免请求被送往其他服务。
- `TWITTER_AIO_ENV_FILE` 可显式指定已有 env 文件，进程环境覆盖文件同名变量；不自动读取项目 `.env` 或相邻项目配置。
- 本机凭据复用相邻项目已有 key，独立保存在 `~/.twitter-aio/key`，权限 0600；源码和仓库不含密钥。cron 使用 `HOME=/home/ubuntu`，无需修改 crontab。修改源码后须 `pnpm build` 更新 `dist`。
- Actions 使用 `TWITTER_AIO_RAPIDAPI_KEY` secret，可用同名 provider 仓库变量选择备选；切到 Scrappa/AIsa 后仍须其对应 secret。

请求超时 40 秒，不自动重试；HTTP、网络和响应错误不输出请求头、密钥或原始响应。API 调用不意味着免费。报告数字不含尚未核实的 AIO 套餐费用，也不含模型费用；不可把 AIO 的内部成本占位零解释为零账单。

## 账号采集契约

先 `/user/by/username/{handle}` 校验账号身份，再 `/user/{id}/tweetsAndReplies` 采集推文及回复，与原 Scrappa `with_replies: true` 对齐。每页建议 20 条，每账号最多 3 页；有下一页时要求覆盖最近 30 小时，超预算、重复游标或没有新增推文均报错。旧置顶贴不能使第一页提前结束，以该页最后一条推文判断时间覆盖。无下一页视为结果已穷尽。

同时兼容 `data.user.result.timeline.timeline.instructions` 与 `data.data.user.result.timeline.timeline.instructions`。遍历分组 `entries`、单条 `entry` 和线程模块，优先 note_tweet 长文，验证 ID、正文、点赞和日期；识别转推并保留 `RT @` 标记供名称发现排除。全部账号成功后才更新原有 60 天词表快照，状态格式不变。

## 高赞搜索契约

两家都使用 `"名称" min_faves:50 -filter:replies since:日期`、Top、最近 14 天。AIO 调 `/search/{query}`，AIsa 仍调用 `get_twitter_tweet_advanced_search`。本地按顶层正文、Unicode 词边界、连续短语、至少 50 赞、日期和非回复严格过滤，不用引用正文充当顶层结果。

最多 5 页，累计 12 条合格证据即停止；按 ID 去重、点赞排序并最多交付 12 条。页数用尽可返回已验证的少量证据，异常游标或必需字段缺失报错。这里只是正文匹配，不能消除 Gemini 等同名词的语义歧义，也不保证完整召回。五页真实对照见 [known-issues.md](known-issues.md)。

## 验证

`pnpm check` 检查格式、类型、测试与构建。`tests/twitter-aio.test.ts` 覆盖两种时间线外壳、长文、后续页游标、严格过滤、跨页去重、五页上限、十二条停止、收费请求无重试、词表保护及显式备选路由；原 Scrappa 与 AIsa 管线测试保留。真实验证使用临时 state，不写生产词表或发送通知。

本机已通过 `pnpm check`：全部测试、类型检查、格式检查及生产构建通过。使用构建后的真实入口和临时 state，OpenAI 推文与回复采集返回 22 条、首次词表初始化成功；`evidence(["Claude Code"])` 返回 12 条合格证据且无搜索错误。两次验证均未修改生产 state 或发送通知。
