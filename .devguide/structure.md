# 项目文件结构

```text
new-term-radar/
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
│   ├── structure.md             文件树与职责
│   ├── local-setup.md           Node/pnpm 环境、配置、凭据、命令
│   ├── architecture.md         个人实验定位、现有模块与运行限制
│   ├── typescript.md            类型边界、ESM、状态兼容、舍入与分发
│   ├── scheduling.md            本机 cron、最小环境与 Actions
│   ├── notify.md                Telegram/飞书摘要与邮件通道
│   ├── twitter-aio.md           X 默认数据源、凭据、备选路由与过滤契约
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
│   ├── core.ts                  配置/文案、日期、舍入、HTTP、gzip JSON 快照
│   ├── defaults.json            各模块默认配置
│   ├── messages.json            中英文报告文案
│   ├── prompts.json             模型提示词、停用词和邮件内联样式
│   ├── cli.ts                   daily/sources/keywords/leads/mcp 编排
│   ├── mcp-server.ts            recent_leads/keyword_table/run_radar 工具
│   ├── x.ts                     X 按用途路由、显式备选、统一高赞搜索过滤
│   ├── twitter-aio.ts           RapidAPI 传输、推文解析、时间线及搜索游标
│   ├── aisa.ts                  X 全站搜索、Google Ads、WHOIS、chat
│   ├── scrappa.ts               MCP 账号推文分页、90 天全球 Trends
│   ├── goanyapi.ts              可选相关查询与单国日序列
│   ├── sources.ts               X 新名称、HF trending 新模型及名称清洗
│   ├── breakout.ts              GitHub 星数增长、爆发与搜索变体
│   ├── sitemaps.ts              XML/gzip sitemap 抓取、新页面激增词
│   ├── new-sites.ts             周频 WHOIS、ETV/排名词新域名信号
│   ├── gsc.ts                   Search Console 授权刷新与新展现查询
│   ├── judge.ts                 模型名称评分及输出校验
│   ├── terms.ts                 名称提取、词项、按独立来源统计激增
│   ├── usecases.ts              取证、提词、筛选、量级/趋势与优先级
│   ├── review.ts                到期线索 Trends 复盘与命中判定
│   ├── report.ts                合并线索、双语 Markdown 与关键词表
│   ├── store.ts                 SQLite 线索、命中率与复盘状态
│   └── notify.ts                Resend 邮件与 Markdown HTML
├── scripts/
│   ├── notify-report.ts         Telegram 摘要/附件、飞书摘要
│   ├── gsc-auth.ts              桌面 OAuth、PKCE、gsc_token.json
│   └── make-diagram.ts          SVG 动画及 rsvg/ffmpeg 媒体导出
├── skills/
│   ├── new-term-radar/SKILL.md   整轮发现与关键词研究
│   ├── ai-listening/SKILL.md     新名称线索收集
│   └── seo-new-keywords-research/SKILL.md  指定名称关键词研究
├── tests/
│   ├── parity.test.ts           固定旧实现基准：曲线、名称、双语报告
│   ├── radar.test.ts            SQLite、快照、信号、CLI、邮件纯逻辑
│   ├── twitter-aio.test.ts      时间线/搜索契约、词表保护和备选路由
│   ├── scrappa.test.ts          真样本契约、SDK mock、分页及错误保护
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
