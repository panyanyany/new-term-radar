# 定时运行

## 本机 cron

```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
HOME=/home/ubuntu
30 9 * * * cd /var/www/pyys/new-term-radar && RADAR_SITE_DIR=/var/www/pyys/new-term-radar/site /usr/bin/node dist/src/cli.js daily --skip newsites --out report.md >> state/cron.log 2>&1 && /usr/bin/node dist/scripts/notify-report.js report.md >> state/cron.log 2>&1
```

09:30 为服务器本地时区。state 留在本机磁盘；程序更新后先 `pnpm build`，cron 直接执行构建产物，不依赖 tsx 或交互式 shell。`--skip newsites` 跳过上游参数校验有问题的周频接口。

cron 不读取 shell 初始化文件；显式 HOME 供 AIsa/Scrappa/Twitter AIO 查找凭据，通知脚本自行读取工作目录的 `.env`。`&&` 使报告生成失败时不发通知。日志追加至 `state/cron.log`。当前通知路由由本地 `.env` 设为 Telegram 私聊、飞书群暂停；调整收件人不改变任务频率，无自动恢复群聊的定时项。

更新前用 `crontab -l` 备份，精确替换该项目条目，保留其他定时任务。

## 最小环境验证

```bash
env -i HOME=/home/ubuntu PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/bin/node dist/src/cli.js leads --days 1 --json
```

上述命令只读线索，不请求付费接口。验证通知会真的发消息，仅在需要发报告时执行 `pnpm notify report.md`。

## GitHub Actions

`.github/workflows/radar.yml` 保留 sources 每 8 小时、daily 每日一次的双调度，`RADAR_ENABLED=true` 才启用。pnpm 安装依赖并构建后执行 Node 入口。secrets、状态缓存与报告附件规则保持独立配置；Actions cache 可能淘汰，应定期备份 state。工作流没有 Telegram/飞书推送步骤。

本机 daily 命令使用 `RADAR_SITE_DIR` 在日报生成后发布静态页面，详情见 `.devguide/site.md`；域名不记录在仓库中。
