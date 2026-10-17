import { t, type Config, type Data } from "./core.js";
import { degraded } from "./usecases.js";
// 关键词研究结果的展示，独立于日报编排。
export const cell = (s: string) => s.replaceAll("|", "/").replaceAll("\n", " ");
export function keywordTable(cfg: Config, uc: Data): string[] {
  if (uc.skipped) return [];
  const lines = ["", t("uc_h"), ""];
  if (uc.error) return [...lines, uc.error];
  if (!uc.names?.length) return [...lines, t("uc_none")];
  const c = cfg.usecases;
  if (degraded(uc)) lines.push(t("uc_degraded"), "");
  lines.push(
    t(uc.volume_source === "trends_estimate" ? "uc_intro_trends" : "uc_intro", {
      names: uc.names.join(", "),
      proposed: uc.proposed,
      relevant: uc.relevant,
      kept: uc.kept,
      min: c.min_volume,
      month: uc.volume_month || "?",
    }),
    uc.bench_daily
      ? t(
          uc.volume_source === "trends_estimate"
            ? "uc_bench_trends"
            : "uc_bench",
          { bench: uc.benchmark, bench_daily: uc.bench_daily },
        )
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
  const sources = Object.entries(uc.evidence_sources ?? {}).filter(
    ([, items]) => (items as Data[]).length,
  );
  if (sources.length)
    lines.push(
      "",
      t("uc_sources"),
      ...sources.map(
        ([name, items]) =>
          `- **${cell(name)}**: ${(items as Data[])
            .slice(0, 3)
            .map(
              (item) =>
                `[${cell(item.title ?? "source").replace(/[\[\]]/g, "")}](${encodeURI(item.url).replace(/\(/g, "%28").replace(/\)/g, "%29")})`,
            )
            .join(" · ")}`,
      ),
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
    lines.push(
      "",
      t(
        uc.evidence_provider === "google"
          ? "uc_no_web_evidence"
          : "uc_no_evidence",
        { names: uc.no_evidence.join(", ") },
      ),
    );
  if (uc.posts_error)
    lines.push(
      "",
      t(uc.evidence_provider === "google" ? "uc_google_err" : "uc_posts_err", {
        why: uc.posts_error,
      }),
    );
  if (uc.related_errors?.length)
    lines.push(
      "",
      t("uc_related_err", { names: uc.related_errors.join("; ") }),
    );
  else if (!uc.related) lines.push("", t("uc_related_off"));
  return lines;
}
