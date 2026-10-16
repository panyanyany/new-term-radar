import { t, known, unique, type Data, type Config } from "./core.js";
import * as judge from "./judge.js";
import { degraded } from "./usecases.js";
export const KINDS = [
  "x",
  "hf",
  "breakout",
  "sitemap",
  "newsite",
  "usecase",
  "cosearch",
  "watch",
];
export const cell = (s: string) => s.replaceAll("|", "/").replaceAll("\n", " ");
const score = (r: Data) =>
  r.named != null ? Number(r.named).toFixed(2) : t("dash");
const state = (b: Data, ok: string) =>
  b.error || (b.skipped ? t("skipped") : ok);
const cost = (...blocks: Data[]) =>
  "$" +
  (blocks.reduce((s, b) => s + Number(b.cost_micros ?? 0), 0) / 1e6).toFixed(3);
// 多信号合并后优先展示名称，未评分项仍保留。
export async function leads(
  cfg: Config,
  blocks: Record<string, Data>,
): Promise<[Data[], Data]> {
  const out: Record<string, Data> = {};
  for (const [kind, b] of Object.entries(blocks))
    for (const r of b.terms ?? []) {
      const row = (out[r.term] ??= {
        term: r.term,
        kinds: [],
        signals: [],
        examples: [],
        variants: [],
        posts: [],
      });
      row.kinds.push(kind);
      row.signals.push(
        r.note ||
          t("note_surge", {
            label: t("kind_" + kind),
            n: r.recent,
            lift: r.lift,
          }),
      );
      row.examples.push(...(r.examples ?? []));
      row.posts.push(...(r.posts ?? []));
      row.variants = unique([...row.variants, ...(r.variants ?? [])]);
      if (r.repo) row.repo = r.repo;
    }
  const rows = Object.values(out);
  for (const r of rows) r.known = known(cfg, r.term);
  const status = rows.length
      ? await judge.score(rows, cfg.judge.model)
      : { judged: 0 },
    cut = cfg.judge.min_score;
  rows.sort(
    (a, b) =>
      Number((b.named ?? 0) >= cut) - Number((a.named ?? 0) >= cut) ||
      b.kinds.length - a.kinds.length ||
      Math.min(...a.kinds.map((k: string) => KINDS.indexOf(k))) -
        Math.min(...b.kinds.map((k: string) => KINDS.indexOf(k))) ||
      (b.named ?? 0) - (a.named ?? 0),
  );
  return [rows, status];
}
export const named = (cfg: Config, lead: Data[]) =>
  lead.filter((r) => (r.named ?? 1) >= cfg.judge.min_score);
export const toRecord = (cfg: Config, lead: Data[]) =>
  named(cfg, lead)
    .slice(0, 20)
    .filter((r) => !r.known);
