# 根词 Trends 发现与筛选

## 流程与配置

Rising 去重 → 保存原始发现时间 → 七天曲线筛选 → 普通 Google 搜索 → AI 线上游戏/在线工具分类 → 解释 → 日报。保持单机直接模块调用，无额外工作流或缓存服务。

`trends_roots` 支持 `roots`、`windows`（1/3/7）、`category_code`（默认 8）、`provider`（默认 dataforseo）、`standard_wait_minutes`（默认 45）和可选 `benchmark`。参考词未单独设置时兼容 `usecases.benchmark`，默认 hex picker。`src/trends-config.ts` 在加载时校验空词、重复根词/窗口、类目、供应商和等待时限。`--skip trends` 跳过整个来源。

`src/trends-roots.ts` 通过 trends-related 默认直连 DataForSEO Standard 批量任务，AIsa Live 作为显式备选保留报价及调用。批量与恢复细节见 [dataforseo.md](dataforseo.md)。只接受显式 `data.rising`；`check_url` 必须回显同一根词、日期和类目。1/7 天用 past_day/past_7_days；3 天用 UTC 当天减三天至当天的日期区间，只有日期精度，不等同精确滚动 72 小时。Google 类目不能保证结果全部符合目标产品类型，因此仍需搜索后分类。

## 一级与二级词

配置根词查询 Rising 得到一级词。一级词七天曲线在任一同一时间点满足候选值严格大于参考值三倍，且参考值大于零时，以该一级词查询 Rising，得到二级词。只比较原始共同尺度数据，不比较网页绘图的显示缩放；等于三倍、参考值为零或无效点不触发。只有一级词通过七天曲线、搜索取证及 AI 分类流程且未被线下赛事门禁拦截，才允许扩展；分类 uncertain/pending 仍按既有规则放行。二级词仍必须独立通过七天曲线门槛，再搜索取证、AI 分类和赛事拦截。二级词不触发三级扩展。每轮最多研究 10 个去重二级词（SECOND_LEVEL_LIMIT），先汇总所有通过一级门禁及三倍条件的父词返回的二级候选，合并重复入口后统一按 Rising 信号排序，再选前十名研究。排序依次为显式 Breakout、最大有效增长百分比、不同时间窗口数量、不同父词数量，最后按标准化词键稳定排序；同一入口的重复记录不重复加分，缺失/非法增长不猜测为 Breakout。priority 保存排名与信号，代表研究优先级，不代表商业价值。增长缺失、非法或负值使用 max_growth=null，不伪装成 0%；有效零增长仍保留 0%，在同为非 Breakout 时优先于无有效增长。sorting_strategy=rising-v1 明确标记当前排序规则。超限的词保存在 second_level.deferred，写入首次发现时间并在网页独立展示，不请求曲线、搜索、分类，不进入已通过门禁的新旧词表。second_level.discovered 保留选中的十词及路径，便于统计。错误示范：不能一边收集一边取前十，否则后查询父词的高增长词永远无法入选；不能在一级分类前产生二级词。全局排序需要查询全部合格父词的 Rising，因此相关查询费用不受十词上限约束，曲线、搜索和分类最多处理十个二级词。

二级 Rising 查询沿用现有 1/3/7 天窗口配置，并继承一级来源的 category_code（游戏为 8），绝不自动取消类目。返回的原根词、父词和已有一级词不重复研究；多个入口合并 appearances，记录 discovery_level 和 root_path，网页诞生路径展示根词 → 一级词 → 二级词。二级原始发现先保存时间，曲线失败词留在 filtered；expansion 和 windows 留存扩展触发与请求信息。相同类目的合格父词统一提交；Standard 每批最多 100 个任务，AIsa 备选每批最多 20 个。

**类目只用于 Rising 相关查询，不能用于任何级别的曲线接口。** 曲线统一请求 Worldwide、7d、候选词及参考词，不传 category/category_code/cat。错误示范：把一级来源 category_code=8 直接复制到曲线请求，会让参考词 hex picker 被游戏类目过滤为零，破坏倍数与曲线判断。

## 二级扩展模块与本地快照

`src/trends-roots.ts` 负责一级编排，trends-related 负责 Rising 路由与归并，trends-contract 共用请求/解析校验；`src/trends-expansion.ts` 直接负责二级触发、类目继承、来源归并、全局排序与前十选择，定义 Appearance/Candidate/Priority/SecondLevelSnapshot。接口函数作为直接函数参数传入，避免两个模块互相导入；不增加服务层或通用策略框架。合并来源使用克隆，一级输出显式接回合并后的来源，不修改调用者数组。

