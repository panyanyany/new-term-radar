import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as aisa from "../src/aisa.js";
import * as scrappa from "../src/scrappa.js";
import { run, countrySeries, measure } from "../src/usecases.js";
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
    return [
      {
        vol: {
          tasks: [
            {
              result: [
                {
                  keyword: "image editor online",
                  search_volume: 3000,
                  monthly_searches: [{ year: 2026, month: 8 }],
                },
              ],
            },
          ],
        },
      },
      90000,
    ];
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
              i < 60 ? 10 : 80,
              ...(r.keywords.length > 1 ? [40] : []),
            ] as Point,
        );
      return [out, requests.length * 303];
    });
}
it("full keyword pipeline requests Top search, volumes, solo and pair; optional source stays off", async () => {
  setup();
  const cfg = loadConfig("config.example.json"),
    r = await run(cfg, state, ["strata"], {}, "2026-10-16");
  expect(r.names).toEqual(["strata"]);
  expect(r.rows.map((r: any) => r.kind).sort()).toEqual(["generic", "name"]);
  expect(r.related).toBe(false);
  expect(r.country_errors).toEqual([]);
  expect(r.cost_micros).toBe(94212);
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
  expect(scrappa.trendsMany).toHaveBeenCalledWith(
    expect.arrayContaining([
      {
        call_id: "s0",
        keywords: ["strata"],
        start: "2026-07-18",
        end: "2026-10-16",
      },
      {
        call_id: "p0",
        keywords: ["strata", "gpts"],
        start: "2026-07-18",
        end: "2026-10-16",
      },
    ]),
  );
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
