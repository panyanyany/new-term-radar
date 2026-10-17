import { describe, expect, it, vi } from "vitest";
import { discoverRoots, requestFor, risingRows } from "../src/trends-roots.js";

describe("根词 Rising 契约", () => {
  it("三天使用自定义 UTC 日期，其他窗口使用接口预设", () => {
    expect(requestFor("game", 3, "2026-10-17")).toMatchObject({
      date_from: "2026-10-14",
      date_to: "2026-10-17",
      category_code: 8,
    });
    expect(requestFor("game", 1).time_range).toBe("past_day");
    expect(requestFor("game", 7).time_range).toBe("past_7_days");
  });
  it("拒绝 top 和无标签数组，只返回原始 rising 词组", () => {
    const wrap = (data: unknown) => ({
      status_code: 20000,
      tasks_error: 0,
      tasks: [
        {
          status_code: 20000,
          result: [{ items: [{ type: "google_trends_queries_list", data }] }],
        },
      ],
    });
    expect(() => risingRows(wrap({ top: [{ query: "the game" }] }))).toThrow(
      /rising/,
    );
    expect(() => risingRows(wrap([{ query: "the game" }]))).toThrow(/rising/);
    expect(
      risingRows(
        wrap({
          top: [{ query: "top" }],
          rising: [{ query: "full query phrase", value: 150 }],
        }),
      ).rows,
    ).toEqual([{ query: "full query phrase", value: 150 }]);
  });
});

