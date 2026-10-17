## 开发规范
- 除非用户明确要求，否则不要自动执行 git commit 或 git push
- 要有中文注释: 函数、关键步骤等
- 开发相关的内容，分类后沉淀为开发文档并更新到 .devguide/*.md，在 AGENTS.md 中更新它的索引，索引描述用一句话或多个关键词精确表示，这里只记录现状，不要记录变更历史和未来规划
  - 解决问题的经验也要沉淀
- 优先使用行业内的成熟方案，避免造轮子
  - 遇到问题，先去 agents.md 找已有实现，或者在项目内找
- 维护一个 .devguide/structure.md 文件，包含文件树和注释，当项目文件有变化时更新

## 项目定位
- 个人使用的实验项目，优先快速开发和验证功能，保持现有单机结构与直接的模块调用
- 按实际痛点做小改动，不为假设的规模或可靠性需求引入队列、工作流引擎、微服务或额外分层
- 保留数据源备选与核心判断/接口测试；允许部分失败后手动重跑，不追求企业级可靠性

## 开发文档索引

- `.devguide/site.md` —— 紧凑表格日报、Tippy 结构化诞生路径时间线与多行理由、手机底部面板、词语/路径复制与多来源追溯、浏览器当地发现时间、趋势分类与 AI 分类列、七天蓝红双线曲线、超限二级候选四词加参考词分组链接、外链匿名来源、白名单与转义、离线和自动发布、nginx/HTTPS、仅本机域名与验证

- `.devguide/structure.md` —— 文件树与逐文件职责，文件增减时更新
- `.devguide/local-setup.md` —— Node.js / pnpm 环境、config.json 关键项、AIsa / Scrappa / Twitter AIO 凭据、Codex DataForSEO MCP OAuth 与 X 数据源选择、运行与测试命令
- `.devguide/notify.md` —— 三段日报、本轮候选限定、24 小时首次发现分类、Telegram 私聊费用、群聊费用隐藏与推送：.env 变量、scripts/notify-report.ts、本地配置切换私聊及暂停群通知、webhook 文件与 Markdown 限制
- `.devguide/scheduling.md` —— 本机 cron 定时：crontab 条目、cron 最小环境要点、状态目录与日志、验证方法
- `.devguide/known-issues.md` —— new-sites 上游错误、Scrappa 替代边界、Twitter AIO 复用与 AIsa 五页搜索对照、报告搜索量边界、AI 停用词、邮件依赖
- `.devguide/costs.md` —— SQLite 请求明细、costs 分组统计、报告费用分布、hex picker 批量 Trends 估量、AIO/DeepSeek/OpenRouter 单价与历史还原边界、完整费用与模块小计
- `.devguide/dataforseo.md` —— Standard 百任务批量提交、统一轮询与限并发取回、SQLite 任务归档与显式恢复、OAuth/API 凭据、实际费用与 AIsa 备选、取回时间预算、发送边界、Rising 结构校验与采集完整性提示
- `.devguide/trends.md` —— 根词/一级/二级 Rising、一级全门禁后三倍扩展、二级独立扩展、全局 Rising 排序及缺失增长、每轮十词、研究前原子快照及超限展示、类目仅限相关查询、七天低基线起量、两天/三天持续爆发与实测曲线样本、超大曲线有限重查、任意来源曲线硬门槛、AI 类型标注与线下体育赛事拦截、精确搜索补查、发现时间、解释状态缓存、本轮请求复用与费用去重、分类原词 term 关联与缺项隔离、显式报告输入及异常边界
- `.devguide/scrappa.md` —— Scrappa Google 搜索取证、MCP 客户端、密钥复用、推文分页、Trends 归一化、相关查询 top/rising 边界、根词 1/3/7 天 Rising、游戏类目 8 限定与七天曲线从零上涨筛选、普通搜索与 AI 线上游戏/在线工具分类与 AIsa/DataForSEO 对照
- `.devguide/typescript.md` —— ESM/NodeNext、类型边界、状态兼容、舍入与基准测试、生产入口和本地 MCP 分发
- `.devguide/twitter-aio.md` —— X 默认数据源、独立凭据、显式备选切换、30 小时时间线与五页搜索过滤
- `.devguide/architecture.md` —— 个人实验定位、轻量模块分工、现有保护与接受的运行限制

- `.devguide/pages.md` —— 本地专属监控配置、指定网页新增链接、全部锚文本合并、大模型核心词组提取与缓存、URL 候选词回退、七天曲线硬门槛和共用 AI 分类/赛事拦截、快照前候选归档、显式 replay-pages 补查、永久去重基线与日报展示
