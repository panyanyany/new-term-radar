# Scrappa MCP 数据接入

## 当前分工

- `src/scrappa.ts` 使用官方 TypeScript MCP SDK v1 的 Streamable HTTP 客户端连接 `https://scrappa.co/mcp`，初始化后调用 `call-endpoint`；`params` 是 JSON 字符串。
- 设置 `X_TIMELINE_PROVIDER=scrappa` 时，`sources.xNew()`：通过 `x-twitter-user-tweets` 读取账号正文、点赞和 UTC 发布时间，最多每账号 3 页，覆盖 30 小时。游标重复、分页卡住或达到预算仍未覆盖窗口时显式报错，不覆盖词表。`count` 只是建议页大小，实测请求 2 条仍返回 22 条。
- `review.review()`、`usecases.fetch_series()`：使用 `google-trends-interest` 的 `90d` 世界范围序列，每词单独一条曲线，再单独请求该词与基准词的比较曲线。
- X 默认使用 Twitter AIO；AIsa 高赞搜索作为 `X_SEARCH_PROVIDER=aisa` 备选，仍负责 Google Ads 月搜索量、WHOIS 综合筛选和模型调用。见 [twitter-aio.md](twitter-aio.md)。
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

原相关查询来源是 GoAnyAPI，不是 AIsa。`split_related()` 优先 rising 再补 top，二者均能补充通用需求和品牌长尾；`other_names()` 仅允许 rising 中的新产品名产生 `cosearch` 线索。

Google 的 [Top/Rising 定义](https://support.google.com/trends/answer/4355000?hl=en)：top 是相关查询的相对热门程度；rising 是相对前一时段增长最快的查询，带增长百分比或 Breakout。热门不等于上涨，上涨也不保证是刚诞生的新词。

Scrappa 实测 `related_queries` 为扁平数组，数值依次为 100、99、73 等，无 `rising` 分类、增长率或 Breakout；只能确认是未分类相关词，不能证明其是 rising，也不能仅凭数值严格断定是 top。因此不把它映射成 rising，更不能静默顶替 GoAnyAPI 后让 `cosearch` 消失。官网概览宣称支持 top/rising，但当前 MCP schema 及实际响应不具备该契约。

## 验证与费用

运行 `pnpm check`。测试隔离本机密钥和 Scrappa 网络，真实样本保存在 `tests/fixtures/scrappa.json`，推文仅保留必要字段。

本机真实客户端冒烟：临时 state 读取 OpenAI 账号返回 22 条、303 micro-USD 估算；`claude code` 单词及与 `gpts` 比较返回各 91 个裁剪日点，区间 2026-07-18 至 2026-10-16，606 micro-USD 估算。相关查询实测返回 25 个未分类相关词。这些验证不写生产 state，不运行日报或通知。

Scrappa 以 Starter 单价 303 micro-USD/成功请求估算成本，未扣免费额度，报告已注明估算。失败不自动重试、不隐式切回收费来源；失败发生在批次中途时，报告不能据此还原完整账单，应以服务商使用记录为准。详见 [costs.md](costs.md)。
