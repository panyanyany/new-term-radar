# 本机搭建

## 环境与依赖

Node.js 22+，本机 Node.js 24；包管理器固定 pnpm 10.33.0（`package.json#packageManager`）。安装只使用 pnpm，提交 `pnpm-lock.yaml`。业务程序、通知、OAuth、图形导出均使用 TypeScript，不需要 Python 环境。

```bash
pnpm install --frozen-lockfile
pnpm build
cp config.example.json config.json  # 已有配置不要覆盖
```

`better-sqlite3` 使用原生模块；pnpm 仅允许它和 esbuild 执行安装脚本。主流 Node LTS 有预编译产物；没有对应产物时需要系统 C++ 构建工具。

## 配置

| 项 | 作用 |
|---|---|
| `lang` | `en` / `zh`，报告语言 |
| `x_accounts.labs/bloggers` | 要读的 X 账号 |
| `sitemaps` | 当前配置为空，不抓取 sitemap；模块保留，可显式配置地址、分片正则、抓取间隔和语言路径合并 |
| `topics` | 主题名与匹配正则 |
| `known_terms/stop_words` | 已覆盖名称、额外停用词 |
| `judge.model/min_score` | 名称判定模型与展示阈值 |
| `usecases.per_day` | 每日分析名称数量，0 关闭 |
| `new_sites.weekday` | 新站任务星期，0 为周一 |
| `review.after_days/per_day` | 复盘间隔、每日预算 |
| `gsc.site/token_file` | 可选 Search Console 站点与凭据文件 |

默认配置、模型提示词与双语文案分别位于 `src/defaults.json`、`src/prompts.json`、`src/messages.json`。

## 密钥

业务程序不自动加载 `.env`。密钥优先级：

- AIsa：`AISA_API_KEY` → `~/.aisa/key` → `~/.aisa/tokens.json` 的 `accessToken`。
- Scrappa：`SCRAPPA_API_KEY` → `~/.scrappa/key` → `~/.config/opencode/opencode.json` 中 `mcp.scrappa.headers.X-API-KEY`，字段大小写不敏感。
- GoAnyAPI：仅 `GOANYAPI_API_KEY`；本机未设置，相关查询和单国曲线不会请求。
- GitHub：可选 `GITHUB_TOKEN` / `GH_TOKEN`。
- Search Console：相对于配置目录的 `gsc_token.json`，缺失时读取 `GSC_TOKEN_JSON`。

已有密钥可通过专用文件或符号链接复用；不要将明文复制到项目文件。通知脚本单独使用 dotenv 读取 `.env`，进程环境变量优先。

## 命令

```bash
pnpm radar daily --skip newsites --out report.md
pnpm radar sources --out sources.md
pnpm radar keywords "名字" --repo "名字=owner/repo" --json
pnpm radar leads --days 7 --json
pnpm radar mcp
pnpm notify report.md
pnpm gsc-auth gsc_client.json
```

pnpm 开发入口使用 tsx。生产和 cron 使用构建产物 `node dist/src/cli.js ...`、`node dist/scripts/notify-report.js ...`。改动源码后必须重新执行 `pnpm build`。

首次 X/HF/sitemap 运行只建立快照；GitHub 爆发不依赖旧快照。`state/radar.db` 和 gzip JSON 快照可直接沿用，删除 state 会丢失历史。`daily --out report.md` 同时写 `report.json`。

## 验证

```bash
pnpm check  # 格式、业务与测试类型检查、Vitest、构建
```

单元测试使用固定样本和临时 state；MCP 集成测试通过官方客户端启动真实 stdio 子进程，只调用免费的 `recent_leads`。测试不发送通知、不改生产 state、不请求收费接口。

## X 数据源

默认账号采集与高赞搜索均用 Twitter AIO，设置 `TWITTER_AIO_RAPIDAPI_KEY` 或 `~/.twitter-aio/key`。保留 `X_TIMELINE_PROVIDER=scrappa` 与 `X_SEARCH_PROVIDER=aisa` 显式切换旧方案；不会自动跨供应商重试。详细凭据优先级、分页和部署规则见 [twitter-aio.md](twitter-aio.md)。

关键词量级配置：`usecases.benchmark="hex picker"`、`benchmark_daily=2500`。每批参考词加最多四词，通过全球 Trends 比值估算日搜及日搜乘 30 的月量，不调用 Google Ads。`min_volume` 是估算月量门槛，`trends_max` 是展示通用词数量上限。

模型配置：`usecases.model=deepseek-v4.1-flash` 用于提词及筛选，仍由 AIsa chat 调用；`judge.model=gpt-4.1-mini` 用于名称评分。DeepSeek 输入/输出单价采用用户提供的 $0.283/$1.131 每百万 token，详见 costs.md。

关键词取证默认 Scrappa Google Search，复用 `SCRAPPA_API_KEY` / 既有本机凭据。`KEYWORD_EVIDENCE_PROVIDER=x pnpm radar keywords "产品名"` 显式改用 X，`X_SEARCH_PROVIDER=aisa` 可进一步选择旧 AIsa 搜索；默认 Google 模式不受 `X_SEARCH_PROVIDER` 影响。`SCRAPPA_API_URL` 仅覆盖 REST API 域名，MCP 地址仍由 `SCRAPPA_MCP_URL` 控制。

`trends_roots: { roots: ["game"], windows: [1, 3, 7], category_code: 8 }` 启用根词 Rising 发现；需要现有 AIsa 与 Scrappa 凭据。`--skip trends` 禁用。三天采用 UTC 日期区间，接口日期精度不保证滚动 72 小时。

根词参考词可通过 `trends_roots.benchmark` 独立设置，未设置时兼容 `usecases.benchmark`。根词、窗口、类目与批量数量在配置加载阶段校验。七天筛选与超大曲线有限重查详见 [trends.md](trends.md)。
