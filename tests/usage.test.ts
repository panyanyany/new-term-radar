import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  withUsageRun,
  withUsageModule,
  tracked,
  currentUsage,
  usageSummary,
} from "../src/usage.js";
import { request } from "../src/twitter-aio.js";
import { chat, call } from "../src/aisa.js";
import { call as goanyCall } from "../src/goanyapi.js";
import { costSummary, costLines } from "../src/report.js";
import { summary } from "../scripts/notify-report.js";
import { main } from "../src/cli.js";
import { type Data } from "../src/core.js";
const dirs: string[] = [];
function state() {
  const d = mkdtempSync(join(tmpdir(), "radar-usage-"));
  dirs.push(d);
  return d;
}
function rows(dir: string): Data[] {
  const db = new Database(join(dir, "radar.db"));
  try {
    return db.prepare("SELECT * FROM api_usage ORDER BY id").all() as Data[];
  } finally {
    db.close();
  }
}
function response(body: Data, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
it("persists successful requests before later pipeline failure and reports ledger totals once", async () => {
  const dir = state();
  await expect(
    withUsageRun(dir, "daily", async () => {
      await withUsageModule("x", () =>
        tracked(
          { provider: "test", endpoint: "page" },
          async () => ({}),
          () => ({
            cost_micros: 400,
            pricing_source: "fixed",
            rates: { request_micros: 400 },
          }),
        ),
      );
      expect(costSummary({ cost_micros: 999999 }).cost_micros).toBe(400);
      expect(costLines({}).join("\n")).toContain("$0.0004");
      throw Error("later step failed");
    }),
  ).rejects.toThrow("later step failed");
  const saved = rows(dir);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    status: "success",
    module: "x",
    cost_micros: 400,
    pricing_status: "priced",
  });
  expect(usageSummary(dir).cost_micros).toBe(400);
});
it("keeps concurrent run IDs and module attribution isolated", async () => {
  const dir = state();
  await Promise.all(
    ["x", "usecases"].map((module) =>
      withUsageRun(dir, "daily", async () =>
        withUsageModule(module, async () => {
          await Promise.resolve();
          await tracked(
            { provider: "test", endpoint: module },
            async () => 1,
            () => ({ cost_micros: 1, pricing_source: "test" }),
          );
          expect(currentUsage()?.rows[0].requests).toBe(1);
        }),
      ),
    ),
  );
  expect(new Set(rows(dir).map((r) => r.run_id)).size).toBe(2);
  expect(
    usageSummary(dir, 30, "module")
      .rows.map((r: Data) => r.name)
      .sort(),
  ).toEqual(["usecases", "x"]);
});
it("records pending before network completion and leaves unknown cost after timeout", async () => {
  const dir = state();
  await withUsageRun(dir, "keywords", async () => {
    await expect(
      tracked(
        { provider: "scrappa", endpoint: "google-trends-interest" },
        async () => {
          expect(rows(dir)[0]).toMatchObject({
            status: "pending",
            cost_micros: null,
          });
          throw Error("timeout secret body");
        },
        () => ({ cost_micros: null, pricing_source: "unknown" }),
      ),
    ).rejects.toThrow("timeout");
  });
  expect(rows(dir)[0]).toMatchObject({
    status: "failed",
    pricing_status: "unknown",
    cost_micros: null,
  });
  expect(JSON.stringify(rows(dir))).not.toContain("secret body");
});
it("charges every AIO attempt including failed pages without saving search text", async () => {
  const dir = state();
  vi.stubEnv("TWITTER_AIO_RAPIDAPI_KEY", "private-key");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response({ entries: [] }))
      .mockRejectedValueOnce(Error("timeout")),
  );
  await withUsageRun(dir, "keywords", async () => {
    await request("/search/private-query");
    await expect(
      request("/search/private-query", { cursor: "private-cursor" }),
    ).rejects.toThrow("request failed");
  });
  expect(usageSummary(dir).cost_micros).toBe(800);
  expect(rows(dir).map((r) => r.status)).toEqual(["success", "failed"]);
  expect(JSON.stringify(rows(dir))).not.toMatch(
    /private-key|private-query|private-cursor/,
  );
});
it("saves model token usage, cache rates, response ID and unknown model usage", async () => {
  const dir = state();
  vi.stubEnv("AISA_API_KEY", "private-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() =>
      Promise.resolve(
        response({
          id: "req-123",
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
            prompt_tokens_details: { cached_tokens: 500 },
          },
          choices: [{ message: { content: "answer" } }],
        }),
      ),
    ),
  );
  await withUsageRun(dir, "keywords", async () => {
    await chat("gpt-4.1-mini", "private-system", "private-prompt");
    await chat("unknown-model", "secret", "secret");
  });
  expect(rows(dir)[0]).toMatchObject({
    cost_micros: 570,
    input_tokens: 1000,
    output_tokens: 200,
    cached_tokens: 500,
    request_id: "req-123",
  });
  expect(JSON.parse(rows(dir)[0].rates)).toEqual({
    input: 0.4,
    output: 1.6,
    cached: 0.1,
  });
  expect(rows(dir)[1]).toMatchObject({
    cost_micros: null,
    input_tokens: 1000,
    pricing_status: "unknown",
  });
  expect(JSON.stringify(rows(dir))).not.toMatch(
    /private-system|private-prompt|private-key/,
  );
});
it("records AIsa per-tool charges including failed and missing batch results", async () => {
  const dir = state();
  vi.stubEnv("AISA_API_KEY", "test");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      response({
        results: [
          {
            call_id: "a",
            successful: true,
            customer_cost_micros_usd: 90000,
            data: {},
          },
          {
            call_id: "b",
            successful: false,
            customer_cost_micros_usd: 3000,
            request_id: "req-b",
          },
        ],
      }),
    ),
  );
  await withUsageRun(dir, "daily", () =>
    call([
      { call_id: "a", tool: "ads", arguments: {} },
      { call_id: "b", tool: "search", arguments: {} },
      { call_id: "c", tool: "missing", arguments: {} },
    ]),
  );
  expect(rows(dir).map((r) => [r.endpoint, r.status, r.cost_micros])).toEqual([
    ["ads", "success", 90000],
    ["search", "failed", 3000],
    ["missing", "failed", null],
  ]);
  expect(usageSummary(dir)).toMatchObject({
    requests: 3,
    cost_micros: 93000,
    unpriced: 1,
  });
});
it("records each GoAnyAPI retry independently", async () => {
  const dir = state();
  vi.stubEnv("GOANYAPI_API_KEY", "test");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(Error("timeout"))
      .mockResolvedValueOnce(
        response({ code: "ok", data: { costCredits: 6 } }),
      ),
  );
  await withUsageRun(dir, "keywords", () => goanyCall("google-trends", {}));
  expect(rows(dir).map((r) => [r.status, r.cost_micros])).toEqual([
    ["failed", null],
    ["success", 6000],
  ]);
});
it("queries CLI costs without config or API requests and validates grouping", async () => {
  const dir = state(),
    out: string[] = [];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await withUsageRun(dir, "daily", () =>
    tracked(
      { provider: "test", endpoint: "page" },
      async () => 1,
      () => ({ cost_micros: 400, pricing_source: "test" }),
    ),
  );
  expect(
    await main(
      [
        "costs",
        "--state",
        dir,
        "--config",
        "missing.json",
        "--days=30",
        "--by",
        "day",
        "--json",
      ],
      (s) => out.push(s),
    ),
  ).toBe(0);
  expect(JSON.parse(out[0])).toMatchObject({
    requests: 1,
    cost_micros: 400,
    by: "day",
    days: 30,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(() => usageSummary(dir, 30, "invalid")).toThrow("--by");
});

it("marks unknown data costs in both report and notification summary", async () => {
  const dir = state();
  await withUsageRun(dir, "daily", async () => {
    await tracked(
      { provider: "aisa", endpoint: "missing-fee" },
      async () => ({}),
      () => ({ cost_micros: null, pricing_source: "response" }),
    );
    expect(summary(costLines({}).join("\n"))).toMatch(
      /费用估算不完整|Cost estimate incomplete/,
    );
  });
});
