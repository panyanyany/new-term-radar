import {
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import { renderTrendChart } from "./site-chart.js";
import { siteStyle, siteScript } from "./site-template.js";
import { SECOND_LEVEL_SORT } from "./trends-config.js";
import { tooltipStyle, tooltipScript } from "./site-tooltip.js";

// 分类只公开类型与判断依据，错误堆栈、原始搜索资料仍留在本机。
const publicClassification = z.object({
  status: z.enum(["classified", "pending"]).optional(),
  decision: z.enum(["confirmed", "rejected", "uncertain"]),
  is_online_game: z.boolean(),
  is_online_tool: z.boolean(),
  is_offline_sports_event: z.boolean().nullable().optional(),
  reason: z.string(),
});
// 诞生路径仅允许来源摘要及查询词，排除原始搜索正文、请求头、费用和异常。
const originFields = {
  appearances: z
    .array(
      z.object({
        root: z.string(),
        discovery_level: z.number().optional(),
        root_path: z.array(z.string()).optional(),
        request: z
          .object({
            time_range: z.string().optional(),
            date_from: z.string().optional(),
            date_to: z.string().optional(),
            category_code: z.number().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  site: z.string().optional(),
  url: z.string().optional(),
  anchors: z.array(z.string()).optional(),
  page_evidence: z.array(z.object({ url: z.string() })).optional(),
  search_response: z.object({ query: z.string() }).optional(),
  exact_search_response: z.object({ query: z.string() }).optional(),
};
// 两个来源复用相同公开白名单，不将取证正文、费用或错误诊断发布到网页。
const publicCandidate = z.object({
  term: z.string(),
  ...originFields,
  priority: z
    .object({
      rank: z.number(),
      breakout: z.boolean(),
      max_growth: z.number().nullable(),
    })
    .optional(),
  classification: publicClassification.optional(),
  trend_filter: z
    .object({
      status: z.enum(["passed", "pending", "excluded"]).optional(),
      curve: z.unknown().optional(),
      trend_type: z
        .enum(["low_baseline_rise", "existing_baseline_breakout"])
        .optional(),
      reason: z.string().optional(),
      benchmark: z.string().optional(),
    })
    .optional(),
});
const publicReport = z.object({
  generated_at: z.iso.datetime({ offset: true }).optional(),
  candidate_screening: z
    .object({ candidates: z.array(publicCandidate).default([]) })
    .optional(),
  trends: z
    .object({
      candidates: z.array(publicCandidate).default([]),
      second_level: z
        .object({
          deferred: z.array(publicCandidate).default([]),
          sorting_strategy: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  sitemap: z
    .object({
      pages: z
        .object({
          candidates: z
            .array(
              publicCandidate
                .omit({ term: true })
                .extend({ keyword: z.string() }),
            )
            .default([]),
        })
        .optional(),
    })
    .optional(),
  leads: z
    .array(
      z.object({ term: z.string(), kinds: z.array(z.string()).optional() }),
    )
    .optional(),
  keywords: z
    .object({
      rows: z
        .array(
          z.object({
            phrase: z.string().optional(),
            term: z.string().optional(),
            names: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  brief_terms: z.array(
    z.object({
      term: z.string().trim().min(1),
      explanation: z.string().optional(),
      first_seen_at: z.iso.datetime({ offset: true }),
    }),
  ),
});
type Term = z.infer<typeof publicReport>["brief_terms"][number] & {
  classification?: z.infer<typeof publicClassification>;
  trend_type?: "low_baseline_rise" | "existing_baseline_breakout";
  reason?: string;
  curve?: unknown;
  benchmark?: string;
  status?: "passed" | "pending" | "excluded";
  birth_path?: BirthStep[];
  search_response?: { query: string };
  exact_search_response?: { query: string };
};
interface BirthStep {
  kind:
    | "source"
    | "anchor"
    | "curve"
    | "search"
    | "exact"
    | "classification"
    | "reason";
  title: string;
  text: string;
  copy?: boolean;
  note?: string;
}
// 与发现记录一致的词键，只关联本轮已进入日报的词，不增加历史候选。
const termKey = (value: string) => value.trim().normalize("NFKC").toLowerCase();

// 外部词语与模型解释始终作为纯文本，禁止直接插入 HTML/Markdown。
function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
// 分类标签不参与筛选；旧报告没有分类时明确显示未分类。
function classificationLabel(value: Term["classification"]): string {
  if (!value) return "未分类";
  if (value.is_offline_sports_event === true) return "线下体育赛事";
  if (value.decision === "uncertain") return "待确认";
  if (value.is_online_game && value.is_online_tool) return "游戏 / 工具";
  if (value.is_online_game) return "线上游戏";
  if (value.is_online_tool) return "在线工具";
  return "其他";
}
// 老报告按既有通过原因兼容展示，趋势分类与 AI 产品类型相互独立。
function trendLabel(row: Term): string {
  if (
    row.trend_type === "existing_baseline_breakout" ||
    row.reason === "existing_baseline_then_breakout"
  )
    return "已有热度爆发";
  if (
    row.trend_type === "low_baseline_rise" ||
    row.reason === "low_baseline_then_rising"
  )
    return "低基线起量";
  return "未分类";
}
// 汇总同词的全部来源，最终研究结果覆盖分类与曲线时也不丢失发现入口。
function discoveryPaths(
  report: z.infer<typeof publicReport>,
): Map<string, Map<string, BirthStep>> {
  const paths = new Map<string, Map<string, BirthStep>>();
  const add = (
    term: string,
    text: string,
    kind: BirthStep["kind"] = "source",
    title = "发现入口",
    copy = false,
    note?: string,
  ) => {
    const key = termKey(term),
      items = paths.get(key) ?? new Map<string, BirthStep>();
    const step = { kind, title, text, copy, note };
    items.set(JSON.stringify(step), step);
    paths.set(key, items);
  };
  const source = (
    row: z.infer<typeof publicCandidate>,
    channel?: "rising" | "page",
  ) => {
    for (const appearance of row.appearances ?? []) {
      const request = appearance.request;
      const window =
        request?.time_range === "past_day"
          ? "近1天"
          : request?.time_range === "past_7_days"
            ? "近7天"
            : request?.date_from && request.date_to
              ? `${request.date_from} ～ ${request.date_to}`
              : "窗口未记录";
      add(
        row.term,
        `Google Trends → ${appearance.root_path ? appearance.root_path.map((term, i) => `${i === 0 ? "根词" : i === 1 ? "一级词" : "二级词"}「${term}」`).join(" → ") : `根词「${appearance.root}」`} → Related queries · Rising（${window}${request?.category_code !== undefined ? `，类目 ${request.category_code}` : ""}） → 候选词`,
      );
    }
    if (channel === "rising" && !row.appearances?.length)
      add(row.term, "Google Trends Rising → 候选词（根词/窗口未记录）");
    const urls = new Set([
      ...(row.url ? [row.url] : []),
      ...(row.page_evidence ?? []).map((e) => e.url),
    ]);
    for (const url of urls)
      add(
        row.term,
        url,
        "source",
        `网页新增链接${row.site ? `（${row.site}）` : ""}`,
        true,
        "提取候选词",
      );
    if (row.anchors?.length)
      add(
        row.term,
        row.anchors.join(" / ").slice(0, 240),
        "anchor",
        "原始锚文本",
      );
    if (channel === "page" && !urls.size)
      add(row.term, "网页新增链接 → 提取候选词（来源页未记录）");
  };
  for (const row of report.trends?.candidates ?? []) source(row, "rising");
  for (const row of report.sitemap?.pages?.candidates ?? [])
    source({ ...row, term: row.keyword }, "page");
  for (const row of report.candidate_screening?.candidates ?? []) source(row);
  for (const row of report.leads ?? [])
    add(
      row.term,
      `来源线索${row.kinds?.length ? `（${row.kinds.join("、")}）` : ""} → 候选词`,
    );
  for (const row of report.keywords?.rows ?? []) {
    const term = row.phrase ?? row.term;
    if (term)
      add(
        term,
        `关键词研究${row.names?.length ? `（${row.names.join("、")}）` : ""} → 提取候选词`,
      );
  }
  return paths;
}
// 仅根据已保存记录说明路径；曲线存在不等于通过，分类失败也不能标成已确认。
function birthPath(
  row: Term,
  paths: Map<string, Map<string, BirthStep>>,
): BirthStep[] {
  const steps: BirthStep[] = [
    ...(paths.get(termKey(row.term))?.values() ?? [
      { kind: "source" as const, title: "发现来源", text: "未记录" },
    ]),
  ];
  steps.push({
    kind: "curve",
    title: "近7天曲线",
    text:
      row.status === "passed"
        ? `通过 · ${trendLabel(row)}（参考词：${row.benchmark ?? "未记录"}）`
        : row.status === "excluded"
          ? "未通过"
          : row.status === "pending"
            ? "待验证"
            : "判定未记录",
  });
  if (row.search_response)
    steps.push({
      kind: "search",
      title: "Google 搜索",
      text: row.search_response.query,
      copy: true,
    });
  if (row.exact_search_response)
    steps.push({
      kind: "exact",
      title: "精确补查",
      text: row.exact_search_response.query,
      copy: true,
    });
  if (!row.search_response && !row.exact_search_response)
    steps.push({ kind: "search", title: "Google 搜索", text: "记录缺失" });
  steps.push({
    kind: "classification",
    title: "AI 分类",
    text: classificationLabel(row.classification),
  });
  if (row.classification?.reason)
    steps.push({
      kind: "reason",
      title: "分类依据",
      text: row.classification.reason,
    });
  return steps;
}

function section(
  id: string,
  title: string,
  note: string,
  rows: Term[],
): string {
  return `<section id="${id}" aria-labelledby="${id}-title">
  <div class="section-title"><h2 id="${id}-title">${title}<span class="count" aria-live="polite">${String(rows.length).padStart(2, "0")}</span></h2><span class="note">${note}</span></div>
  <div class="table-wrap" tabindex="0" role="region" aria-label="${title}表格，可横向滚动"><table>
  <thead><tr><th scope="col" class="number-col">#</th><th scope="col" class="trend-col">Google Trends · 近7天</th><th scope="col" class="term-col">词语</th><th scope="col" class="discovered-col">发现时间</th><th scope="col" class="trend-kind-col">趋势分类</th><th scope="col" class="kind-col">AI 分类</th><th scope="col">一句话解释</th></tr></thead>
  <tbody>${rows.map((row, i) => `<tr><td class="ordinal">${String(i + 1).padStart(2, "0")}</td><td class="trend-cell">${row.curve ? `<a class="chart-link" href="https://trends.google.com/trends/explore?date=now%207-d&amp;q=${encodeURIComponent([row.benchmark ?? "hex picker", row.term].join(","))}" target="_blank" rel="noopener noreferrer" aria-label="在 Google Trends 比较${escape(row.term)}与${escape(row.benchmark ?? "hex picker")}">${renderTrendChart(row.curve)}</a><span class="reference-name">参考词：${escape(row.benchmark ?? "hex picker")}</span>` : renderTrendChart(undefined)}</td><th scope="row" class="term-name"><button type="button" class="term-trigger" data-birth-path="${escape(JSON.stringify(row.birth_path ?? []))}">${escape(row.term)}</button></th><td class="discovered-cell"><time data-local-time datetime="${new Date(row.first_seen_at).toISOString()}">${new Date(row.first_seen_at).toISOString()}</time></td><td class="trend-kind-cell">${trendLabel(row)}</td><td class="kind-cell" title="${escape(row.classification?.reason ?? "尚无分类记录")}">${classificationLabel(row.classification)}</td><td class="explanation">${escape(row.explanation || "目前资料不足，具体含义待确认。")}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="empty"${rows.length ? " hidden" : ""}>本期暂无符合条件的词语。</p></section>`;
}
// 超限候选单独展示，不冒充通过曲线、分类或进入本轮词表。
function deferredSection(
  rows: z.infer<typeof publicCandidate>[],
  strategy?: string,
): string {
  if (!rows.length) return "";
  return `<section id="deferred" aria-labelledby="deferred-title"><div class="section-title"><h2 id="deferred-title">二级候选 · 超限未查询<span class="count">${rows.length}</span></h2><span class="note">${strategy === SECOND_LEVEL_SORT ? "统一按 Rising 信号排序，每轮仅研究前 10 个二级词" : "历史报告未记录排序策略"}；以下词未查询曲线、搜索或 AI 分类</span></div><div class="table-wrap" tabindex="0" role="region" aria-label="超限二级候选表格，可横向滚动"><table><thead><tr><th>优先级</th><th>词语</th><th>Rising 增长</th><th>发现路径</th><th>状态</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${row.priority?.rank ?? "—"}</td><th scope="row" class="term-name">${escape(row.term)}</th><td>${row.priority ? (row.priority.breakout ? "Breakout" : row.priority.max_growth === null ? "未记录" : `${row.priority.max_growth}%`) : "未记录"}</td><td class="explanation">${[...new Set((row.appearances ?? []).map((a) => (a.root_path ?? [a.root, row.term]).join(" → ")))].map(escape).join("<br>")}</td><td>超限未查询</td></tr>`).join("")}</tbody></table></div><p class="empty" hidden>无匹配候选。</p></section>`;
}
// 新旧词按报告时间划分，浏览时间不会改变已发布日报的分类。
export function renderSite(input: unknown, fallbackDate: Date): string {
  const report = publicReport.parse(input);
  const generated = report.generated_at
    ? new Date(report.generated_at)
    : fallbackDate;
  const iso = generated.toISOString();
  const cutoff = generated.getTime() - 86400000;
  const curves = new Map(
    [
      ...(report.sitemap?.pages?.candidates ?? []).map((row) => ({
        ...row,
        term: row.keyword,
      })),
      ...(report.trends?.candidates ?? []),
      ...(report.candidate_screening?.candidates ?? []),
    ].map((row) => [
      termKey(row.term),
      {
        ...row.trend_filter,
        classification: row.classification,
        search_response: row.search_response,
        exact_search_response: row.exact_search_response,
      },
    ]),
  );
  const paths = discoveryPaths(report);
  const rows: Term[] = report.brief_terms.map((row) => {
    const term = { ...row, ...curves.get(termKey(row.term)) };
    return { ...term, birth_path: birthPath(term, paths) };
  });
  const fresh = rows.filter((r) => Date.parse(r.first_seen_at) > cutoff);
  const old = rows.filter((r) => Date.parse(r.first_seen_at) <= cutoff);
  const updated = iso;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="description" content="新词雷达最新日报：当天新词、旧词与一句话解释。"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='%23256b4a'/%3E%3C/svg%3E"><title>新词雷达 · 最新日报</title><style>${siteStyle}
${tooltipStyle}</style></head>
<body><main class="shell">
<header class="masthead"><a class="wordmark" href="#" aria-label="新词雷达首页"><span class="mark" aria-hidden="true"></span>新词雷达</a><span class="edition">FIELD NOTES / DAILY</span></header>
<div class="intro"><div><h1>发现，值得留意的新词。</h1><p class="subtitle">当天新词与再次出现的旧词，每个词用一句话说明。</p></div><p class="updated">报告更新<time data-local-time datetime="${iso}">${updated}</time></p></div>
<p class="chart-legend"><span class="reference-key">蓝线：参考词</span><span class="term-key">红线：当前词</span><span>相对热度 · 参考词均值优先居中 · 曲线截至报告时间</span></p>
<div class="tools"><nav aria-label="日报分区"><a href="#fresh">当天新词 ↗</a><a href="#old">旧词 ↗</a></nav><div class="search"><label for="search">查找词语</label><input id="search" type="search" placeholder="输入词语或解释中的关键词" autocomplete="off"></div></div>
${section("fresh", "当天新词", "本项目首次发现未满 24 小时", fresh)}
${section("old", "旧词", "本轮再次出现，首次发现已满 24 小时", old)}
${deferredSection(report.trends?.second_level?.deferred ?? [], report.trends?.second_level?.sorting_strategy)}
<footer><p>仅展示本轮候选 · 新旧以本项目首次发现时间为准</p><p>最新一期日报</p></footer>
</main><script>${tooltipScript}
${siteScript}</script></body></html>`;
}
// 先完整生成再原子替换；失败保留旧页面，发布目录不包含原始报告。
export function publishSite(reportFile: string, outputDir: string): string {
  const html = renderSite(
    JSON.parse(readFileSync(reportFile, "utf8")),
    statSync(reportFile).mtime,
  );
  const dir = resolve(outputDir);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "index.html");
  const temporary = join(dir, `.index-${process.pid}.tmp`);
  try {
    writeFileSync(temporary, html, { mode: 0o644 });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return target;
}
