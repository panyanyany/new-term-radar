import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageDiff } from "../src/pages.js";
import { diff } from "../src/sitemaps.js";
import { loadPageBatch } from "../src/page-batches.js";
import { main, run } from "../src/cli.js";
import { filterRootTrends } from "../src/trends-filter.js";
import { loadConfig } from "../src/core.js";
import { SourceDataError } from "../src/source-errors.js";

vi.mock("../src/page-keywords.js", () => ({
  extractPageKeywords: vi.fn(async (_store, rows: { title: string }[]) =>
    rows.map((r) => ({ keyword: r.title, explanation: "工具" })),
  ),
}));
vi.mock("../src/trends-filter.js", () => ({ filterRootTrends: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("研究抛错后原始批次仍可显式补查，不删除快照或自动回灌", async () => {
  const state = mkdtempSync(join(tmpdir(), "page-recovery-"));
  const cfg = loadConfig("config.example.json");
  cfg.pages = { test: { url: "https://example.test/" } };
  cfg.sitemaps = {};
  let html = '<a href="/old-tool">Old Tool</a>';
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(html, { headers: { "content-type": "text/html" } }),
    ),
  );
  try {
    await pageDiff(cfg, state);
    html += '<a href="/new-tool">New Tool</a>';
    const error = new ReferenceError("research bug");
    vi.mocked(filterRootTrends).mockRejectedValueOnce(error);
    await expect(diff(cfg, state)).rejects.toBe(error);
    const files = readdirSync(join(state, "page-batches"));
    expect(files).toHaveLength(1);
    const batch = files[0].replace(".json.gz", "");
    const saved = loadPageBatch(state, batch);
    expect(saved.candidates[0]).toMatchObject({
      keyword: "New Tool",
      url: "https://example.test/new-tool",
    });
    expect((await pageDiff(cfg, state)).candidates).toEqual([]);
    vi.mocked(filterRootTrends).mockResolvedValueOnce({
      candidates: [],
      filtered: [{ term: "New Tool", trend_filter: { status: "excluded" } }],
      cost_micros: 303,
    });
    const output: string[] = [];
    await main(
      [
        "replay-pages",
        "--batch",
        batch,
        "--config",
        "config.example.json",
        "--state",
        state,
      ],
      (value) => output.push(value),
    );
    expect(JSON.parse(output[0])).toMatchObject({
      research_batch: batch,
      candidates: [],
      curve_filtered: [{ term: "New Tool" }],
    });
    expect(readdirSync(join(state, "page-batches"))).toEqual(files);
    expect((await pageDiff(cfg, state)).candidates).toEqual([]);
    expect(() => loadPageBatch(state, "../../config")).toThrow(
      "invalid page batch ID",
    );
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

it("网页研究的程序错误保留堆栈上抛，预期上游错误仅警告并局部降级", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const error = new ReferenceError("research bug");
    await expect(
      run(
        () => {
          throw error;
        },
        false,
        "sitemaps",
      ),
    ).rejects.toBe(error);
    expect(log.mock.calls[0][0]).toContain("stack");
    expect(log.mock.calls[0][0]).toContain("sitemaps_run");
    expect(
      await run(
        () => {
          throw new SourceDataError("upstream invalid");
        },
        false,
        "sitemaps",
      ),
    ).toMatchObject({ error: "SourceDataError: upstream invalid" });
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
    warn.mockRestore();
  }
});