CLI 在二级排序完成、后续曲线和 AI 请求之前调用 `saveSecondLevelBatch`，通过现有 saveSnap 的 gzip + 临时文件 rename 原子保存到 `state/trends-batches/<UUID>.json.gz`。文件含 created_at、batch_id、sorting_strategy、limit、discovered、deferred、triggers 和 windows，最终报告 second_level 关联 batch_id。只归档本轮证据，不扫描历史、不自动恢复或发起付费请求。测试直接读取归档验证曲线异常后仍能离线统计；归档失败直接抛出，保留堆栈，不继续付费研究。

错误示范：只保存词名/首次发现时间，或等完整日报完成才保存来源，会导致中止后无法判断哪些二级词来自合格父词。排名与路径快照必须在研究前保存，但不承诺操作系统强制终止前的内存内容均可恢复。

## 首次发现与日报边界

去重后立即通过 CLI 回调写入 SQLite `term_discoveries`，即使后续被排除、缺资料或接口失败也保留首次发现。旧本机报告的过滤词也按文件时间导入发现记录，冲突时保留最早值。该表只保存本地词键、原词和 first_seen_at，不覆盖报告证据或解释。报告的首次时间取原始发现、既有报告和旧 leads 中最早的有效时间。历史不作为本轮候选来源。

错误示范：等到词通过分类才写首次时间，会把数天前已发现的待验证词错误标为当天新词。

## 七天小时曲线

`src/trends-filter.ts` 每批最多四个候选加参考词，通过 Scrappa `google-trends-interest` 查询 7d、Worldwide。该步骤不套游戏类目，避免把参考词限定到不相关语境；不使用九十天日序列冒充小时序列。

忽略上游 partial 点以及尚未结束的当前小时。要求连续小时数据覆盖最近七天（起点允许一小时、末端允许两小时结算偏差，至少 166 点），核对词序、数值与参考词有效性。起始 24 小时最多允许 3 个非零小时，且所有值不高于该词七天峰值的 10%（低基线噪声阈值）；后续至少三个点高于该阈值，且最新完整 24 小时均值高于此前 24 小时并大于零，才能通过。阈值相对当前词自身峰值计算，不依赖同批其他词的热度尺度。全零、孤立尖峰和没有爆发的持续已有热度仍排除。通过原因 low_baseline_then_rising，基线失败原因 no_initial_24h_low_baseline。判断由 lowBaselineRise 集中实现。

Trends 的零表示低于显示精度，不代表无人搜索。错误示范：起始一天一个热度 2 的零星点就淘汰，会漏掉后来明显起量的词；早期噪声不能计入后续至少三个有效上涨点。错误示范：把缺失点补成零，会制造“从零上涨”。

### 已有热度后持续爆发

在原低基线规则之外，`lowBaselineRise` 分别检查最近 48、72 小时的持续爆发窗口。每个窗口前的 24 小时作为临近对照，更早的数据作为历史基线；历史至少 24 个非零小时且均值大于零。爆发阈值取历史均值三倍、临近对照均值两倍中的较大值；窗口均值、最近 48 小时均值、最新 24 小时均值都需达到阈值，且最新 24 小时至少 12 个小时达到阈值。任一窗口通过即放行，优先记录 48 小时窗口。允许两天或三天前起涨后高位持平，不要求最后一天继续创新高；稳定已有热度、缓慢渐涨、单小时尖峰及已回落曲线仍排除。

错误示范：三天前从 10 升至 30 并维持时，不能把已经升至 30 的第五天作为爆发前基线。失败时保留原低基线 reason，并补充 breakout_reason=no_sustained_2d_or_3d_breakout；诊断同时记录 burst_window_hours、历史/临近对照均值、最近两天均值、阈值和达标小时数。

通过词记录 `trend_filter.trend_type`：`low_baseline_rise`（低基线起量）或 `existing_baseline_breakout`（已有热度爆发），后者 reason 为 `existing_baseline_then_breakout`。历史均值、临近对照均值、最近两天均值、爆发阈值和达标小时数一并记录，便于定位判断；趋势类型不等同 AI 产品类型，网页分别显示两列。

### 超大曲线重查

首批满足以下全部条件才触发：参考词全零；至少两个候选；唯一候选存在非零值且峰值至少 90；其余候选全零。这是共同刻度被单个候选占据的保守识别规则，不根据普通尖峰或全零结果猜测压制。

该候选本轮标记 excluded / dominates_comparison 并移出批次，剩余词带同一参考词重查一次。第二次不再递归拆分；参考词仍无效则 pending。原始与重查的请求、曲线和 checked_at 保存在 trend_filter.attempts；两次成功请求均计费。网络失败不会触发该重查。

`trends.filtered` 保存曲线未通过和待验证结果。`trend_filter` 包含 status/reason、参考词、请求、检查时间、曲线、首次非零时间、前后均值、起始基线均值/峰值/非零小时数、噪声阈值及有效点数（有有效结果时）。

