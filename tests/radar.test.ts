import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  setLang,
  STOP,
  loadConfig,
  loadSnap,
  saveSnap,
  type Data,
} from "../src/core.js";
import { Store } from "../src/store.js";
import { novelNames } from "../src/sources.js";
import { score, variants } from "../src/breakout.js";
import * as uc from "../src/usecases.js";
import * as aisa from "../src/aisa.js";
import { decode, timeline, trendsMany, userPosts } from "../src/scrappa.js";
import { parse as judgeParse } from "../src/judge.js";
import { freshQueries } from "../src/gsc.js";
import { nameTerms, keep } from "../src/new-sites.js";
import { locations, slugText, diff } from "../src/sitemaps.js";
import { html, recipients, send } from "../src/notify.js";
import { main, keywordTable, keptLeads } from "../src/cli.js";
import { summary } from "../scripts/notify-report.js";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "radar-test-"));
  setLang("en");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("network disabled in unit tests")),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});
const cfg = () => loadConfig("config.example.json");
it("loading a new config replaces custom stop words while keeping built-ins", () => {
  const file = join(dir, "config.json"),
    builtIn = [...STOP][0];
  try {
    writeFileSync(file, JSON.stringify({ stop_words: ["ExperimentOnly"] }));
    loadConfig(file);
    expect(STOP.has("experimentonly")).toBe(true);
    writeFileSync(file, JSON.stringify({ stop_words: [] }));
    loadConfig(file);
    expect(STOP.has("experimentonly")).toBe(false);
    expect(STOP.has(builtIn)).toBe(true);
  } finally {
    cfg();
  }
});
it("diff handles a 200,000 URL baseline and retains new-term counts", async () => {
  const c = cfg(),
    index = "https://example.test/sitemap.xml";
  c.pages = {}; // 此用例仅验证 sitemap，网页抓取另有独立测试。
  c.sitemaps = { large: { index, pause: 0 } };
  const old = Array.from(
    { length: 200000 },
    (_, i) => `https://example.test/archive/${i}`,
  );
  saveSnap(dir, "sitemaps/large", old);
  const added = ["one", "two", "three"].map(
    (p) => `https://example.test/NewSignal1/${p}`,
  );
  const current = [old[0], ...added];
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      `<urlset>${current.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
    ),
  );
  const result = await diff(c, dir);
  expect(result.sites.large).toMatchObject({
    urls: 4,
    new: 3,
    first_run: false,
  });
  expect(result.sites.large.error).toBeUndefined();
  expect(result.terms).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ term: "newsignal1", recent: 3 }),
    ]),
  );
  expect(loadSnap(dir, "sitemaps/large")).toEqual(current.sort());
}, 15000);
const post = (account: string, text: string, likes = 0, hours = 2) => ({
  account,
  text,
  likes,
  url: "",
  created: new Date(Date.parse("2026-10-03T12:00:00Z") - hours * 3600000),
});
it("X requires independent accounts or a popular unmistakable name, excludes retweets and vocabulary", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  expect(
    novelNames(
      [post("a", "Strata is fast"), post("b", "Tried Strata today")],
      {},
      now,
    ).map((r) => r.term),
  ).toEqual(["strata"]);
  expect(novelNames([post("a", "Qwen3.9 is fast", 500)], {}, now)[0].term).toBe(
    "qwen3.9",
  );
  expect(novelNames([post("a", "Strata is fast", 500)], {}, now)).toEqual([]);
  expect(novelNames([post("a", "Qwen3.9", 20)], {}, now)).toEqual([]);
  expect(
    novelNames([post("a", "Qwen3.9", 500)], { "qwen3.9": "2026-10-01" }, now),
  ).toEqual([]);
  expect(
    novelNames(
      [post("a", "RT @a: Qwen3.9", 500), post("b", "Qwen3.9", 500, 48)],
      {},
      now,
    ),
  ).toEqual([]);
  expect(
    novelNames(
      [post("a", "New: Alpha1 Beta2 Gamma3 Delta4 Eps5 Zeta6 models", 900)],
      {},
      now,
    ).length,
  ).toBeLessThanOrEqual(3);
});
it("GitHub uses velocity or snapshot delta and supplies owner variants", () => {
  const rows = score(
    [
      {
        full_name: "Niko1221/Strata",
        stargazers_count: 7734,
        created_at: "2026-09-24T12:00:00Z",
      },
      {
        full_name: "a/late",
        stargazers_count: 1500,
        created_at: "2026-09-20T12:00:00Z",
      },
    ],
    { "a/late": 900 },
    new Date("2026-10-03T12:00:00Z"),
  );
  expect(rows.map((r) => r.repo)).toEqual(["Niko1221/Strata", "a/late"]);
  expect(variants(rows[0], "Niko Test")).toEqual([
    "strata",
    "niko1221 strata",
    "niko strata",
  ]);
});
it("SQLite preserves original dates, notes, variants and verdict on subsequent reports", () => {
  let db = new Store(dir);
  db.record(
    [
      {
        term: "strata",
        kinds: ["x"],
        signals: ["first"],
        variants: ["strata"],
        named: 0.9,
      },
    ],
    "2026-09-01",
  );
  db.saveVerdict("strata", "hit", 3, { strata: { rose: true } }, "2026-09-15");
  db.close();
  db = new Store(dir);
  db.record(
    [
      {
        term: "strata",
        kinds: ["hf", "x"],
        signals: ["second"],
        variants: ["niko strata"],
      },
    ],
    "2026-10-01",
  );
  const row = db.leads(60, "2026-10-03")[0];
  expect(row).toMatchObject({
    first_seen: "2026-09-01",
    last_seen: "2026-10-01",
    signals: ["hf", "x"],
    name_score: 0.9,
    variants: ["strata", "niko strata"],
    verdict: "hit",
    days_ahead: 3,
  });
  expect(db.due("2026-10-03", 14, 5)).toEqual([]);
  expect(db.summary("2026-10-03").by_signal.x).toEqual({
    checked: 1,
    hit: 1,
    median_lead: 3,
  });
  db.record([{ term: "later", kinds: ["hf"], signals: ["new"] }], "2026-09-02");
  expect(db.due("2026-10-03", 14, 5)).toEqual([["later", "2026-09-02", []]]);
  db.close();
});
it("snapshots remain interoperable gzip JSON including nested sitemap directories", () => {
  writeFileSync(
    join(dir, "old.json.gz"),
    gzipSync(JSON.stringify({ 词: "2026-10-01" })),
  );
  expect(loadSnap(dir, "old")).toEqual({ 词: "2026-10-01" });
  saveSnap(dir, "sitemaps/test", ["https://example.com/中文"]);
  expect(
    JSON.parse(
      gunzipSync(readFileSync(join(dir, "sitemaps/test.json.gz"))).toString(),
    ),
  ).toEqual(["https://example.com/中文"]);
});
it("MCP decoding never mistakes errors or malformed content for empty results", () => {
  expect(decode({ structuredContent: { results: [] } })).toEqual({
    results: [],
  });
  expect(decode({ content: [{ type: "text", text: '{"a":1}' }] })).toEqual({
    a: 1,
  });
  for (const b of [
    { isError: true },
    { content: [{ type: "text", text: "nope" }] },
    { structuredContent: { error: "bad" } },
    { structuredContent: [] },
  ])
    expect(() => decode(b)).toThrow();
});
it("Trends validates common scale, partial days, daily gaps, baseline and keyword order", () => {
  const p = (d: string, values: Data[]) => ({
    timestamp: String(Date.parse(d + "T00:00:00Z") / 1000),
    values,
  });
  const rows = [
    p("2026-10-01", [
      { query: "a", value: 10 },
      { query: "b", value: 80 },
    ]),
    p("2026-10-02", [
      { query: "a", value: 20 },
      { query: "b", value: 100 },
    ]),
  ];
  expect(
    timeline({ timeline_data: rows }, ["a", "b"], "2026-10-01", "2026-10-02"),
  ).toEqual([
    ["2026-10-01", 10, 80],
    ["2026-10-02", 20, 100],
  ]);
  expect(() =>
    timeline({ timeline_data: rows }, ["b", "a"], "2026-10-01", "2026-10-02"),
  ).toThrow();
  expect(() =>
    timeline({ timeline_data: rows }, ["a", "b"], "2026-09-30", "2026-10-02"),
  ).toThrow("baseline");
  expect(() =>
    timeline(
      { timeline_data: [rows[0], p("2026-10-03", rows[1].values)] },
      ["a", "b"],
      "2026-10-01",
      "2026-10-03",
    ),
  ).toThrow("continuous");
  expect(
    timeline({ timeline_data: [] }, ["a"], "2026-10-01", "2026-10-02"),
  ).toEqual([]);
});
it("old review windows fail before paid transport", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    trendsMany([
      {
        call_id: "old",
        keywords: ["strata"],
        start: "2020-01-01",
        end: "2020-02-01",
      },
    ]),
  ).rejects.toThrow("90 days");
  expect(fetch).not.toHaveBeenCalled();
});
it("AIsa batches five calls, retains billed unsuccessful results and does not retry", async () => {
  vi.stubEnv("AISA_API_KEY", "test");
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        results: [
          {
            call_id: "a",
            successful: true,
            data: { ok: 1 },
            customer_cost_micros_usd: 12,
          },
          { call_id: "b", successful: false, customer_cost_micros_usd: 5 },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const [d, c] = await aisa.call([{ call_id: "a" }]);
  expect(d).toEqual({ a: { ok: 1 } });
  expect(c).toBe(17);
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockRejectedValue(new Error("offline"));
  await expect(aisa.call([{ call_id: "b" }])).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("keyword parsing, related tail separation and co-search only promote rising new names", () => {
  expect(
    uc.parse(
      '```json\n{"use_cases":[{"phrase":"AI Image Detector","evidence":"use it"},{"phrase":"strata editor"},{"phrase":"ai image detector"}]}\n```',
      "strata",
    ),
  ).toEqual([
    { phrase: "ai image detector", evidence: "use it", brand: false },
  ]);
  const [tails, cands] = uc.splitRelated("pdfcraft", {
    rising: ["pdf craft download", "new image editor", "gpt image 3"],
    top: ["gpt image 3", "old editor"],
  });
  expect(tails).toEqual(["pdf craft download"]);
  expect(cands[1].rising).toBe(true);
  expect(cands[2].rising).toBe(false);
  expect(
    uc.otherNames("pdfcraft", [
      ...cands.map((c) => ({ ...c, is_name: true, established: false })),
      {
        phrase: "premiere pro",
        rising: true,
        is_name: true,
        established: true,
      },
    ]),
  ).toEqual([
    { term: "new image editor", with: "pdfcraft" },
    { term: "gpt image 3", with: "pdfcraft" },
  ]);
});
it("new names precede due second readings, manual selection excludes sitemap fragments", () => {
  expect(
    uc.due(
      ["new", "old"],
      {
        old: { first: "2026-10-01", runs: 1 },
        absent: { first: "2026-10-01", runs: 1 },
        twice: { first: "2026-10-01", runs: 2 },
      },
      "2026-10-16",
      5,
      3,
    ),
  ).toEqual(["new", "old"]);
  expect(
    uc.namesToRead(
      [
        { term: "fragment", kinds: ["sitemap"] },
        { term: "low", kinds: ["hf"], named: 0.6 },
        { term: "new", kinds: ["x"], named: 0.9 },
      ],
      [
        { term: "new", kinds: ["x"] },
        { term: "other", kinds: ["hf"] },
      ],
    ),
  ).toEqual(["new", "other"]);
});
it("size calibration, volume anchors and decisions handle missing and tiny demand", () => {
  const points: [string, number, number][] = [
    ["2026-08-01", 20, 40],
    ["2026-08-02", 20, 40],
    ["2026-10-01", 40, 40],
  ];
  expect(
    uc.benchDaily([{ volume: 3000, month: "2026-08", _pair: points }]),
  ).toBe(200);
  expect(uc.ownPerDay(points, 3000, "2026-08", "2026-10-16")).toBe(133);
  expect(uc.decide({ no_data: true }, 1000, 300)).toBe("watch");
  expect(uc.decide({ now: "fading" }, 1000, 300)).toBe("skip");
  expect(uc.decide({ now: "flat" }, 1000, 300)).toBe("watch");
  expect(uc.decide({ now: "rising" }, 1000, 300)).toBe("prioritize");
});
it("judge and source adapters reject malformed data and aggregate search-console pages", () => {
  expect(
    judgeParse('[{"i":0,"score":0.9},{"i":1,"score":2},{"i":99,"score":1}]', 2),
  ).toEqual({ 0: 0.9 });
  expect(judgeParse("bad", 2)).toEqual({});
  expect(
    freshQueries(
      [
        { query: "new", page: "/a", impressions: 3, clicks: 1 },
        { query: "new", page: "/b", impressions: 4, clicks: 0 },
        { query: "old", page: "/a", impressions: 50, clicks: 0 },
      ],
      [{ query: "old" }],
    ),
  ).toEqual([{ query: "new", page: "/a", impressions: 7, clicks: 1 }]);
  expect(nameTerms("ai-hailuo.com")).toEqual(["hailuo"]);
  expect(keep({ metrics: { organic: { etv: 1001, count: 20 } } })).toBe(true);
  expect(keep({ metrics: { organic: { etv: 1000, count: 20 } } })).toBe(false);
  expect(
    locations(
      "<urlset><url><loc>https://e.com/a?x=1&amp;y=2</loc></url></urlset>",
    ),
  ).toEqual(["https://e.com/a?x=1&y=2"]);
  expect(slugText("https://e.com/a-new-model.html?q=1")).toContain(
    "a new model",
  );
});
it("mail recipients and tables preserve multilingual output without sending", async () => {
  expect(recipients('"a@example.com；<b@example.com>"')).toEqual([
    "a@example.com",
    "b@example.com",
  ]);
  expect(html("| 名称 | 值 |\n|---|---|\n| 测试 | 1 |")).toContain(
    "border-collapse:collapse",
  );
  vi.stubEnv("RADAR_EMAIL_TO", "");
  expect(await send("test", "test")).toContain("skipped");
  expect(
    summary("| **strata** | 名字 | — | 是 | 500 | 2026 | **优先** |"),
  ).toContain("500 次/天");
});
it("CLI runs daily fully offline, writes Markdown and JSON, and sources stays quiet", async () => {
  const conf = join(dir, "config.json");
  writeFileSync(conf, JSON.stringify({ lang: "zh-CN" }));
  const out = join(dir, "report.md"),
    lines: string[] = [];
  expect(
    await main(
      [
        "daily",
        "--config",
        conf,
        "--state",
        dir,
        "--skip",
        "x,hf,breakout,sitemaps,newsites,gsc,review,judge,usecases",
        "--out",
        out,
      ],
      (s) => lines.push(s),
    ),
  ).toBe(0);
  expect(existsSync(out)).toBe(true);
  expect(
    JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).keywords,
  ).toEqual({ skipped: true });
  expect(readFileSync(out, "utf8")).toContain("新词");
  const quiet = join(dir, "quiet.md");
  await main(
    [
      "sources",
      "--config",
      conf,
      "--state",
      dir,
      "--skip",
      "x,hf,judge",
      "--out",
      quiet,
    ],
    () => {},
  );
  expect(existsSync(quiet)).toBe(false);
  expect(keptLeads(dir, 7).leads).toEqual([]);
  await expect(main(["sources", "--skip", "typo"], () => {})).rejects.toThrow(
    "unknown",
  );
});

it("GoAnyAPI retries transport failures but not rejected API responses", async () => {
  const { call } = await import("../src/goanyapi.js");
  vi.stubEnv("GOANYAPI_API_KEY", "test");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "error", message: "invalid request" }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(call("google-trends", { q: "test" })).rejects.toThrow(
    "invalid request",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "ok", data: { costCredits: 6 } })),
    );
  expect(await call("google-trends", { q: "test" })).toEqual([
    { costCredits: 6 },
    6000,
  ]);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("notification channels remain independent and Telegram uses multipart attachment", async () => {
  const { main: notifyMain } = await import("../scripts/notify-report.js");
  const path = join(dir, "report.md");
  writeFileSync(path, "- 本次数据成本估算:$0.123(Scrappa 估算)");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "unit-test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "unit-test-chat");
  vi.stubEnv("FEISHU_GROUP_HOOK", "https://example.test/webhook");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"ok":false}'))
    .mockResolvedValueOnce(new Response('{"code":0}'));
  vi.stubGlobal("fetch", fetch);
  expect(await notifyMain([path])).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body).msg_type).toBe("text");
  fetch.mockReset().mockImplementation(async () => new Response('{"ok":true}'));
  expect(await notifyMain([path])).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1][1].body).toBeInstanceOf(FormData);
  expect(summary("- Data cost estimate this run: $0.123 (estimate)")).toContain(
    "$0.123",
  );
});

// 私聊与群聊分别验证实际消息和附件，避免群聊泄漏费用。
it.each(["123456", "-100123456", "@test_channel"])(
  "notification costs follow recipient %s",
  async (chat) => {
    const { main: notifyMain } = await import("../scripts/notify-report.js");
    const path = join(dir, "cost-report.md");
    writeFileSync(
      path,
      "业务内容\n- 本次总成本估算:$0.1234\n- 本次 AIsa 数据花费:$0.100\n- 费用估算不完整:1 次\n\n| 费用来源 | 请求数 |\n|---|---:|\n| aisa | 2 |\n已计价合计 $0.1234；未计价 1 次\n",
    );
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "unit-test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", chat);
    vi.stubEnv("FEISHU_GROUP_HOOK", "https://example.test/webhook");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetch = vi
      .fn()
      .mockImplementation(async () => new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetch);
    expect(await notifyMain([path])).toBe(0);
    const text = JSON.parse(fetch.mock.calls[0][1].body).text;
    const attachment = await fetch.mock.calls[1][1].body.get("document").text();
    const group = JSON.parse(fetch.mock.calls[2][1].body).content.text;
    expect(group).not.toMatch(/成本|费用|\$/);
    expect(attachment).toContain("业务内容");
    if (chat === "123456") {
      expect(text).toContain("$0.1234");
      expect(attachment).toContain("费用来源");
    } else {
      expect(text).not.toMatch(/成本|费用|\$/);
      expect(attachment).not.toMatch(/成本|费用|\$|aisa/);
    }
    expect(readFileSync(path, "utf8")).toContain("$0.1234");
  },
);
