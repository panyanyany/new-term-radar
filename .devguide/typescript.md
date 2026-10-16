# TypeScript 运行与兼容约定

## 模块

ESM + NodeNext，目标 ES2023；运行要求 Node.js 22+，生产推荐 24。源码导入写 `.js` 后缀，JSON 使用 `with { type: "json" }`，开发由 tsx 加载，生产由 tsc 输出到 `dist/`。`tsconfig.json` 开启 strict，`tsconfig.test.json` 同时检查测试。

- `src/core.ts`：日期、配置、双语文案、gzip 快照、共享数据类型。
- `src/store.ts`：better-sqlite3，沿用 leads 表结构，记录使用事务，不重置首次发现和复盘状态。
- `src/cli.ts`：Commander 参数解析及异步信号编排，单个信号失败生成局部错误。
- `src/mcp-server.ts`：官方 MCP SDK 的 stdio 服务，工具响应是 JSON 文本，不输出额外日志。
- `src/scrappa.ts`：同 SDK 的 Streamable HTTP 客户端，付费请求顺序执行。

`Config` 明确配置字段、`Point` 约束日期与序列值；上游开放 JSON 和不同信号的可选字段使用 `Data` 字典，不能认为所有远端字段都已经通过类型验证。Twitter AIO 和 Scrappa 在适配边界校验推文必需字段与时间；X 路由层对两家搜索使用相同的严格过滤规则，Scrappa 另校验 Trends 日期与比较词序。

## 数据与算法

- SQLite 列名和 JSON 列格式保持兼容；日期以 ISO 字符串表示，按字典序比较。业务日期使用服务器本地日历，Scrappa 的可请求窗口使用 UTC。
- 快照为 UTF-8 JSON + gzip，先写同目录临时文件再 rename，目录递归创建。所有账号完整采集前不更新词表。
- `round()` 按 IEEE 754 原始位计算十进制最近偶数舍入，保留 Python 的半值边界；先乘浮点倍率再 `Math.round` 会改变部分 1 位小数的趋势比率。
- 业务阈值由固定种子旧实现基准覆盖：240 组 shape、240 组复盘曲线、名称提取、HF 清洗及双语完整报告。基准 JSON 固定在 `tests/fixtures/python-parity.json`，执行测试不依赖 Python。
- Trends 单词曲线可重新归一化，共同请求的比较曲线不能分别归一化；没有数据和请求失败是不同状态。

## 运行入口与分发

`pnpm radar` / `pnpm notify` / `pnpm gsc-auth` / `pnpm diagram` 用于本地操作。生产使用 `node dist/src/cli.js`，MCP 示例见 `mcp.example.json`。MCP 客户端需填绝对路径，并与定时任务共用 `RADAR_STATE`。

`package.json` 标为 private；release 工作流只验证并上传 tgz 构建包，不向注册表发布。构建包包含 dist、示例配置和说明；解包后需用 pnpm 安装生产依赖。无已发布的 TypeScript 注册表包，不使用旧的 Python/uvx 安装方式。

图形生成入口 `pnpm diagram oss-zh /tmp/radar --svg-only`；场景模板为 `docs/diagram-scenes.json`。去掉 `--svg-only` 还需要 `rsvg-convert`、`ffmpeg`，输出 GIF/MP4/PNG。
