import { it, expect, vi, afterEach } from "vitest";
import {
  recordModelUsage,
  withModelCosts,
  modelPrice,
} from "../src/model-costs.js";
import { chat } from "../src/aisa.js";
import { run } from "../src/cli.js";
import { costLines } from "../src/report.js";
import { setLang } from "../src/core.js";
import { summary } from "../scripts/notify-report.js";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it.each([
  ["gpt-4.1-mini", 720],
  ["deepseek-v4.1-flash", 509.2],
  ["deepseek/deepseek-v4.1-flash", 509.2],
  ["openai/gpt-4.1-mini", 720],
  ["claude-sonnet-4.6", 6000],
  ["claude-sonnet-4-6", 6000],
  ["anthropic/claude-sonnet-4.6", 6000],
])("prices %s by returned token usage", async (model, cost) => {
  const result = await withModelCosts(async () => {
    recordModelUsage(String(model), {
      prompt_tokens: 1000,
      completion_tokens: 200,
    });
    return { cost_micros: 400 };
  });
  expect(result.cost_micros).toBe(Number(cost) + 400);
  expect(result.model_cost_micros).toBe(cost);
  expect(result.model_unpriced_calls).toBe(0);
});
it("applies cached input price without double charging tokens", async () => {
  const r = await withModelCosts(async () => {
    recordModelUsage("gpt-4.1-mini", {
      prompt_tokens: 1000,
      completion_tokens: 200,
      prompt_tokens_details: { cached_tokens: 500 },
    });
    return {};
  });
  expect(r.cost_micros).toBeCloseTo(570);
});
it("isolates concurrently running analyses", async () => {
  const costs = await Promise.all(
    ["gpt-4.1-mini", "claude-sonnet-4.6"].map((model) =>
      withModelCosts(async () => {
        await Promise.resolve();
        recordModelUsage(model, {
          prompt_tokens: 1000,
          completion_tokens: 200,
        });
        return {};
      }),
    ),
  );
  expect(costs.map((c) => c.cost_micros)).toEqual([720, 6000]);
});
it.each([
  ["unknown", { prompt_tokens: 1000, completion_tokens: 200 }],
  ["gpt-4.1-mini", undefined],
  ["gpt-4.1-mini", { prompt_tokens: -1, completion_tokens: 2 }],
])("flags unpriced model call %s", async (model, usage) => {
  const r = await withModelCosts(async () => {
    recordModelUsage(model, usage);
    return {};
  });
  expect(r.model_unpriced_calls).toBe(1);
});
it("aisa chat records actual usage while preserving its string return value", async () => {
  vi.stubEnv("AISA_API_KEY", "test");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
          choices: [{ message: { content: "answer" } }],
        }),
      ),
    ),
  );
  const r = await withModelCosts(async () => ({
    answer: await chat("gpt-4.1-mini", "system", "user"),
  }));
  expect(r).toMatchObject({ answer: "answer", cost_micros: 720 });
});
it("known model costs survive a later step failure", async () => {
  const r = await run(() =>
    withModelCosts(async () => {
      recordModelUsage("gpt-4.1-mini", {
        prompt_tokens: 1000,
        completion_tokens: 200,
      });
      throw new Error("Trends failed");
    }),
  );
  expect(r.cost_micros).toBe(720);
  expect(r.error).toContain("Trends failed");
});
it("reports and notification summaries include precise totals and incomplete estimates", () => {
  setLang("en");
  const lines = costLines(
    { cost_micros: 400 },
    { cost_micros: 720, model_unpriced_calls: 1 },
  );
  expect(lines[0]).toContain("$0.0011");
  expect(lines[1]).toContain("1 model calls");
  expect(summary(lines.join("\n"))).toContain("$0.0011");
  expect(summary(lines.join("\n"))).toContain("Cost estimate incomplete");
});

// 用户没有提供缓存折扣，避免低估费用；历史 Sonnet 价格继续保留。
it("uses supplied DeepSeek rates including cached input at regular price", () => {
  const p = modelPrice("deepseek-v4.1-flash", {
    prompt_tokens: 1000,
    completion_tokens: 200,
    prompt_tokens_details: { cached_tokens: 500 },
  });
  expect(p.cost_micros).toBeCloseTo(509.2);
  expect(p.pricing_source).toContain("User supplied");
  expect(p.rates).toEqual({ input: 0.283, output: 1.131, cached: 0.283 });
});
