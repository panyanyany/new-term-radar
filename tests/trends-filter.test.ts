import { withResearchCache } from "../src/research-cache.js";
import noillirkFixture from "./fixtures/noillirk-hourly.json" with { type: "json" };
import perceptleReportFixture from "./fixtures/perceptle-report-hourly.json" with { type: "json" };
import perceptleFixture from "./fixtures/perceptle-hourly.json" with { type: "json" };
import { SourceTransportError } from "../src/source-errors.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  filterRootTrends,
  hourlySeries,
  lowBaselineRise,
  type HourPoint,
} from "../src/trends-filter.js";
import { callMany } from "../src/scrappa.js";
vi.mock("../src/scrappa.js", () => ({ callMany: vi.fn() }));
const now = Date.parse("2026-10-17T12:00:00Z");
const series = (value: (i: number) => number): HourPoint[] =>
  Array.from({ length: 168 }, (_, i) => [
    now - (168 - i) * 3600000,
    value(i),
    20,
  ]);
const body = (values: HourPoint[], names = ["hex picker", "new game"]) => ({
  timeline_data: values.map(([at, value, ref]) => ({
    timestamp: at / 1000,
    values: [
      { query: names[0], value: ref },
      { query: names[1], value },
    ],
  })),
});
beforeEach(() => vi.clearAllMocks());
describe("七天低基线上涨筛选", () => {
  it("保留连续24小时零且最近24小时继续上涨的词", () => {
    expect(
      lowBaselineRise(series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20))),
    ).toMatchObject({ status: "passed", recent_mean: 20, previous_mean: 5 });
  });
  it.each([
    [
      "开始已有热度",
      (i: number) => (i < 144 ? 5 : 20),
      "no_initial_24h_low_baseline",
    ],
    [
      "不足24小时零",
      (i: number) => (i < 23 ? 0 : 20),
      "no_initial_24h_low_baseline",
    ],
    ["全零", () => 0, "all_zero"],
    ["孤立尖峰", (i: number) => (i === 167 ? 20 : 0), "isolated_spike"],
    [
      "热度下降",
      (i: number) => (i < 120 ? 0 : i < 144 ? 20 : 5),
      "not_rising_recently",
    ],
    [
      "近期归零",
      (i: number) => (i < 120 || i >= 144 ? 0 : 20),
      "not_rising_recently",
    ],
  ])("排除%s", (_, value, reason) =>
    expect(lowBaselineRise(series(value))).toMatchObject({
      status: "excluded",
      reason,
    }),
  );
  it("参考词全零、断点和日粒度不能放行", () => {
    expect(
      lowBaselineRise(series(() => 20).map(([t, v]) => [t, v, 0])),
    ).toMatchObject({ status: "pending", reason: "invalid_benchmark" });
    expect(() =>
      hourlySeries(
        body(series(() => 0).filter((_, i) => i !== 80)),
        ["hex picker", "new game"],
        now,
      ),
    ).toThrow(/coverage/);
    expect(() =>
      hourlySeries(
        body(series(() => 0).filter((_, i) => i % 24 === 0)),
        ["hex picker", "new game"],
        now,
      ),
    ).toThrow(/coverage/);
  });
  it("忽略未完成点且拒绝错序、缺值和陈旧窗口", () => {
    const b = body(series((i) => (i < 120 ? 0 : 20)));
    b.timeline_data.push({
      ...b.timeline_data.at(-1)!,
      timestamp: now / 1000,
      is_partial: true,
    } as (typeof b.timeline_data)[number]);
    expect(hourlySeries(b, ["hex picker", "new game"], now)[0]).toHaveLength(
      168,
    );
    expect(() => hourlySeries(b, ["new game", "hex picker"], now)).toThrow(
      /order/,
    );
    expect(() =>
      hourlySeries(b, ["hex picker", "new game"], now + 86400000),
    ).toThrow(/coverage/);
  });
  it("四词一批带参考词，批失败待验证，只有通过者保留", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ term: `word${i}` }));
    const pts = series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20));
    vi.mocked(callMany)
      .mockResolvedValueOnce([
        [
          {
            timeline_data: pts.map(([at, v, ref]) => ({
              timestamp: at / 1000,
              values: [
                { query: "hex picker", value: ref },
                ...rows
                  .slice(0, 4)
                  .map((r, i) => ({ query: r.term, value: i === 0 ? v : 10 })),
              ],
            })),
          },
        ],
        303,
      ])
      .mockRejectedValueOnce(new SourceTransportError("HTTP 502"));
    const result = await filterRootTrends(rows, "hex picker", now);
    expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
      "word0",
    ]);
    expect(result.filtered).toHaveLength(4);
    expect(result.filtered.at(-1).trend_filter.status).toBe("pending");
    expect(callMany).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callMany).mock.calls[0][0][0][1]).toEqual({
      q: "hex picker,word0,word1,word2,word3",
      geo: "Worldwide",
      time_range: "7d",
    });
    expect(result.cost_micros).toBe(303);
  });
});
it("唯一超大曲线压零其他词时移除它，仅重查一次并累计费用", async () => {
  const rows = [{ term: "giant" }, { term: "small" }];
  const mixed = {
    timeline_data: series(() => 100).map(([at]) => ({
      timestamp: at / 1000,
      values: [
        { query: "hex picker", value: 0 },
        { query: "giant", value: 100 },
        { query: "small", value: 0 },
      ],
    })),
  };
  const recovered = body(
    series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20)),
    ["hex picker", "small"],
  );
  vi.mocked(callMany)
    .mockResolvedValueOnce([[mixed], 303])
    .mockResolvedValueOnce([[recovered], 303]);
  const result = await filterRootTrends(rows, "hex picker", now);
  expect(callMany).toHaveBeenCalledTimes(2);
  expect(vi.mocked(callMany).mock.calls[1][0][0][1].q).toBe("hex picker,small");
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "small",
  ]);
  expect(result.candidates[0].trend_filter.attempts).toHaveLength(2);
  expect(result.filtered[0].trend_filter.reason).toBe("dominates_comparison");
  expect(result.cost_micros).toBe(606);
});
it("全零、多个有热度的候选和有效参考词不触发额外付费重查", async () => {
  for (const values of [
    [0, 0, 0],
    [0, 100, 1],
    [1, 100, 0],
  ]) {
    vi.mocked(callMany).mockClear();
    vi.mocked(callMany).mockResolvedValue([
      [
        {
          timeline_data: series(() => 0).map(([at]) => ({
            timestamp: at / 1000,
            values: ["hex picker", "a", "b"].map((query, i) => ({
              query,
              value: values[i],
            })),
          })),
        },
      ],
      303,
    ]);
    await filterRootTrends([{ term: "a" }, { term: "b" }], "hex picker", now);
    expect(callMany).toHaveBeenCalledTimes(1);
  }
});
it("重查仍无有效参考词时保持待验证，不递归重查", async () => {
  const response = (names: string[], values: number[]) => ({
    timeline_data: series(() => 0).map(([at]) => ({
      timestamp: at / 1000,
      values: names.map((query, i) => ({ query, value: values[i] })),
    })),
  });
  vi.mocked(callMany)
    .mockResolvedValueOnce([
      [response(["hex picker", "a", "b"], [0, 100, 0])],
      303,
    ])
    .mockResolvedValueOnce([[response(["hex picker", "b"], [0, 100])], 303]);
  const result = await filterRootTrends(
    [{ term: "a" }, { term: "b" }],
    "hex picker",
    now,
  );
  expect(callMany).toHaveBeenCalledTimes(2);
  expect(result.candidates).toEqual([]);
  expect(
    result.filtered.map(
      (r: { trend_filter: { reason: string } }) => r.trend_filter.reason,
    ),
  ).toEqual(["dominates_comparison", "invalid_benchmark"]);
});
it("程序错误保留堆栈并抛出，不标成曲线待验证", async () => {
  const error = new TypeError("internal bug");
  vi.mocked(callMany).mockRejectedValueOnce(error);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      filterRootTrends([{ term: "a" }], "hex picker", now),
    ).rejects.toBe(error);
    expect(log.mock.calls[0][0]).toContain("internal bug");
    expect(log.mock.calls[0][0]).toContain("stack");
  } finally {
    log.mockRestore();
  }
});