## 普通搜索与类型分类

`googleSearchResult(term, "broad")` 不加引号，不要求标题摘要完整匹配原词，返回 query/rawResults/evidence/costMicros。只保留首页最多八条 HTTP(S) 去重证据，原始结果另行保存。`src/candidate-research.ts` 为根词和网页词共用普通/精确搜索及类型分类路径；网页词另合并来源页证据，只有明确赛事触发分类拦截。`googleSearch(term)` 是兼容包装，保留其他关键词流程的精确查询及元组返回值。

每词 `search_response` 保存 query 和未过滤的 organic_results，不保存请求头或密钥。普通搜索标题/摘要没有完整原词匹配时，额外执行一次带引号的精确搜索；精确结果保存在 exact_search_response，有匹配证据时优先用于分类和解释。精确搜索失败保留普通证据和 search_error，不循环补查；每次请求单独计费。没有证据的词仍进入日报，解释标记含义待确认。

`src/candidate-kind.ts` 每批八词，用当前模型输出 term/is_online_game/is_online_tool/is_offline_sports_event/decision/reason/evidence_indices。输入与输出均携带原样 term，按原词精确关联，不依赖数组顺序或数字索引，再逐条用 Zod 校验结构并核对引用范围和判断一致性；confirmed 必须至少一类为 true 且有有效证据引用。线上游戏/在线工具分类只作记录；仅有证据明确确认 is_offline_sports_event=true 的词拦截。

提示词动态说明本批候选数量，要求每词原样返回一次；无法判断仍返回 uncertain。返回乱序或条数不等时，保留全部可关联的有效结果；遗漏、同词重复、单条结构或证据错误只将对应原词降为 pending。缺少 term 或返回本批以外/改写的 term 时记录 classification_unmatched 警告，不新增候选、不按位置猜测关联，也不影响其他有效项。整批 JSON 无法解析或顶层不是数组、请求失败时才整批降级。诊断记录对应词语与堆栈；未知词不映射为已知词。

错误示范：输入八词、返回七条，不应把七条有效结果全部丢弃；重复词不能任取一条或挤占下一词的分类。`tests/candidate-kind.test.ts` 验证七条乱序结果保留赛事拦截、遗漏项单独待确认、重复/未知/无 term/改写 term 隔离及证据校验。

线上游戏指可在线游玩或明确联网的电子游戏；在线工具指可在线使用的软件工具或服务。体育比赛、线下桌游、攻略资讯、谜题线索、普通商品账号和泛游戏类型不符合。近似拼写不能自动等同原词。原词不随模型输出改写。

曲线通过后，除明确线下体育赛事外都进入 `trends.candidates`，每词附 classification；明确判断状态为 classified，无法判断或请求失败为 pending。`trends.classification_filtered` 仅保存 is_offline_sports_event=true 的词及完整分类证据，供排查及首次发现时间兼容读取。后续解释优先使用分类引用的证据。错误示范：分类失败不是“不是游戏”，不能混同 rejected，也不能据此删除候选。网页显示分类标签，判断依据通过悬停查看。

`is_offline_sports_event` 为 true/false/null：现实体育比赛及明确指向该比赛的赛程、比分、延期、直播查询为 true；体育电子游戏、电竞、线下桌游不算；证据不足或分类失败为 null，保留候选。true 必须有有效引用、不能同时是线上游戏/工具或 uncertain；不符合契约的结果记录诊断并作为待确认保留，不能静默假定为体育赛事。被拦截的词不进入后续解释、日报或网页，但原始发现时间仍保留。

## Trends 解释缓存

`src/trends-explanations.ts` 独立管理 trends_explanations 表。证据哈希、模型和提示词版本相同且 state=reliable 时复用；模型显式返回 reliable=false 的结果下轮重试，不通过中文文案判断是否过期。没有状态的旧解释在 Trends 当前路径重新生成，其他来源保持原缓存行为。

数据库旧解释在新可靠解释成功后才替换。更新失败时旧值留作排查，本轮不会把失效旧值当作新证据的解释。状态字段用普通 TEXT，枚举及关联规则在应用层校验，不加 CHECK/ENUM。

## 错误与验证

`src/source-errors.ts` 区分预期的 HTTP/传输失败、上游契约不符与程序错误。预期失败记 WARN 并保留待验证记录；非预期错误记 ERROR 并向上传递。诊断保留 stage、批次/词语、stack 和 cause，stderr 不污染 MCP stdout。CLI 的 Trends 与 sitemaps 研究边界均不会吞掉程序或配置错误。费用由现有 SQLite 请求明细汇总，解析失败也不丢失成功请求的费用。

