#!/usr/bin/env node
import { loadPageBatch } from "./page-batches.js";
import { researchPages } from "./page-research.js";
import { screenReportTerms } from "./report-screening.js";
import { publishSite } from "./site.js";
import { rememberDiscoveries } from "./term-observations.js";
import { sourceFailure } from "./source-errors.js";
import { createBrief, briefReport } from "./brief-report.js";
import {
  withUsageRun,
  withUsageModule,
  currentUsage,
  usageSummary,
  usageLines,
} from "./usage.js";
import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadConfig,
  today,
  t,
  errorText,
  type Config,
  type Data,
} from "./core.js";
import { xNew, hfNew } from "./sources.js";
import { saveSecondLevelBatch } from "./trends-batches.js";
import { resumeRelated } from "./trends-related.js";
import { discoverRoots } from "./trends-roots.js";
import { breakouts } from "./breakout.js";
import { diff } from "./sitemaps.js";
import { newSites } from "./new-sites.js";
import { gscNew } from "./gsc.js";
import { review } from "./review.js";
import { Store } from "./store.js";
import * as usecases from "./usecases.js";
import * as report from "./report.js";
import { send } from "./notify.js";
export const SKIPPABLE = [
  "x",
  "hf",
  "breakout",
  "trends",
  "sitemaps",
  "newsites",
  "gsc",
  "review",
  "judge",
  "usecases",
];
// 单个信号失败只降级该部分，MCP 可传入捕获函数保持 stdout 纯净。
export async function run(
  fn: () => Data | Promise<Data>,
  skip = false,
  module?: string,
): Promise<Data> {
  if (skip) return { skipped: true };
  try {
    return await withUsageModule(module ?? "other", fn);
  } catch (e) {
    if (module === "trends" || module === "sitemaps") {
      sourceFailure(`${module}_run`, {}, e);
    }
    return {
      error: errorText(e),
      cost_micros: (e as Data)?.cost_micros ?? 0,
      model_unpriced_calls: (e as Data)?.model_unpriced_calls ?? 0,
    };
  }
}
export function keptLeads(state: string, days: number): Data {
  const db = new Store(state);
  try {
    return { leads: db.leads(days), hit_rates: db.summary() };
  } finally {
    db.close();
  }
}
async function keywordTableInner(
  cfg: Config,
  state: string,
  names: string[],
  repos: Record<string, string>,
): Promise<[Data, string]> {
  const uc = await usecases.run(
    cfg,
    state,
    names.filter((n) => n.trim()).map((n) => n.toLowerCase().trim()),
    Object.fromEntries(
      Object.entries(repos).map(([k, v]) => [k.toLowerCase(), v]),
    ),
    today(),
    true,
  );
  return [
    { ...uc, ...report.costSummary(uc), usage: currentUsage() },
    [...report.keywordTable(cfg, uc), ...report.costLines(uc)]
      .join("\n")
      .trim() + "\n",
  ];
}
// CLI 与 MCP 的独立关键词调用共用相同记账范围。
export async function keywordTable(
  ...args: Parameters<typeof keywordTableInner>
): Promise<[Data, string]> {
  return withUsageRun(args[1], "keywords", () =>
    withUsageModule("usecases", () => keywordTableInner(...args)),
  );
}
export async function main(
  argv = process.argv.slice(2),
  output: (s: string) => void = console.log,
): Promise<number> {
  if (argv[0] === "mcp") {
    await (await import("./mcp-server.js")).serve();
    return 0;
  }
  const p = new Command()
    .name("new-term-radar")
    .argument(
      "<command>",
      "daily | sources | keywords | leads | costs | replay-pages | resume-trends",
    )
    .argument("[names...]")
    .option(
      "--repo <mapping>",
      "NAME=OWNER/REPO",
      (v: string, a: string[]) => [...a, v],
      [],
    )
    .option("--batch <id>", "batch ID for replay-pages or resume-trends")
    .option("--days <days>", "lead window", "7")
    .option(
      "--by <group>",
      "cost grouping: provider | module | model | endpoint | day",
      "provider",
    )
    .option("--json")
    .option("--config <file>", "configuration", "config.json")
    .option("--state <dir>", "persistent state", "state")
    .option("--out <file>")
    .option("--skip <signals>", "comma separated signals", "")
    .option(
      "--trends-provider <provider>",
      "Rising provider: dataforseo | aisa",
    )
    .option("--new-sites")
    .option("--mail")
    .exitOverride();
  p.parse(argv, { from: "user" });
  const [command, ...rest] = p.args,
    args = p.opts(),
    names = rest,
    skip = new Set<string>(args.skip.split(",").filter(Boolean));
  if (
    ![
      "daily",
      "sources",
      "keywords",
      "leads",
      "costs",
      "replay-pages",
      "resume-trends",
    ].includes(command)
  )
    throw new Error("unknown command");
  if ([...skip].some((s) => !SKIPPABLE.includes(s)))
    throw new Error("--skip: unknown signal");
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < 0)
    throw new Error("--days must be a non-negative integer");
  if (command === "costs") {
    const stats = usageSummary(
      args.state,
      p.getOptionValueSource("days") === "cli" ? days : 30,
      args.by,
    );
    output(
      args.json ? JSON.stringify(stats, null, 2) : usageLines(stats).join("\n"),
    );
    return 0;
  }
  if (command === "leads") {
    const d = keptLeads(args.state, days);
    if (args.json) output(JSON.stringify(d, null, 1));
    else {
      for (const r of d.leads)
        output(
          `${r.first_seen}  ${r.term}  [${r.signals.join(", ")}]${r.verdict ? " · " + r.verdict + (r.days_ahead != null ? ` (${r.days_ahead} days ahead)` : "") : ""}  ${r.note}`,
        );
      for (const [k, s] of Object.entries(d.hit_rates.by_signal) as [
        string,
        Data,
      ][])
        output(`hit rate ${k}: ${s.hit}/${s.checked}`);
      output(
        `${d.leads.length} leads in the last ${days} days; ${d.hit_rates.pending} awaiting review`,
      );
    }
    return 0;
  }
  if (command === "keywords" && !names.length)
    throw new Error("keywords: give at least one name");
  if (command === "replay-pages" && !args.batch)
    throw new Error("replay-pages: --batch is required");
  if (command === "resume-trends" && !args.batch)
    throw new Error("resume-trends: --batch is required");
  const cfg = loadConfig(args.config);
  if (args.trendsProvider) {
    if (!["dataforseo", "aisa"].includes(args.trendsProvider))
      throw new Error("--trends-provider: dataforseo | aisa");
    cfg.trends_roots.provider = args.trendsProvider;
  }
  if (skip.has("judge")) cfg.judge.model = "";
  mkdirSync(args.state, { recursive: true });
  return withUsageRun(args.state, command, async () => {
    if (command === "resume-trends") {
      const result = await withUsageModule("trends", () =>
        resumeRelated(args.state, args.batch, cfg),
      );
      const text = JSON.stringify(
        { ...result, usage: currentUsage() },
        null,
        2,
      );
      if (args.out) writeFileSync(args.out, text);
      output(text);
      return 0;
    }
    if (command === "replay-pages") {
      const pages = loadPageBatch(args.state, args.batch);
      const researched = await withUsageModule("sitemaps", () =>
        researchPages(cfg, args.state, pages),
      );
      const result = JSON.stringify(
        { ...researched, research_batch: args.batch, usage: currentUsage() },
        null,
        2,
      );
      if (args.out) writeFileSync(args.out, result);
      output(result);
      return 0;
    }
    if (command === "keywords") {
      const repos: Record<string, string> = {};
      for (const r of args.repo) {
        const i = r.indexOf("=");
        if (i < 1 || !r.slice(i + 1).includes("/"))
          throw new Error("--repo must be NAME=OWNER/REPO");
        repos[r.slice(0, i)] = r.slice(i + 1);
      }
      const [uc, text] = await keywordTable(cfg, args.state, names, repos),
        out = args.json ? JSON.stringify(uc, null, 1) : text;
      if (args.out) writeFileSync(args.out, out);
      output(out);
      return 0;
    }
    const blocks: Record<string, Data> = {
      x: await run(() => xNew(cfg, args.state), skip.has("x"), "x"),
      hf: await run(() => hfNew(cfg, args.state), skip.has("hf"), "hf"),
    };
    const daily = command === "daily";
    if (daily) {
      blocks.trends = await run(
        () =>
          discoverRoots(
            cfg,
            (rows) => {
              const observations = new Store(args.state);
              try {
                rememberDiscoveries(observations, rows);
              } finally {
                observations.close();
              }
            },
            (snapshot) => saveSecondLevelBatch(args.state, snapshot),
            args.state,
          ),
        skip.has("trends"),
        "trends",
      );
      blocks.breakout = await run(
        () => breakouts(cfg, args.state),
        skip.has("breakout"),
        "breakout",
      );
      blocks.sitemap = await run(
        () => diff(cfg, args.state),
        skip.has("sitemaps"),
        "sitemaps",
      );
      const weekday = (new Date().getDay() + 6) % 7;
      blocks.newsite = await run(
        () => newSites(cfg, args.state),
        skip.has("newsites") ||
          (!args.newSites && weekday !== cfg.new_sites.weekday),
        "newsites",
      );
    }
    const found = daily
        ? await run(() => gscNew(cfg), skip.has("gsc"))
        : { off: true },
      [lead, judged] = await withUsageModule("judge", () =>
        report.leads(cfg, blocks),
      ),
      db = new Store(args.state);
    try {
      const extra: Record<string, Data> = {
        judge: judged,
        record: await run(() => ({
          recorded: db.record(report.toRecord(cfg, lead)),
        })),
      };
      let text: string;
      if (daily) {
        // 历史线索仅供时间判断，不在跳过数据源时补充研究候选。
        extra.recent_sources = { skipped: true };
        const names = usecases.namesToRead(report.toRecord(cfg, lead), []),
          repos = Object.fromEntries(
            lead.filter((r) => r.repo).map((r) => [r.term, r.repo]),
          );
        extra.usecases = await run(
          () => usecases.run(cfg, args.state, names, repos),
          skip.has("usecases") || !cfg.usecases.per_day,
          "usecases",
        );
        const recorded = await run(() => ({
          recorded: db.record(report.usecaseLeads(extra.usecases)),
        }));
        if (recorded.error) extra.record = recorded;
        const rev = await run(
            () => review(cfg, db),
            skip.has("review"),
            "review",
          ),
          summ = await run(() => db.summary());
        const screened = await withUsageModule("candidates", () =>
          screenReportTerms(cfg, db, lead, blocks, extra.usecases),
        );
        blocks.candidate_screening = screened;
        const brief = await withUsageModule("report", () =>
          createBrief(cfg, db, screened.rows, args.out),
        );
        const generatedAt = new Date();
        text = briefReport(brief.rows, generatedAt, [
          ...Object.values(blocks),
          rev,
          judged,
          extra.usecases,
        ]);
        if (args.out) {
          const ext = extname(args.out);
          writeFileSync(
            args.out.slice(0, ext ? -ext.length : undefined) + ".json",
            JSON.stringify(
              {
                generated_at: generatedAt.toISOString(),
                brief_terms: brief.rows,
                brief_error: brief.error,
                leads: lead,
                ...blocks,
                gsc: found,
                review: rev,
                summary: summ,
                keywords: extra.usecases,
                judge: judged,
                usage: currentUsage(),
                ...report.costSummary(
                  ...Object.values(blocks),
                  rev,
                  judged,
                  extra.usecases,
                ),
              },
              null,
              1,
            ),
          );
        }
      } else {
        const errors = [...Object.values(blocks), ...Object.values(extra)].some(
          (b) => b.error,
        );
        if (!report.named(cfg, lead).length && !errors) {
          output(
            t("sources_quiet") +
              Object.entries(blocks)
                .map(([k, v]) => `${k} ${v.posts ?? v.models ?? t("dash")}`)
                .join("; ") +
              "\n" +
              report.costLines().join("\n"),
          );
          return 0;
        }
        text = report.sources(cfg, lead, blocks, extra);
      }
      if (args.out) {
        writeFileSync(args.out, text);
        // 仅本机显式启用发布；网站生成失败保留旧页面，并暴露异常。
        if (daily && process.env.RADAR_SITE_DIR) {
          const ext = extname(args.out);
          publishSite(
            args.out.slice(0, ext ? -ext.length : undefined) + ".json",
            process.env.RADAR_SITE_DIR,
          );
        }
      }
      output(text);
      if (args.mail)
        output(
          await send(
            `New-term radar${daily ? "" : " · sources"} ${today()}`,
            text,
          ),
        );
      return 0;
    } finally {
      db.close();
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((c) => {
      process.exitCode = c;
    })
    .catch((e) => {
      if (e.code === "commander.helpDisplayed") return;
      console.error(e instanceof Error ? e.stack : errorText(e));
      process.exitCode = 1;
    });
