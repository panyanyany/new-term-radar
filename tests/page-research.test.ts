import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { researchPages } from "../src/page-research.js";
import { loadConfig } from "../src/core.js";
import { collectTerms } from "../src/brief-report.js";
import { filterRootTrends } from "../src/trends-filter.js";
import { googleSearchResult } from "../src/scrappa.js";
import { chat } from "../src/aisa.js";
import { Store } from "../src/store.js";
import { discoveredAt } from "../src/term-observations.js";
vi.mock("../src/trends-filter.js", () => ({
  filterRootTrends: vi.fn(async (rows) => ({
    candidates: rows
      .filter((r: { term: string }) => !["steady", "pending"].includes(r.term))
      .map((row: { term: string }) => ({
        ...row,
        trend_filter: {
          status: "passed",
          reason: "low_baseline_then_rising",
          benchmark: "hex picker",
          curve: [
            [0, 0, 10],
            [3600000, 20, 10],
          ],
        },
      })),
    filtered: rows
      .filter((r: { term: string }) => ["steady", "pending"].includes(r.term))
      .map((row: { term: string }) => ({
        ...row,
        trend_filter: {
          status: row.term === "pending" ? "pending" : "excluded",
          reason: row.term === "pending" ? "curve_unavailable" : "all_zero",
        },
      })),
    cost_micros: 303,
  })),
}));
vi.mock("../src/scrappa.js", async (original) => ({
  ...(await original<typeof import("../src/scrappa.js")>()),
  googleSearchResult: vi.fn(async (term) => ({
    query: term,
    rawResults: [],
    costMicros: 303,
    evidence: [
      {
        title: term,
        text: "搜索资料",
        url: "https://example.test/info",
        source: "google",
      },
    ],
  })),
}));
vi.mock("../src/aisa.js", () => ({ chat: vi.fn() }));
const state = mkdtempSync(join(tmpdir(), "page-research-"));
afterEach(() => vi.clearAllMocks());
import { afterAll } from "vitest";
afterAll(() => rmSync(state, { recursive: true, force: true }));
it("网页词曲线不达标或待验证均拦截，赛事拦截，原始页面证据加入分类，重复词只查一次", async () => {
  vi.mocked(chat).mockImplementation(async (_model, _system, input) =>
    JSON.stringify(
      JSON.parse(input).map((r: { i: number; term: string }) => ({
        term: r.term,
        decision: r.term === "sports match" ? "rejected" : "confirmed",
        is_online_game: r.term !== "sports match",
        is_online_tool: false,
        is_offline_sports_event: r.term === "sports match",
        reason: "按证据判断",
        evidence_indices: [1],
      })),
    ),
  );
  const cfg = loadConfig("config.example.json");
  const result = await researchPages(cfg, state, {
    sites: { test: { new: 3 } },
    candidates: [
      {
        keyword: "Guess the player",
        url: "https://example.test/game",
        anchors: ["Guess the mystery footballer"],
        explanation: "猜球员游戏",
      },
      {
        keyword: "Guess the player",
        url: "https://example.test/game2",
        anchors: ["Play online"],
      },
      { keyword: "steady", url: "https://example.test/steady", anchors: [] },
      { keyword: "pending", url: "https://example.test/pending", anchors: [] },
      {
        keyword: "sports match",
        url: "https://example.test/match",
        anchors: ["Match live"],
      },
    ],
  });
  expect(filterRootTrends).toHaveBeenCalledTimes(1);
  expect(googleSearchResult).toHaveBeenCalledTimes(2);
  expect(result.candidates).toHaveLength(2);
  expect(result.curve_filtered).toHaveLength(2);
  expect(result.candidates[0]).toMatchObject({
    keyword: "Guess the player",
    url: "https://example.test/game",
    trend_filter: { reason: "low_baseline_then_rising" },
    classification: { is_online_game: true },
  });
  expect(result.classification_filtered[0]).toMatchObject({
    term: "sports match",
    classification: { is_offline_sports_event: true },
  });
  const input = JSON.parse(vi.mocked(chat).mock.calls[0][2]);
  expect(input[0].evidence[1]).toMatchObject({
    source: "page",
    url: "https://example.test/game",
  });
  expect(
    collectTerms([], { sitemap: { pages: result } }, {}).map((r) => r.term),
  ).toEqual(["Guess the player"]);
  const store = new Store(state);
  try {
    expect(discoveredAt(store, "sports match")).toBeTruthy();
  } finally {
    store.close();
  }
});
it("没有新增网页时不请求任何研究接口", async () => {
  await researchPages(loadConfig("config.example.json"), state, {
    sites: {},
    candidates: [],
  });
  expect(filterRootTrends).not.toHaveBeenCalled();
  expect(googleSearchResult).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
});
