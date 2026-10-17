import { screenReportTerms } from "../src/report-screening.js";
import { researchPages } from "../src/page-research.js";
import { renderSite } from "../src/site.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { rememberDiscoveries } from "../src/term-observations.js";
import { discoverRoots } from "../src/trends-roots.js";
import {
  createBrief,
  briefReport,
  rememberTerms,
} from "../src/brief-report.js";
import { loadConfig } from "../src/core.js";
import { withUsageRun, usageSummary } from "../src/usage.js";
const m = vi.hoisted(() => ({ callTool: vi.fn() }));
// 只替换外部 MCP SDK，内部曲线、搜索、分类和日报均执行真实代码。
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = async () => {};
    callTool = m.callTool;
    close = async () => {};
  },
}));
vi.mock(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js")
    >()),
    StreamableHTTPClientTransport: class {},
  }),
);
let state: string, store: Store;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "radar-integration-"));
  store = new Store(state);
  vi.stubEnv("AISA_API_KEY", "test");
  vi.stubEnv("SCRAPPA_API_KEY", "test");
  vi.clearAllMocks();
});
afterEach(() => {
  store.close();
  rmSync(state, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("真实模块串联：记录原始发现，仅明确线下体育赛事不进入解释与日报", async () => {
  const names = ["fresh tool", "sports match", "uncertain game", "established"];
  const now = Date.now(),
    hour = Math.floor(now / 3600000) * 3600000;
  m.callTool.mockImplementation(
    async (input: { arguments: { params: string } }) => ({
      structuredContent: {
        timeline_data: Array.from({ length: 168 }, (_, i) => ({
          timestamp: (hour - (168 - i) * 3600000) / 1000,
          values: [
            { query: "hex picker", value: 10 },
            ...JSON.parse(input.arguments.params)
              .q.split(",")
              .slice(1)
              .map((term: string) => ({
                query: term,
                value:
                  term === "established" || term.startsWith("steady")
                    ? 20
                    : i < 120
                      ? 0
                      : i < 144
                        ? 5
                        : 20,
              })),
          ],
        })),
      },
    }),
  );
  const searched: string[] = [],
    explained: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const response = (data: unknown) => new Response(JSON.stringify(data));
      if (url.pathname.endsWith("aisa-batch-quote"))
        return response({ results: [{ successful: true }] });
      if (url.pathname.endsWith("aisa-batch-use"))
        return response({
          results: [
            {
              call_id: "root_0_1",
              successful: true,
              customer_cost_micros_usd: 11000,
              data: {
                status_code: 20000,
                tasks_error: 0,
                tasks: [
                  {
                    status_code: 20000,
                    result: [
                      {
                        check_url:
                          "https://trends.google.com/trends/explore?cat=8&q=game&date=now%201-d",
                        items: [
                          {
                            type: "google_trends_queries_list",
                            data: {
                              rising: names.map((query) => ({
                                query,
                                value: 100,
                              })),
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        });
      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("query")!;
        searched.push(q);
        return response({
          organic_results: [
            {
              title: q,
              snippet: "Search evidence",
              link: `https://example.test/${encodeURIComponent(q)}`,
            },
          ],
        });
      }
      if (url.pathname.endsWith("chat/completions")) {
        const body = JSON.parse(String(init!.body));
        const rows = JSON.parse(body.messages[1].content);
        const classification =
          body.messages[0].content.includes("候选词分类员");
        const answer = rows.map((r: { i: number; term: string }) =>
          classification
            ? {
                term: r.term,
                decision:
                  r.term === "fresh tool"
                    ? "confirmed"
                    : r.term === "sports match"
                      ? "rejected"
                      : "uncertain",
                is_online_tool: r.term === "fresh tool",
                is_online_game: false,
                is_offline_sports_event: r.term === "sports match",
                reason: "按搜索证据判断",
                evidence_indices: [0],
              }
            : (explained.push(r.term),
              { i: r.i, explanation: "可在线使用的工具。", reliable: true }),
        );
        return response({
          choices: [{ message: { content: JSON.stringify(answer) } }],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        });
      }
      throw new Error(`unexpected endpoint ${url.pathname}`);
    }),
  );
  // 历史只影响新旧，不能补入候选；当前词即使后来才分类通过也保留原始发现时间。
  rememberDiscoveries(
    store,
    [{ term: "fresh tool" }],
    new Date(now - 48 * 3600000),
  );
  rememberTerms(store, [{ term: "historical unrelated", context: "旧词" }]);
  const cfg = loadConfig("config.example.json");
  cfg.trends_roots.windows = [1];
  cfg.trends_roots.provider = "aisa";
  await withUsageRun(state, "integration", async () => {
    const trends = await discoverRoots(cfg, (rows) =>
      rememberDiscoveries(store, rows),
    );
    expect(trends.filtered.map((r: { term: string }) => r.term)).toEqual([
      "established",
    ]);
    expect(trends.candidates).toHaveLength(2);
    expect(trends.classification_filtered[0]).toMatchObject({
      term: "sports match",
      classification: { is_offline_sports_event: true },
    });
    expect(
      trends.candidates.map(
        (r: { classification: { decision: string } }) =>
          r.classification.decision,
      ),
    ).toEqual(["confirmed", "uncertain"]);
    expect(searched).toEqual(["fresh tool", "sports match", "uncertain game"]);
    const pages = await researchPages(cfg, state, {
      candidates: [
        {
          keyword: "page game",
          url: "https://example.test/game",
          anchors: ["Play online"],
        },
        {
          keyword: "steady page",
          url: "https://example.test/steady",
          anchors: [],
        },
      ],
    });
    const lead = [
      { term: "lead game" },
      { term: "steady lead" },
      { term: "sports match" },
      { term: "established" },
    ];
    const keywords = {
      rows: [{ phrase: "keyword tool" }, { phrase: "steady keyword" }],
    };
    const blocks = { trends, sitemap: { pages } };
    const screened = await screenReportTerms(
      cfg,
      store,
      lead,
      blocks,
      keywords,
    );
    const brief = await createBrief(cfg, store, screened.rows);
    expect(brief.error).toBeUndefined();
    expect(explained.sort()).toEqual(
      [
        "fresh tool",
        "uncertain game",
        "page game",
        "lead game",
        "keyword tool",
      ].sort(),
    );
    expect(searched).not.toContain("steady page");
    expect(searched).not.toContain("steady lead");
    expect(searched).not.toContain("steady keyword");
    const html = renderSite(
      { ...blocks, candidate_screening: screened, brief_terms: brief.rows },
      new Date(),
    );
    for (const term of [
      "sports match",
      "steady page",
      "steady lead",
      "steady keyword",
      "established",
    ])
      expect(html).not.toContain(term);
    expect(html).toContain("page game");
    expect(
      brief.rows.some((r: { term: string }) => r.term === "sports match"),
    ).toBe(false);
    const md = briefReport(brief.rows);
    expect(md.split("## 2. 旧词")[0]).not.toContain("fresh tool:");
    expect(md.split("## 2. 旧词")[1]).toContain("fresh tool:");
    expect(md).not.toContain("historical unrelated");
  });
  expect(
    store.db.prepare("SELECT count(*) n FROM term_discoveries").get(),
  ).toEqual({ n: 10 });
  expect(usageSummary(state, 1).unpriced).toBe(0);
});
