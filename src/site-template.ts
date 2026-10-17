// 单页只包含阅读和本地搜索，数据已在生成阶段转义，不使用 innerHTML。
export const siteStyle = `
:root { color-scheme:light; --paper:#f6f5ef; --ink:#202c26; --muted:#59645d; --line:#d4d9cf; --accent:#256b4a; --reference:#2563eb; --term:#dc2626; }
* { box-sizing:border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font:14px/1.55 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
a { color:inherit; text-underline-offset:3px; }
p { margin:0; }
.shell { max-width:1280px; padding:20px 24px; margin:auto; }
.masthead { display:flex; justify-content:space-between; align-items:center; gap:16px; border-bottom:1px solid var(--ink); padding-bottom:10px; }
.wordmark { display:flex; align-items:center; gap:8px; font-weight:650; letter-spacing:.04em; text-decoration:none; }
.mark { width:12px; height:12px; border:1px solid var(--accent); border-radius:50%; box-shadow:inset 0 0 0 2px var(--paper); background:var(--accent); }
.edition { color:var(--muted); font:11px/1.5 ui-monospace,monospace; letter-spacing:.08em; }
.intro { padding:18px 0 12px; display:flex; align-items:center; justify-content:space-between; gap:24px; }
h1 { font-size:24px; line-height:1.35; font-weight:650; margin:0 0 4px; }
.subtitle,.updated { color:var(--muted); font-size:12px; }
.updated { text-align:right; flex-shrink:0; }
.updated time { display:block; font-variant-numeric:tabular-nums; }
.chart-legend { display:flex; flex-wrap:wrap; gap:8px 16px; color:var(--muted); font-size:12px; padding-bottom:12px; }
.reference-key { color:var(--reference); }
.term-key { color:var(--term); }
.reference-key::before,.term-key::before { content:""; display:inline-block; width:18px; border-top:2px solid currentColor; vertical-align:middle; margin-right:6px; }
.tools { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
nav { display:flex; gap:20px; font-size:13px; }
nav a { text-decoration:none; }
nav a:hover { color:var(--accent); text-decoration:underline; }
.search { display:flex; align-items:center; gap:8px; width:340px; max-width:100%; }
.search label { font-size:12px; white-space:nowrap; }
input { min-width:0; width:100%; border:1px solid #a8b2a6; background:#fffefa; border-radius:3px; padding:6px 10px; color:var(--ink); font:inherit; font-size:13px; }
input:focus-visible,a:focus-visible,.table-wrap:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
section { padding-top:20px; scroll-margin-top:16px; }
.section-title { display:flex; justify-content:space-between; align-items:baseline; gap:12px; margin-bottom:8px; }
h2 { font-size:17px; font-weight:600; margin:0; }
.count { color:var(--accent); font:12px ui-monospace,monospace; margin-left:8px; }
.note { font-size:12px; color:var(--muted); }
.table-wrap { overflow-x:auto; }
table { width:100%; min-width:1060px; border-collapse:collapse; table-layout:fixed; text-align:left; }
thead { background:#eaece4; font-size:12px; color:#435147; }
th,td { padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:middle; overflow-wrap:anywhere; }
thead th { font-weight:550; padding-top:8px; padding-bottom:8px; }
.number-col { width:42px; }
.term-col { width:22%; }
.discovered-col { width:142px; }
.discovered-cell { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.trend-kind-col { width:104px; }
.trend-kind-cell { color:var(--muted); font-size:12px; }
.kind-col { width:88px; }
.kind-cell { color:var(--muted); font-size:12px; }
.trend-col { width:248px; }
.ordinal { color:var(--muted); font:11px ui-monospace,monospace; }
.term-name { font-size:14px; font-weight:600; }
.term-copy { display:inline-flex; vertical-align:middle; align-items:center; justify-content:center; position:relative; width:28px; height:28px; margin-left:4px; padding:5px; border:0; background:transparent; color:var(--muted); cursor:pointer; border-radius:4px; }
.term-copy:hover,.term-copy:focus-visible { color:var(--accent); background:#e7ece4; }
.term-copy:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
.term-copy svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.7; }
.term-copy[data-feedback]::after { content:attr(data-feedback); position:absolute; bottom:100%; left:0; padding:3px 6px; background:var(--ink); color:var(--paper); font-size:11px; font-weight:400; white-space:nowrap; border-radius:3px; pointer-events:none; }
.copy-status { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.explanation { font-size:13px; color:#435147; line-height:1.65; }
tbody tr:hover { background:#f0f1e9; }
.trend-cell { padding-top:3px; padding-bottom:3px; }
.chart-link { display:block; text-decoration:none; }
.trend-chart { display:block; width:218px; height:72px; max-width:100%; }
.trend-chart text { fill:var(--muted); font:9px system-ui,sans-serif; }
.chart-grid { fill:none; stroke:var(--line); stroke-width:.6; }
.reference-line,.term-line { fill:none; stroke-width:1.5; stroke-linejoin:round; stroke-linecap:round; }
.reference-line { stroke:var(--reference); }
.term-line { stroke:var(--term); }
.reference-name { display:block; color:var(--muted); font-size:10px; line-height:1.2; padding-left:26px; }
.no-curve { color:var(--muted); font-size:12px; }
.deferred-trends { margin:10px 0 14px; padding:10px 12px; border:1px solid var(--line); border-radius:4px; }
.deferred-trends h3 { margin:0 0 2px; font-size:13px; font-weight:600; }
.trend-groups { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr)); gap:6px 16px; margin-top:8px; }
.trend-group { display:flex; gap:8px; padding:6px 0; font-size:12px; line-height:1.5; text-decoration:none; overflow-wrap:anywhere; }
.trend-group:hover { color:var(--accent); text-decoration:underline; }
.group-number { flex-shrink:0; color:var(--accent); font:11px/1.65 ui-monospace,monospace; }
.empty { color:var(--muted); padding:12px 0; font-size:13px; }
footer { border-top:1px solid var(--ink); margin-top:24px; padding-top:12px; display:flex; justify-content:space-between; gap:16px; color:var(--muted); font-size:11px; }
[hidden] { display:none!important; }
@media(max-width:600px) { .shell { padding:14px 12px; } .intro { padding:14px 0 10px; display:block; } h1 { font-size:21px; } .updated { text-align:left; margin-top:8px; } .updated time { display:inline; margin-left:8px; } .tools { gap:10px; } .search { width:100%; } .section-title { display:block; } .note { display:block; margin-top:2px; } footer { display:block; } footer p+p { margin-top:4px; } }
`;