it("逗号候选保留待验证，其他词继续查询且不额外付费", async () => {
  vi.mocked(callMany).mockResolvedValueOnce([
    [body(series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20)))],
    303,
  ]);
  const result = await filterRootTrends(
    [{ term: "game, online" }, { term: "new game" }],
    "hex picker",
    now,
  );
  expect(result.filtered[0].trend_filter).toMatchObject({
    status: "pending",
    reason: "unsupported_comparison_keyword",
  });
  expect(result.candidates.map((r: { term: string }) => r.term)).toEqual([
    "new game",
  ]);
  expect(callMany).toHaveBeenCalledTimes(1);
  expect(vi.mocked(callMany).mock.calls[0][0][0][1].q).toBe(
    "hex picker,new game",
  );
  expect(result.cost_micros).toBe(303);
});
it("空曲线点作为上游异常保留待验证，费用不丢失", async () => {
  vi.mocked(callMany).mockResolvedValueOnce([[{ timeline_data: [null] }], 303]);
  const result = await filterRootTrends(
    [{ term: "new game" }],
    "hex picker",
    now,
  );
  expect(result.candidates).toEqual([]);
  expect(result.filtered[0].trend_filter.status).toBe("pending");
  expect(result.cost_micros).toBe(303);
});

it("perceptle 实际曲线允许起始一天一个热度 2 的噪声点", () => {
  const points: HourPoint[] = perceptleFixture.points.map(
    ([at, value, reference]) => [at, value, reference],
  );
  expect(lowBaselineRise(points)).toMatchObject({
    status: "passed",
    reason: "low_baseline_then_rising",
    baseline_nonzero_hours: 1,
    baseline_max: 2,
    noise_threshold: 10,
  });
});
it("低基线允许最多三个低值小时，超出数量或幅度均排除", () => {
  const build = (hours: number[], noise: number) =>
    series((i) =>
      hours.includes(i) ? noise : i < 120 ? 0 : i < 144 ? 20 : 100,
    );
  expect(lowBaselineRise(build([1, 9, 23], 10)).status).toBe("passed");
  expect(lowBaselineRise(build([1, 9, 22, 23], 1)).reason).toBe(
    "no_initial_24h_low_baseline",
  );
  expect(lowBaselineRise(build([1], 11)).reason).toBe(
    "no_initial_24h_low_baseline",
  );
});
it("早期噪声不计入持续上涨点数，防止单个后期尖峰通过", () => {
  const points = series((i) =>
    [1, 9, 23].includes(i) ? 1 : i === 167 ? 100 : 0,
  );
  expect(lowBaselineRise(points)).toMatchObject({
    status: "excluded",
    reason: "isolated_spike",
    significant_points: 1,
  });
});

