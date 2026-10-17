import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandSecondLevel,
  rankSecondLevel,
  type Candidate,
} from "../src/trends-expansion.js";
import { filterRootTrends } from "../src/trends-filter.js";
import { loadConfig, loadSnap } from "../src/core.js";
import { saveSecondLevelBatch } from "../src/trends-batches.js";
vi.mock("../src/trends-filter.js", () => ({ filterRootTrends: vi.fn() }));
afterEach(() => vi.resetAllMocks());
// 合格父词及其来源，不依赖真实接口或历史报告。
const parent = (term: string): Candidate => ({
  term,
  appearances: [
    {
      root: "game",
      request: { category_code: 8, time_range: "past_day" },
      discovery_level: 1,
    },
  ],
  trend_filter: { status: "passed", curve: [[1, 40, 10]] },
  classification: { is_offline_sports_event: false },
});
const child = (term: string, root: string, growth: unknown): Candidate => ({
  term,
  appearances: [
    { root, growth, request: { category_code: 8, time_range: "past_7_days" } },
  ],
});

it("后返回父词的高分候选挤入全局前十，反转父词顺序仍一致，超限不请求曲线", async () => {
  const cfg = loadConfig("config.example.json");
  const all = [parent("early"), parent("late")];
  const original = structuredClone(all);
  const query = vi.fn(async (_cfg, roots: string[]) => ({
    candidates:
      roots[0] === "early"
        ? Array.from({ length: 11 }, (_, i) =>
            child(`low${i}`, "early", 100 - i),
          )
        : [child("winner", "late", 9000), child("low0", "late", 100)],
    windows: [],
    cost_micros: 1,
  }));
  vi.mocked(filterRootTrends).mockImplementation(async (rows) => ({
    candidates: rows,
    filtered: [],
    cost_micros: 0,
  }));
  const run = (rows: Candidate[]) =>
    expandSecondLevel(cfg, rows, { candidates: rows }, undefined, query);
  const first = await run(all);
  const second = await run([...all].reverse());
  expect(first.discovered.map((r: Candidate) => r.term)).toEqual([
    "winner",
    ...Array.from({ length: 9 }, (_, i) => `low${i}`),
  ]);
  expect(second.discovered.map((r: Candidate) => r.term)).toEqual(
    first.discovered.map((r: Candidate) => r.term),
  );
  expect(first.deferred.map((r: Candidate) => r.term)).toEqual([
    "low9",
    "low10",
  ]);
  for (const [rows] of vi.mocked(filterRootTrends).mock.calls)
    expect(rows.map((r) => r.term)).not.toContain("low9");
  expect(all).toEqual(original);
  expect(
    first.discovered.find((r: Candidate) => r.term === "low0").appearances,
  ).toHaveLength(2);
});

it("曲线失败前已原子归档二级排名、来源和超限名单，可独立离线读取", async () => {
  const state = mkdtempSync(join(tmpdir(), "trends-batch-"));
  try {
    const rows = [parent("early")];
    vi.mocked(filterRootTrends).mockImplementation(async () => {
      throw new Error("simulated interruption");
    });
    const query = async () => ({
      candidates: Array.from({ length: 12 }, (_, i) =>
        child(`term${i}`, "early", 100 - i),
      ),
      windows: [{ request: { keywords: ["early"] } }],
      cost_micros: 1,
    });
    await expect(
      expandSecondLevel(
        loadConfig("config.example.json"),
        rows,
        { candidates: rows },
        undefined,
        query,
        (snapshot) => saveSecondLevelBatch(state, snapshot),
      ),
    ).rejects.toThrow("simulated interruption");
    const files = readdirSync(join(state, "trends-batches"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json\.gz$/);
    const saved = loadSnap<{
      discovered: Candidate[];
      deferred: Candidate[];
      sorting_strategy: string;
    }>(state, `trends-batches/${files[0].replace(/\.json\.gz$/, "")}`)!;
    expect(saved.discovered).toHaveLength(10);
    expect(saved.deferred).toHaveLength(2);
    expect(saved.sorting_strategy).toBe("rising-v1");
    expect(saved.discovered[0].appearances[0].root_path).toEqual([
      "game",
      "early",
      "term0",
    ]);
    expect(saved.discovered[0].priority?.rank).toBe(1);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

it("有效零增长优先于缺失及非法增长，缺失不伪装成零", () => {
  const rows = rankSecondLevel([
    child("missing", "p", undefined),
    child("zero", "p", 0),
    child("invalid", "p", "oops"),
    child("negative", "p", -1),
  ]);
  expect(rows[0].term).toBe("zero");
  expect(rows[0].priority.max_growth).toBe(0);
  expect(rows.slice(1).every((row) => row.priority.max_growth === null)).toBe(
    true,
  );
});