vi.mock("../src/candidate-kind.js", () => ({
  classifyCandidates: vi.fn(async (rows) => ({
    candidates: rows,
    filtered: [],
  })),
}));
// 模拟曲线筛选已通过，确认类目生效且没有额外的 game 子串过滤。
vi.mock("../src/trends-filter.js", () => ({
  filterRootTrends: vi.fn(async (rows) => ({
    candidates: rows,
    filtered: [],
    cost_micros: 0,
  })),
}));
vi.mock("../src/aisa.js", () => ({ key: () => "test", call: vi.fn() }));
vi.mock("../src/scrappa.js", async (original) => ({
  ...(await original<typeof import("../src/scrappa.js")>()),
  googleSearchResult: vi.fn(async () => ({
    evidence: [],
    rawResults: [],
    query: "test",
    costMicros: 303,
  })),
}));
vi.mock("../src/core.js", async (original) => ({
  ...(await original<typeof import("../src/core.js")>()),
  jsonFetch: vi.fn(async () => ({ results: [{ successful: true }] })),
}));
it("游戏类目 8 传给接口，所有原词进入搜索", async () => {
  const { call } = await import("../src/aisa.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const response = (root: string) => ({
    root_0_1: {
      status_code: 20000,
      tasks_error: 0,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              check_url: `https://trends.google.com/trends/explore?cat=8&q=${root}&date=now%201-d`,
              items: [
                {
                  type: "google_trends_queries_list",
                  data: {
                    rising: [
                      { query: "Football GAME" },
                      { query: "games" },
                      { query: "gameplay" },
                      { query: "moonshot" },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
  vi.mocked(call).mockResolvedValue([response("game"), 11000]);
  const result = await discoverRoots(cfg);
  expect(
    vi.mocked(call).mock.calls[0][0][0].arguments.body[0].category_code,
  ).toBe(8);
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "Football GAME",
    "games",
    "gameplay",
    "moonshot",
  ]);
  expect(googleSearchResult).toHaveBeenCalledTimes(8);
  expect(googleSearchResult).toHaveBeenCalledWith("Football GAME", "broad");
  expect(googleSearchResult).toHaveBeenCalledWith("moonshot", "broad");
});
it("未通过曲线筛选的候选不触发搜索", async () => {
  const { filterRootTrends } = await import("../src/trends-filter.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  vi.mocked(googleSearchResult).mockClear();
  vi.mocked(filterRootTrends).mockResolvedValueOnce({
    candidates: [],
    filtered: [{ term: "games", trend_filter: { status: "excluded" } }],
    cost_micros: 303,
  });
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const result = await discoverRoots(cfg);
  expect(result.candidates).toEqual([]);
  expect(result.filtered).toHaveLength(1);
  expect(googleSearchResult).not.toHaveBeenCalled();
  expect(result.cost_micros).toBe(11303);
});

it("分类未确认的词仍进入日报候选", async () => {
  const { classifyCandidates } = await import("../src/candidate-kind.js");
  const { loadConfig } = await import("../src/core.js");
  vi.mocked(classifyCandidates).mockResolvedValueOnce({
    candidates: [{ term: "games", classification: { status: "pending" } }],
    filtered: [],
  });
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const result = await discoverRoots(cfg);
  expect(result.candidates[0]).toMatchObject({
    term: "games",
    classification: { status: "pending" },
  });
  expect(result.classification_filtered).toEqual([]);
});

it("原词匹配则不补查，偏题仅补一次精确查询并保留原始响应", async () => {
  const { filterRootTrends } = await import("../src/trends-filter.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  vi.mocked(filterRootTrends).mockResolvedValueOnce({
    candidates: [{ term: "perceptle" }],
    filtered: [],
    cost_micros: 0,
  });
  vi.mocked(googleSearchResult).mockClear();
  vi.mocked(googleSearchResult).mockResolvedValueOnce({
    query: "perceptle",
    rawResults: [{ title: "Percept" }],
    evidence: [
      {
        title: "Percept",
        text: "artist",
        url: "https://example.test/artist",
        source: "google",
      },
    ],
    costMicros: 303,
  });
  vi.mocked(googleSearchResult).mockResolvedValueOnce({
    query: '"perceptle"',
    rawResults: [{ title: "Perceptle" }],
    evidence: [
      {
        title: "Perceptle",
        text: "daily game",
        url: "https://example.test/game",
        source: "google",
      },
    ],
    costMicros: 303,
  });
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  const result = await discoverRoots(cfg);
  expect(googleSearchResult).toHaveBeenNthCalledWith(1, "perceptle", "broad");
  expect(googleSearchResult).toHaveBeenNthCalledWith(2, "perceptle", "exact");
  expect(result.candidates[0].evidence[0].title).toBe("Perceptle");
  expect(result.candidates[0].search_response.organic_results[0].title).toBe(
    "Percept",
  );
  expect(result.candidates[0].exact_search_response.query).toBe('"perceptle"');
  vi.mocked(filterRootTrends).mockResolvedValueOnce({
    candidates: [{ term: "perceptle" }],
    filtered: [],
    cost_micros: 0,
  });
  vi.mocked(googleSearchResult).mockClear();
  vi.mocked(googleSearchResult).mockResolvedValueOnce({
    query: "perceptle",
    rawResults: [],
    evidence: [
      {
        title: "Play Perceptle",
        text: "game",
        url: "https://example.test/game",
        source: "google",
      },
    ],
    costMicros: 303,
  });
  expect((await discoverRoots(cfg)).candidates).toHaveLength(1);
  expect(googleSearchResult).toHaveBeenCalledTimes(1);
});

it("3 倍触发严格比较同一时间点，零参考和无效数据不触发", async () => {
  const { exceedsReference } = await import("../src/trends-roots.js");
  expect(exceedsReference([[1, 31, 10]])).toBe(true);
  expect(exceedsReference([[1, 30, 10]])).toBe(false);
  expect(exceedsReference([[1, 100, 0]])).toBe(false);
  expect(exceedsReference([[1, Infinity, 10]])).toBe(false);
  expect(
    exceedsReference([
      [1, 100, 50],
      [2, 2, 1],
    ]),
  ).toBe(false);
  expect(exceedsReference(undefined)).toBe(false);
});

it("一级通过全部门禁后扩展，最多十词、继承类目且不扩展三级", async () => {
  const { call } = await import("../src/aisa.js");
  const { filterRootTrends } = await import("../src/trends-filter.js");
  const { googleSearchResult } = await import("../src/scrappa.js");
  const { loadConfig } = await import("../src/core.js");
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [7], category_code: 8 };
  const response = (root: string, terms: string[]) => ({
    root_0_7: {
      status_code: 20000,
      tasks: [
        {
          status_code: 20000,
          result: [
            {
              check_url: `https://trends.google.com/trends/explore?cat=8&q=${encodeURIComponent(root)}&date=now%207-d`,
              items: [
                {
                  type: "google_trends_queries_list",
                  data: {
                    rising: terms.map((query, index) => ({
                      query,
                      value: 1000 - index,
                    })),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });
  vi.mocked(call).mockClear();
  vi.mocked(filterRootTrends).mockClear();
  vi.mocked(googleSearchResult).mockClear();
  vi.mocked(call).mockResolvedValueOnce([
    response("game", ["first", "other"]),
    100,
  ]);
  vi.mocked(call).mockResolvedValueOnce([
    response("first", [
      "second",
      "second",
      "first",
      "game",
      ...Array.from({ length: 14 }, (_, i) => `child${i}`),
    ]),
    200,
  ]);
  vi.mocked(call).mockResolvedValueOnce([response("other", []), 50]);
  vi.mocked(filterRootTrends).mockImplementationOnce(async (rows) => ({
    candidates: rows.map((row) => ({
      ...row,
      trend_filter: { status: "passed", curve: [[1, 40, 10]] },
    })),
    filtered: [],
    cost_micros: 10,
  }));
  vi.mocked(filterRootTrends).mockImplementationOnce(async (rows) => ({
    candidates: rows.map((row) => ({
      ...row,
      trend_filter: { status: "passed", curve: [[1, 90, 10]] },
    })),
    filtered: [],
    cost_micros: 20,
  }));
  const observed = vi.fn();
  const result = await discoverRoots(cfg, observed);
  expect(call).toHaveBeenCalledTimes(3);
  expect(vi.mocked(call).mock.calls[1][0][0].arguments.body[0]).toMatchObject({
    keywords: ["first"],
    category_code: 8,
    time_range: "past_7_days",
  });
  expect(filterRootTrends).toHaveBeenCalledTimes(2);
  expect(
    vi.mocked(filterRootTrends).mock.calls[1][0].map((row) => row.term),
  ).toEqual(["second", ...Array.from({ length: 9 }, (_, i) => `child${i}`)]);
  expect(result.candidates.map((row: { term: string }) => row.term)).toEqual([
    "first",
    "other",
    "second",
    ...Array.from({ length: 9 }, (_, i) => `child${i}`),
  ]);
  expect(result.candidates[2].appearances[0]).toMatchObject({
    discovery_level: 2,
    root_path: ["game", "first", "second"],
  });
  expect(
    observed.mock.calls[1][0].map((row: { term: string }) => row.term),
  ).toEqual(["second", ...Array.from({ length: 14 }, (_, i) => `child${i}`)]);
  expect(googleSearchResult).toHaveBeenCalledWith("second", "broad");
  expect(googleSearchResult).toHaveBeenCalledWith("first", "broad");
  expect(result.second_level.discovered).toHaveLength(10);
  expect(result.second_level.deferred).toHaveLength(5);
  expect(googleSearchResult).not.toHaveBeenCalledWith("child9", "broad");
  expect(result.cost_micros).toBe(380);
});

it("一级词被赛事门禁拦截后，即使超过三倍也不发起二级查询", async () => {
  const { call } = await import("../src/aisa.js");
  const { filterRootTrends } = await import("../src/trends-filter.js");
  const { classifyCandidates } = await import("../src/candidate-kind.js");
  const { loadConfig } = await import("../src/core.js");
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots = { roots: ["game"], windows: [1] };
  vi.mocked(call).mockClear();
  vi.mocked(filterRootTrends).mockImplementationOnce(async (rows) => ({
    candidates: rows.map((row) => ({
      ...row,
      trend_filter: { status: "passed", curve: [[1, 90, 10]] },
    })),
    filtered: [],
    cost_micros: 0,
  }));
  vi.mocked(classifyCandidates).mockImplementationOnce(async (rows) => ({
    candidates: [],
    filtered: rows.map((row) => ({
      ...row,
      classification: { is_offline_sports_event: true },
    })),
  }));
  const result = await discoverRoots(cfg);
  expect(call).toHaveBeenCalledTimes(1);
  expect(result.expansion).toEqual([]);
  expect(result.second_level.discovered).toEqual([]);
  expect(result.classification_filtered.length).toBeGreaterThan(0);
});

it("二级词全局排序：Breakout、最大增长、去重窗口及父词信号，结果稳定", async () => {
  const { rankSecondLevel } = await import("../src/trends-roots.js");
  const a = (root: string, growth: unknown, window = "past_day") => ({
    root,
    growth,
    request: { time_range: window },
  });
  const rows = [
    { term: "early low", appearances: [a("early", 100)] },
    { term: "late high", appearances: [a("late", "2,000%")] },
    { term: "breakout", appearances: [a("late", "Breakout")] },
    {
      term: "many windows",
      appearances: [a("a", 100), a("a", 100, "past_7_days")],
    },
    { term: "many parents", appearances: [a("a", 100), a("b", 100)] },
    { term: "duplicate appearance", appearances: [a("a", 100), a("a", 100)] },
    { term: "invalid", appearances: [a("a", "not available")] },
  ];
  const ranked = rankSecondLevel(rows);
  expect(ranked.map((r) => r.term)).toEqual([
    "breakout",
    "late high",
    "many windows",
    "many parents",
    "duplicate appearance",
    "early low",
    "invalid",
  ]);
  expect(ranked.map((r) => r.priority.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(
    ranked.find((r) => r.term === "duplicate appearance")?.priority
      .window_count,
  ).toBe(1);
  expect(rankSecondLevel([...rows].reverse()).map((r) => r.term)).toEqual(
    ranked.map((r) => r.term),
  );
});