export function usecaseLeads(uc: Data): Data[] {
  return [
    ...(uc.rows ?? [])
      .filter((r: Data) => r.kind === "generic")
      .map((r: Data) => ({
        term: r.phrase,
        kinds: ["usecase"],
        variants: [r.phrase],
        signals: [
          t("note_usecase", {
            names: r.names.join(", "),
            volume: r.volume ?? 0,
          }),
        ],
      })),
    ...(uc.cosearch ?? []).map((r: Data) => ({
      term: r.term,
      kinds: ["cosearch"],
      variants: [r.term],
      signals: [t("note_cosearch", { name: r.with })],
    })),
  ];
}
export function keywordTable(cfg: Config, uc: Data): string[] {
  if (uc.skipped) return [];
  const lines = ["", t("uc_h"), ""];
  if (uc.error) return [...lines, uc.error];
  if (!uc.names?.length) return [...lines, t("uc_none")];
  const c = cfg.usecases;
  if (degraded(uc)) lines.push(t("uc_degraded"), "");
  lines.push(
    t("uc_intro", {
      names: uc.names.join(", "),
      proposed: uc.proposed,
      relevant: uc.relevant,
      kept: uc.kept,
      min: c.min_volume,
      month: uc.volume_month || "?",
    }),
    uc.bench_daily
      ? t("uc_bench", { bench: uc.benchmark, bench_daily: uc.bench_daily })
      : t("uc_bench_none", { bench: uc.benchmark }),
    "",
    t("uc_cols", { bench: uc.benchmark }),
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const r of uc.rows) {
    const generic = r.kind === "generic",
      none = r.no_data,
      peak =
        "peak_vs" in r
          ? `${r.peak_vs} vs ${Number(r.bench_level).toFixed(1)}`
          : t("dash");
    lines.push(
      `| **${r.phrase}**${r.source === "searched" ? " 🔎" : ""}${generic && r.brand ? " ⚠" : ""} | ${t(generic ? "uc_type_generic" : "uc_type_name")} | ${r.names.join(", ") || t("dash")} | ${none ? t("dash") : t(r.new ? "uc_yes" : "uc_no")} | ${r.per_day ?? t("dash")} | ${r.started || t("dash")} | ${peak} | ${none ? t("dash") : r.peak_day} | ${r.momentum != null ? "×" + Number(r.momentum).toFixed(1) : t("dash")} | ${none ? t("uc_now_none") : t("uc_now_" + r.now)}${r.trend_geo ? " (" + uc.geo + ")" : ""} | ${t("uc_" + r.decision)} |`,
    );
  }
  lines.push("", t("uc_rules", { min_daily: c.min_daily }));
  if (uc.rows.some((r: Data) => r.kind === "generic" && r.brand))
    lines.push(t("uc_brand_note"));
  if (uc.rows.some((r: Data) => r.trend_geo))
    lines.push(t("uc_geo_note", { geo: uc.geo }));
  if (uc.country_errors?.length)
    lines.push(t("uc_geo_err", { names: uc.country_errors.join("; ") }));
  if (uc.rows.some((r: Data) => r.source === "searched"))
    lines.push(t("uc_searched_note"));
  const said = uc.rows
    .filter(
      (r: Data) =>
        r.kind === "generic" && r.evidence && r.source !== "searched",
    )
    .map(
      (r: Data) =>
        `- **${r.phrase}** (${r.names.join(", ")}): “${cell(r.evidence)}”`,
    );
  if (said.length) lines.push("", t("uc_said_h"), ...said);
  if (Object.keys(uc.tails ?? {}).length)
    lines.push(
      "",
      t("uc_tails_h"),
      ...Object.entries(uc.tails).map(
        ([n, v]) => `- **${n}**: ${(v as string[]).slice(0, 10).join(", ")}`,
      ),
    );
  if (uc.cosearch?.length)
    lines.push(
      "",
      t("uc_cosearch_h") +
        " " +
        uc.cosearch
          .map((x: Data) =>
            t("uc_cosearch_item", { term: x.term, name: x.with }),
          )
          .join(", "),
    );
  if (uc.no_evidence?.length)
    lines.push("", t("uc_no_evidence", { names: uc.no_evidence.join(", ") }));
  if (uc.posts_error)
    lines.push("", t("uc_posts_err", { why: uc.posts_error }));
  if (uc.related_errors?.length)
    lines.push(
      "",
      t("uc_related_err", { names: uc.related_errors.join("; ") }),
    );
  else if (!uc.related) lines.push("", t("uc_related_off"));
  return lines;
}
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n),
    i = cut.lastIndexOf(" ");
  return (i > n / 2 ? cut.slice(0, i) : cut) + "…";
}
export function postsLines(rows: Data[]): string[] {
  const lines: string[] = [];
  for (const r of rows)
    for (const p of (r.posts ?? []).slice(0, 3)) {
      if (!lines.length) lines.push("", t("posts_h"), "");
      lines.push(
        `- **${r.term}** · @${p.account} ♥${p.likes}${p.url ? t("post_link", { url: p.url }) : ""}  \n  ${p.text}`,
      );
    }
  return lines;
}
export function sources(
  cfg: Config,
  lead: Data[],
  b: Record<string, Data>,
  extra: Record<string, Data>,
): string {
  const lines = [
      t("sources_title"),
      "",
      t("sources_cols"),
      "|---|---|---|---|---|",
    ],
    top = named(cfg, lead).slice(0, 20);
  for (const r of top)
    lines.push(
      `| **${r.term}** | ${r.signals.join("; ")} | ${score(r)} | ${r.known || t("none")} | ${cell(
        r.examples
          .slice(0, 2)
          .map((e: string) => clip(e, 60))
          .join("<br>"),
      )} |`,
    );
  lines.push(...postsLines(top), "");
  for (const [key, label] of [
    ["x", "st_x"],
    ["hf", "st_hf"],
  ])
    if (b[key].error) lines.push(t(label, { state: b[key].error }));
  for (const [key, label] of [
    ["judge", "st_judge"],
    ["record", "st_record"],
  ])
    if (extra[key]?.error) lines.push(t(label, { state: extra[key].error }));
  lines.push(t("cost", { cost: cost(b.x) }));
  return lines.join("\n") + "\n";
}
export function topicLines(
  cfg: Config,
  lead: Data[],
  b: Record<string, Data>,
  gsc: Data,
): string[] {
  const lines: string[] = [];
  for (const [name, pattern] of Object.entries(cfg.topics)) {
    const pat = new RegExp(pattern as string, "i"),
      hits = named(cfg, lead).filter((r) =>
        pat.test(r.term + " " + r.examples.slice(0, 2).join(" ")),
      ),
      repos = (b.breakout.repos ?? []).filter((r: Data) =>
        pat.test(r.repo + " " + r.description),
      ),
      queries = (gsc.queries ?? []).filter((q: Data) => pat.test(q.query));
    lines.push("", t("topic_h", { name }), "");
    if (!hits.length && !repos.length && !queries.length)
      lines.push(t("topic_none"));
    else
      lines.push(
        ...hits
          .slice(0, 10)
          .map((r) =>
            t("topic_lead", { term: r.term, signals: r.signals.join("; ") }),
          ),
        ...repos
          .slice(0, 8)
          .map((r: Data) =>
            t("topic_repo", { ...r, desc: r.description.slice(0, 60) }),
          ),
        ...queries.slice(0, 8).map((q: Data) => t("topic_query", q)),
      );
  }
  return lines;
}
export function daily(
  cfg: Config,
  lead: Data[],
  b: Record<string, Data>,
  gsc: Data,
  rev: Data,
  summ: Data,
  extra: Record<string, Data>,
): string {
  const lines = [
      t("title"),
      ...keywordTable(cfg, extra.usecases ?? { skipped: true }),
      "",
      t("leads_h"),
      "",
      t("leads_cols"),
      "|---|---|---|---|---|---|",
    ],
    ns = named(cfg, lead);
  for (const r of ns.slice(0, 20))
    lines.push(
      `| **${r.term}** | ${r.signals.join("; ")} | ${score(r)} | ${r.known || t("none")} | ${r.variants.slice(1).join(", ") || t("dash")} | ${cell(
        r.examples
          .slice(0, 2)
          .map((e: string) => e.slice(0, 50))
          .join(" / "),
      )} |`,
    );
  const rest = lead
    .filter((r) => !ns.includes(r))
    .slice(0, 15)
    .map((r) => r.term);
  if (rest.length) lines.push("", t("other_terms") + rest.join(", "));
  lines.push(...topicLines(cfg, lead, b, gsc));
  const recent = extra.recent_sources ?? { skipped: true };
  if (!recent.skipped) {
    lines.push("", t("recent_h"), "");
    if (recent.rows?.length)
      lines.push(...recent.rows.map((r: Data) => `- **${r.term}**: ${r.note}`));
    else
      lines.push(t("recent_none", { why: recent.error || t("no_new_names") }));
  }
  const bo = b.breakout;
  lines.push("", t("breakout_h", { days: cfg.breakout.window_days }), "");
  if (!bo.repos?.length)
    lines.push(t("recent_none", { why: state(bo, t("no_breakouts")) }));
  else {
    lines.push(t("breakout_cols"), "|---|---|---|---|---|---|");
    for (const r of bo.repos)
      lines.push(
        `| ${r.new ? "🆕 " : ""}[${r.repo}](https://github.com/${r.repo}) | ${r.stars} | ${r.velocity} | ${r.delta != null ? "+" + r.delta : t("dash")} | ${Number(r.age_days).toFixed(1)} | ${cell(r.description.slice(0, 60))} |`,
      );
  }
  const site = b.newsite ?? { skipped: true };
  if (!site.skipped) {
    const c = cfg.new_sites;
    lines.push(
      "",
      t("newsite_h", {
        days: c.window_days,
        etv: c.min_etv,
        kw: c.min_keywords,
      }),
      "",
    );
    if (!site.sites?.length)
      lines.push(t("recent_none", { why: site.error || t("newsite_none") }));
    else {
      lines.push(t("newsite_cols"), "|---|---|---|---|---|");
      for (const r of site.sites)
        lines.push(
          `| ${r.new ? "🆕 " : ""}[${r.domain}](https://${r.domain}) | ${r.created} | ${r.first_seen} | ${r.etv} | ${r.keywords} |`,
        );
    }
  }
  if (!gsc.off) {
    lines.push("", t("gsc_h"), "");
    if (!gsc.queries?.length)
      lines.push(t("recent_none", { why: state(gsc, t("gsc_none")) }));
    else
      lines.push(
        t("gsc_intro", {
          window: gsc.window,
          total: gsc.total_new,
          min: gsc.min_impressions,
        }),
        "",
        t("gsc_cols"),
        "|---|---|---|---|",
        ...gsc.queries.map(
          (q: Data) =>
            `| ${cell(q.query)} | ${q.impressions} | ${q.clicks} | ${q.page} |`,
        ),
      );
  }
  const days = cfg.review.after_days;
  lines.push("", t("review_h", { days }), "");
  if (rev.checked?.length)
    lines.push(
      t("review_cols"),
      "|---|---|---|---|",
      ...rev.checked.map(
        (c: Data) =>
          `| ${c.term} | ${c.first_seen} | ${c.verdict} | ${c.lead_days ?? t("dash")} |`,
      ),
    );
  else
    lines.push(
      t("review_none", { why: state(rev, t("review_young", { days })) }),
    );
  if (Object.keys(summ.by_signal ?? {}).length) {
    lines.push(
      "",
      t("hit_intro", { days: summ.window_days, pending: summ.pending }),
      "",
      t("hit_cols"),
      "|---|---|---|---|---|",
    );
    for (const [k, s] of (
      Object.entries(summ.by_signal) as [string, Data][]
    ).sort(
      ([a], [b]) =>
        (KINDS.includes(a) ? KINDS.indexOf(a) : 99) -
        (KINDS.includes(b) ? KINDS.indexOf(b) : 99),
    ))
      lines.push(
        `| ${KINDS.includes(k) ? t("kind_" + k) : k} | ${s.checked} | ${s.hit} | ${((100 * s.hit) / s.checked).toFixed(0)}% | ${s.median_lead ?? t("dash")} |`,
      );
  }
  lines.push("", t("status_h"), "");
  const x = b.x,
    hf = b.hf,
    sm = b.sitemap;
  if (!x.skipped)
    lines.push(
      t("st_x", {
        state: state(
          x,
          x.error ? "" : t("st_x_ok", x) + (x.first_run ? t("st_x_first") : ""),
        ),
      }),
    );
  if (!hf.skipped)
    lines.push(
      t("st_hf", {
        state: state(
          hf,
          hf.error
            ? ""
            : t("st_hf_ok", hf) + (hf.first_run ? t("st_first") : ""),
        ),
      }),
    );
  lines.push(
    t("st_breakout", {
      state: state(
        bo,
        bo.error || bo.skipped
          ? ""
          : t("st_breakout_ok", { n: bo.searched }) +
              (bo.first_run ? t("st_breakout_first") : ""),
      ),
    }),
  );
  for (const [site, s] of Object.entries(sm.sites ?? {}) as [string, Data][])
    lines.push(
      t("st_site", {
        site,
        state:
          s.error || (s.first_run ? t("st_site_first") : t("st_site_ok", s)),
      }),
    );
  if (sm.error) lines.push(t("st_sitemaps", { state: sm.error }));
  for (const [k, label] of [
    ["judge", "st_judge"],
    ["record", "st_record"],
  ])
    if (extra[k]?.error) lines.push(t(label, { state: extra[k].error }));
  lines.push(
    t("cost", { cost: cost(b.x, rev, b.newsite ?? {}, extra.usecases ?? {}) }),
  );
  return lines.join("\n") + "\n";
}
