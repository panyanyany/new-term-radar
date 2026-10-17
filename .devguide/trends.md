# 根词 Trends 发现与筛选

## 流程与配置

Rising 去重 → 保存原始发现时间 → 七天曲线筛选 → 普通 Google 搜索 → AI 线上游戏/在线工具分类 → 解释 → 日报。保持单机直接模块调用，无额外工作流或缓存服务。

`trends_roots` 支持 `roots`、`windows`（1/3/7）、`category_code`（默认 8）和可选 `benchmark`。参考词未单独设置时兼容 `usecases.benchmark`，默认 hex picker。`src/trends-config.ts` 在加载时校验空词、重复根词/窗口、类目和 AIsa 单批最多 20 个请求。`--skip trends` 跳过整个来源。

`src/trends-roots.ts` 通过 AIsa 转接 DataForSEO Live Explore，先报价再调用。只接受显式 `data.rising`；`check_url` 必须回显同一根词、日期和类目。1/7 天用 past_day/past_7_days；3 天用 UTC 当天减三天至当天的日期区间，只有日期精度，不等同精确滚动 72 小时。Google 类目不能保证结果全部符合目标产品类型，因此仍需搜索后分类。

## 首次发现与日报边界

去重后立即通过 CLI 回调写入 SQLite `term_discoveries`，即使后续被排除、缺资料或接口失败也保留首次发现。旧本机报告的过滤词也按文件时间导入发现记录，冲突时保留最早值。该表只保存本地词键、原词和 first_seen_at，不覆盖报告证据或解释。报告的首次时间取原始发现、既有报告和旧 leads 中最早的有效时间。历史不作为本轮候选来源。

错误示范：等到词通过分类才写首次时间，会把数天前已发现的待验证词错误标为当天新词。

## 七天小时曲线

`src/trends-filter.ts` 每批最多四个候选加参考词，通过 Scrappa `google-trends-interest` 查询 7d、Worldwide。该步骤不套游戏类目，避免把参考词限定到不相关语境；不使用九十天日序列冒充小时序列。

忽略上游 partial 点以及尚未结束的当前小时。要求连续小时数据覆盖最近七天（起点允许一小时、末端允许两小时结算偏差，至少 166 点），核对词序、数值与参考词有效性。开头至少连续 24 小时为零、后续至少三个非零点，且最新完整 24 小时均值高于此前 24 小时，才能通过。

Trends 的零表示低于显示精度，不代表无人搜索。错误示范：把缺失点补成零，会制造“从零上涨”。

### 超大曲线重查

首批满足以下全部条件才触发：参考词全零；至少两个候选；唯一候选存在非零值且峰值至少 90；其余候选全零。这是共同刻度被单个候选占据的保守识别规则，不根据普通尖峰或全零结果猜测压制。

该候选本轮标记 excluded / dominates_comparison 并移出批次，剩余词带同一参考词重查一次。第二次不再递归拆分；参考词仍无效则 pending。原始与重查的请求、曲线和 checked_at 保存在 trend_filter.attempts；两次成功请求均计费。网络失败不会触发该重查。

`trends.filtered` 保存曲线未通过和待验证结果。`trend_filter` 包含 status/reason、参考词、请求、检查时间、曲线、首次非零时间及前后均值（有有效结果时）。

## 普通搜索与类型分类

`googleSearchResult(term, "broad")` 不加引号，不要求标题摘要完整匹配原词，返回 query/rawResults/evidence/costMicros。只保留首页最多八条 HTTP(S) 去重证据，原始结果另行保存。`googleSearch(term)` 是兼容包装，保留其他关键词流程的精确查询及元组返回值。

每词 `search_response` 保存 query 和未过滤的 organic_results，不保存请求头或密钥。没有证据的词保留在分类待确认记录，本轮不解释。

`src/candidate-kind.ts` 每批八词，用当前模型输出 is_online_game/is_online_tool/decision/reason/evidence_indices。Zod 校验结构，应用层核对完整索引、引用范围和放行条件。至少一类为 true、decision 为 confirmed 且有有效证据引用才通过。

线上游戏指可在线游玩或明确联网的电子游戏；在线工具指可在线使用的软件工具或服务。体育比赛、线下桌游、攻略资讯、谜题线索、普通商品账号和泛游戏类型不符合。近似拼写不能自动等同原词。原词不随模型输出改写。

通过者进入 `trends.candidates`；明确不符合为 excluded，无法判断或请求失败为 pending，保存于 `trends.classification_filtered`。后续解释优先使用分类引用的证据。错误示范：分类失败不是“不是游戏”，不能混同 rejected。

## Trends 解释缓存

`src/trends-explanations.ts` 独立管理 trends_explanations 表。证据哈希、模型和提示词版本相同且 state=reliable 时复用；模型显式返回 reliable=false 的结果下轮重试，不通过中文文案判断是否过期。没有状态的旧解释在 Trends 当前路径重新生成，其他来源保持原缓存行为。

数据库旧解释在新可靠解释成功后才替换。更新失败时旧值留作排查，本轮不会把失效旧值当作新证据的解释。状态字段用普通 TEXT，枚举及关联规则在应用层校验，不加 CHECK/ENUM。

## 错误与验证

`src/source-errors.ts` 区分预期的 HTTP/传输失败、上游契约不符与程序错误。预期失败记 WARN 并保留待验证记录；非预期错误记 ERROR 并向上传递。诊断保留 stage、批次/词语、stack 和 cause，stderr 不污染 MCP stdout。CLI 的 Trends 边界不会吞掉程序错误。费用由现有 SQLite 请求明细汇总，解析失败也不丢失成功请求的费用。

`pnpm check` 覆盖配置、曲线、有限重查、分类、缓存及完整内部流程。`tests/trends-maintenance.test.ts` 只模拟外部 HTTP/MCP，实际串联发现、筛选、搜索、分类和日报，并验证跨天首次发现及历史不回灌。

### 输入与异常边界

参考词含逗号属于配置错误，在曲线请求前抛出；上游候选含逗号时单独保留为 `pending / unsupported_comparison_keyword`，不影响其他词，也不为该词发起曲线请求。空曲线点、非法时间戳、非 JSON 响应和聊天正文缺失属于上游数据契约错误。

`SourceDataError`、`SourceTransportError` 可局部失败，`SourceConfigError` 和未知程序错误向上传递。Scrappa 只包装已知 MCP/HTTP/网络故障，不通过消息中的 key/configure 判断类别；原生 fetch 的 `TypeError: fetch failed` 仅在请求边界识别。未知 RangeError/ReferenceError/TypeError 不降级。JSON 解析错误保留 cause，诊断保留堆栈。

旧报告读取或格式问题记录 WARN 后跳过，数据库写入在文件容错范围之外；写入失败必须暴露，不能以“旧报告不可读”静默忽略。`tests/source-errors.test.ts` 覆盖错误类别、响应解析、SDK 故障、旧报告与数据库边界、部分费用展示；曲线测试覆盖逗号候选隔离与空点计费。
