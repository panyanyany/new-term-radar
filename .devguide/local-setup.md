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
| `sitemaps` | sitemap 地址、分片正则、抓取间隔和语言路径合并 |
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