`pnpm check` 覆盖配置、曲线、有限重查、分类、缓存及完整内部流程。`tests/trends-maintenance.test.ts` 只模拟外部 HTTP/MCP，实际串联发现、筛选、搜索、分类和日报，并验证跨天首次发现及历史不回灌。

### 输入与异常边界

参考词含逗号属于配置错误，在曲线请求前抛出；上游候选含逗号时单独保留为 `pending / unsupported_comparison_keyword`，不影响其他词，也不为该词发起曲线请求。空曲线点、非法时间戳、非 JSON 响应和聊天正文缺失属于上游数据契约错误。

`SourceDataError`、`SourceTransportError` 可局部失败，`SourceConfigError` 和未知程序错误向上传递。Scrappa 只包装已知 MCP/HTTP/网络故障，不通过消息中的 key/configure 判断类别；原生 fetch 的 `TypeError: fetch failed` 仅在请求边界识别。未知 RangeError/ReferenceError/TypeError 不降级。JSON 解析错误保留 cause，诊断保留堆栈。

旧报告读取或格式问题记录 WARN 后跳过，数据库写入在文件容错范围之外；写入失败必须暴露，不能以“旧报告不可读”静默忽略。`tests/source-errors.test.ts` 覆盖错误类别、响应解析、SDK 故障、旧报告与数据库边界、部分费用展示；曲线测试覆盖逗号候选隔离与空点计费。

`tests/fixtures/perceptle-hourly.json` 保存一轮实测 perceptle 七天小时曲线，仅包含词语、报告时间和数字点。回归覆盖早期噪声容忍、噪声数量/幅度边界及噪声不能凑够孤立尖峰点数；未增加付费重查。

### 实测曲线样本

`tests/fixtures/perceptle-hourly.json` 保留起始一天热度 2 的噪声回归数据；`tests/fixtures/perceptle-report-hourly.json` 保存实际日报中 perceptle 与参考词 hex picker 的完整 168 个小时点，附采样时间、时间范围和列定义。每点为 `[毫秒时间戳, 当前词热度, 参考词热度]`，保持原始共同尺度，不重新归一化。样本不包含密钥、私聊信息或部署域名，`tests/trends-filter.test.ts` 离线验证真实曲线的低基线上涨判定。

`tests/fixtures/noillirk-hourly.json` 保存 noillirk 与 hex picker 实际七天 168 个小时点及采样元数据，前五天有日常热度、最近两天持续爆发，用于已有热度爆发回归测试。

## 任意来源的统一曲线门槛

`src/report-screening.ts` 在日报解释之前汇总本轮词，复用根词与网页曲线结果，剩余 X/其他线索、关键词研究结果按同一参考词和七天规则补查。只有 trend_filter.status=passed 的词继续共用搜索和 AI 分类；excluded/pending 均拦截。同词在任一已研究来源被曲线或明确赛事拦截时，不能通过其他来源重新进入词表。结果保存在 candidate_screening（rows/candidates/filtered/classification_filtered），网页同时读取其中曲线与分类白名单。首次发现仍在筛选前记录，缓存的历史解释不构成绕过理由。


## 本轮请求复用与显式报告输入

`withUsageRun` 创建独立的 `research-cache` 范围，使用 Node.js AsyncLocalStorage 隔离并行 CLI/MCP 调用，运行结束即释放，不使用 Redis 或跨轮缓存。相同原词/模式/服务地址/语言地区的 Google 搜索共享 Promise；命中返回 costMicros=0，不新增账本请求，失败不留缓存。AI 分类不复用，保留各来源自己的网页证据。

曲线按规范化词、参考词、Worldwide/7d、查询小时和 MCP 地址复用本轮已完成结果；原比较批次、共同尺度、checked_at 保留，命中标记 cache_hit。后续批次只查询未命中词，模块 cost_micros 不重复增加；pending 和 dominates_comparison 不缓存，避免把暂时失败或特定比较批次的压制结论当成永久事实。复用不改变最终同词拦截优先规则。

`report-terms.collectTerms` 只收集本轮原始候选，不根据 candidate_screening 的存在切换语义；`report-screening` 返回明确的 ScreenedTerms，CLI 显式将 screened.rows 传给 createBrief。报告层只负责这些输入的时间、解释与展示，不反向收集其他来源。`tests/trends-maintenance.test.ts` 只替换外部接口，串联根词、网页、其他线索、关键词研究至最终日报和网页，验证未通过曲线及赛事词不会进入解释或展示；`research-cache.test.ts` 验证请求/费用去重、失败再查和运行隔离。

collection_status 由共享 trends-status.ts 依据一级和二级全部窗口汇总，兼容 AIsa 同步成功窗口与 Standard 异步状态；候选为空不能推断本轮采集成功。