// 搜索只改变可见性；无脚本时仍可阅读完整日报。
export const siteScript = `
// 使用浏览器默认时区显示，底层 ISO 时间及 24 小时新旧划分保持不变。
const localTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const browserZone = localTime.resolvedOptions().timeZone;
for (const time of document.querySelectorAll('time[data-local-time]')) {
  time.textContent = localTime.format(new Date(time.dateTime));
  time.title = browserZone;
}
for (const heading of document.querySelectorAll('.discovered-col')) {
  heading.title = '浏览器当地时区：' + browserZone;
}
const search = document.getElementById('search');
search.addEventListener('input', () => {
  const query = search.value.normalize('NFKC').toLocaleLowerCase().trim();
  for (const section of document.querySelectorAll('section')) {
    let visible = 0;
    for (const row of section.querySelectorAll('tbody tr')) {
      const text = row.querySelector('.term-text').textContent + ' ' + row.querySelector('.explanation').textContent;
      row.hidden = !text.normalize('NFKC').toLocaleLowerCase().includes(query);
      if (!row.hidden) visible++;
    }
    section.querySelector('.count').textContent = String(visible).padStart(2, '0');
    const empty = section.querySelector('.empty');
    empty.hidden = visible > 0;
    empty.textContent = query ? '没有匹配的词语，请换个关键词。' : '本期暂无符合条件的词语。';
  }
});

// 使用标准剪贴板 API；失败明确反馈，不影响词语路径和搜索。
const copyTimers = new WeakMap();
for (const button of document.querySelectorAll('[data-copy-term]')) {
  button.addEventListener('click', async () => {
    let feedback;
    try { await navigator.clipboard.writeText(button.dataset.copyTerm); feedback = '已复制'; }
    catch { feedback = '复制失败'; }
    button.dataset.feedback = feedback;
    document.getElementById('copy-status').textContent = feedback + '：' + button.dataset.copyTerm;
    clearTimeout(copyTimers.get(button));
    copyTimers.set(button, setTimeout(() => { delete button.dataset.feedback; }, 1800));
  });
}
`;
