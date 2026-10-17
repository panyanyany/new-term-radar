# 单页日报网站

## 页面与数据

网站由 nginx 托管静态 HTML，无常驻后端、鉴权或付费接口调用。页面展示最新一期的当天新词、旧词、首次发现时间（浏览器当地时区，精确到分钟）、趋势分类、AI 分类、一句话解释、浏览器当地报告更新时间，采用紧凑表格，提供浏览器本地搜索并适配手机（表格可横向滚动）。网站不展示费用、原始搜索证据、上下文或运行诊断。

`src/site.ts` 使用 Zod 白名单解析 `brief_terms` 的 term/explanation/first_seen_at 及 generated_at；同时从 trends.candidates、sitemap.pages.candidates 和 candidate_screening.candidates 按归一化词键关联 trend_filter.curve、trend_type、reason（兼容旧报告分类）、benchmark 及 classification 的 decision/is_online_game/is_online_tool/is_offline_sports_event/reason，其余字段不进入页面。分类列显示线上游戏、在线工具、游戏 / 工具、其他、待确认或未分类，悬停显示判断依据；线上游戏/工具分类只作标注；本轮明确线下体育赛事在发现流程中拦截，不进入网页，旧报告不会离线重新判断。外部文字始终 HTML 转义，浏览器搜索仅改变可见性，不使用 innerHTML。新旧分类以报告生成时间为基准，刚好满 24 小时归旧词，浏览时间不会改变分类。新报告包含 generated_at，旧报告以文件修改时间兼容。

`src/site-template.ts` 保存紧凑表格样式和浏览器搜索脚本，搜索只匹配词语与解释。`src/site-chart.ts` 将已有七天小时点渲染为 SVG：元组为 [毫秒时间戳, 当前词热度, 参考词热度]，蓝线显示参考词，红线显示当前词，原始数据仍为 0–100 相对热度；各图纵轴从零开始，上限优先取参考词均值的两倍，让蓝线平均位于中间；若任一曲线峰值更高，则按峰值加 5% 留白扩大上限（最大 100），避免截断。上限至少为 1，向上保留一位小数，并显示中间刻度。两线使用同一纵轴，不分别归一化；不同图的纵轴上限可不同，以图上刻度为准，避免固定 100 将低热度压平。图上显示 UTC 起止日期，图下显示参考词名，点击可进入 Google Trends 比较两词。缺失、非法或时间不递增的曲线显示“暂无曲线”，不补造零，不新增请求。`scripts/publish-site.ts` 是离线发布入口：

```bash
pnpm site
# 或指定输入与独立输出目录
pnpm site report.json /path/to/public-site
# 已构建时无需 tsx
node dist/scripts/publish-site.js report.json /path/to/public-site
```

默认输出 `site/index.html`，目录已被 Git 忽略。生成成功后通过同目录 rename 原子替换；输入解析或写入失败保留旧页面并抛出错误，不自动重试或重新抓取。

## 日报自动发布

本机为 daily 命令设置 `RADAR_SITE_DIR`。成功写出 Markdown 和同名 JSON 后，CLI 调用发布函数；sources 命令及未设置变量的调用不发布。网站发布不依赖 Telegram 成功与否；发布失败使命令失败并在 cron 日志中保留堆栈。可独立重跑离线发布。

```bash
RADAR_SITE_DIR=/path/to/public-site node dist/src/cli.js daily --skip newsites --out report.md
```

## nginx 与域名

实际域名仅配置在本机 `/etc/nginx/sites-available/` 及其启用链接和证书设置中，不写入仓库、示例、页面或测试。网页使用相对锚点，不需要域名或 public URL 配置。以下仅为占位符：

```nginx
server {
    listen 443 ssl;
    server_name YOUR_DOMAIN;
    root /path/to/public-site;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    location = / { try_files /index.html =404; add_header Cache-Control "no-cache"; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location / { return 404; }
}
```

本机 HTTP 跳转 HTTPS，ACME webroot 独立设为 `/var/www/html`，只公开 index.html 与 ACME 验证路径。不得将 nginx 根目录指向项目根目录，也不要开放原始报告、state 或目录索引。证书由系统 Certbot 续期，部署钩子验证配置后 reload nginx。

## 验证

`tests/site.test.ts` 验证公开字段白名单、外部 HTML 转义、精确 24 小时分类、旧报告时间兼容、空状态、表格曲线关联、双线共同尺度、缺失/损坏曲线及发布失败保留旧页面。上线检查 HTTPS、手机无横向溢出、搜索及空结果、费用和本机文件路径不能访问。设计上下文记录于 `.impeccable.md`。

发现时间与报告更新时间的 `time` 元素保留 ISO datetime，由浏览器 Intl.DateTimeFormat 按默认时区格式化，悬停可查看时区名；无脚本时显示带 Z 的 ISO 原始时间。显示时区不影响按时间戳进行的 24 小时新旧划分。

发现时间列表头为“发现时间”，时区信息通过悬停提示展示。

