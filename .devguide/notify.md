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

摘要由 `summary()` 从 Markdown 里抽取，同一条内容用于两个通道：本次数据成本估算、`**优先**` 名字及其估算日搜、GitHub 爆发 Top3。

## 飞书的两个限制（实测）

- 自定义机器人 webhook 仅接受 `{"msg_type":"text","content":{"text":...}}`，**不支持上传文件**，所以飞书不发 `report.md`
- 文本是纯文本，Markdown 表格不会渲染

## 成功判定

飞书与 Telegram 的响应体不同，脚本按 `ok == true`、`code == 0`、`StatusCode == 0` 三者之一判定成功（`post()`）。

## 指定 Telegram 私聊

个人用户名不能像频道用户名一样直接作为 Bot API 的 `chat_id`。收件人须先给当前机器人发送 `/start`；从 `getUpdates` 中按用户名精确匹配 `message.chat`，且必须为 `type=private`，取得数字 chat_id。发送前再次通过 `getChat` 验证会话类型和用户名，避免误发到群或频道。

一次性私聊不改 `.env` 和 cron 的默认收件人。需要绕过通用通知入口，或显式覆盖 `TELEGRAM_CHAT_ID` 并将 `FEISHU_GROUP_HOOK` 置为空；dotenv 不覆盖已有环境变量，因此空字符串能禁用飞书。发送结果需检查 Bot API 的 `ok` 和返回消息的私人会话 ID。`getUpdates` 查询不传 offset，不确认消费其他更新。
