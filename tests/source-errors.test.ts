import { withoutCosts } from "../scripts/notify-report.js";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonFetch } from "../src/core.js";
import { chat } from "../src/aisa.js";
import { callMany, ScrappaError } from "../src/scrappa.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  SourceDataError,
  SourceConfigError,
  SourceTransportError,
  expectedSourceError,
} from "../src/source-errors.js";
import { seedPreviousReport } from "../src/brief-report.js";
import { Store } from "../src/store.js";
import { costSummary, costLines } from "../src/cost-report.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
// 错误示范：错误文案中包含 key，不应把上游数据错误误判为配置错误。
it("错误类别与文案无关，程序错误不能降级", () => {
  expect(expectedSourceError(new ScrappaError("invalid keyword"))).toBe(true);
  expect(
    expectedSourceError(new SourceConfigError("missing credentials")),
  ).toBe(false);
  for (const error of [
    new RangeError("bug"),
    new ReferenceError("bug"),
    new Error("HTTP 502"),
  ])
    expect(expectedSourceError(error)).toBe(false);
});
it("HTTP 和非法 JSON 在响应边界归类，内部错误保留原异常", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 502 }))
      .mockResolvedValueOnce(new Response("not-json")),
  );
  await expect(jsonFetch("https://test.invalid")).rejects.toBeInstanceOf(
    SourceTransportError,
  );
  await expect(jsonFetch("https://test.invalid")).rejects.toMatchObject({
    name: "SourceDataError",
    cause: expect.any(SyntaxError),
  });
  const error = new RangeError("internal bug");
  vi.mocked(fetch).mockRejectedValueOnce(error);
  await expect(jsonFetch("https://test.invalid")).rejects.toBe(error);
});
it("聊天响应缺少正文属于上游数据错误", async () => {
  vi.stubEnv("AISA_API_KEY", "test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null")));
  await expect(chat("test", "system", "user")).rejects.toBeInstanceOf(
    SourceDataError,
  );
});
it("MCP 仅包装已知 SDK 故障，未知程序错误原样抛出", async () => {
  vi.stubEnv("SCRAPPA_API_KEY", "test");
  vi.spyOn(Client.prototype, "close").mockResolvedValue();
  const connect = vi.spyOn(Client.prototype, "connect");
  for (const error of [
    new RangeError("bug"),
    new ReferenceError("bug"),
    new TypeError("bug"),
  ]) {
    connect.mockRejectedValueOnce(error);
    await expect(callMany([["test", {}]])).rejects.toBe(error);
  }
  connect.mockRejectedValueOnce(new McpError(-32000, "upstream failure"));
  await expect(callMany([["test", {}]])).rejects.toBeInstanceOf(
    SourceTransportError,
  );
});
it("损坏旧报告有警告，数据库故障必须抛出", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-errors-"));
  const store = new Store(dir);
  const file = join(dir, "previous.json");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    writeFileSync(file, "broken");
    expect(() => seedPreviousReport(store, file)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    writeFileSync(file, JSON.stringify({ brief_terms: [] }));
    store.close();
    expect(() => seedPreviousReport(store, file)).toThrow();
    expect(warn).toHaveBeenCalledOnce();
  } finally {
    if (store.db.open) store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("无账本时模块部分费用不能展示为完整总额", () => {
  expect(costSummary({ cost_micros: 303, cost_complete: false })).toMatchObject(
    { cost_micros: 303, cost_complete: false },
  );
  const text = costLines({ cost_micros: 303, cost_complete: false }).join("\n");
  expect(text).toContain("费用不完整");
  expect(withoutCosts(text)).not.toContain("$");
});
