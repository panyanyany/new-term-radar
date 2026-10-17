# DataForSEO Standard Rising

## 用途、接口与配置

根词和二级扩展的 Rising 默认由官方 HTTP Standard 接口提供；七天曲线、Google 取证、AI 分类及十词研究上限保持原路径。官方 MCP 的 `kw_data_google_trends_explore` 没有 Standard 提交/取回工具，因此采集不经 MCP 转发。

`trends_roots.provider` 为 `dataforseo`（默认）或 `aisa`。临时备选：`pnpm radar daily --trends-provider aisa`；生产构建入口同样支持此参数。不自动跨供应商重试，避免排队任务已扣费时额外调用 Live。`standard_wait_minutes` 为每阶段最大等待分钟数，整数 0–45、默认 45；0 表示提交后立即探测一次并返回未完成任务，便于测试和人工恢复。两阶段存在门禁依赖，总等待可能接近 90 分钟。

参数和校验共用 `trends-contract.ts`：只收显式 Rising，核对 check_url 的原词、日期及类目；1/7 天用相对窗口，3 天用提交日 UTC 日期范围。`trends-related.ts` 负责供应商选择、Standard 归并和显式恢复，`trends-aisa.ts` 保留报价及 Live 调用，AIsa 每批最多 20 个任务。

## 批量和恢复

使用 `/v3/keywords_data/google_trends/explore/task_post`、`tasks_ready`、`task_get/<id>`。Standard 每 POST 最多 100 个任务，所有分组提交后统一等待；每个任务只含一个根词，不能把五个根词合并到一次相关查询。第一阶段统一提交根词 × 窗口；第二阶段按来源类目汇总所有通过门禁及三倍条件的一级父词后提交，各父词保持独立任务。收齐或到时后才全局去重排序，仍只研究前十个二级词，不按返回先后占位。

等待初次直接探测本批 ID，之后每 30 秒统一查询 ready 列表，以最多 5 个并发 worker 取结果；只消费本批任务，不处理账户其他任务。每五分钟直接探测尚未完成的本批 ID，覆盖其他客户端取走 ready 条目和失败任务。取回异常保留任务 ID，下次探测可重取；程序/配置错误保留堆栈并抛出，等待所有并发请求结束后才关闭数据库。

`radar.db` 的 `dataforseo_trends_tasks` 保存本地 UUID、批次 UUID、原运行 ID、call_id、原始参数、上游 task_id、状态、提交响应片段、原始取回响应、提交费用和错误。状态是应用控制的字符串，不使用数据库 CHECK/ENUM。提交前保存 queued、发出前提交 submitting；响应通过本地 UUID tag 关联，拒绝按数组位置配对；缺少唯一 tag 时归档提交响应供人工对账。POST 超时或缺少唯一 tag 标记 unknown；中断遗留 submitting 在显式恢复时变成 unknown。它们都不会自动重新 POST。原始参数含查询词，只存在忽略的本地 state，费用账本仍不保存词或正文。

```bash
pnpm radar resume-trends --batch <批次UUID> --out state/trends-recovered.json
# 生产入口：node dist/src/cli.js resume-trends --batch <批次UUID> --out state/trends-recovered.json
```

恢复只 GET 已知任务 ID，复用已归档成功响应，不重新提交、不自动研究或回灌日报、不发送通知。queued/unknown/failed 也明确展示。批次 ID 在提交日志及报告 windows 中记录。unknown 的 tag 是 local_id，需要在服务商后台对账确认；新一轮 daily 是新的付费采集，不是恢复命令，不会自动复用历史候选。错误示范：提交超时后直接重发，或重跑 daily 代替恢复，会有重复付费风险。

## 本机授权

凭据优先级：成对环境变量 `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` → `~/.dataforseo/credentials.json` 的 `login` / `password` → Codex 用户目录 `.credentials.json` 中名称为 dataforseo、URL 为 `https://mcp.dataforseo.com/mcp` 的 OAuth。显式配置残缺时直接报错，不混用其他来源。独立凭据 JSON 建议权限 600；所有凭据在仓库之外。cron 使用运行用户的 HOME；CODEX_HOME 可指定 Codex 用户目录。

OAuth 在 HTTP API 已实测可用。访问令牌临近过期时向固定 `https://data.dataforseo.com/oauth/token` 刷新；同进程共享刷新，原子回写前重新读取凭据，保留其他 MCP 登录，权限 600。不记录认证响应或令牌。刷新失败明确要求重新登录，不回退 AIsa。该个人项目按单个采集进程运行，不提供跨进程 OAuth 刷新锁；避免同时启动多个采集或在刷新期间重新登录，独立 API 凭据可避免共享 OAuth 文件。

## 费用与验证

按 HTTP 顶层 response.cost 实际费用写入现有 api_usage，provider=dataforseo；task_post、tasks_ready、task_get 分别统计请求。成功排队 20100、未完成 40601/40602 属于预期状态，不算请求故障；未知费用仍 NULL。任务表保留每任务提交 cost；恢复的业务小计不再计原提交费用。错误示范：Task GET 的 tasks[].cost 是原任务费用，不能每次取回再累计一遍。

最小实测：一个游戏类目的一天相关查询，Standard 提交实际 $0.0027，取回 $0，返回 11 个显式 Rising；查询范围回显通过校验。测试覆盖 103 个任务 100/3 拆批、乱序 tag、部分成功/超时、只 GET 恢复、未知提交、终态失败、ready 外部任务隔离、top/类目错误、OAuth 刷新及费用去重；测试使用临时 SQLite 和模拟 HTTP，不请求收费接口。

官方文档：
- https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/task_post/
- https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/tasks_ready/
- https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/task_get/
- https://dataforseo.com/pricing/keywords-data/google-trends

## 等待边界、错误与报告状态

正等待预算覆盖整轮取回 worker 队列：到期不启动新的 ready/GET 请求，每次 HTTP 超时不超过剩余预算与 90 秒的较小值；鉴权准备完成后再次核对剩余预算，避免刷新后继续发送已过期的取回请求。鉴权刷新有独立 30 秒超时。wait=0 是明确的一次全批探测模式，各已知 ID 最多探测一次，不轮询。超时任务保留 submitted，可按批次恢复，不标记为永久失败。

提交前鉴权失败标记 failed；真正进入发送边界才标记 submitting，发送后结果不确定标记 unknown，禁止自动重提。OAuth 网络刷新异常通过 cause 保留原始堆栈，不记录凭据。错误示范：鉴权都未成功便标记 unknown，会误导人工核对收费；POST 超时自动重发可能重复扣费。

显式 Rising 的 result/items/行结构用 Zod 在共享边界校验；格式错误转换为带 cause 的 SourceDataError，仅隔离对应窗口，不吞程序异常。collection_status 统一汇总完成、待取回、失败、未知和 batch_ids；远端 completed 但 Rising 解析失败计入失败。日报 JSON 保存汇总，Markdown 与网站只在不完整时提示，仍保留已成功取得的词；完整空结果保持正常的暂无状态。
