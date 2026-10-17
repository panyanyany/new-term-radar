# 项目文件结构

```text
new-term-radar/
├── .impeccable.md               单页阅读界面的设计上下文
├── .playwright-mcp/             本机浏览器验证日志与截图，未跟踪
├── site/                        本机生成的静态页面，未跟踪
├── AGENTS.md                    开发规范与开发文档索引
├── package.json                 pnpm 版本、依赖、开发/验证/构建入口
├── pnpm-lock.yaml               pnpm 依赖锁定
├── tsconfig.json                strict ESM/NodeNext 业务构建配置
├── tsconfig.test.json           业务源码与测试的联合类型检查
├── .gitignore                   忽略依赖、构建、状态、凭据和本机报告
├── config.example.json          公开示例：账号、站点、阈值和模型
├── config.json                  本机配置，未跟踪
├── mcp.example.json             本地 Node stdio MCP 客户端配置模板
├── README.md / README.zh-CN.md   英文与中文使用说明
├── LICENSE                      MIT 许可
├── .env                         本机通知凭据，未跟踪
├── .devguide/
│   ├── site.md                  公开单页、发布脚本、nginx 与仅本机域名
│   ├── structure.md             文件树与职责
│   ├── pages.md                 网页监控、锚文本选择、候选词与基线
│   ├── local-setup.md           Node/pnpm 环境、配置、凭据、命令
│   ├── architecture.md         个人实验定位、现有模块与运行限制
│   ├── typescript.md            类型边界、ESM、状态兼容、舍入与分发
│   ├── scheduling.md            本机 cron、最小环境与 Actions
│   ├── notify.md                Telegram/飞书摘要与邮件通道
│   ├── twitter-aio.md           X 默认数据源、凭据、备选路由与过滤契约
│   ├── dataforseo.md            Standard 批量任务、OAuth、费用及显式恢复
│   ├── trends.md                根词发现、曲线有限重查、分类、缓存及诊断
│   ├── scrappa.md               MCP 接入、分页、Trends 与 rising 边界
│   ├── costs.md                 数据接口价格、额度与成本估算
│   └── known-issues.md          上游错误和搜索量/相关查询边界
├── .github/workflows/
│   ├── test.yml                 Node 22/24、pnpm check
│   ├── radar.yml                可选 sources/daily 调度及状态缓存
│   └── publish.yml              release 验证及 tgz 附件，不自动发布注册表
├── .claude-plugin/
│   ├── plugin.json              三个 Agent Skill 的插件元数据
│   └── marketplace.json         Claude Code marketplace 描述
├── docs/
│   ├── diagram-scenes.json      中英文流程图 SVG 场景与运动路径
│   ├── radar.en.svg             英文流程图
│   ├── radar.zh.svg             中文流程图
│   ├── radar.en.gif             英文流程动画
│   └── radar.zh.gif             中文流程动画
├── src/
│   ├── site.ts                  公开字段校验、HTML 转义、超限候选分组趋势链接、外链来源策略与原子发布
│   ├── site-tooltip.ts          Tippy/Popper 本地发行文件内联、诞生路径浮窗与键盘交互
│   ├── site-template.ts         紧凑表格样式及浏览器搜索
│   ├── site-chart.ts            七天趋势双线 SVG，蓝参考词、红当前词
│   ├── core.ts                  配置/文案、日期、舍入、HTTP、gzip JSON 快照
│   ├── defaults.json            各模块默认配置
│   ├── messages.json            中英文报告文案
│   ├── prompts.json             模型提示词、停用词和邮件内联样式
│   ├── cli.ts                   daily/sources/keywords/leads/costs/replay-pages/resume-trends/mcp 编排
│   ├── mcp-server.ts            recent_leads/keyword_table/run_radar 工具
│   ├── usage.ts                 SQLite 请求明细、运行/模块范围、统计及费用分布表
│   ├── model-costs.ts           DeepSeek 用户单价/OpenRouter 快照、token 计价及独立调用范围
│   ├── x.ts                     X 按用途路由、显式备选、统一高赞搜索过滤
│   ├── twitter-aio.ts           RapidAPI 传输、推文解析、时间线及搜索游标
│   ├── aisa.ts                  X 全站搜索备选、WHOIS、chat 与工具路由
│   ├── scrappa.ts               Google 搜索 REST、MCP 账号推文分页及全球 Trends
│   ├── goanyapi.ts              可选相关查询与单国日序列
│   ├── sources.ts               X 新名称、HF trending 新模型及名称清洗
│   ├── breakout.ts              GitHub 星数增长、爆发与搜索变体
│   ├── page-keywords.ts         大模型标题核心词组与解释、输出校验和 SQLite 缓存
│   ├── page-batches.ts          URL 快照推进前归档原始候选、批次 ID 校验与显式读取
│   ├── research-cache.ts        单轮曲线与搜索请求复用、并行隔离与失败不缓存
│   ├── report-terms.ts          原始候选收集与去重、报告输入类型
│   ├── pages.ts                 Cheerio 页面链接汇总、候选词、曾见 URL 快照
│   ├── sitemaps.ts              XML/gzip sitemap 抓取、新页面激增词
│   ├── new-sites.ts             周频 WHOIS、ETV/排名词新域名信号
│   ├── gsc.ts                   Search Console 授权刷新与新展现查询
│   ├── judge.ts                 模型名称评分及输出校验
│   ├── terms.ts                 名称提取、词项、按独立来源统计激增
│   ├── trends-roots.ts          一级门禁及二级扩展直接编排
│   ├── trends-status.ts       Rising 采集完整性计数、公开状态白名单与提示
│   ├── trends-related.ts        Rising 数据源选择、Standard 结果归并与恢复
│   ├── trends-contract.ts       共用请求参数、显式 Rising 与回显范围校验
│   ├── trends-aisa.ts           AIsa Live 备选、报价及单批二十任务
│   ├── dataforseo-api.ts        官方 HTTP 请求、费用跟踪及账户错误
│   ├── dataforseo-auth.ts       API 凭据、复用本机 Codex OAuth 及刷新
│   ├── dataforseo-standard.ts   百任务拆批、统一等待、五并发取回及只 GET 恢复
│   ├── dataforseo-store.ts      SQLite 任务参数、提交状态及原始响应归档
│   ├── trends-expansion.ts      二级触发、类目继承、来源克隆归并、全局排序前十及快照契约
│   ├── trends-batches.ts        二级研究前 gzip 原子归档，保留排名及来源，不自动恢复
│   ├── trends-config.ts         根词/供应商/等待默认值与 Zod 校验
│   ├── trends-filter.ts         七天小时曲线、低基线上涨与超大曲线有限重查
│   ├── candidate-research.ts    所有来源共用普通/精确搜索、证据上下文与分类
│   ├── page-research.ts         网页词去重、曲线硬门槛、来源页证据与体育赛事拦截
│   ├── report-screening.ts      日报前任意来源统一曲线门槛、复用已研究结果及跨来源防绕过
│   ├── candidate-kind.ts        按 term 关联分类、缺项隔离、线下体育赛事拦截与证据校验
│   ├── term-observations.ts     原始发现时间、本地词键和只追加发现记录
│   ├── trends-explanations.ts   Trends 解释的证据/模型/版本状态缓存
│   ├── source-errors.ts         上游预期错误、程序错误及 stderr 堆栈诊断
│   ├── trend-measure.ts         日曲线形状、搜索量比值及研究判断纯计算
│   ├── trends-series.ts         既有九十天参考词批量比较请求
│   ├── cost-report.ts           费用合计和账本分布展示
│   ├── keyword-report.ts        关键词研究 Markdown 表格与字段格式化
│   ├── usecases.ts              Google/README 取证、X 显式备选、提词筛选与批量估量
│   ├── review.ts                到期线索 Trends 复盘与命中判定
│   ├── brief-report.ts          三段日报、精确首次发现、历史词与一句话解释
│   ├── report.ts                合并线索、双语 Markdown 与关键词表
│   ├── store.ts                 SQLite 线索、命中率与复盘状态
│   └── notify.ts                Resend 邮件与 Markdown HTML
├── scripts/
│   ├── publish-site.ts          离线生成最新日报页面
│   ├── notify-report.ts         Telegram 摘要/附件、飞书摘要
│   ├── gsc-auth.ts              桌面 OAuth、PKCE、gsc_token.json
│   └── make-diagram.ts          SVG 动画及 rsvg/ffmpeg 媒体导出
├── skills/
│   ├── new-term-radar/SKILL.md   整轮发现与关键词研究
│   ├── ai-listening/SKILL.md     新名称线索收集
│   └── seo-new-keywords-research/SKILL.md  指定名称关键词研究
├── tests/
│   ├── dataforseo-api.test.ts   独立凭据、OAuth 刷新、实际费用与排队状态
│   ├── dataforseo-standard.test.ts  百任务拆批、乱序关联、失败隔离与只 GET 恢复
│   ├── fixtures/perceptle-hourly.json 实测七天小时点，低基线噪声回归样本
│   ├── fixtures/noillirk-hourly.json 已有热度后持续爆发的 noillirk / hex picker 实测双线
│   ├── fixtures/perceptle-report-hourly.json 最近实跑 perceptle 与 hex picker 七天双线样本及采样元数据
│   ├── site.test.ts             公开白名单、转义、分类与失败保留页面
│   ├── source-errors.test.ts      上游错误分类、程序异常传播、历史导入和部分费用展示
│   ├── parity.test.ts           固定旧实现基准：曲线、名称、双语报告
│   ├── trends-expansion.test.ts 跨父词前十稳定性、输入不变、缺失增长及中止快照
│   ├── site-path.test.ts        结构化多行路径、排序策略兼容及零/缺失增长展示
│   ├── trends-roots.test.ts       Rising 契约、类目继承、三倍边界、全局排序前十与二级不递归
│   ├── trends-filter.test.ts      低基线噪声边界、超大曲线有限重查、失败和费用
│   ├── report-screening.test.ts 其他来源补查、已有结果复用、跨来源防绕过
│   ├── page-recovery.test.ts    研究失败留档、显式补查、快照去重及错误传播
│   ├── research-cache.test.ts   搜索跨模块复用、费用去重、失败再查和运行隔离
│   ├── page-research.test.ts    网页曲线不达标/待验证拦截、同词去重、来源证据、赛事拦截与无新增零请求
│   ├── candidate-kind.test.ts     分类 term 匹配、八词七答、缺项/重复隔离与证据引用
│   ├── trends-config.test.ts      配置默认值、重复项、供应商与等待时限
│   ├── trends-cache.test.ts       解释状态、证据/模型/版本失效与旧来源隔离
│   ├── trends-maintenance.test.ts 外部接口模拟下的完整内部流程及首次发现
│   ├── brief-report.test.ts     24 小时边界、重跑去重、费用隔离与解释降级
│   ├── page-keywords.test.ts    模型提词校验、缓存复用、历史词修正与首次发现保留
│   ├── pages.test.ts            重复锚文本、URL 回退、首次基线、失败保护和重现去重
│   ├── radar.test.ts            SQLite、快照、信号、CLI、邮件纯逻辑
│   ├── twitter-aio.test.ts      时间线/搜索契约、词表保护和备选路由
│   ├── scrappa.test.ts          真样本契约、SDK mock、分页及错误保护
│   ├── usage.test.ts            持久化记账、失败/重试、并发隔离、费用汇总与 CLI
│   ├── model-costs.test.ts      模型费用、缓存输入、并行隔离、缺失用量和摘要
│   ├── trends-status.test.ts  采集状态汇总、三段报告及畸形上游边界
│   ├── pipeline.test.ts         模拟付费接口的完整关键词管线和状态保护
│   ├── mcp.test.ts              官方 SDK 与真实 stdio 子进程集成
│   └── fixtures/
│       ├── python-parity.json   不依赖 Python 的固定业务基准
│       ├── scrappa.json         Scrappa 推文/比较/相关词真实脱敏样本
│       └── whois_new_ai_sites.json WHOIS 响应样本
├── node_modules/                pnpm 安装依赖，未跟踪
├── dist/                        tsc 构建结果，生产/cron 直接执行，未跟踪
└── state/                       radar.db、gzip 快照、cron.log，未跟踪
```

`gsc_client.json`、`gsc_token.json` 和运行生成的报告也被忽略；不得加入凭据明文。构建输出包含 src/scripts 的 JS、source map 与依赖 JSON；不手工编辑 dist。
