import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as aisa from "../src/aisa.js";
import * as scrappa from "../src/scrappa.js";
import {
  run,
  countrySeries,
  measure,
  fetchSeries,
  evidence,
} from "../src/usecases.js";
import {
  loadConfig,
  loadSnap,
  saveSnap,
  shift,
  type Point,
} from "../src/core.js";
let state: string;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "radar-pipeline-"));
  vi.stubEnv("GOANYAPI_API_KEY", "");
  vi.stubEnv("X_SEARCH_PROVIDER", "aisa");
  vi.stubEnv("KEYWORD_EVIDENCE_PROVIDER", "x");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(state, { recursive: true, force: true });
});
function setup() {
  vi.spyOn(aisa, "call").mockImplementation(async (calls) => {
    if (calls[0].call_id === "s")
      return [
        {
          s: {
            tweets: [
              {
                id: "1",
                createdAt: "2026-10-09T12:00:00Z",
                isReply: false,
                text: "Use Strata for image editing",
                likeCount: 200,
                author: { userName: "a" },
              },
            ],
          },
        },
        3000,
      ];
    throw new Error("Unexpected paid data tool: " + calls[0].tool);
  });
  vi.spyOn(aisa, "chat").mockImplementation(async (_model, system) =>
    system.startsWith("You help")
      ? '{"use_cases":[{"phrase":"image editor online","evidence":"image editing","brand":false}]}'
      : '[{"i":0,"score":0.95,"brand":false,"name":false}]',
  );
  return vi
    .spyOn(scrappa, "trendsMany")
    .mockImplementation(async (requests) => {
      const out: Record<string, Point[]> = {};
      for (const r of requests)
        out[r.call_id] = Array.from(
          { length: 91 },
          (_, i) =>
            [
              shift("2026-10-16", i - 90),
              ...r.keywords.map((_, j) => (j === 0 ? 40 : i < 60 ? 10 : 80)),
            ] as Point,
        );
      return [out, requests.length * 303];
    });
}
it("keyword pipeline batches Trends against hex picker without Google Ads requests", async () => {
  setup();
  const cfg = loadConfig("config.example.json"),
    r = await run(cfg, state, ["strata"], {}, "2026-10-16");
  expect(r.names).toEqual(["strata"]);
  expect(aisa.chat).toHaveBeenCalledWith(
    "deepseek-v4.1-flash",
    expect.any(String),
    expect.any(String),
    expect.any(Number),
  );
  expect(r.rows.map((r: any) => r.kind).sort()).toEqual(["generic", "name"]);
  expect(r.related).toBe(false);
  expect(r.country_errors).toEqual([]);
  expect(r.cost_micros).toBe(3303);
  expect(r.rows.every((r: any) => r.decision && r.per_day != null)).toBe(true);
  expect(loadSnap(state, "usecases")).toEqual({
    strata: { first: "2026-10-16", runs: 1 },
  });
  expect(aisa.call).toHaveBeenCalledWith([
    {
      call_id: "s",
      tool: "get_twitter_tweet_advanced_search",
      arguments: {
        query: '"strata" min_faves:50 -filter:replies since:2026-10-02',
        queryType: "Top",
      },
    },
  ]);
  expect(aisa.call).toHaveBeenCalledTimes(1);
  expect(scrappa.trendsMany).toHaveBeenCalledWith([
    {
      call_id: "b0",
      keywords: ["hex picker", "strata", "image editor online"],
      start: "2026-07-18",
      end: "2026-10-16",
    },
  ]);
  expect(r.bench_daily).toBe(2500);
  expect(
    r.rows.every((row: any) => row.per_day === 5000 && row.volume === 150000),
  ).toBe(true);
  expect(r.volume_source).toBe("trends_estimate");
});
it("manual keywords do not change read-twice state and failed paid analysis preserves it", async () => {
  const trends = setup();
  saveSnap(state, "usecases", { previous: { first: "2026-10-15", runs: 1 } });
  const before = readFileSync(join(state, "usecases.json.gz"));
  await run(
    loadConfig("config.example.json"),
    state,
    ["strata"],
    {},
    "2026-10-16",
    true,
  );
  expect(readFileSync(join(state, "usecases.json.gz"))).toEqual(before);
  trends.mockRejectedValueOnce(new Error("invalid Trends daily series"));
  await expect(
    run(loadConfig("config.example.json"), state, ["strata"], {}, "2026-10-16"),
  ).rejects.toThrow("invalid Trends");
  expect(readFileSync(join(state, "usecases.json.gz"))).toEqual(before);
});
it("empty country series falls back to worldwide shape without a geo label", () => {
  const rows = [{ phrase: "term", kind: "name" }],
    series = {
      term: {
        solo: Array.from(
          { length: 91 },
          (_, i) => [shift("2026-10-16", i - 90), i < 60 ? 0 : 100] as Point,
        ),
        pair: [],
      },
    };
  measure(rows, series, 300, "2026-10-16", { term: [["2026-10-01", 0]] });
  expect(rows[0]).toMatchObject({
    no_data: false,
    now: "rising",
    decision: "watch",
  });
  expect(rows[0]).not.toHaveProperty("trend_geo");
});