// 保留实际双线数据，避免只用人工曲线而遗漏真实小时采样的边界。
it("最近实跑 perceptle 七天双线样本可通过低基线上涨筛选", () => {
  const points: HourPoint[] = perceptleReportFixture.points.map(
    ([at, value, reference]) => [at, value, reference],
  );
  expect(points).toHaveLength(168);
  expect(perceptleReportFixture.benchmark).toBe("hex picker");
  expect(lowBaselineRise(points)).toMatchObject({
    status: "passed",
    reason: "low_baseline_then_rising",
  });
});

it("noillirk 实测已有日常热度、最近两天爆发也应通过", () => {
  const points: HourPoint[] = noillirkFixture.points.map(
    ([at, value, reference]) => [at, value, reference],
  );
  expect(points).toHaveLength(168);
  expect(noillirkFixture.benchmark).toBe("hex picker");
  expect(lowBaselineRise(points)).toMatchObject({
    status: "passed",
    reason: "existing_baseline_then_breakout",
    trend_type: "existing_baseline_breakout",
  });
});
it("持续爆发允许高位持平，稳定曲线、渐涨、单点尖峰和已经回落仍排除", () => {
  expect(lowBaselineRise(series((i) => (i < 120 ? 10 : 30)))).toMatchObject({
    status: "passed",
    reason: "existing_baseline_then_breakout",
    trend_type: "existing_baseline_breakout",
    burst_hours: 24,
  });
  for (const points of [
    series(() => 10),
    series((i) => 10 + i * 0.3),
    series((i) => (i === 167 ? 100 : 1)),
    series((i) => (i < 120 ? 10 : i < 144 ? 100 : 10)),
    series((i) => (i < 120 ? 10 : 29)),
  ])
    expect(lowBaselineRise(points).status).toBe("excluded");
});

