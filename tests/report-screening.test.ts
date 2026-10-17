import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screenReportTerms } from "../src/report-screening.js";
import { collectTerms } from "../src/brief-report.js";
import { loadConfig } from "../src/core.js";
import { Store } from "../src/store.js";
import { filterRootTrends } from "../src/trends-filter.js";
import { researchCandidates } from "../src/candidate-research.js";
vi.mock("../src/trends-filter.js", () => ({
  filterRootTrends: vi.fn(async (rows) => ({
    candidates: rows
      .filter((r: { term: string }) => r.term === "keyword pass")
      .map((r: { term: string }) => ({
        ...r,
        trend_filter: { status: "passed" },
      })),
    filtered: rows.filter((r: { term: string }) => r.term !== "keyword pass"),
    cost_micros: 303,
  })),
}));
vi.mock("../src/candidate-research.js", () => ({
  researchCandidates: vi.fn(async (rows) => ({
    candidates: rows.map((r: { term: string }) => ({
      ...r,
      classification: { is_offline_sports_event: false },
    })),
    filtered: [],
  })),
}));
afterEach(() => vi.clearAllMocks());
it("任何来源必须通过曲线：其他来源补查，已有结果复用，失败词不能换来源绕过", async () => {
  const state = mkdtempSync(join(tmpdir(), "report-screening-")),
    store = new Store(state);
  try {
    const blocks = {
      trends: {
        candidates: [
          {
            term: "root pass",
            context: "evidence",
            trend_filter: { status: "passed" },
            classification: { is_offline_sports_event: false },
          },
        ],
        filtered: [{ term: "blocked", trend_filter: { status: "excluded" } }],
      },
      sitemap: {
        pages: {
          candidates: [
            {
              keyword: "page pass",
              term: "page pass",
              url: "https://example.test/game",
              trend_filter: { status: "passed" },
              classification: { is_offline_sports_event: false },
            },
          ],
        },
      },
    };
    const result = await screenReportTerms(
      loadConfig("config.example.json"),
      store,
      [{ term: "lead fail" }, { term: "blocked" }],
      blocks,
      { rows: [{ phrase: "keyword pass" }] },
    );
    expect(result.rows.map((r: { term: string }) => r.term)).toEqual([
      "root pass",
      "keyword pass",
      "page pass",
    ]);
    expect(
      vi.mocked(filterRootTrends).mock.calls[0][0].map((r) => r.term),
    ).toEqual(["lead fail", "keyword pass"]);
    expect(
      vi.mocked(researchCandidates).mock.calls[0][0].map((r) => r.term),
    ).toEqual(["keyword pass"]);
    expect(
      collectTerms([{ term: "bypass" }], { candidate_screening: result }, {}),
    ).toEqual([{ term: "bypass", context: "" }]);
  } finally {
    store.close();
    rmSync(state, { recursive: true, force: true });
  }
});