it("batches four targets per reference and maps each keyword column correctly", async () => {
  const mock = vi
    .spyOn(scrappa, "trendsMany")
    .mockImplementation(async (reqs) => [
      Object.fromEntries(
        reqs.map((r, i) => [
          r.call_id,
          [
            [
              "2026-10-10",
              i === 0 ? 20 : 50,
              ...(i === 0 ? [10, 20, 30, 40] : [25]),
            ],
          ],
        ]),
      ),
      reqs.length * 303,
    ]);
  const [series, cost] = await fetchSeries(
    ["a", "b", "c", "d", "e", "a", "hex picker"],
    "hex picker",
    "2026-10-16",
  );
  expect(mock.mock.calls[0][0].map((r) => r.keywords)).toEqual([
    ["hex picker", "a", "b", "c", "d"],
    ["hex picker", "e"],
  ]);
  expect(cost).toBe(606);
  expect(series.a.pair).toEqual([["2026-10-10", 10, 20]]);
  expect(series.e.pair).toEqual([["2026-10-10", 25, 50]]);
  expect(series["hex picker"].pair).toEqual([["2026-10-10", 20, 20]]);
  const rows = [{ phrase: "a" }, { phrase: "e" }];
  measure(rows, series, 300, "2026-10-16", {}, 2500);
  expect(rows.every((r: any) => r.per_day === 1250 && r.volume === 37500)).toBe(
    true,
  );
});
it("leaves size unknown when reference interest is zero or missing", () => {
  const rows = [{ phrase: "zero" }, { phrase: "missing" }];
  measure(
    rows,
    { zero: { solo: [["2026-10-10", 10]], pair: [["2026-10-10", 10, 0]] } },
    300,
    "2026-10-16",
    {},
    2500,
  );
  for (const row of rows) {
    expect(row).not.toHaveProperty("per_day");
    expect(row).not.toHaveProperty("volume");
  }
});

// 默认搜索路径不得暗中调用付费 X 搜索；标题、摘要、链接进入模型资料。
it("uses Google by default and retains source links through the pipeline", async () => {
  setup();
  vi.stubEnv("KEYWORD_EVIDENCE_PROVIDER", "");
  const google = vi.spyOn(scrappa, "googleSearch").mockResolvedValue([
    [
      {
        title: "Strata official",
        text: "Strata edits images online",
        url: "https://strata.test/docs",
        source: "google",
      },
    ],
    303,
  ]);
  const result = await run(
    loadConfig("config.example.json"),
    state,
    ["strata"],
    {},
    "2026-10-16",
    true,
  );
  expect(google).toHaveBeenCalledExactlyOnceWith("strata");
  expect(aisa.call).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    evidence_provider: "google",
    cost_micros: 606,
    evidence_sources: {
      strata: [{ title: "Strata official", url: "https://strata.test/docs" }],
    },
  });
  expect(vi.mocked(aisa.chat).mock.calls[0][2]).toContain(
    "https://strata.test/docs",
  );
  expect(vi.mocked(aisa.chat).mock.calls[1][2]).toContain(
    "Strata edits images online",
  );
});
it("Google failure preserves README without falling back to paid X", async () => {
  setup();
  vi.stubEnv("KEYWORD_EVIDENCE_PROVIDER", "");
  vi.spyOn(scrappa, "googleSearch").mockRejectedValue(
    Error("search unavailable"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: Buffer.from("Strata edits images").toString("base64"),
        }),
      ),
    ),
  );
  try {
    const [data, cost] = await evidence(
      ["strata"],
      { strata: "owner/strata" },
      "2026-10-16",
    );
    expect(data.strata).toMatchObject({
      pages: [],
      posts: [],
      readme: "Strata edits images",
      error: "Error: search unavailable",
    });
    expect(cost).toBe(0);
    expect(aisa.call).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
