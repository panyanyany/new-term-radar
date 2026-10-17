import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withResearchCache, cachedSearch } from "../src/research-cache.js";
import { googleSearchResult } from "../src/scrappa.js";
import { withUsageRun, withUsageModule, usageSummary } from "../src/usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("相同搜索跨模块共享请求与费用，模式和运行范围分别隔离", async () => {
  const state = mkdtempSync(join(tmpdir(), "research-cache-"));
  vi.stubEnv("SCRAPPA_API_KEY", "test");
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          organic_results: [
            {
              title: "test tool",
              snippet: "test tool online",
              link: "https://example.test/tool",
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await withUsageRun(state, "test", async () => {
      const first = await withUsageModule("trends", () =>
        googleSearchResult("test tool", "broad"),
      );
      first.evidence[0].title = "local mutation";
      const second = await withUsageModule("sitemaps", () =>
        googleSearchResult("test tool", "broad"),
      );
      expect(first.costMicros).toBe(303);
      expect(second.costMicros).toBe(0);
      expect(second.evidence[0].title).toBe("test tool");
      second.evidence[0].title = "changed";
      expect(first.evidence[0].title).toBe("local mutation");
      await googleSearchResult("test tool", "exact");
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await withUsageRun(state, "test", () =>
      googleSearchResult("test tool", "broad"),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(usageSummary(state, 1).requests).toBe(3);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

it("并发相同查询共享Promise，失败可显式再查，独立运行不共享", async () => {
  const call = vi.fn(async () => ({ value: 1 }));
  await withResearchCache(async () => {
    const results = await Promise.all([
      cachedSearch("same", call),
      cachedSearch("same", call),
    ]);
    expect(results.map((r) => r.reused)).toEqual([false, true]);
    const fail = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("ok");
    await expect(cachedSearch("failed", fail)).rejects.toThrow("network");
    expect((await cachedSearch("failed", fail)).value).toBe("ok");
  });
  await Promise.all(
    [1, 2].map(() => withResearchCache(() => cachedSearch("same", call))),
  );
  expect(call).toHaveBeenCalledTimes(3);
});
