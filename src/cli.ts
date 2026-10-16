#!/usr/bin/env node
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
): Promise<Data> {
  if (skip) return { skipped: true };
  try {
    return await fn();
  } catch (e) {
    return { error: errorText(e) };
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
export async function keywordTable(
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
  return [uc, report.keywordTable(cfg, uc).join("\n").trim() + "\n"];
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
    .argument("<command>", "daily | sources | keywords | leads")
    .argument("[names...]")
    .option(
      "--repo <mapping>",
      "NAME=OWNER/REPO",
      (v: string, a: string[]) => [...a, v],
      [],
    )
    .option("--days <days>", "lead window", "7")
    .option("--json")
    .option("--config <file>", "configuration", "config.json")
    .option("--state <dir>", "persistent state", "state")
    .option("--out <file>")
    .option("--skip <signals>", "comma separated signals", "")
    .option("--new-sites")
    .option("--mail")
    .exitOverride();
  p.parse(argv, { from: "user" });
  const [command, ...rest] = p.args,
    args = p.opts(),
    names = rest,
    skip = new Set<string>(args.skip.split(",").filter(Boolean));
  if (!["daily", "sources", "keywords", "leads"].includes(command))
    throw new Error("unknown command");
  if ([...skip].some((s) => !SKIPPABLE.includes(s)))
    throw new Error("--skip: unknown signal");
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < 0)
    throw new Error("--days must be a non-negative integer");
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
  const cfg = loadConfig(args.config);
  if (skip.has("judge")) cfg.judge.model = "";
  mkdirSync(args.state, { recursive: true });
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
    x: await run(() => xNew(cfg, args.state), skip.has("x")),
    hf: await run(() => hfNew(cfg, args.state), skip.has("hf")),
  };
  const daily = command === "daily";
  if (daily) {
    blocks.breakout = await run(
      () => breakouts(cfg, args.state),
      skip.has("breakout"),
    );
    blocks.sitemap = await run(
      () => diff(cfg, args.state),
      skip.has("sitemaps"),
    );
    const weekday = (new Date().getDay() + 6) % 7;
    blocks.newsite = await run(
      () => newSites(cfg, args.state),
      skip.has("newsites") ||
        (!args.newSites && weekday !== cfg.new_sites.weekday),
    );
  }
  const found = daily
      ? await run(() => gscNew(cfg), skip.has("gsc"))
      : { off: true },
    [lead, judged] = await report.leads(cfg, blocks),
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
      extra.recent_sources = await run(
        () => ({ rows: db.recentSources() }),
        !skip.has("x") || !skip.has("hf"),
      );
      const names = usecases.namesToRead(
          report.toRecord(cfg, lead),
          extra.recent_sources.rows ?? [],
        ),
        repos = Object.fromEntries(
          lead.filter((r) => r.repo).map((r) => [r.term, r.repo]),
        );
      extra.usecases = await run(
        () => usecases.run(cfg, args.state, names, repos),
        skip.has("usecases") || !cfg.usecases.per_day,
      );
      const recorded = await run(() => ({
        recorded: db.record(report.usecaseLeads(extra.usecases)),
      }));
      if (recorded.error) extra.record = recorded;
      const rev = await run(() => review(cfg, db), skip.has("review")),
        summ = await run(() => db.summary());
      text = report.daily(cfg, lead, blocks, found, rev, summ, extra);
      if (args.out) {
        const ext = extname(args.out);
        writeFileSync(
          args.out.slice(0, ext ? -ext.length : undefined) + ".json",
          JSON.stringify(
            {
              leads: lead,
              ...blocks,
              gsc: found,
              review: rev,
              summary: summ,
              keywords: extra.usecases,
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
              .join("; "),
        );
        return 0;
      }
      text = report.sources(cfg, lead, blocks, extra);
    }
    if (args.out) writeFileSync(args.out, text);
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
      console.error(errorText(e));
      process.exitCode = 1;
    });
