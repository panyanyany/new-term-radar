# 报告推送（Telegram / 飞书）

radar 自带的通道只有邮件（`src/notify.ts`，走 Resend，`--mail` 使用）。Telegram 与飞书群由 `scripts/notify-report.ts` 提供，**不修改 radar 源码**。

## 变量

radar 本身不读 `.env`；该脚本会读取**当前工作目录**的 `.env`（已存在的真实环境变量优先），所以 cron 里先 `cd` 到项目根即可。失败日志不输出请求 URL、响应正文或鉴权字段，避免泄露 token 与 webhook。

| 变量 | 用途 |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人 token |
| `TELEGRAM_CHAT_ID` | 目标 chat（可用 `@频道名`） |
| `FEISHU_GROUP_HOOK` | 飞书群自定义机器人 webhook 地址 |

每个通道只在其变量齐全时才运行，互不影响；一个失败不会阻止另一个。两个都没配置则打印 skipped 并以 0 退出。

## 用法

```bash
pnpm notify report.md
```

发送内容：

| 通道 | 内容 | 说明 |
|---|---|---|
| Telegram | 摘要文字 + `report.md` 文件（`sendMessage` + `sendDocument`） | 文件走 multipart 上传，上限 45MB |
| 飞书群 | **仅摘要文字** | 自定义机器人 webhook 只能发消息，不能上传文件 |

摘要由 `summary()` 从 Markdown 抽取 `**优先**` 名字及其估算日搜、GitHub 爆发 Top3。费用仅在 Telegram 数字正整数 ID 的私聊摘要和完整附件中保留；飞书群、Telegram 群/超级群和频道摘要不含费用或未计价提示。Telegram 群/频道附件通过 `withoutCosts()` 去除费用合计、未计价提示及费用分布表，本地报告和 SQLite 明细不受影响。

## 飞书的两个限制（实测）

- 自定义机器人 webhook 仅接受 `{"msg_type":"text","content":{"text":...}}`，**不支持上传文件**，所以飞书不发 `report.md`
- 文本是纯文本，Markdown 表格不会渲染

## 成功判定

飞书与 Telegram 的响应体不同，脚本按 `ok == true`、`code == 0`、`StatusCode == 0` 三者之一判定成功（`post()`）。

## 指定 Telegram 私聊

个人用户名不能像频道用户名一样直接作为 Bot API 的 `chat_id`。收件人须先给当前机器人发送 `/start`；从 `getUpdates` 中按用户名精确匹配 `message.chat`，且必须为 `type=private`，取得数字 chat_id。发送前再次通过 `getChat` 验证会话类型和用户名，避免误发到群或频道。

一次性私聊不改 `.env` 和 cron 的默认收件人。需要绕过通用通知入口，或显式覆盖 `TELEGRAM_CHAT_ID` 并将 `FEISHU_GROUP_HOOK` 置为空；dotenv 不覆盖已有环境变量，因此空字符串能禁用飞书。发送结果需检查 Bot API 的 `ok` 和返回消息的私人会话 ID。`getUpdates` 查询不传 offset，不确认消费其他更新。

## 三段日报

`daily` 使用 `src/brief-report.ts` 输出“当天新词、旧词、花费”三段，每个词格式为 `词语: 一句话解释`。Telegram 群聊、频道与飞书删除整个第三段；私聊保留。摘要最多 3500 字，完整内容见附件。原详细信号、趋势与错误保留在同名 JSON 中。

SQLite `report_terms` 独立保存归一化词键、精确 UTC 首次/最近发现时间、依据和解释。以本项目首次发现时间按滚动 24 小时分段，刚好满 24 小时归旧词；不是声称互联网上首次发布。报告只展示本轮抓取和研究产生的候选；历史表仅用于首次发现判断与解释缓存，不补入旧词。本次再次出现且已满 24 小时的词才进入旧词段，本次没有候选则两段均为暂无。已有 report.json 按文件修改时间补历史；旧 leads 只有日期时以 UTC 日期起点兼容，历史精度只到天。新写入记录精确到秒。DeepSeek 批量解释依据资料，不明含义显式待确认，调用记入 report 模块费用。

AI 解释若遇到 504，可复用本轮报告 JSON 的候选与 Google 搜索证据分批补充缺失解释，不必重新抓取来源或重复搜索。补跑的请求明细需合并入原日报运行统计；超时请求无 usage 时保留“费用未知”，不能按免费计。补充完成后再发送完整私聊报告。

根词首次出现时间在 Rising 去重后即写入 term_discoveries，是否通过曲线/分类不改变发现时间。日报仍仅展示本轮最终通过的词；Trends 解释的证据与版本缓存见 [trends.md](trends.md)。

## 定时通知路由配置

定时通知当前使用本机 `.env` 指定的 Telegram 私人会话，`FEISHU_GROUP_HOOK` 为空，群聊发送暂停。路由无需改代码或 cron：`TELEGRAM_CHAT_ID` 决定 Telegram 收件人，`FEISHU_GROUP_HOOK` 为空关闭飞书群；两个变量都为空时全部跳过。真实 ID、用户名、token、webhook 以及原配置备份只保存在被 Git 忽略的本机文件中。切换收件人前使用 Bot API getChat 核对 private 类型、用户名及数字 ID；只验证配置不发送测试消息。未配置自动恢复时间，恢复群聊需明确调整本地配置。进程已设置的同名环境变量优先于 `.env`，本机 cron 未内联覆盖这两个变量。

上涨词采集不完整时，第一段内显示完成/待取回/失败/未知数量提示，未完成不等同于没有候选；不新增第四段，不改变私聊费用和群聊隐藏费用的规则。