it("三天前爆发并维持高位也通过，基线不包含已起涨时段", () => {
  expect(lowBaselineRise(series((i) => (i < 96 ? 10 : 30)))).toMatchObject({
    status: "passed",
    trend_type: "existing_baseline_breakout",
    burst_window_hours: 72,
    historical_mean: 10,
    pre_burst_mean: 10,
    burst_threshold: 30,
  });
  for (const points of [
    series((i) => (i < 96 ? 10 : 29)),
    series((i) => (i < 96 ? 10 : i < 144 ? 30 : 10)),
    series((i) => (i === 167 ? 100 : 10)),
    series((i) => 10 + i * 0.3),
  ])
    expect(lowBaselineRise(points)).toMatchObject({
      status: "excluded",
      breakout_reason: "no_sustained_2d_or_3d_breakout",
    });
});

it("同轮跨来源复用曲线且只计一次费用，不覆盖来源证据，参考词与小时变更不复用", async () => {
  vi.mocked(callMany).mockImplementation(async (calls) => {
    const names = calls[0][1].q.split(",");
    return [
      [
        body(
          series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20)),
          names,
        ),
      ],
      303,
    ];
  });
  await withResearchCache(async () => {
    const first = await filterRootTrends(
      [{ term: "new game", origin: "root" }],
      "hex picker",
      now,
    );
    const next = await filterRootTrends(
      [
        {
          term: "new game",
          origin: "page",
          page_evidence: [{ title: "new game" }],
        },
      ],
      "hex picker",
      now,
    );
    expect(first.cost_micros).toBe(303);
    expect(next.cost_micros).toBe(0);
    expect(next.candidates[0]).toMatchObject({
      origin: "page",
      page_evidence: [{ title: "new game" }],
      trend_filter: { cache_hit: true },
    });
    expect(callMany).toHaveBeenCalledTimes(1);
    await filterRootTrends([{ term: "new game" }], "other benchmark", now);
    await filterRootTrends([{ term: "new game" }], "hex picker", now + 3600000);
    expect(callMany).toHaveBeenCalledTimes(3);
  });
  await filterRootTrends([{ term: "new game" }], "hex picker", now);
  expect(callMany).toHaveBeenCalledTimes(4);
});

it("曲线请求只比较词语和参考词，不继承 Rising 游戏类目", async () => {
  vi.mocked(callMany).mockResolvedValueOnce([
    [body(series((i) => (i < 120 ? 0 : i < 144 ? 5 : 20)))],
    303,
  ]);
  await filterRootTrends(
    [
      {
        term: "new game",
        appearances: [{ request: { category_code: 8 }, discovery_level: 2 }],
      },
    ],
    "hex picker",
    now,
  );
  expect(vi.mocked(callMany).mock.calls[0][0][0]).toEqual([
    "google-trends-interest",
    { q: "hex picker,new game", geo: "Worldwide", time_range: "7d" },
  ]);
});