“趋势分类”列与“AI 分类”独立，显示低基线起量、已有热度爆发或未分类；旧报告可按通过原因兼容显示，发布不会触发新的趋势查询。


## 词汇诞生路径浮窗

桌面词语使用可聚焦按钮触发 Tippy.js 6，Popper 2 负责双轴定位；浮窗挂到 document.body，支持悬停、键盘聚焦、移入阅读、关闭按钮和 Escape。640px 及以下点击词语打开浏览器原生 dialog 底部面板，提供背景遮罩、焦点约束、Esc、关闭后焦点恢复；面板最高 90dvh，内部滚动，背景锁定滚动，兼容安全区域。

界面使用深绿标题栏、竖向图标时间线、浅色内容块和收录结果条；面板边距 12px、步骤间距 10px、内容块内边距 7px/9px，复制按钮保留至少 28px 点击区域；锚文本、趋势状态、普通搜索、精确补查、AI 分类和分类依据逐项显示，不虚构阶段时间。来源 URL、搜索词提供剪贴板复制，失败明确提示。原始锚文本和分类依据直接显示，与参考 UI 一致。

`site-tooltip.ts` 从 pnpm 安装的 tippy.js 及其 Popper 依赖读取发行文件，将脚本、CSS 和初始化内联到唯一的 index.html；保留第三方许可标注，不请求 CDN，不增加 nginx 资源路由。`allowHTML=false`，路径使用 kind/title/text/copy/note 步骤数组，JSON 序列化并转义后放在 data-birth-path 属性中，通过 DOM 与 textContent 构建面板；仅固定本地图标 SVG 使用 innerHTML。浏览器按 kind 选图标和行为，不解析中文前缀或按换行拆步骤，多行分类理由保留在原步骤。错误示范：不要靠“分类依据：”等展示文案或换行识别业务阶段；不要将 URL、锚文本、AI 理由等外部文字插入 innerHTML，也不要把无记录的时间或耗时作为路径事实展示。

site.ts 从本轮报告公开白名单汇总同词的全部发现入口：Trends 根词、Rising 时间窗口/类目、网页新增链接及锚文本、其他线索与关键词研究。最终筛选结果覆盖曲线和分类时不覆盖来源集合。浮窗继续显示七天曲线实际状态、参考词、普通/精确搜索查询和 AI 分类状态及依据，再进入本轮词表；不展示搜索正文、堆栈、密钥或费用。此路径指本项目如何发现该词，不声称是词语在互联网上的首次出现。旧报告缺项明确显示未记录，不据已有曲线猜测通过，不回查收费接口。

离线重新发布：`pnpm site report.json site`；只更新 HTML，不修改报告、重跑发现或发通知。site.test.ts 覆盖多来源合并、提示转义、状态准确性和私密字段排除。

## 超限二级候选

trends.second_level.deferred 通过公开候选白名单展示为独立的“二级候选 · 超限未查询”表格，包含词语、全局优先级和 Rising 增长（旧报告显示未记录）、根词/一级/二级来源路径及未查询状态，支持搜索。未通过研究的候选不进入当天新词和旧词，也不伪造曲线或 AI 结果。

日报表格列顺序：序号 → Google Trends 近七天曲线 → 词语 → 发现时间 → 趋势分类 → AI 分类 → 一句话解释；曲线紧邻词语左侧，新词与旧词保持一致。

排序说明只在报告 second_level.sorting_strategy=rising-v1 时宣称统一 Rising 排序；无标识或未知策略的报告显示“未记录排序策略”，不推断旧报告曾执行新排序。增长值为 null 或旧报告无优先级时显示“未记录”，有效 0 保留 0%。

词语旁的独立复制图标覆盖新词、旧词和超限候选，使用浏览器 Clipboard API 复制原词；成功/失败均显示短暂反馈，并通过 role=status 告知辅助技术。复制与路径按钮独立，搜索只读取 term-text 及解释，不包含反馈文案。

## 超限二级候选的手动趋势链接

“二级候选 · 超限未查询”区域包含紧凑的分组链接板块，仅使用 second_level.deferred，按原顺序去重，每四词加参考词生成 Google Trends 最近七天（date=now 7-d）比较链接；不足四词也成组，不包含已查询的 discovered。参考词优先取本轮 Trends 候选保存的 benchmark，旧报告未记录时沿用 hex picker。生成链接不请求收费接口、不触发后续研究。曲线链接不携带来源类目，避免参考词被分类过滤。

页面通过 meta referrer=no-referrer 设置全局来源策略，所有外部锚点同时设置 rel="noopener noreferrer" 和 referrerpolicy="no-referrer"，新窗口不共享 opener 且不发送来源页面地址。这只隐藏 Referer，不隐藏用户 IP 或目标站已有 Cookie。链接参数用 URLSearchParams 编码、显示文字按既有 HTML 转义。site-path 测试覆盖九词 4/4/1 分组、已查询排除、参考词去重、特殊字符、分类缺省和全外链来源策略。

公开页白名单接受 collection_status 的计数和批次号；仅在上涨词采集不完整时显示短提示，不公开原始请求、错误和费用。
