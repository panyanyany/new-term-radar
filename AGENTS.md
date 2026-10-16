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

- `.devguide/structure.md` —— 文件树与逐文件职责，文件增减时更新
- `.devguide/local-setup.md` —— Node.js / pnpm 环境、config.json 关键项、AIsa / Scrappa / Twitter AIO 凭据与 X 数据源选择、运行与测试命令
- `.devguide/notify.md` —— Telegram 私聊校验与飞书群推送：.env 变量、scripts/notify-report.ts、临时禁用群通知、webhook 文件与 Markdown 限制
- `.devguide/scheduling.md` —— 本机 cron 定时：crontab 条目、cron 最小环境要点、状态目录与日志、验证方法
- `.devguide/known-issues.md` —— new-sites 上游错误、Scrappa 替代边界、Twitter AIO 复用与 AIsa 五页搜索对照、报告搜索量边界、AI 停用词、邮件依赖
- `.devguide/costs.md` —— AIsa、GoAnyAPI 与 Scrappa 接口价格、替代收益、免费额度和充值有效期、月度成本
- `.devguide/scrappa.md` —— Scrappa MCP 客户端、密钥复用、推文分页、Trends 归一化、相关查询 top/rising 边界与验证
- `.devguide/typescript.md` —— ESM/NodeNext、类型边界、状态兼容、舍入与基准测试、生产入口和本地 MCP 分发
- `.devguide/twitter-aio.md` —— X 默认数据源、独立凭据、显式备选切换、30 小时时间线与五页搜索过滤
- `.devguide/architecture.md` —— 个人实验定位、轻量模块分工、现有保护与接受的运行限制
